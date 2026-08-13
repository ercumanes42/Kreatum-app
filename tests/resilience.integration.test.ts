import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signInAnonymously,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  Timestamp,
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
  HeartbeatParticipantSessionOutput,
  JoinWorkshopOutput,
  GetReportJobOutput,
  RequestWorkshopTransitionOutput,
  ReconnectParticipantSessionOutput,
  SelectTeamOutput,
} from '../shared/contracts';

const projectId = 'demo-kreatum';
const organizationId = 'org-resilience';
const resilienceTimeoutMs = process.platform === 'win32' ? 900_000 : 240_000;
const apps: FirebaseApp[] = [];
let environment: RulesTestEnvironment | undefined;
import { PHASES } from '../shared/contracts';

const createClient = (name: string) => {
  const app = initializeApp({
    apiKey: 'fake-api-key',
    authDomain: projectId + '.firebaseapp.com',
    projectId,
  }, name);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const functions = getFunctions(app, 'europe-west1');
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  return { auth, functions };
};

const call = async <Input, Output>(
  functions: ReturnType<typeof getFunctions>,
  name: string,
  input: Input,
) => httpsCallable<Input, Output>(functions, name)(input).then((result) => result.data);

const key = (operation: string) => operation + '-' + crypto.randomUUID();

after(async () => {
  if (environment) await environment.cleanup();
  await Promise.all(apps.map((app) => deleteApp(app)));
});

