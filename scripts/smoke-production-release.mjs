#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { deleteApp as deleteClientApp, initializeApp as initializeClientApp } from 'firebase/app';
import {
  getAuth as getClientAuth,
  signInAnonymously,
  signInWithCustomToken,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  getDocFromServer,
  getFirestore as getClientFirestore,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  appendManifestEvent,
  assertCleanupOrganizationOwnership,
  assertDedicatedSignerServiceAccount,
  assertOwnedIdentifier,
  assertOwnedRoomCode,
  assertSafeSmokeOptions,
  collectManifestResources,
  parseSmokeArguments,
  readManifest,
  roomCodeFor,
} from './lib/production-smoke-guards.mjs';

const requireFunctions = createRequire(path.resolve('functions', 'package.json'));
const {
  applicationDefault,
  deleteApp: deleteAdminApp,
  initializeApp: initializeAdminApp,
} = requireFunctions('firebase-admin/app');
const { getAuth: getAdminAuth } = requireFunctions('firebase-admin/auth');
const {
  FieldValue,
  Timestamp,
  getFirestore: getAdminFirestore,
} = requireFunctions('firebase-admin/firestore');
const { getStorage: getAdminStorage } = requireFunctions('firebase-admin/storage');

const PRODUCTION_APP_ID = '1:997151085311:web:4eb0963c4f75c293bfb2ca';
const REGION = 'europe-southwest1';
const REPORT_TIMEOUT_MS = 180_000;
const PHASES = [
  'Selecci\u00f3n',
  'Calcinar',
  'Diluir',
  'Conjugar',
  'Sublimar',
  'Fermentar',
  'Proyectar',
];
const TEAMS = ['Agua', 'Fuego', 'Aire', 'Tierra'];
const ATTACK_TARGETS = {
  Agua: 'Fuego',
  Fuego: 'Tierra',
  Tierra: 'Aire',
  Aire: 'Agua',
};
const ATTACKS_PER_TEAM = 10;
const REPORT_MIME_TYPES = {
  pdf: 'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  json: 'application/json',
};
const LEGAL_URLS = {
  privacy: 'https://gfs.es/politica-de-privacidad',
  terms: 'https://gfs.es/aviso-legal',
};

const requiredEnvironment = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error('Missing required environment variable ' + name + '.');
  return value;
};

const loadRuntimeConfig = (cleanupOnly) => {
  for (const emulatorVariable of [
    'FIREBASE_AUTH_EMULATOR_HOST',
    'FIRESTORE_EMULATOR_HOST',
    'FUNCTIONS_EMULATOR_HOST',
    'FIREBASE_STORAGE_EMULATOR_HOST',
  ]) {
    if (process.env[emulatorVariable]) {
      throw new Error('Refusing production smoke while ' + emulatorVariable + ' is set.');
    }
  }
  for (const projectVariable of ['GOOGLE_CLOUD_PROJECT', 'GCLOUD_PROJECT']) {
    const configured = process.env[projectVariable]?.trim();
    if (configured && configured !== 'kreatum-dinamic') {
      throw new Error(projectVariable + ' points to a different project.');
    }
  }
  const storageBucket = requiredEnvironment('KREATUM_SMOKE_FIREBASE_STORAGE_BUCKET');
  if (![
    'kreatum-dinamic.appspot.com',
    'kreatum-dinamic.firebasestorage.app',
  ].includes(storageBucket)) {
    throw new Error('Unexpected production Storage bucket.');
  }
  const base = { storageBucket };
  if (cleanupOnly) return base;
  const tokenSignerServiceAccount = assertDedicatedSignerServiceAccount(
    requiredEnvironment('KREATUM_SMOKE_TOKEN_SIGNER_SERVICE_ACCOUNT'),
  );
  const apiKey = requiredEnvironment('KREATUM_SMOKE_FIREBASE_API_KEY');
  const appId = requiredEnvironment('KREATUM_SMOKE_FIREBASE_APP_ID');
  if (appId !== PRODUCTION_APP_ID) throw new Error('Unexpected production Firebase web app id.');
  if (requiredEnvironment('KREATUM_SMOKE_APPCHECK_MODE') !== 'monitor') {
    throw new Error('App Check must remain in monitor mode for this smoke.');
  }
  if (requiredEnvironment('KREATUM_SMOKE_PRIVACY_POLICY_URL') !== LEGAL_URLS.privacy
    || requiredEnvironment('KREATUM_SMOKE_TERMS_URL') !== LEGAL_URLS.terms) {
    throw new Error('Legal URL confirmation does not match the production release.');
  }
  requiredEnvironment('KREATUM_SMOKE_BACKUP_ID');
  return {
    ...base,
    apiKey,
    appId,
    authDomain: 'kreatum-dinamic.firebaseapp.com',
    projectId: 'kreatum-dinamic',
    tokenSignerServiceAccount,
  };
};

const createAdminContext = (projectId, storageBucket, runId, tokenSignerServiceAccount) => {
  const app = initializeAdminApp({
    credential: applicationDefault(),
    projectId,
    storageBucket,
    ...(tokenSignerServiceAccount ? { serviceAccountId: tokenSignerServiceAccount } : {}),
  }, 'production-smoke-' + runId);
  assert.equal(app.options.projectId, projectId);
  return {
    app,
    auth: getAdminAuth(app),
    db: getAdminFirestore(app),
    bucket: getAdminStorage(app).bucket(storageBucket),
  };
};

const appendResource = (manifestPath, kind, id, extra = {}) => {
  appendManifestEvent(manifestPath, { type: 'resource.created', kind, id, ...extra });
};

const keyFor = (runId, label) => {
  const key = runId + '-' + label;
  assert.ok(key.length >= 8 && key.length <= 128);
  return key;
};

const call = async (client, name, data) => {
  const response = await httpsCallable(client.functions, name)(data);
  return response.data;
};

const errorCode = async (operation) => {
  try {
    await operation();
    return 'success';
  } catch (error) {
    return typeof error?.code === 'string' ? error.code : 'unknown';
  }
};

const assertDenied = async (operation, acceptedCodes, message) => {
  const code = await errorCode(operation);
  assert.ok(acceptedCodes.includes(code), message + ' (received ' + code + ')');
  return code;
};

const clientContext = (config, label) => {
  const app = initializeClientApp(config, label);
  return {
    app,
    auth: getClientAuth(app),
    db: getClientFirestore(app),
    functions: getFunctions(app, REGION),
  };
};

