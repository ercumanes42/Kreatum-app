import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('Esta prueba solo puede ejecutarse con el emulador de Firestore.');
}

const suffix = randomUUID().slice(0, 8);
const projectId = `demo-transition-recovery-${suffix}`;
const organizationId = `org-${suffix}`;
const functionsRoot = fileURLToPath(new URL('..', import.meta.url));
const app = initializeApp({ projectId }, `transition-recovery-${suffix}`);
const db = getFirestore(app);

after(async () => deleteApp(app));

const hash = (value) => createHash('sha256').update(String(value)).digest('hex').slice(0, 16);

const target = (label) => {
  const workshopId = `workshop-${label}-${suffix}`;
  const roomCode = `${label.toUpperCase().slice(0, 2)}${suffix.slice(0, 4)}`;
  const transitionId = `transition-${label}-${suffix}`;
  const deadlineMillis = Date.now() - 60_000;
  return {
    workshopId,
    roomCode,
    transitionId,
    deadlineMillis,
    args: [
      '--organization-hash', hash(organizationId),
      '--workshop-hash', hash(workshopId),
      '--room-code-hash', hash(roomCode),
      '--transition-hash', hash(transitionId),
      '--expected-phase', 'Fermentar',
      '--expected-target-phase', 'Proyectar',
      '--expected-transition-kind', 'phase',
      '--expected-required-acks', '2',
      '--expected-received-acks', '0',
      '--expected-deadline', new Date(deadlineMillis).toISOString(),
    ],
  };
};