test('protects device leases and commits only server-confirmed team saves', {
  timeout: resilienceTimeoutMs,
}, async () => {
  environment = await initializeTestEnvironment({ projectId });
  const owner = createClient('resilience-owner-' + Date.now());
  const secondOwner = createClient('resilience-second-owner-' + Date.now());
  const ownerCredential = await createUserWithEmailAndPassword(
    owner.auth,
    'resilience-owner-' + Date.now() + '@gfs.es',
    'Kreatum-Resilience-123!',
  );
  const secondOwnerCredential = await createUserWithEmailAndPassword(
    secondOwner.auth,
    'resilience-second-' + Date.now() + '@gfs.es',
    'Kreatum-Resilience-123!',
  );

  await environment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await setDoc(doc(firestore, 'organizations', organizationId), {
      name: 'KREATUM Resilience',
      status: 'active',
      commercial: {
        status: 'active',
        validFrom: Timestamp.fromMillis(Date.now() - 60_000),
        validUntil: null,
        includedWorkshops: 10,
        additionalWorkshops: 0,
        consumedWorkshops: 0,
      },
      schemaVersion: 3,
    });
    await Promise.all([
      setDoc(
        doc(firestore, 'organizations', organizationId, 'members', ownerCredential.user.uid),
        { role: 'owner', status: 'active', schemaVersion: 3 },
      ),
      setDoc(
        doc(firestore, 'organizations', organizationId, 'members', secondOwnerCredential.user.uid),
        { role: 'owner', status: 'active', schemaVersion: 3 },
      ),
    ]);
  });

  const created = await call<any, { workshopId: string; roomCode: string }>(
    owner.functions,
    'createWorkshop',
    {
      organizationId,
      client: 'Empresa piloto',
      facilitator: 'GFS',
      challenge: 'Prueba anti-freeze',
      customCode: 'SAFE42',
      idempotencyKey: key('create'),
    },
  );

  const participantClients = Array.from({ length: 4 }, (_, index) =>
    createClient('resilience-participant-' + index + '-' + Date.now()));
  const participantCredentials = await Promise.all(
    participantClients.map((client) => signInAnonymously(client.auth)),
  );
  const teams = ['Agua', 'Aire', 'Fuego', 'Tierra'] as const;

  const firstJoin = await call<any, JoinWorkshopOutput>(
    participantClients[0].functions,
    'joinWorkshopByCode',
    { roomCode: created.roomCode, idempotencyKey: key('join-agua') },
  );
  assert.equal(firstJoin.team, null);
  const firstSelection = await call<any, SelectTeamOutput>(
    participantClients[0].functions,
    'selectTeam',
    { workshopId: created.workshopId, team: 'Agua', idempotencyKey: key('select-agua') },
  );
  assert.equal(firstSelection.team, 'Agua');

  await call(participantClients[1].functions, 'joinWorkshopByCode', {
    roomCode: created.roomCode,
    idempotencyKey: key('join-second-device'),
  });
  await assert.rejects(
    call(participantClients[1].functions, 'selectTeam', {
      workshopId: created.workshopId,
      team: 'Agua',
      idempotencyKey: key('occupied-agua'),
    }),
    (error: { code?: string }) => error.code === 'functions/already-exists',
  );
  await call(participantClients[1].functions, 'selectTeam', {
    workshopId: created.workshopId,
    team: 'Aire',
    idempotencyKey: key('select-aire'),
  });

  for (let index = 2; index < participantClients.length; index += 1) {
    await call(participantClients[index].functions, 'joinWorkshopByCode', {
      roomCode: created.roomCode,
      idempotencyKey: key('join-' + teams[index]),
    });
    await call(participantClients[index].functions, 'selectTeam', {
      workshopId: created.workshopId,
      team: teams[index],
      idempotencyKey: key('select-' + teams[index]),
    });
  }

  const fifthDevice = createClient('resilience-fifth-' + Date.now());
  await signInAnonymously(fifthDevice.auth);
  await assert.rejects(
    call(fifthDevice.functions, 'joinWorkshopByCode', {
      roomCode: created.roomCode,
      idempotencyKey: key('fifth-device'),
    }),
    (error: { code?: string }) => error.code === 'functions/resource-exhausted',
  );

  await environment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    const sessionRef = doc(
      firestore,
      'workshops',
      created.workshopId,
      'participantSessions',
      participantCredentials[0].user.uid,
    );
    const sessionSnapshot = await getDoc(sessionRef);
    const slotId = String(sessionSnapshot.data()?.deviceSlot);
    const expiredAt = Timestamp.fromMillis(Date.now() - 1_000);
    await Promise.all([
      updateDoc(sessionRef, { status: 'active', expiresAt: expiredAt }),
      updateDoc(
        doc(firestore, 'workshops', created.workshopId, 'participantDeviceSlots', slotId),
        { expiresAt: expiredAt },
      ),
      setDoc(
        doc(firestore, 'workshops', created.workshopId, 'teams', 'Agua'),
        { perspectives: ['Dato conservado'], activeDeviceExpiresAt: expiredAt },
        { merge: true },
      ),
    ]);
  });

  const reconnected = await call<any, ReconnectParticipantSessionOutput>(
    participantClients[0].functions,
    'reconnectParticipantSession',
    {
      workshopId: created.workshopId,
      team: 'Agua',
      idempotencyKey: key('reconnect-agua-expired'),
    },
  );
  assert.equal(reconnected.team, 'Agua');
  assert.equal(reconnected.currentPhase, PHASES[0]);
  assert.ok(reconnected.unlockedPhases.includes(PHASES[0]));
  let preservedPerspectives: unknown;
  await environment.withSecurityRulesDisabled(async (context) => {
    const preservedTeam = await getDoc(
      doc(context.firestore(), 'workshops', created.workshopId, 'teams', 'Agua'),
    );
    preservedPerspectives = preservedTeam.data()?.perspectives;
  });
  assert.deepEqual(preservedPerspectives, ['Dato conservado']);
  const heartbeat = await call<any, HeartbeatParticipantSessionOutput>(
    participantClients[0].functions,
    'heartbeatParticipantSession',
    { workshopId: created.workshopId },
  );
  assert.equal(heartbeat.team, 'Agua');
  assert.ok(heartbeat.expiresAt > Date.now());
  await environment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    const participantUid = participantCredentials[0].user.uid;
    const sessionRef = doc(firestore, 'workshops', created.workshopId, 'participantSessions', participantUid);
    const sessionSnapshot = await getDoc(sessionRef);
    const slotId = String(sessionSnapshot.data()?.deviceSlot);
    const expiredAt = Timestamp.fromMillis(Date.now() - 1_000);
    const occupiedUntil = Timestamp.fromMillis(Date.now() + 5 * 60_000);
    await Promise.all([
      updateDoc(sessionRef, { expiresAt: expiredAt }),
      updateDoc(doc(firestore, 'workshops', created.workshopId, 'participantDeviceSlots', slotId), {
        expiresAt: expiredAt,
      }),
      setDoc(doc(firestore, 'workshops', created.workshopId, 'teams', 'Agua'), {
        activeParticipantId: participantCredentials[1].user.uid,
        activeDeviceExpiresAt: occupiedUntil,
      }, { merge: true }),
    ]);
  });
  await assert.rejects(
    call(participantClients[0].functions, 'reconnectParticipantSession', {
      workshopId: created.workshopId,
      team: 'Agua',
      idempotencyKey: key('reconnect-occupied'),
    }),
    (error: { code?: string }) => error.code === 'functions/already-exists',
  );
  await environment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    const participantUid = participantCredentials[0].user.uid;
    const sessionRef = doc(firestore, 'workshops', created.workshopId, 'participantSessions', participantUid);
    const sessionSnapshot = await getDoc(sessionRef);
    const slotId = String(sessionSnapshot.data()?.deviceSlot);
    const teamRef = doc(firestore, 'workshops', created.workshopId, 'teams', 'Agua');
    assert.equal((await getDoc(teamRef)).data()?.activeParticipantId, participantCredentials[1].user.uid);
    const restoredUntil = Timestamp.fromMillis(Date.now() + 5 * 60_000);
    await Promise.all([
      updateDoc(sessionRef, { status: 'active', expiresAt: restoredUntil }),
      setDoc(doc(firestore, 'workshops', created.workshopId, 'participantDeviceSlots', slotId), {
        participantId: participantUid,
        expiresAt: restoredUntil,
      }, { merge: true }),
      setDoc(teamRef, {
        activeParticipantId: participantUid,
        activeDeviceExpiresAt: restoredUntil,
      }, { merge: true }),
    ]);
  });

  await assert.rejects(
    call(fifthDevice.functions, 'reconnectParticipantSession', {
      workshopId: created.workshopId,
      team: 'Agua',
      idempotencyKey: key('reconnect-new-identity'),
    }),
    (error: { code?: string }) => error.code === 'functions/permission-denied',
  );
  const concurrentRequests = await Promise.allSettled([
    call<any, RequestWorkshopTransitionOutput>(
      owner.functions,
      'requestWorkshopTransition',
      {
        workshopId: created.workshopId,
        targetPhase: 'Calcinar',
        idempotencyKey: key('transition-owner-a'),
      },
    ),
    call<any, RequestWorkshopTransitionOutput>(
      secondOwner.functions,
      'requestWorkshopTransition',
      {
        workshopId: created.workshopId,
        targetPhase: 'Calcinar',
        idempotencyKey: key('transition-owner-b'),
      },
    ),
  ]);
  assert.equal(concurrentRequests.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(concurrentRequests.filter((result) => result.status === 'rejected').length, 1);
  const requested = concurrentRequests.find(
    (result): result is PromiseFulfilledResult<RequestWorkshopTransitionOutput> =>
      result.status === 'fulfilled',
  )!.value;
  assert.equal(requested.requiredAcks, 4);
  assert.equal(requested.receivedAcks, 0);

  await assert.rejects(
    call(owner.functions, 'commitWorkshopTransition', {
      workshopId: created.workshopId,
      transitionId: requested.transitionId,
      idempotencyKey: key('commit-too-early'),
    }),
    (error: { code?: string }) => error.code === 'functions/failed-precondition',
  );

  let finalAckState = '';
  for (let index = 0; index < participantClients.length; index += 1) {
    const proof = 'late-write-' + teams[index];
    await environment.withSecurityRulesDisabled(async (context) => {
      await updateDoc(
        doc(context.firestore(), 'workshops', created.workshopId, 'teams', teams[index]),
        {
          perspectives: [proof],
          revision: index + 2,
          updatedAt: new Date(),
        },
      );
    });
    const ack = await call<any, AckWorkshopTransitionOutput>(
      participantClients[index].functions,
      'acknowledgeWorkshopTransition',
      {
        workshopId: created.workshopId,
        transitionId: requested.transitionId,
        idempotencyKey: key('ack-' + teams[index]),
      },
    );
    assert.equal(ack.receivedAcks, index + 1);
    finalAckState = ack.state;
  }
  assert.equal(finalAckState, 'committed');

  const committed = await call<any, { state: string }>(
    owner.functions,
    'commitWorkshopTransition',
    {
      workshopId: created.workshopId,
      transitionId: requested.transitionId,
      idempotencyKey: key('commit-safe'),
    },
  );
  assert.equal(committed.state, 'committed');

  await environment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    const workshop = await getDoc(doc(firestore, 'workshops', created.workshopId));
    assert.equal(workshop.data()?.currentPhase, 'Calcinar');
    for (const team of teams) {
      const teamDocument = await getDoc(
        doc(firestore, 'workshops', created.workshopId, 'teams', team),
      );
      assert.deepEqual(teamDocument.data()?.perspectives, ['late-write-' + team]);
      assert.equal(teamDocument.data()?.transitionAckId, requested.transitionId);
    }
  });

  const cancellable = await call<any, RequestWorkshopTransitionOutput>(
    secondOwner.functions,
    'requestWorkshopTransition',
    {
      workshopId: created.workshopId,
      targetPhase: 'Diluir',
      idempotencyKey: key('transition-cancel'),
    },
  );
  const cancelled = await call<any, { state: string }>(
    owner.functions,
    'cancelWorkshopTransition',
    {
      workshopId: created.workshopId,
      transitionId: cancellable.transitionId,
      reason: 'Prueba controlada de cancelación',
      idempotencyKey: key('cancel'),
    },
  );
  assert.equal(cancelled.state, 'cancelled');

  const overrideRequest = await call<any, RequestWorkshopTransitionOutput>(
    owner.functions,
    'requestWorkshopTransition',
    {
      workshopId: created.workshopId,
      targetPhase: 'Diluir',
      idempotencyKey: key('transition-override'),
    },
  );
  await call(owner.functions, 'commitWorkshopTransition', {
    workshopId: created.workshopId,
    transitionId: overrideRequest.transitionId,
    overrideReason: 'Continuidad operativa aprobada durante la prueba',
    idempotencyKey: key('override'),
  });

  await environment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    const workshop = await getDoc(doc(firestore, 'workshops', created.workshopId));
    assert.equal(workshop.data()?.currentPhase, 'Diluir');
    assert.deepEqual(
      new Set(workshop.data()?.transition?.override?.pendingTeams),
      new Set(teams),
    );
    const audit = await getDocs(
      collection(firestore, 'workshops', created.workshopId, 'auditEvents'),
    );
    assert.ok(audit.docs.some((event) => (
      event.data().action === 'workshop.transitionCommitted'
      && event.data().metadata?.override === true
    )));
    for (let index = 0; index < participantCredentials.length; index += 1) {
      const session = await getDoc(doc(
        firestore,
        'workshops',
        created.workshopId,
        'participantSessions',
        participantCredentials[index].user.uid,
      ));
      assert.equal(session.data()?.team, teams[index]);
    }
  });

  await environment.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), 'workshops', created.workshopId), {
      currentPhase: 'Sublimar',
      unlockedPhases: ['Selección', 'Calcinar', 'Diluir', 'Conjugar', 'Sublimar'],
    });
  });

  const attackIds: string[] = [];
  for (let attackIndex = 0; attackIndex < 10; attackIndex += 1) {
    const attack = await call<any, { attackId: string; attackCount: number }>(
      participantClients[0].functions,
      'submitWorkshopAttack',
      {
        workshopId: created.workshopId,
        toTeam: 'Aire',
        content: 'Ataque controlado ' + attackIndex,
        idempotencyKey: key('attack-' + attackIndex),
      },
    );
    attackIds.push(attack.attackId);
    assert.equal(attack.attackCount, attackIndex + 1);
  }
  await assert.rejects(
    call(participantClients[0].functions, 'submitWorkshopAttack', {
      workshopId: created.workshopId,
      toTeam: 'Aire',
      content: 'Ataque once',
      idempotencyKey: key('attack-eleven'),
    }),
    (error: { code?: string }) => error.code === 'functions/resource-exhausted',
  );

  await call(participantClients[1].functions, 'saveWorkshopDefense', {
    workshopId: created.workshopId,
    attackId: attackIds[0],
    content: 'Defensa inicial',
    idempotencyKey: key('defense-create'),
  });
  await call(participantClients[1].functions, 'saveWorkshopDefense', {
    workshopId: created.workshopId,
    attackId: attackIds[0],
    content: 'Defensa revisada',
    idempotencyKey: key('defense-update'),
  });
  await environment.withSecurityRulesDisabled(async (context) => {
    const defenses = await getDocs(
      collection(context.firestore(), 'workshops', created.workshopId, 'defenses'),
    );
    assert.equal(defenses.size, 1);
    assert.equal(defenses.docs[0].id, attackIds[0]);
    assert.equal(defenses.docs[0].data().content, 'Defensa revisada');
  });

  const longRunningJobId = 'job-long-running';
  const reportId = 'report-long-running';
  const olderThanSeventySeconds = Date.now() - 80_000;
  await environment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await updateDoc(doc(firestore, 'workshops', created.workshopId), {
      status: 'completed',
      activeReportJobId: longRunningJobId,
      activeReportJobStatus: 'processing',
    });
    await setDoc(
      doc(firestore, 'workshops', created.workshopId, 'reports', reportId),
      {
        workshopId: created.workshopId,
        status: 'draft',
        schemaVersion: 2,
      },
    );
    await setDoc(
      doc(firestore, 'workshops', created.workshopId, 'reportJobs', longRunningJobId),
      {
        workshopId: created.workshopId,
        reportId,
        status: 'processing',
        progress: 40,
        attempts: 1,
        createdAt: Timestamp.fromMillis(olderThanSeventySeconds),
        updatedAt: Timestamp.now(),
        schemaVersion: 2,
      },
    );
  });

  const recoveredJob = await call<Record<string, string>, GetReportJobOutput>(
    owner.functions,
    'getReportJob',
    { workshopId: created.workshopId, jobId: longRunningJobId },
  );
  assert.equal(recoveredJob.status, 'processing');
  assert.equal(recoveredJob.attempts, 1);
  assert.ok((recoveredJob.createdAt ?? Date.now()) <= olderThanSeventySeconds);
  assert.equal(recoveredJob.result, null);

  await assert.rejects(
    call(owner.functions, 'queueReportGeneration', {
      workshopId: created.workshopId,
      reportId,
      idempotencyKey: key('second-report-job'),
    }),
    (error: { code?: string }) => error.code === 'functions/already-exists',
  );
});