const createFacilitator = async (context, fixture, manifestPath, runId) => {
  const password = 'K!' + randomBytes(24).toString('base64url');
  const user = await context.auth.createUser({
    uid: fixture.facilitatorUid,
    email: fixture.email,
    emailVerified: true,
    password,
    displayName: 'Kreatum Smoke ' + fixture.suffix,
    disabled: false,
  });
  try {
    await context.auth.setCustomUserClaims(fixture.facilitatorUid, {
      kreatumSmokeRunId: runId,
    });
  } catch (error) {
    await context.auth.deleteUser(user.uid);
    throw error;
  }
  appendResource(manifestPath, 'user', fixture.facilitatorUid, { role: 'facilitator' });
  return password;
};

const createOrganization = async (context, fixture, manifestPath, runId) => {
  assertOwnedIdentifier(runId, fixture.organizationId, 'organization');
  appendResource(manifestPath, 'organization', fixture.organizationId);
  const organizationRef = context.db.doc('organizations/' + fixture.organizationId);
  const memberRef = organizationRef.collection('members').doc(fixture.facilitatorUid);
  const indexRef = context.db.doc(
    'users/' + fixture.facilitatorUid + '/organizationMemberships/' + fixture.organizationId,
  );
  const auditRef = organizationRef.collection('auditEvents').doc(runId + '-fixture-created');
  await context.db.runTransaction(async (transaction) => {
    const [organization, member, index] = await Promise.all([
      transaction.get(organizationRef),
      transaction.get(memberRef),
      transaction.get(indexRef),
    ]);
    if (organization.exists || member.exists || index.exists) {
      throw new Error('Refusing to overwrite an existing smoke fixture.');
    }
    const now = Date.now();
    transaction.create(organizationRef, {
      name: '[SMOKE] ' + runId + ' tenant ' + fixture.suffix,
      status: 'active',
      smokeRunId: runId,
      allowedEmailDomains: ['smoke.invalid'],
      retentionMonths: 1,
      commercial: {
        plan: 'pilot',
        status: 'active',
        validFrom: Timestamp.fromMillis(now - 60_000),
        validUntil: Timestamp.fromMillis(now + 24 * 60 * 60 * 1000),
        includedWorkshops: 2,
        additionalWorkshops: 0,
        consumedWorkshops: 0,
      },
      schemaVersion: 3,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    const membership = {
      organizationId: fixture.organizationId,
      email: fixture.email,
      role: 'facilitator',
      status: 'active',
      smokeRunId: runId,
      schemaVersion: 3,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    transaction.create(memberRef, membership);
    transaction.create(indexRef, membership);
    transaction.create(auditRef, {
      organizationId: fixture.organizationId,
      action: 'smoke.fixtureCreated',
      actorId: fixture.facilitatorUid,
      actorHash: createHash('sha256').update(fixture.facilitatorUid).digest('hex').slice(0, 24),
      targetType: 'organization',
      targetId: fixture.organizationId,
      reason: 'Ephemeral production release smoke fixture',
      smokeRunId: runId,
      createdAt: FieldValue.serverTimestamp(),
      schemaVersion: 2,
    });
  });
};

const createWorkshop = async (client, fixture, manifestPath, runId) => {
  assertOwnedRoomCode(runId, fixture.roomCode);
  appendResource(manifestPath, 'roomCode', fixture.roomCode, {
    organizationId: fixture.organizationId,
  });
  const created = await call(client, 'createWorkshop', {
    organizationId: fixture.organizationId,
    client: '[SMOKE ' + runId + '] Tenant ' + fixture.suffix,
    facilitator: 'Facilitator ' + fixture.suffix,
    challenge: 'Validate isolated production release ' + fixture.marker,
    customCode: fixture.roomCode,
    idempotencyKey: keyFor(runId, 'create-workshop-' + fixture.suffix),
  });
  assert.equal(created.roomCode, fixture.roomCode);
  assert.equal(created.creditsRemaining, 1);
  fixture.workshopId = created.workshopId;
  appendResource(manifestPath, 'workshop', created.workshopId, {
    organizationId: fixture.organizationId,
  });
  return created;
};

const registerAnonymousParticipant = async (
  admin,
  client,
  fixture,
  manifestPath,
  runId,
) => {
  const credential = await signInAnonymously(client.auth);
  try {
    await admin.auth.setCustomUserClaims(credential.user.uid, {
      kreatumSmokeRunId: runId,
    });
  } catch (error) {
    await admin.auth.deleteUser(credential.user.uid);
    throw error;
  }
  appendResource(manifestPath, 'user', credential.user.uid, { role: 'participant' });
  return credential.user.uid;
};

const joinParticipants = async (
  admin,
  config,
  clients,
  fixture,
  manifestPath,
  runId,
) => {
  fixture.participantClients = [];
  fixture.participantUids = [];
  for (const [index, team] of TEAMS.entries()) {
    const client = clientContext(
      config,
      runId + '-participant-' + fixture.suffix + '-' + team.toLowerCase(),
    );
    clients.push(client);
    const uid = await registerAnonymousParticipant(
      admin,
      client,
      fixture,
      manifestPath,
      runId,
    );
    const joined = await call(client, 'joinWorkshopByCode', {
      roomCode: fixture.roomCode,
      idempotencyKey: keyFor(runId, 'join-' + fixture.suffix + '-' + index),
    });
    assert.equal(joined.workshopId, fixture.workshopId);
    const selected = await call(client, 'selectTeam', {
      workshopId: fixture.workshopId,
      team,
      idempotencyKey: keyFor(runId, 'select-' + fixture.suffix + '-' + index),
    });
    assert.equal(selected.team, team);
    fixture.participantClients.push(client);
    fixture.participantUids.push(uid);
  }
  const rejectedClient = clientContext(
    config,
    runId + '-participant-' + fixture.suffix + '-rejected',
  );
  clients.push(rejectedClient);
  await registerAnonymousParticipant(
    admin,
    rejectedClient,
    fixture,
    manifestPath,
    runId,
  );
  await assertDenied(
    () => call(rejectedClient, 'joinWorkshopByCode', {
      roomCode: fixture.roomCode,
      idempotencyKey: keyFor(runId, 'join-' + fixture.suffix + '-fifth'),
    }),
    ['functions/resource-exhausted'],
    'Fifth participant device',
  );
  await assertDenied(
    () => call(rejectedClient, 'reconnectParticipantSession', {
      workshopId: fixture.workshopId,
      team: 'Agua',
      idempotencyKey: keyFor(runId, 'reconnect-' + fixture.suffix + '-new-anon'),
    }),
    ['functions/permission-denied'],
    'New anonymous identity reconnect',
  );
};

const tagSmokeWorkshop = async (admin, fixture, runId) => {
  await admin.db.doc('workshops/' + fixture.workshopId).update({
    smokeRunId: runId,
    updatedAt: FieldValue.serverTimestamp(),
  });
};

const smokeText = (fixture, team, label, index) =>
  fixture.marker + ' ' + team + ' ' + label
    + (Number.isInteger(index) ? ' ' + String(index + 1) : '');

const smokeValues = (fixture, team, label, count) =>
  Array.from({ length: count }, (_, index) => smokeText(fixture, team, label, index));

const sourceTeamFor = (targetTeam) => {
  const sourceTeam = TEAMS.find((team) => ATTACK_TARGETS[team] === targetTeam);
  assert.ok(sourceTeam, 'Every team must have one attack source.');
  return sourceTeam;
};

const phasePayload = (fixture, team, phase) => {
  if (phase === 'Diluir') {
    const perspectives = smokeValues(fixture, team, 'perspective', 3);
    return {
      perspectives,
      top3Perspectives: perspectives,
      perspectiveVotes: [3, 2, 1],
      selectedPerspective: perspectives[0],
    };
  }
  if (phase === 'Conjugar') {
    const solutions = smokeValues(fixture, team, 'solution', 3);
    return {
      solutions,
      top3Solutions: solutions,
      solutionVotes: [3, 2, 1],
      selectedSolution: solutions[0],
    };
  }
  if (phase === 'Sublimar') {
    const sourceTeam = sourceTeamFor(team);
    const targetTeam = ATTACK_TARGETS[team];
    return {
      receivedSolutionToAttack: smokeText(fixture, targetTeam, 'solution', 0),
      attacksOnOthers: smokeValues(fixture, team, 'attack', ATTACKS_PER_TEAM),
      receivedAttacks: smokeValues(fixture, sourceTeam, 'attack', ATTACKS_PER_TEAM),
      defenses: smokeValues(fixture, team, 'defense', ATTACKS_PER_TEAM),
      reformulatedSolution: smokeText(fixture, team, 'reformulated solution'),
      expectedResults: smokeText(fixture, team, 'measurable expected result'),
      sublimarView: 'Defensa',
      sublimarDefenseCompleted: true,
    };
  }
  if (phase === 'Fermentar') {
    return {
      audience: smokeText(fixture, team, 'audience'),
      strengths: smokeText(fixture, team, 'strengths'),
      weaknesses: smokeText(fixture, team, 'weaknesses'),
      pilot: smokeText(fixture, team, 'pilot'),
      resources: smokeText(fixture, team, 'resources'),
    };
  }
  if (phase === 'Proyectar') {
    return {
      pitch: smokeText(fixture, team, 'pitch'),
      pitchStart: smokeText(fixture, team, 'pitch opening'),
      pitchProblem: smokeText(fixture, team, 'pitch problem'),
      pitchSolution: smokeText(fixture, team, 'pitch solution'),
      pitchAction: smokeText(fixture, team, 'pitch action'),
    };
  }
  return null;
};

const assertPersistedPayload = (snapshot, payload, label) => {
  assert.equal(snapshot.exists(), true, label + ' document must exist.');
  const data = snapshot.data();
  for (const [field, value] of Object.entries(payload)) {
    assert.deepEqual(data[field], value, label + ' field ' + field);
  }
  assert.equal(typeof data.updatedAt?.toMillis, 'function', label + ' updatedAt');
  assert.equal(typeof data.lastSavedAt?.toMillis, 'function', label + ' lastSavedAt');
};

const persistTeamPhase = async (participantClients, fixture, phase) => {
  await Promise.all(participantClients.map(async (participantClient, index) => {
    const team = TEAMS[index];
    const payload = phasePayload(fixture, team, phase);
    if (!payload) return;
    const teamRef = doc(
      participantClient.db,
      'workshops',
      fixture.workshopId,
      'teams',
      team,
    );
    await updateDoc(teamRef, {
      ...payload,
      updatedAt: serverTimestamp(),
      lastSavedAt: serverTimestamp(),
    });
    assertPersistedPayload(
      await getDocFromServer(teamRef),
      payload,
      fixture.suffix + '/' + phase + '/' + team,
    );

    if (phase === 'Conjugar') {
      const solutionRef = doc(
        participantClient.db,
        'workshops',
        fixture.workshopId,
        'solutions',
        team,
      );
      await setDoc(solutionRef, {
        team,
        content: payload.selectedSolution,
        timestamp: serverTimestamp(),
        schemaVersion: 2,
      });
      const solution = await getDocFromServer(solutionRef);
      assert.equal(solution.exists(), true);
      assert.equal(solution.data()?.team, team);
      assert.equal(solution.data()?.content, payload.selectedSolution);
      assert.equal(typeof solution.data()?.timestamp?.toMillis, 'function');
      assert.equal(solution.data()?.schemaVersion, 2);
    }

    if (phase === 'Proyectar') {
      await updateDoc(teamRef, {
        isFinished: true,
        updatedAt: serverTimestamp(),
        lastSavedAt: serverTimestamp(),
      });
      const finished = await getDocFromServer(teamRef);
      assert.equal(finished.data()?.isFinished, true, fixture.suffix + '/' + team + ' finished');
      assert.equal(typeof finished.data()?.lastSavedAt?.toMillis, 'function');
    }
  }));
};

const heartbeatAllTeams = async (participantClients, fixture) => {
  const results = await Promise.all(participantClients.map((participantClient) =>
    call(participantClient, 'heartbeatParticipantSession', {
      workshopId: fixture.workshopId,
    }),
  ));
  assert.deepEqual(results.map((result) => result.team), TEAMS);
};

const completeSublimarContent = async (
  facilitatorClient,
  participantClients,
  fixture,
  runId,
) => {
  await heartbeatAllTeams(participantClients, fixture);
  const inboundAttacks = Object.fromEntries(TEAMS.map((team) => [team, []]));
  await Promise.all(participantClients.map(async (participantClient, participantIndex) => {
    const team = TEAMS[participantIndex];
    const toTeam = ATTACK_TARGETS[team];
    for (let attackIndex = 0; attackIndex < ATTACKS_PER_TEAM; attackIndex += 1) {
      if (attackIndex === 5) {
        await call(participantClient, 'heartbeatParticipantSession', {
          workshopId: fixture.workshopId,
        });
      }
      const content = smokeText(fixture, team, 'attack', attackIndex);
      const attack = await call(participantClient, 'submitWorkshopAttack', {
        workshopId: fixture.workshopId,
        toTeam,
        content,
        idempotencyKey: keyFor(
          runId,
          'attack-' + fixture.suffix + '-' + team.toLowerCase() + '-' + attackIndex,
        ),
      });
      assert.equal(attack.attackCount, attackIndex + 1);
      inboundAttacks[toTeam].push({
        attackId: attack.attackId,
        content,
        fromTeam: team,
      });
    }
  }));
  assert.deepEqual(TEAMS.map((team) => inboundAttacks[team].length), [10, 10, 10, 10]);

  await call(facilitatorClient, 'updateWorkshopControl', {
    workshopId: fixture.workshopId,
    sublimarDefenseUnlocked: true,
    idempotencyKey: keyFor(runId, 'unlock-defense-' + fixture.suffix),
  });
  await heartbeatAllTeams(participantClients, fixture);

  await Promise.all(participantClients.map(async (participantClient, participantIndex) => {
    const team = TEAMS[participantIndex];
    for (const [defenseIndex, attack] of inboundAttacks[team].entries()) {
      if (defenseIndex === 5) {
        await call(participantClient, 'heartbeatParticipantSession', {
          workshopId: fixture.workshopId,
        });
      }
      const content = smokeText(fixture, team, 'defense', defenseIndex);
      const defense = await call(participantClient, 'saveWorkshopDefense', {
        workshopId: fixture.workshopId,
        attackId: attack.attackId,
        content,
        idempotencyKey: keyFor(
          runId,
          'defense-' + fixture.suffix + '-' + team.toLowerCase() + '-' + defenseIndex,
        ),
      });
      assert.equal(defense.defenseId, attack.attackId);
      const attackSnapshot = await getDocFromServer(doc(
        participantClient.db,
        'workshops',
        fixture.workshopId,
        'attacks',
        attack.attackId,
      ));
      assert.equal(attackSnapshot.data()?.fromTeam, attack.fromTeam);
      assert.equal(attackSnapshot.data()?.toTeam, team);
      assert.equal(attackSnapshot.data()?.content, attack.content);
      const defenseSnapshot = await getDocFromServer(doc(
        participantClient.db,
        'workshops',
        fixture.workshopId,
        'defenses',
        attack.attackId,
      ));
      assert.equal(defenseSnapshot.data()?.team, team);
      assert.equal(defenseSnapshot.data()?.content, content);
    }
  }));
  await persistTeamPhase(participantClients, fixture, 'Sublimar');
};

const verifyReconnect = async (admin, fixture, runId) => {
  const participantClient = fixture.participantClients[0];
  const participantUid = fixture.participantUids[0];
  const heartbeat = await call(participantClient, 'heartbeatParticipantSession', {
    workshopId: fixture.workshopId,
  });
  assert.equal(heartbeat.team, 'Agua');
  const sessionRef = admin.db.doc(
    'workshops/' + fixture.workshopId + '/participantSessions/' + participantUid,
  );
  const session = await sessionRef.get();
  const slot = session.data()?.deviceSlot;
  assert.ok(Number.isInteger(slot));
  const expiredAt = Timestamp.fromMillis(Date.now() - 1_000);
  const batch = admin.db.batch();
  batch.update(sessionRef, { expiresAt: expiredAt });
  batch.update(admin.db.doc(
    'workshops/' + fixture.workshopId + '/participantDeviceSlots/' + slot,
  ), { expiresAt: expiredAt });
  batch.set(admin.db.doc('workshops/' + fixture.workshopId + '/teams/Agua'), {
    activeDeviceExpiresAt: expiredAt,
  }, { merge: true });
  await batch.commit();
  const reconnected = await call(participantClient, 'reconnectParticipantSession', {
    workshopId: fixture.workshopId,
    team: 'Agua',
    idempotencyKey: keyFor(runId, 'reconnect-' + fixture.suffix),
  });
  assert.equal(reconnected.team, 'Agua');
  assert.equal(reconnected.currentPhase, PHASES[0]);
};

const acknowledgeAllTeams = async (
  participantClients,
  fixture,
  transition,
  label,
  runId,
) => {
  for (const [participantIndex, participantClient] of participantClients.entries()) {
    const ack = await call(participantClient, 'acknowledgeWorkshopTransition', {
      workshopId: fixture.workshopId,
      transitionId: transition.transitionId,
      idempotencyKey: keyFor(
        runId,
        'ack-' + fixture.suffix + '-' + label + '-' + participantIndex,
      ),
    });
    assert.equal(ack.receivedAcks, participantIndex + 1);
    assert.equal(
      ack.state,
      participantIndex === TEAMS.length - 1 ? 'committed' : 'requested',
    );
  }
};

const completeSevenPhases = async (
  facilitatorClient,
  participantClients,
  fixture,
  runId,
) => {
  for (const [index, targetPhase] of PHASES.slice(1).entries()) {
    const currentPhase = PHASES[index];
    if (currentPhase === 'Sublimar') {
      await completeSublimarContent(
        facilitatorClient,
        participantClients,
        fixture,
        runId,
      );
    } else {
      await persistTeamPhase(participantClients, fixture, currentPhase);
    }
    await heartbeatAllTeams(participantClients, fixture);
    const transition = await call(facilitatorClient, 'requestWorkshopTransition', {
      workshopId: fixture.workshopId,
      targetPhase,
      idempotencyKey: keyFor(runId, 'request-' + fixture.suffix + '-' + index),
    });
    assert.equal(transition.requiredAcks, 4);
    await acknowledgeAllTeams(
      participantClients,
      fixture,
      transition,
      'phase-' + index,
      runId,
    );
    const committed = await call(facilitatorClient, 'commitWorkshopTransition', {
      workshopId: fixture.workshopId,
      transitionId: transition.transitionId,
      idempotencyKey: keyFor(runId, 'commit-' + fixture.suffix + '-' + index),
    });
    assert.equal(committed.state, 'committed');
    const workshop = await getDocFromServer(doc(
      facilitatorClient.db,
      'workshops',
      fixture.workshopId,
    ));
    assert.equal(workshop.data()?.currentPhase, targetPhase);
  }
  await persistTeamPhase(participantClients, fixture, 'Proyectar');
  await heartbeatAllTeams(participantClients, fixture);
  const completion = await call(facilitatorClient, 'requestWorkshopTransition', {
    workshopId: fixture.workshopId,
    complete: true,
    idempotencyKey: keyFor(runId, 'request-complete-' + fixture.suffix),
  });
  assert.equal(completion.requiredAcks, 4);
  await acknowledgeAllTeams(
    participantClients,
    fixture,
    completion,
    'complete',
    runId,
  );
  const committed = await call(facilitatorClient, 'commitWorkshopTransition', {
    workshopId: fixture.workshopId,
    transitionId: completion.transitionId,
    idempotencyKey: keyFor(runId, 'commit-complete-' + fixture.suffix),
  });
  assert.equal(committed.state, 'committed');
  const completedWorkshop = await getDocFromServer(doc(
    facilitatorClient.db,
    'workshops',
    fixture.workshopId,
  ));
  assert.equal(completedWorkshop.data()?.status, 'completed');
};

const verifyTenantIsolation = async (fixtureA, fixtureB, facilitatorA, participantA, runId) => {
  const missingWorkshopId = runId + '-missing-workshop';
  const scope = fixtureA.suffix.toLowerCase();
  const foreignCode = await errorCode(() => call(facilitatorA, 'generateReportSnapshot', {
    workshopId: fixtureB.workshopId,
    idempotencyKey: keyFor(runId, 'foreign-report-' + scope),
  }));
  const missingCode = await errorCode(() => call(facilitatorA, 'generateReportSnapshot', {
    workshopId: missingWorkshopId,
    idempotencyKey: keyFor(runId, 'missing-report-' + scope),
  }));
  assert.equal(foreignCode, 'functions/not-found');
  assert.equal(foreignCode, missingCode, 'Foreign and absent tenant data must be indistinguishable.');
  await assertDenied(
    () => getDoc(doc(facilitatorA.db, 'workshops', fixtureB.workshopId)),
    ['permission-denied'],
    'Facilitator A read workshop B',
  );
  await assertDenied(
    () => getDoc(doc(participantA.db, 'workshops', fixtureB.workshopId)),
    ['permission-denied'],
    'Participant A read workshop B',
  );
  const own = await getDoc(doc(facilitatorA.db, 'workshops', fixtureA.workshopId));
  assert.equal(own.exists(), true);
};

const waitForReport = async (client, fixture, reportId, jobId) => {
  const deadline = Date.now() + REPORT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const job = await call(client, 'getReportJob', {
      workshopId: fixture.workshopId,
      jobId,
    });
    if (job.status === 'completed') return job;
    if (job.status === 'failed') {
      throw new Error('Report generation failed: ' + (job.errorCode || 'unknown'));
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error('Report generation did not complete within the fixed smoke deadline for ' + reportId + '.');
};

const downloadArtifacts = async (client, fixture, report, result, otherMarker, runId) => {
  for (const format of ['pdf', 'pptx', 'json']) {
    const expectedMimeType = REPORT_MIME_TYPES[format];
    assert.equal(result.artifacts[format].mimeType, expectedMimeType);
    const authorization = await call(client, 'createReportDownload', {
      workshopId: fixture.workshopId,
      reportId: report.reportId,
      format,
      idempotencyKey: keyFor(runId, 'download-' + fixture.suffix + '-' + format),
    });
    const response = await globalThis.fetch(authorization.url, { signal: AbortSignal.timeout(30_000) });
    assert.equal(response.status, 200);
    assert.ok(
      response.headers.get('content-type')?.toLowerCase().startsWith(expectedMimeType),
      format + ' download content type',
    );
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.ok(bytes.length > 100);
    const expectedHash = result.artifacts[format].sha256;
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expectedHash);
    if (format === 'pdf') assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
    if (format === 'pptx') {
      assert.equal(bytes.subarray(0, 2).toString(), 'PK');
      assert.ok(bytes.includes(Buffer.from('[Content_Types].xml')));
      assert.ok(bytes.includes(Buffer.from('ppt/presentation.xml')));
    }
    if (format === 'json') {
      const text = bytes.toString('utf8');
      JSON.parse(text);
      assert.ok(text.includes(fixture.marker), 'JSON report must contain its own tenant marker.');
      assert.equal(text.includes(otherMarker), false, 'JSON report leaked another tenant marker.');
      assert.equal(/"createdBy"\s*:/.test(text), false);
      assert.equal(/"organizationId"\s*:/.test(text), false);
    }
    const directPath = result.artifacts[format].storagePath;
    const directUrl = 'https://firebasestorage.googleapis.com/v0/b/'
      + requiredEnvironment('KREATUM_SMOKE_FIREBASE_STORAGE_BUCKET')
      + '/o/' + encodeURIComponent(directPath) + '?alt=media';
    const directResponse = await globalThis.fetch(directUrl, {
      signal: AbortSignal.timeout(30_000),
    });
    assert.ok([401, 403, 404].includes(directResponse.status));
  }
};

const generateAndVerifyReport = async (client, fixture, otherMarker, runId) => {
  const report = await call(client, 'generateReportSnapshot', {
    workshopId: fixture.workshopId,
    idempotencyKey: keyFor(runId, 'snapshot-' + fixture.suffix),
  });
  assert.match(report.sourceSnapshotHash, /^[a-f0-9]{64}$/);
  const queued = await call(client, 'queueReportGeneration', {
    workshopId: fixture.workshopId,
    reportId: report.reportId,
    idempotencyKey: keyFor(runId, 'queue-report-' + fixture.suffix),
  });
  const job = await waitForReport(client, fixture, report.reportId, queued.jobId);
  assert.ok(job.result?.pageCount >= 5, 'Report must contain at least five pages.');
  assert.ok(job.result?.artifacts?.pdf);
  assert.ok(job.result?.artifacts?.pptx);
  assert.ok(job.result?.artifacts?.json);
  await downloadArtifacts(client, fixture, report, job.result, otherMarker, runId);
  const published = await call(client, 'publishReport', {
    workshopId: fixture.workshopId,
    reportId: report.reportId,
    idempotencyKey: keyFor(runId, 'publish-' + fixture.suffix),
  });
  assert.equal(published.status, 'published');
  return report;
};

const verifyFacilitatorStatusIsolation = async (
  admin,
  platformClient,
  fixture,
  report,
  unaffectedClient,
  unaffectedFixture,
  unaffectedReport,
  runId,
) => {
  const disableKey = keyFor(runId, 'facilitator-disable-' + fixture.suffix);
  const reactivateKey = keyFor(runId, 'facilitator-reactivate-' + fixture.suffix);
  const disabled = await call(platformClient, 'changePlatformFacilitatorStatus', {
    organizationId: fixture.organizationId,
    memberId: fixture.facilitatorUid,
    status: 'disabled',
    reason: 'Production smoke tenant-scoped facilitator disable',
    idempotencyKey: disableKey,
  });
  assert.equal(disabled.memberId, fixture.facilitatorUid);
  assert.equal(disabled.role, 'facilitator');
  assert.equal(disabled.status, 'disabled');
  try {
    const memberships = await call(fixture.facilitatorClient, 'listMyOrganizations', {});
    assert.equal(
      memberships.organizations.some((item) => item.id === fixture.organizationId),
      false,
    );
    await assertDenied(
      () => getDocFromServer(doc(
        fixture.facilitatorClient.db,
        'workshops',
        fixture.workshopId,
      )),
      ['permission-denied'],
      'Disabled facilitator Firestore workshop access',
    );
    await assertDenied(
      () => call(fixture.facilitatorClient, 'generateReportSnapshot', {
        workshopId: fixture.workshopId,
        idempotencyKey: keyFor(runId, 'disabled-report-' + fixture.suffix),
      }),
      ['functions/not-found'],
      'Disabled facilitator report generation',
    );
    await assertDenied(
      () => call(fixture.facilitatorClient, 'createReportDownload', {
        workshopId: fixture.workshopId,
        reportId: report.reportId,
        format: 'json',
        idempotencyKey: keyFor(runId, 'disabled-download-' + fixture.suffix),
      }),
      ['functions/permission-denied'],
      'Disabled facilitator report download',
    );

    const unaffectedMemberships = await call(unaffectedClient, 'listMyOrganizations', {});
    assert.ok(unaffectedMemberships.organizations.some(
      (item) => item.id === unaffectedFixture.organizationId,
    ));
    const unaffectedAuthorization = await call(unaffectedClient, 'createReportDownload', {
      workshopId: unaffectedFixture.workshopId,
      reportId: unaffectedReport.reportId,
      format: 'json',
      idempotencyKey: keyFor(
        runId,
        'unaffected-download-' + fixture.suffix + '-' + unaffectedFixture.suffix,
      ),
    });
    const unaffectedResponse = await globalThis.fetch(unaffectedAuthorization.url, {
      signal: AbortSignal.timeout(30_000),
    });
    assert.equal(unaffectedResponse.status, 200);
  } finally {
    const reactivated = await call(platformClient, 'changePlatformFacilitatorStatus', {
      organizationId: fixture.organizationId,
      memberId: fixture.facilitatorUid,
      status: 'active',
      reason: 'Restore tenant-scoped facilitator after production smoke',
      idempotencyKey: reactivateKey,
    });
    assert.equal(reactivated.memberId, fixture.facilitatorUid);
    assert.equal(reactivated.status, 'active');
  }

  const restoredMemberships = await call(fixture.facilitatorClient, 'listMyOrganizations', {});
  assert.ok(restoredMemberships.organizations.some(
    (item) => item.id === fixture.organizationId,
  ));
  const audit = await admin.db.collection(
    'organizations/' + fixture.organizationId + '/auditEvents',
  ).where('targetId', '==', fixture.facilitatorUid).get();
  const actions = audit.docs.map((snapshot) => snapshot.data().action);
  assert.equal(actions.filter((action) => action === 'member.disabled').length, 1);
  assert.equal(actions.filter((action) => action === 'member.activated').length, 1);
};
const verifySuspensionAndAudit = async (
  admin,
  platformClient,
  facilitatorClient,
  fixture,
  report,
  otherFacilitatorClient,
  otherFixture,
  otherReport,
  runId,
) => {
  const suspendKey = keyFor(runId, 'platform-suspend-' + fixture.suffix);
  const reactivateKey = keyFor(runId, 'platform-reactivate-' + fixture.suffix);
  await call(platformClient, 'suspendPlatformOrganization', {
    organizationId: fixture.organizationId,
    reason: 'Ephemeral production release suspension smoke',
    idempotencyKey: suspendKey,
  });
  try {
    const listedWhileSuspended = await call(facilitatorClient, 'listMyOrganizations', {});
    const suspendedSummary = listedWhileSuspended.organizations.find(
      (organization) => organization.id === fixture.organizationId,
    );
    assert.equal(suspendedSummary?.operationalStatus, 'suspended');
    const otherOrganizations = await call(otherFacilitatorClient, 'listMyOrganizations', {});
    const otherSummary = otherOrganizations.organizations.find(
      (organization) => organization.id === otherFixture.organizationId,
    );
    assert.equal(otherSummary?.operationalStatus, 'active');
    const unaffectedDownload = await call(otherFacilitatorClient, 'createReportDownload', {
      workshopId: otherFixture.workshopId,
      reportId: otherReport.reportId,
      format: 'json',
      idempotencyKey: keyFor(
        runId,
        'unaffected-download-' + fixture.suffix.toLowerCase()
          + '-' + otherFixture.suffix.toLowerCase(),
      ),
    });
    const unaffectedResponse = await globalThis.fetch(unaffectedDownload.url, {
      signal: AbortSignal.timeout(30_000),
    });
    assert.equal(unaffectedResponse.status, 200);
    assert.ok(
      unaffectedResponse.headers.get('content-type')?.toLowerCase().startsWith(
        REPORT_MIME_TYPES.json,
      ),
    );
    await assertDenied(
      () => call(facilitatorClient, 'generateReportSnapshot', {
        workshopId: fixture.workshopId,
        idempotencyKey: keyFor(runId, 'suspended-report-' + fixture.suffix),
      }),
      ['functions/failed-precondition'],
      'Suspended organization report access',
    );
  } finally {
    await call(platformClient, 'reactivatePlatformOrganization', {
      organizationId: fixture.organizationId,
      reason: 'Restore ephemeral smoke tenant after suspension test',
      idempotencyKey: reactivateKey,
    });
  }
  const listedActive = await call(facilitatorClient, 'listMyOrganizations', {});
  const activeSummary = listedActive.organizations.find(
    (organization) => organization.id === fixture.organizationId,
  );
  assert.equal(activeSummary?.operationalStatus, 'active');
  const [organizationAudit, workshopAudit, reportDocument] = await Promise.all([
    admin.db.collection('organizations/' + fixture.organizationId + '/auditEvents').get(),
    admin.db.collection('workshops/' + fixture.workshopId + '/auditEvents').get(),
    admin.db.doc('workshops/' + fixture.workshopId + '/reports/' + report.reportId).get(),
  ]);
  const organizationActions = organizationAudit.docs.map((snapshot) => snapshot.data().action);
  const workshopActions = workshopAudit.docs.map((snapshot) => snapshot.data().action);
  assert.ok(organizationActions.includes('report.downloaded'));
  assert.ok(organizationActions.includes('organization.suspended'));
  assert.ok(organizationActions.includes('organization.reactivated'));
  assert.ok(workshopActions.includes('workshop.created'));
  assert.ok(workshopActions.includes('workshop.transitionCommitted'));
  assert.equal(reportDocument.data()?.status, 'published');
};

const verifyOperator = async (admin) => {
  const uid = requiredEnvironment('KREATUM_SMOKE_PLATFORM_ADMIN_UID');
  const user = await admin.auth.getUser(uid);
  if (user.disabled || user.customClaims?.platformAdmin !== true) {
    throw new Error('Configured JU operator is not an active platform admin.');
  }
  return uid;
};

const createPlatformClient = async (admin, config, operatorUid, runId, clients) => {
  const token = await admin.auth.createCustomToken(operatorUid);
  const platformClient = clientContext(config, runId + '-platform-client');
  clients.push(platformClient);
  await signInWithCustomToken(platformClient.auth, token);
  return platformClient;
};

const runSmoke = async (options, config, admin) => {
  const manifest = options.manifestPath;
  if (existsSync(manifest)) throw new Error('Refusing to reuse an existing smoke manifest.');
  const operatorUid = await verifyOperator(admin);
  appendManifestEvent(manifest, {
    type: 'manifest.created',
    projectId: options.projectId,
    runId: options.runId,
    operatorUid,
    appId: config.appId,
    region: REGION,
    appCheckMode: 'monitor',
    backupId: requiredEnvironment('KREATUM_SMOKE_BACKUP_ID'),
  });
  const fixtures = ['A', 'B'].map((suffix) => ({
    suffix,
    organizationId: options.runId + '-org-' + suffix.toLowerCase(),
    facilitatorUid: options.runId + '-fac-' + suffix.toLowerCase(),
    email: options.runId + '-' + suffix.toLowerCase() + '@smoke.invalid',
    roomCode: roomCodeFor(options.runId, suffix),
    marker: 'TENANT-' + suffix + '-' + options.runId,
  }));
  const clients = [];
  try {
    const platformClient = await createPlatformClient(
      admin,
      config,
      operatorUid,
      options.runId,
      clients,
    );
    for (const fixture of fixtures) {
      const password = await createFacilitator(admin, fixture, manifest, options.runId);
      await createOrganization(admin, fixture, manifest, options.runId);
      const facilitatorClient = clientContext(config, options.runId + '-fac-client-' + fixture.suffix);
      clients.push(facilitatorClient);
      await signInWithEmailAndPassword(facilitatorClient.auth, fixture.email, password);
      const organizations = await call(facilitatorClient, 'listMyOrganizations', {});
      assert.deepEqual(
        organizations.organizations.map((organization) => organization.id),
        [fixture.organizationId],
      );
      fixture.facilitatorClient = facilitatorClient;
      await createWorkshop(facilitatorClient, fixture, manifest, options.runId);
      await joinParticipants(
        admin,
        config,
        clients,
        fixture,
        manifest,
        options.runId,
      );
      await tagSmokeWorkshop(admin, fixture, options.runId);
      await verifyReconnect(admin, fixture, options.runId);
    }
    await verifyTenantIsolation(
      fixtures[0],
      fixtures[1],
      fixtures[0].facilitatorClient,
      fixtures[0].participantClients[0],
      options.runId,
    );
    await verifyTenantIsolation(
      fixtures[1],
      fixtures[0],
      fixtures[1].facilitatorClient,
      fixtures[1].participantClients[0],
      options.runId,
    );
    for (const fixture of fixtures) {
      await completeSevenPhases(
        fixture.facilitatorClient,
        fixture.participantClients,
        fixture,
        options.runId,
      );
    }
    for (const [index, fixture] of fixtures.entries()) {
      const platformData = await call(platformClient, 'getPlatformWorkshopData', {
        organizationId: fixture.organizationId,
        workshopId: fixture.workshopId,
        reason: 'Production release smoke tenant isolation review',
      });
      const serialized = JSON.stringify(platformData.dataset);
      assert.ok(serialized.includes(fixture.marker));
      assert.equal(serialized.includes(fixtures[1 - index].marker), false);
    }
    for (const [organizationIndex, workshopIndex] of [[0, 1], [1, 0]]) {
      await assertDenied(
        () => call(platformClient, 'getPlatformWorkshopData', {
          organizationId: fixtures[organizationIndex].organizationId,
          workshopId: fixtures[workshopIndex].workshopId,
          reason: 'Production release smoke cross tenant denial',
        }),
        ['functions/not-found'],
        'Platform cross-tenant organization/workshop mismatch '
          + fixtures[organizationIndex].suffix + '/' + fixtures[workshopIndex].suffix,
      );
    }
    const reports = [];
    for (const [index, fixture] of fixtures.entries()) {
      reports[index] = await generateAndVerifyReport(
        fixture.facilitatorClient,
        fixture,
        fixtures[1 - index].marker,
        options.runId,
      );
    }
    for (const [sourceIndex, targetIndex] of [[0, 1], [1, 0]]) {
      await assertDenied(
        () => call(fixtures[sourceIndex].facilitatorClient, 'createReportDownload', {
          workshopId: fixtures[targetIndex].workshopId,
          reportId: reports[targetIndex].reportId,
          format: 'json',
          idempotencyKey: keyFor(
            options.runId,
            'cross-download-' + fixtures[sourceIndex].suffix.toLowerCase()
              + '-' + fixtures[targetIndex].suffix.toLowerCase(),
          ),
        }),
        ['functions/not-found'],
        'Cross-tenant report download ' + fixtures[sourceIndex].suffix
          + ' to ' + fixtures[targetIndex].suffix,
      );
    }
    for (const [sourceIndex, unaffectedIndex] of [[0, 1], [1, 0]]) {
      await verifyFacilitatorStatusIsolation(
        admin,
        platformClient,
        fixtures[sourceIndex],
        reports[sourceIndex],
        fixtures[unaffectedIndex].facilitatorClient,
        fixtures[unaffectedIndex],
        reports[unaffectedIndex],
        options.runId,
      );
    }
    for (const [index, fixture] of fixtures.entries()) {
      await verifySuspensionAndAudit(
        admin,
        platformClient,
        fixture.facilitatorClient,
        fixture,
        reports[index],
        fixtures[1 - index].facilitatorClient,
        fixtures[1 - index],
        reports[1 - index],
        options.runId,
      );
    }
    appendManifestEvent(manifest, { type: 'smoke.completed', status: 'passed' });
  } finally {
    await Promise.allSettled(clients.map((client) => deleteClientApp(client.app)));
  }
};

const isNotFound = (error) =>
  error?.code === 5
  || error?.code === 'not-found'
  || error?.code === 'auth/user-not-found';

export const cleanupProductionSmoke = async (options, admin) => {
  const events = readManifest(options.manifestPath, options.runId);
  const resources = collectManifestResources(events, options.runId);
  const organizations = new Set(resources.organizations);
  const workshops = new Map(resources.workshops.map((entry) => [entry.id, entry.organizationId]));
  if (resources.platformCommands.length > 0) {
    throw new Error('Refusing cleanup of unbound platform command keys.');
  }
  const header = events.find((event) => event.type === 'manifest.created');
  if (typeof header?.operatorUid !== 'string' || !header.operatorUid) {
    throw new Error('Smoke manifest is missing its exact operator.');
  }
  for (const organizationId of organizations) {
    assertOwnedIdentifier(options.runId, organizationId, 'organization');
    const snapshot = await admin.db.doc('organizations/' + organizationId).get();
    assertCleanupOrganizationOwnership(
      options.runId, organizationId, snapshot.exists ? snapshot.data() : null,
    );
  }
  for (const organizationId of organizations) {
    const suffix = organizationId.endsWith('-org-a')
      ? 'A'
      : organizationId.endsWith('-org-b') ? 'B' : null;
    if (!suffix) throw new Error('Unexpected smoke organization suffix.');
    for (const operation of ['suspendPlatformOrganization', 'reactivatePlatformOrganization']) {
      const action = operation === 'suspendPlatformOrganization' ? 'suspend' : 'reactivate';
      const idempotencyKey = keyFor(options.runId, 'platform-' + action + '-' + suffix);
      const commandId = createHash('sha256')
        .update(header.operatorUid + ':' + operation + ':' + idempotencyKey)
        .digest('hex')
        .slice(0, 24);
      const commandRef = admin.db.doc('platformCommandKeys/' + commandId);
      const command = await commandRef.get();
      if (!command.exists) continue;
      if (command.data()?.operation !== operation) {
        throw new Error('Refusing to delete a mismatched platform command.');
      }
      await commandRef.delete();
    }
    const memberId = options.runId + '-fac-' + suffix.toLowerCase();
    for (const action of ['disable', 'reactivate']) {
      const operation = 'changePlatformFacilitatorStatus';
      const idempotencyKey = keyFor(
        options.runId,
        'facilitator-' + action + '-' + suffix,
      );
      const commandScope = operation + ':' + organizationId + ':' + memberId;
      const commandId = createHash('sha256')
        .update(header.operatorUid + ':' + commandScope + ':' + idempotencyKey)
        .digest('hex')
        .slice(0, 24);
      const commandRef = admin.db.doc('platformCommandKeys/' + commandId);
      const command = await commandRef.get();
      if (!command.exists) continue;
      if (command.data()?.operation !== operation
        || command.data()?.organizationId !== organizationId
        || command.data()?.memberHash !== createHash('sha256')
          .update(memberId)
          .digest('hex')
          .slice(0, 24)) {
        throw new Error('Refusing to delete a mismatched facilitator status command.');
      }
      await commandRef.delete();
    }
  }
  for (const roomCode of new Set(resources.roomCodes)) {
    assertOwnedRoomCode(options.runId, roomCode);
    const roomCodeRef = admin.db.doc('activeRoomCodes/' + roomCode);
    const snapshot = await roomCodeRef.get();
    if (!snapshot.exists) continue;
    const organizationId = snapshot.data()?.organizationId;
    assertOwnedIdentifier(options.runId, organizationId, 'room code organization');
    if (!organizations.has(organizationId)) throw new Error('Room code organization is not in manifest.');
    const workshopId = snapshot.data()?.workshopId;
    if (typeof workshopId !== 'string' || !workshopId) throw new Error('Unsafe room code workshop.');
    workshops.set(workshopId, organizationId);
  }
  for (const [workshopId, organizationId] of workshops) {
    const workshopRef = admin.db.doc('workshops/' + workshopId);
    const snapshot = await workshopRef.get();
    if (!snapshot.exists) continue;
    if (snapshot.data()?.organizationId !== organizationId
      || (snapshot.data()?.smokeRunId !== options.runId
        && snapshot.data()?.client !== '[SMOKE ' + options.runId + '] Tenant '
          + (organizationId.endsWith('-org-a') ? 'A' : 'B'))) {
      throw new Error('Refusing to delete workshop without exact smoke ownership.');
    }
    await admin.db.recursiveDelete(workshopRef);
  }
  for (const roomCode of new Set(resources.roomCodes)) {
    const roomCodeRef = admin.db.doc('activeRoomCodes/' + roomCode);
    const snapshot = await roomCodeRef.get();
    if (!snapshot.exists) continue;
    assertOwnedIdentifier(
      options.runId,
      snapshot.data()?.organizationId,
      'room code organization',
    );
    await roomCodeRef.delete();
  }
  for (const organizationId of organizations) {
    assertOwnedIdentifier(options.runId, organizationId, 'organization');
    const organizationRef = admin.db.doc('organizations/' + organizationId);
    const snapshot = await organizationRef.get();
    assertCleanupOrganizationOwnership(
      options.runId, organizationId, snapshot.exists ? snapshot.data() : null,
    );
    if (!snapshot.exists) continue;
    const prefix = 'organizations/' + organizationId + '/';
    const [files] = await admin.bucket.getFiles({ prefix });
    for (const file of files) {
      if (!file.name.startsWith(prefix)) throw new Error('Storage cleanup escaped its exact prefix.');
      await file.delete({ ignoreNotFound: true });
    }
    await admin.db.recursiveDelete(organizationRef);
  }
  for (const user of new Map(resources.users.map((entry) => [entry.id, entry])).values()) {
    for (const organizationId of organizations) {
      await admin.db.doc(
        'users/' + user.id + '/organizationMemberships/' + organizationId,
      ).delete();
    }
    try {
      const record = await admin.auth.getUser(user.id);
      const exactClaim = record.customClaims?.kreatumSmokeRunId === options.runId;
      if (!exactClaim) {
        throw new Error('Refusing to delete Auth user without exact smoke ownership.');
      }
      await admin.auth.deleteUser(user.id);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }
  appendManifestEvent(options.manifestPath, {
    type: 'cleanup.completed',
    status: 'passed',
    note: 'joinRateLimits uses short-lived server-IP TTL buckets and is intentionally not wildcard-deleted',
  });
};

export const main = async (values = process.argv.slice(2)) => {
  const parsed = parseSmokeArguments(values);
  const options = assertSafeSmokeOptions(parsed);
  const config = loadRuntimeConfig(options.cleanupOnly);
  const admin = createAdminContext(
    options.projectId,
    config.storageBucket,
    options.runId,
    config.tokenSignerServiceAccount,
  );
  let smokeError;
  try {
    if (!options.cleanupOnly) {
      try {
        await runSmoke(options, config, admin);
      } catch (error) {
        smokeError = error;
        appendManifestEvent(options.manifestPath, {
          type: 'smoke.completed',
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (existsSync(options.manifestPath)) {
      await cleanupProductionSmoke(options, admin);
    } else if (options.cleanupOnly) {
      throw new Error('Cleanup manifest does not exist.');
    }
    if (smokeError) throw smokeError;
  } finally {
    await deleteAdminApp(admin.app);
  }
};

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
