import { strict as assert } from 'node:assert';
import { after, test } from 'node:test';
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signInAnonymously,
} from 'firebase/auth';

import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from 'firebase/functions';
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import type {
  AckWorkshopTransitionOutput,
  GetReportJobOutput,
  CreateReportDownloadInput,
  CreateReportDownloadOutput,
  QueueReportGenerationInput,
  QueueReportGenerationOutput,
} from '../shared/contracts';

const projectId = 'demo-kreatum';
const organizationId = 'org-integration';
const lifecycleTimeoutMs = process.platform === 'win32' ? 1_200_000 : 420_000;
const apps: FirebaseApp[] = [];
let rulesEnvironment: RulesTestEnvironment | undefined;

const createClient = (name: string) => {
  const app = initializeApp({
    apiKey: 'fake-api-key',
    authDomain: projectId + '.firebaseapp.com',
    projectId,
    storageBucket: projectId + '.appspot.com',
  }, name);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const functions = getFunctions(app, 'europe-west1');
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  return { app, auth, functions };
};

const call = async <Input, Output>(
  functions: ReturnType<typeof getFunctions>,
  name: string,
  input: Input,
) => httpsCallable<Input, Output>(functions, name)(input).then((result) => result.data);

after(async () => {
  if (rulesEnvironment) await rulesEnvironment.cleanup();
  await Promise.all(apps.map((app) => deleteApp(app)));
});