const runRecovery = (targetArguments, extraArguments = [], expectedStatus = 0, overrides = {}) => {
  const selectedProject = overrides.projectId ?? projectId;
  const result = spawnSync(process.execPath, [
    'scripts/recover-stale-workshop-transition.mjs',
    '--project', selectedProject,
    ...targetArguments,
    ...extraArguments,
  ], {
    cwd: functionsRoot,
    env: {
      ...process.env,
      GCLOUD_PROJECT: selectedProject,
      GOOGLE_CLOUD_PROJECT: selectedProject,
      ...(overrides.allowedProjects
        ? { KREATUM_MIGRATION_ALLOWED_PROJECTS: overrides.allowedProjects }
        : {}),
    },
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  assert.equal(
    result.status,
    expectedStatus,
    `STDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
  );
  return result;
};

const seedWorkshop = async (value) => {
  await Promise.all([
    db.doc(`organizations/${organizationId}`).set({ name: 'Empresa privada' }),
    db.doc(`activeRoomCodes/${value.roomCode}`).set({
      organizationId,
      workshopId: value.workshopId,
    }),
    db.doc(`workshops/${value.workshopId}`).set({
      organizationId,
      roomCode: value.roomCode,
      challenge: 'Contenido confidencial que nunca debe salir por consola',
      status: 'active',
      currentPhase: 'Fermentar',
      unlockedPhases: ['Selección', 'Calcinar', 'Diluir', 'Conjugar', 'Sublimar', 'Fermentar'],
      pendingTransitionId: value.transitionId,
      transitionState: 'requested',
      transitionKind: 'phase',
      transitionTargetPhase: 'Proyectar',
      transitionExpiresAt: Timestamp.fromMillis(value.deadlineMillis),
      transition: {
        id: value.transitionId,
        state: 'requested',
        kind: 'phase',
        targetPhase: 'Proyectar',
        requiredTeams: ['Agua', 'Aire'],
        acknowledgedTeams: [],
        requiredAcks: 2,
        receivedAcks: 0,
        requestedAt: Timestamp.fromMillis(value.deadlineMillis - 120_000),
        deadline: Timestamp.fromMillis(value.deadlineMillis),
        requestedByHash: 'actor-hash-not-public',
      },
    }),
    db.doc(`workshops/${value.workshopId}/teams/Agua`).set({ answer: 'privada' }),
    db.doc(`workshops/${value.workshopId}/participantSessions/session-private`).set({
      team: 'Agua', status: 'active',
    }),
    db.doc(`workshops/${value.workshopId}/participantDeviceSlots/0`).set({
      participantId: 'privado',
    }),
    db.doc(`workshops/${value.workshopId}/attacks/attack-private`).set({ text: 'privado' }),
    db.doc(`workshops/${value.workshopId}/defenses/defense-private`).set({ text: 'privado' }),
    db.doc(`workshops/${value.workshopId}/solutions/solution-private`).set({ text: 'privado' }),
    db.doc(`workshops/${value.workshopId}/commandKeys/command-private`).set({
      operation: 'private',
    }),
  ]);
};

test('cancel-stale is dry-run by default, exact, idempotent and preserves data', {
  timeout: process.platform === 'win32' ? 300_000 : 60_000,
}, async () => {
  const value = target('cancel');
  await seedWorkshop(value);
  const actionArguments = ['--action', 'cancel-stale', ...value.args];

  const dryRun = runRecovery(actionArguments);
  assert.match(dryRun.stdout, /"mode": "dry-run"/);
  assert.match(dryRun.stdout, /"ready": true/);
  assert.doesNotMatch(
    dryRun.stdout,
    new RegExp(`${value.roomCode}|${value.workshopId}|${value.transitionId}|Empresa privada|Contenido|privad`, 'i'),
  );
  assert.equal((await db.doc(`workshops/${value.workshopId}`).get()).data()?.transition?.state, 'requested');

  const verifyBefore = runRecovery(actionArguments, ['--verify'], 2);
  assert.match(verifyBefore.stdout, /"verified": false/);
  const missingConfirmation = runRecovery(actionArguments, ['--apply'], 1);
  assert.match(missingConfirmation.stderr, /confirm-project/);

  const applied = runRecovery(actionArguments, [
    '--apply',
    '--confirm-project', projectId,
  ]);
  assert.match(applied.stdout, /"applied": true/);
  assert.match(applied.stdout, /"verified": true/);

  const [workshop, activeRoom, auditEvents] = await Promise.all([
    db.doc(`workshops/${value.workshopId}`).get(),
    db.doc(`activeRoomCodes/${value.roomCode}`).get(),
    db.collection(`workshops/${value.workshopId}/auditEvents`).get(),
  ]);
  assert.equal(workshop.data()?.status, 'active');
  assert.equal(workshop.data()?.currentPhase, 'Fermentar');
  assert.equal(workshop.data()?.transition?.state, 'cancelled');
  assert.equal(Object.hasOwn(workshop.data() ?? {}, 'pendingTransitionId'), false);
  assert.equal(activeRoom.exists, true);
  assert.equal(auditEvents.size, 1);
  assert.equal(auditEvents.docs[0].data()?.action, 'workshop.transitionCancelled');
  assert.equal((await db.collection(`workshops/${value.workshopId}/attacks`).get()).size, 1);
  assert.equal((await db.collection(`workshops/${value.workshopId}/solutions`).get()).size, 1);

  const repeated = runRecovery(actionArguments, [
    '--apply',
    '--confirm-project', projectId,
  ]);
  assert.match(repeated.stdout, /"applied": false/);
  assert.match(repeated.stdout, /"verified": true/);
  assert.equal((await db.collection(`workshops/${value.workshopId}/auditEvents`).get()).size, 1);

  const verifyAfter = runRecovery(actionArguments, ['--verify']);
  assert.match(verifyAfter.stdout, /"verified": true/);
});

test('complete-explicit requires a second confirmation, closes the index and preserves content', {
  timeout: process.platform === 'win32' ? 300_000 : 60_000,
}, async () => {
  const value = target('complete');
  await seedWorkshop(value);
  await db.doc(`workshops/${value.workshopId}/auditEvents/existing-event`).set({
    action: 'workshop.created',
    actorId: 'private-actor',
    metadata: { content: 'private' },
  });
  const actionArguments = ['--action', 'complete-explicit', ...value.args];

  const missingCompletionConfirmation = runRecovery(actionArguments, [
    '--apply',
    '--confirm-project', projectId,
  ], 1);
  assert.match(missingCompletionConfirmation.stderr, /confirm-completion/);

  const applied = runRecovery(actionArguments, [
    '--apply',
    '--confirm-project', projectId,
    '--confirm-completion', hash(value.workshopId),
  ]);
  assert.match(applied.stdout, /"applied": true/);
  assert.match(applied.stdout, /"verified": true/);
  assert.doesNotMatch(
    applied.stdout,
    new RegExp(`${value.roomCode}|${value.workshopId}|${value.transitionId}|private|Contenido`, 'i'),
  );

  const [workshop, activeRoom, auditEvents, attack, solution] = await Promise.all([
    db.doc(`workshops/${value.workshopId}`).get(),
    db.doc(`activeRoomCodes/${value.roomCode}`).get(),
    db.collection(`workshops/${value.workshopId}/auditEvents`).get(),
    db.doc(`workshops/${value.workshopId}/attacks/attack-private`).get(),
    db.doc(`workshops/${value.workshopId}/solutions/solution-private`).get(),
  ]);
  assert.equal(workshop.data()?.status, 'completed');
  assert.equal(workshop.data()?.currentPhase, 'Fermentar');
  assert.equal(workshop.data()?.transition?.state, 'committed');
  assert.equal(workshop.data()?.transition?.kind, 'complete');
  assert.equal(workshop.data()?.transition?.recovery?.sourceTransitionHash, hash(value.transitionId));
  assert.equal(Object.hasOwn(workshop.data() ?? {}, 'pendingTransitionId'), false);
  assert.equal(activeRoom.exists, false);
  assert.equal(attack.data()?.text, 'privado');
  assert.equal(solution.data()?.text, 'privado');
  assert.equal(auditEvents.size, 4);
  assert.deepEqual(
    auditEvents.docs.map((document) => document.data()?.action).sort(),
    [
      'workshop.completed',
      'workshop.created',
      'workshop.transitionCancelled',
      'workshop.transitionCommitted',
    ].sort(),
  );

  const repeated = runRecovery(actionArguments, [
    '--apply',
    '--confirm-project', projectId,
    '--confirm-completion', hash(value.workshopId),
  ]);
  assert.match(repeated.stdout, /"applied": false/);
  assert.match(repeated.stdout, /"verified": true/);
  const verifyAfter = runRecovery(actionArguments, ['--verify']);
  assert.match(verifyAfter.stdout, /"verified": true/);
});

test('production apply is rejected without an exact project confirmation before database access', () => {
  const value = target('production');
  const actionArguments = ['--action', 'cancel-stale', ...value.args, '--apply'];
  const result = runRecovery(actionArguments, [], 1, {
    projectId: 'kreatum-dinamic',
    allowedProjects: 'kreatum-dinamic',
  });
  assert.match(result.stderr, /confirm-project/);
});