test('runs the protected workshop lifecycle without changing the game contract', {
  timeout: lifecycleTimeoutMs,
}, async () => {
  rulesEnvironment = await initializeTestEnvironment({ projectId });

  const ownerClient = createClient('owner-' + Date.now());
  const ownerCredential = await createUserWithEmailAndPassword(
    ownerClient.auth,
    'owner-' + Date.now() + '@kreatum.test',
    'Kreatum-Test-123!',
  );

  await rulesEnvironment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await setDoc(doc(firestore, 'organizations', organizationId), {
      name: 'KREATUM Integration',
      status: 'active',
      commercial: {
        plan: 'pilot',
        status: 'active',
        validFrom: Timestamp.fromMillis(Date.now() - 60_000),
        validUntil: null,
        includedWorkshops: 3,
        additionalWorkshops: 0,
        consumedWorkshops: 0,
      },
    });
    await setDoc(
      doc(firestore, 'organizations', organizationId, 'members', ownerCredential.user.uid),
      {
        role: 'owner',
        status: 'active',
      },
    );
  });

  const analystClient = createClient('analyst-' + Date.now());
  const analystCredential = await createUserWithEmailAndPassword(
    analystClient.auth,
    'analyst-' + Date.now() + '@kreatum.test',
    'Kreatum-Test-123!',
  );
  await rulesEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(
      doc(context.firestore(), 'organizations', organizationId, 'members', analystCredential.user.uid),
      { role: 'analyst', status: 'active' },
    );
  });

  const participantClient = createClient('participant-' + Date.now());
  const participantCredential = await signInAnonymously(participantClient.auth);

  await assert.rejects(
    call(participantClient.functions, 'createWorkshop', {
      organizationId,
      client: 'Empresa',
      facilitator: 'Facilitador',
      challenge: 'Reto',
      idempotencyKey: 'anonymous-create-001',
    }),
    (error: { code?: string }) => error.code === 'functions/permission-denied',
  );
  await rulesEnvironment.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(
      context.firestore(),
      'organizations',
      organizationId,
      'members',
      ownerCredential.user.uid,
    ), { status: 'disabled' });
  });
  await assert.rejects(call(ownerClient.functions, 'createWorkshop', {
    organizationId,
    client: 'Empresa revocada',
    facilitator: 'Facilitador KREATUM',
    challenge: 'No debe consumir crédito',
    idempotencyKey: 'revoked-create-001',
  }), (error: { code?: string }) => error.code === 'functions/permission-denied');
  await rulesEnvironment.withSecurityRulesDisabled(async (context) => {
    const organizationSnapshot = await getDoc(doc(context.firestore(), 'organizations', organizationId));
    assert.equal(organizationSnapshot.data()?.commercial?.consumedWorkshops, 0);
    await updateDoc(doc(
      context.firestore(),
      'organizations',
      organizationId,
      'members',
      ownerCredential.user.uid,
    ), { status: 'active' });
  });
  const created = await call<
    {
      organizationId: string;
      client: string;
      facilitator: string;
      challenge: string;
      customCode: string;
      idempotencyKey: string;
    },
    {
      workshopId: string;
      roomCode: string;
      schemaVersion: number;
      creditsRemaining: number | null;
    }
  >(ownerClient.functions, 'createWorkshop', {
    organizationId,
    client: 'Empresa contratante',
    facilitator: 'Facilitador KREATUM',
    challenge: 'Resolver el reto de innovación',
    customCode: 'TEST42',
    idempotencyKey: 'create-workshop-001',
  });

  assert.equal(created.roomCode, 'TEST42');
  assert.equal(created.schemaVersion, 2);

  assert.equal(created.creditsRemaining, 2);
  const resumed = await call<
    { roomCode: string; idempotencyKey: string },
    { workshopId: string; roomCode: string; status: string }
  >(ownerClient.functions, 'resumeWorkshopByCode', {
    roomCode: 'test42',
    idempotencyKey: 'resume-workshop-001',
  });
  assert.equal(resumed.workshopId, created.workshopId);
  assert.equal(resumed.status, 'active');

  const joined = await call<
    { roomCode: string; idempotencyKey: string },
    { workshopId: string; team: string | null; expiresAt: number }
  >(participantClient.functions, 'joinWorkshopByCode', {
    roomCode: 'test42',
    idempotencyKey: 'join-workshop-001',
  });
  assert.equal(joined.workshopId, created.workshopId);
  assert.equal(joined.team, null);
  assert.ok(joined.expiresAt > Date.now());

  await call(participantClient.functions, 'selectTeam', {
    workshopId: created.workshopId,
    team: 'Agua',
    idempotencyKey: 'select-team-001',
  });

  await assert.rejects(
    call(participantClient.functions, 'selectTeam', {
      workshopId: created.workshopId,
      team: 'Fuego',
      idempotencyKey: 'select-team-002',
    }),
    (error: { code?: string }) => error.code === 'functions/failed-precondition',
  );

  await assert.rejects(
    call(ownerClient.functions, 'requestWorkshopTransition', {
      workshopId: created.workshopId,
      targetPhase: 'Diluir',
      idempotencyKey: 'skip-phase-001',
    }),
    (error: { code?: string }) => error.code === 'functions/failed-precondition',
  );

  const phaseTransition = await call<Record<string, unknown>, { transitionId: string }>(
    ownerClient.functions,
    'requestWorkshopTransition',
    {
      workshopId: created.workshopId,
      targetPhase: 'Calcinar',
      idempotencyKey: 'request-phase-001',
    },
  );
  const phaseAck = await call<Record<string, unknown>, AckWorkshopTransitionOutput>(
    participantClient.functions,
    'acknowledgeWorkshopTransition',
    {
      workshopId: created.workshopId,
      transitionId: phaseTransition.transitionId,
      idempotencyKey: 'ack-phase-001',
    },
  );
  assert.equal(phaseAck.state, 'committed');
  await call(ownerClient.functions, 'commitWorkshopTransition', {
    workshopId: created.workshopId,
    transitionId: phaseTransition.transitionId,
    idempotencyKey: 'commit-phase-001',
  });
  await call(ownerClient.functions, 'updateWorkshopControl', {
    workshopId: created.workshopId,
    sublimarDefenseUnlocked: true,
    idempotencyKey: 'unlock-defense-001',
  });

  await rulesEnvironment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    const ownerSession = await getDoc(doc(
      firestore,
      'workshops',
      created.workshopId,
      'participantSessions',
      ownerCredential.user.uid,
    ));
    const participantSession = await getDoc(doc(
      firestore,
      'workshops',
      created.workshopId,
      'participantSessions',
      participantCredential.user.uid,
    ));
    const team = await getDoc(doc(
      firestore,
      'workshops',
      created.workshopId,
      'teams',
      'Agua',
    ));

    assert.equal(ownerSession.exists(), false);
    assert.equal(participantSession.data()?.team, 'Agua');
    assert.equal(team.data()?.schemaVersion, 2);
  });

  await assert.rejects(
    call(ownerClient.functions, 'generateReportSnapshot', {
      workshopId: created.workshopId,
      idempotencyKey: 'active-report-rejected-001',
    }),
    (error: { code?: string }) => error.code === 'functions/failed-precondition',
  );

  const completionTransition = await call<Record<string, unknown>, { transitionId: string }>(
    ownerClient.functions,
    'requestWorkshopTransition',
    {
      workshopId: created.workshopId,
      complete: true,
      idempotencyKey: 'request-completion-001',
    },
  );
  await call(participantClient.functions, 'acknowledgeWorkshopTransition', {
    workshopId: created.workshopId,
    transitionId: completionTransition.transitionId,
    idempotencyKey: 'ack-completion-001',
  });
  await call(ownerClient.functions, 'commitWorkshopTransition', {
    workshopId: created.workshopId,
    transitionId: completionTransition.transitionId,
    idempotencyKey: 'commit-completion-001',
  });

  const report = await call<
    { workshopId: string; idempotencyKey: string },
    {
      workshopId: string;
      reportId: string;
      status: string;
      storagePath: string;
      sourceSnapshotHash: string;
    }
  >(ownerClient.functions, 'generateReportSnapshot', {
    workshopId: created.workshopId,
    idempotencyKey: 'generate-report-001',
  });
  assert.equal(report.status, 'draft');
  assert.match(report.sourceSnapshotHash, /^[a-f0-9]{64}$/);
  const storageUrl = 'http://127.0.0.1:9199/v0/b/'
    + encodeURIComponent(projectId + '.appspot.com')
    + '/o/' + encodeURIComponent(report.storagePath) + '?alt=media';
  const downloadAuthorization = await call<
    CreateReportDownloadInput,
    CreateReportDownloadOutput
  >(ownerClient.functions, 'createReportDownload', {
    workshopId: created.workshopId,
    reportId: report.reportId,
    format: 'json',
    idempotencyKey: 'download-report-json-001',
  });
  assert.equal(downloadAuthorization.workshopId, created.workshopId);
  assert.equal(downloadAuthorization.reportId, report.reportId);
  assert.ok(downloadAuthorization.expiresAt > Date.now());
  const ownerReportResponse = await fetch(downloadAuthorization.url, {
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(ownerReportResponse.status, 200);
  const reportJson = await ownerReportResponse.json() as {
    sourceSnapshotHash: string;
    snapshot: { workshop: Record<string, unknown> };
  };
  assert.equal(reportJson.sourceSnapshotHash, report.sourceSnapshotHash);
  assert.equal('createdBy' in reportJson.snapshot.workshop, false);
  const ownerDirectResponse = await fetch(storageUrl, {
    headers: { Authorization: 'Bearer ' + await ownerCredential.user.getIdToken() },
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(ownerDirectResponse.status, 403);
  assert.equal('organizationId' in reportJson.snapshot.workshop, false);

  const participantReportResponse = await fetch(storageUrl, {
    headers: { Authorization: 'Bearer ' + await participantCredential.user.getIdToken() },
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(participantReportResponse.status, 403);
  const analystDraftResponse = await fetch(storageUrl, {
    headers: { Authorization: 'Bearer ' + await analystCredential.user.getIdToken() },
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(analystDraftResponse.status, 403);

  const editorial = await call<
    {
      workshopId: string;
      reportId: string;
      executiveSummary: string;
      observations: string;
      nextSteps: string;
      idempotencyKey: string;
    },
    { status: string }
  >(ownerClient.functions, 'updateReportEditorial', {
    workshopId: created.workshopId,
    reportId: report.reportId,
    executiveSummary: 'Resumen editorial',
    observations: 'Observación editorial',
    nextSteps: 'Siguiente paso verificable',
    idempotencyKey: 'update-report-editorial-001',
  });
  assert.equal(editorial.status, 'draft');

  const queuedReport = await call<QueueReportGenerationInput, QueueReportGenerationOutput>(
    ownerClient.functions,
    'queueReportGeneration',
    {
      workshopId: created.workshopId,
      reportId: report.reportId,
      idempotencyKey: 'queue-report-artifacts-001',
    },
  );
  assert.ok(['queued', 'processing', 'completed'].includes(queuedReport.status));

  const repeatedQueue = await call<QueueReportGenerationInput, QueueReportGenerationOutput>(
    ownerClient.functions,
    'queueReportGeneration',
    {
      workshopId: created.workshopId,
      reportId: report.reportId,
      idempotencyKey: 'queue-report-artifacts-001',
    },
  );
  assert.deepEqual(repeatedQueue, queuedReport);

  const reportDeadline = Date.now() + 90_000;
  let reportJob: GetReportJobOutput | undefined;
  while (Date.now() < reportDeadline) {
    reportJob = await call<
      { workshopId: string; jobId: string },
      GetReportJobOutput
    >(ownerClient.functions, 'getReportJob', {
      workshopId: created.workshopId,
      jobId: queuedReport.jobId,
    });
    if (reportJob.status === 'completed' || reportJob.status === 'failed') break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.ok(reportJob, 'The report job must remain recoverable.');
  assert.equal(reportJob.status, 'completed', reportJob.errorCode ?? 'Report job timed out.');
  assert.ok(reportJob.result, 'A completed report job must expose its result.');
  const generatedArtifacts = reportJob.result;

  assert.equal(generatedArtifacts.status, 'draft');
  assert.ok(generatedArtifacts.pageCount >= 5);
  assert.match(generatedArtifacts.artifacts.pdf.sha256, /^[a-f0-9]{64}$/);
  assert.match(generatedArtifacts.artifacts.pptx.sha256, /^[a-f0-9]{64}$/);
  assert.match(generatedArtifacts.artifacts.json.sha256, /^[a-f0-9]{64}$/);

  await rulesEnvironment.withSecurityRulesDisabled(async (context) => {
    const persistedReport = await getDoc(doc(
      context.firestore(),
      'workshops',
      created.workshopId,
      'reports',
      report.reportId,
    ));
    assert.equal(persistedReport.data()?.status, 'draft');
    assert.equal(persistedReport.data()?.activeReportJobId, undefined);
    assert.equal(persistedReport.data()?.activeReportJobStatus, 'completed');
    assert.match(persistedReport.data()?.artifacts?.pdf?.sha256 ?? '', /^[a-f0-9]{64}$/);
    assert.match(persistedReport.data()?.artifacts?.pptx?.sha256 ?? '', /^[a-f0-9]{64}$/);
  });

  await assert.rejects(call(ownerClient.functions, 'generateReportArtifacts', {
    workshopId: created.workshopId,
    reportId: report.reportId,
    idempotencyKey: 'legacy-report-artifacts-001',
  }), (error: { code?: string }) => error.code === 'functions/failed-precondition');

  for (const [rawFormat, artifact] of Object.entries(generatedArtifacts.artifacts)) {
    const format = rawFormat as CreateReportDownloadInput['format'];
    const authorization = await call<
      CreateReportDownloadInput,
      CreateReportDownloadOutput
    >(ownerClient.functions, 'createReportDownload', {
      workshopId: created.workshopId,
      reportId: report.reportId,
      format,
      idempotencyKey: 'download-report-artifact-' + format + '-001',
    });
    assert.match(authorization.url, /[?&]token=[^&]+/);

    const artifactUrl = 'http://127.0.0.1:9199/v0/b/'
      + encodeURIComponent(projectId + '.appspot.com')
      + '/o/' + encodeURIComponent(artifact.storagePath) + '?alt=media';
    const ownerDirectResponse = await fetch(artifactUrl, {
      headers: { Authorization: 'Bearer ' + await ownerCredential.user.getIdToken() },
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(ownerDirectResponse.status, 403);
    const analystArtifactResponse = await fetch(artifactUrl, {
      headers: { Authorization: 'Bearer ' + await analystCredential.user.getIdToken() },
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(analystArtifactResponse.status, 403);
  }

  let auditedDownloads = 0;
  await rulesEnvironment.withSecurityRulesDisabled(async (context) => {
    const auditSnapshot = await getDocs(
      collection(context.firestore(), 'organizations', organizationId, 'auditEvents'),
    );
    auditedDownloads = auditSnapshot.docs
      .filter((snapshot) => snapshot.data().action === 'report.downloaded').length;
  });
  assert.equal(auditedDownloads, 4);

  const published = await call<
    { workshopId: string; reportId: string; idempotencyKey: string },
    { status: string }
  >(ownerClient.functions, 'publishReport', {
    workshopId: created.workshopId,
    reportId: report.reportId,
    idempotencyKey: 'publish-report-001',
  });
  assert.equal(published.status, 'published');
  await assert.rejects(
    call(ownerClient.functions, 'updateReportEditorial', {
      workshopId: created.workshopId,
      reportId: report.reportId,
      executiveSummary: 'Cambio posterior',
      observations: '',
      nextSteps: '',
      idempotencyKey: 'update-report-editorial-002',
    }),
    (error: { code?: string }) => error.code === 'functions/failed-precondition',
  );

  const analystPublishedResponse = await fetch(storageUrl, {
    headers: { Authorization: 'Bearer ' + await analystCredential.user.getIdToken() },
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(analystPublishedResponse.status, 403);
  for (const artifact of [generatedArtifacts.artifacts.pdf, generatedArtifacts.artifacts.pptx]) {
    const artifactUrl = 'http://127.0.0.1:9199/v0/b/'
      + encodeURIComponent(projectId + '.appspot.com')
      + '/o/' + encodeURIComponent(artifact.storagePath) + '?alt=media';
    const analystArtifactResponse = await fetch(artifactUrl, {
      headers: { Authorization: 'Bearer ' + await analystCredential.user.getIdToken() },
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(analystArtifactResponse.status, 403);
  }

  const archived = await call<
    { organizationId: string; reason: string; idempotencyKey: string },
    { archivedCount: number }
  >(ownerClient.functions, 'archiveOrganizationWorkshops', {
    organizationId,
    reason: 'Cierre de la prueba de integración',
    idempotencyKey: 'archive-organization-001',
  });
  assert.equal(archived.archivedCount, 1);
  const archivedRetry = await call<
    { organizationId: string; reason: string; idempotencyKey: string },
    { archivedCount: number }
  >(ownerClient.functions, 'archiveOrganizationWorkshops', {
    organizationId,
    reason: 'Cierre de la prueba de integración',
    idempotencyKey: 'archive-organization-001',
  });
  assert.equal(archivedRetry.archivedCount, 1);

  await rulesEnvironment.withSecurityRulesDisabled(async (context) => {
    const workshop = await getDoc(doc(context.firestore(), 'workshops', created.workshopId));
    const reportRecord = await getDoc(doc(
      context.firestore(),
      'workshops',
      created.workshopId,
      'reports',
      report.reportId,
    ));
    assert.equal(workshop.data()?.status, 'archived');
    assert.equal(reportRecord.data()?.status, 'published');
    assert.equal(reportRecord.data()?.editorial?.nextSteps, 'Siguiente paso verificable');
  });

  const lateParticipant = createClient('late-participant-' + Date.now());
  await signInAnonymously(lateParticipant.auth);
  await assert.rejects(
    call(lateParticipant.functions, 'joinWorkshopByCode', {
      roomCode: 'TEST42',
      idempotencyKey: 'late-join-001',
    }),
    (error: { code?: string }) => error.code === 'functions/not-found',
  );
});

test('enforces anonymous joins, tenant isolation and rotating-code rate limits', {
  timeout: 90_000,
}, async () => {
  if (!rulesEnvironment) rulesEnvironment = await initializeTestEnvironment({ projectId });

  const nonce = Date.now();
  const organizationAId = `org-security-a-${nonce}`;
  const organizationBId = `org-security-b-${nonce}`;
  const workshopBId = `workshop-security-b-${nonce}`;
  const roomCodeB = 'BSEC42';
  const ownerClient = createClient('security-owner-' + nonce);
  const facilitatorClient = createClient('security-facilitator-' + nonce);
  const ownerCredential = await createUserWithEmailAndPassword(
    ownerClient.auth,
    `security-owner-${nonce}@kreatum.test`,
    'Kreatum-Test-123!',
  );
  const facilitatorCredential = await createUserWithEmailAndPassword(
    facilitatorClient.auth,
    `security-facilitator-${nonce}@kreatum.test`,
    'Kreatum-Test-123!',
  );

  await rulesEnvironment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    const commercial = {
      plan: 'pilot',
      status: 'active',
      validFrom: Timestamp.fromMillis(Date.now() - 60_000),
      validUntil: null,
      includedWorkshops: 10,
      additionalWorkshops: 0,
      consumedWorkshops: 0,
    };
    await Promise.all([
      setDoc(doc(firestore, 'organizations', organizationAId), {
        name: 'Security tenant A',
        status: 'active',
        commercial,
        schemaVersion: 3,
      }),
      setDoc(doc(firestore, 'organizations', organizationBId), {
        name: 'Security tenant B',
        status: 'active',
        commercial,
        schemaVersion: 3,
      }),
      setDoc(
        doc(firestore, 'organizations', organizationAId, 'members', ownerCredential.user.uid),
        { role: 'owner', status: 'active' },
      ),
      setDoc(
        doc(firestore, 'organizations', organizationAId, 'members', facilitatorCredential.user.uid),
        { role: 'facilitator', status: 'active' },
      ),
      setDoc(doc(firestore, 'workshops', workshopBId), {
        organizationId: organizationBId,
        facilitatorUid: 'unrelated-facilitator-b',
        roomCode: roomCodeB,
        status: 'active',
        currentPhase: 'Selecci\u00f3n',
        unlockedPhases: ['Selecci\u00f3n'],
        schemaVersion: 2,
      }),
      setDoc(doc(firestore, 'activeRoomCodes', roomCodeB), {
        workshopId: workshopBId,
        organizationId: organizationBId,
      }),
    ]);
  });

  for (const [client, idempotencyKey] of [
    [ownerClient, 'registered-owner-join-001'],
    [facilitatorClient, 'registered-facilitator-join-001'],
  ] as const) {
    await assert.rejects(
      call(client.functions, 'joinWorkshopByCode', {
        roomCode: roomCodeB,
        idempotencyKey,
      }),
      (error: { code?: string }) => error.code === 'functions/permission-denied',
    );
  }

  await rulesEnvironment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    assert.equal(
      (await getDoc(doc(
        firestore,
        'workshops',
        workshopBId,
        'participantSessions',
        ownerCredential.user.uid,
      ))).exists(),
      false,
    );
    assert.equal(
      (await getDoc(doc(
        firestore,
        'workshops',
        workshopBId,
        'participantSessions',
        facilitatorCredential.user.uid,
      ))).exists(),
      false,
    );
  });

  for (const [workshopId, idempotencyKey] of [
    [workshopBId, 'tenant-oracle-existing-001'],
    [`missing-security-workshop-${nonce}`, 'tenant-oracle-missing-001'],
  ]) {
    await assert.rejects(
      call(ownerClient.functions, 'requestWorkshopTransition', {
        workshopId,
        targetPhase: 'Calcinar',
        idempotencyKey,
      }),
      (error: { code?: string }) => error.code === 'functions/not-found',
    );
  }

  await rulesEnvironment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await Promise.all(Array.from({ length: 501 }, (_, index) => setDoc(
      doc(firestore, 'workshops', `tenant-b-bulk-${nonce}-${index}`),
      {
        organizationId: organizationBId,
        status: 'active',
        schemaVersion: 2,
      },
    )));
  });
  await assert.rejects(
    call(ownerClient.functions, 'archiveOrganizationWorkshops', {
      organizationId: organizationBId,
      reason: 'Prueba de aislamiento de archivado masivo',
      idempotencyKey: `tenant-bulk-oracle-${nonce}`,
    }),
    (error: { code?: string }) => error.code === 'functions/not-found',
  );
  await rulesEnvironment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    const untouched = await getDoc(doc(firestore, 'workshops', `tenant-b-bulk-${nonce}-0`));
    assert.equal(untouched.data()?.status, 'active');
  });
  const participantClient = createClient('security-participant-' + nonce);
  await signInAnonymously(participantClient.auth);
  for (let index = 0; index < 10; index += 1) {
    await assert.rejects(
      call(participantClient.functions, 'joinWorkshopByCode', {
        roomCode: `R${String(index).padStart(5, '0')}`,
        idempotencyKey: `rotate-code-${String(index).padStart(2, '0')}-${nonce}`,
      }),
      (error: { code?: string }) => error.code === 'functions/not-found',
    );
  }
  await assert.rejects(
    call(participantClient.functions, 'joinWorkshopByCode', {
      roomCode: 'R00010',
      idempotencyKey: `rotate-code-10-${nonce}`,
    }),
    (error: { code?: string }) => error.code === 'functions/resource-exhausted',
  );
});

test('marks and hard-deletes workshops after the retention grace period', {
  timeout: 60_000,
}, async () => {
  if (!rulesEnvironment) rulesEnvironment = await initializeTestEnvironment({ projectId });
  const workshopId = 'retention-expired-workshop';
  await rulesEnvironment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await setDoc(doc(firestore, 'workshops', workshopId), {
      organizationId,
      roomCode: 'OLD42',
      status: 'archived',
      currentPhase: 'Proyectar',
      retentionDeleteAt: Timestamp.fromMillis(Date.now() - 60_000),
      schemaVersion: 2,
    });
    await setDoc(doc(firestore, 'workshops', workshopId, 'teams', 'Agua'), {
      team: 'Agua',
      schemaVersion: 2,
    });
  });

  process.env.GCLOUD_PROJECT = projectId;
  process.env.FIREBASE_CONFIG = JSON.stringify({
    projectId,
    storageBucket: projectId + '.appspot.com',
  });
  const {
    hardDeleteExpiredWorkshopsNow,
    markExpiredWorkshopsNow,
  } = await import('../functions/src/index');

  assert.equal(await markExpiredWorkshopsNow(), 1);
  await rulesEnvironment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    const marked = await getDoc(doc(firestore, 'workshops', workshopId));
    assert.equal(marked.data()?.status, 'pendingDeletion');
    await updateDoc(doc(firestore, 'workshops', workshopId), {
      hardDeleteAt: Timestamp.fromMillis(Date.now() - 1_000),
    });
  });

  assert.equal(await hardDeleteExpiredWorkshopsNow(), 1);
  await rulesEnvironment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    assert.equal((await getDoc(doc(firestore, 'workshops', workshopId))).exists(), false);
    const events = await getDocs(collection(firestore, 'retentionDeletionEvents'));
    assert.ok(events.docs.some((event) => event.data().organizationId === organizationId));
  });
});