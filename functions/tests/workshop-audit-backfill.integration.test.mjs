import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('Esta prueba solo puede ejecutarse con el emulador de Firestore.');
}

const suffix = randomUUID().slice(0, 8);
const projectId = `demo-audit-backfill-${suffix}`;
const organizationA = `org-a-${suffix}`;
const organizationB = `org-b-${suffix}`;
const workshopA = `workshop-a-${suffix}`;
const workshopB = `workshop-b-${suffix}`;
const actorUid = `actor-${suffix}`;
const functionsRoot = fileURLToPath(new URL('..', import.meta.url));
const app = initializeApp({ projectId }, `audit-backfill-${suffix}`);
const db = getFirestore(app);

const destinationPath = (organizationId, workshopId, eventId) => (
  `organizations/${organizationId}/auditEvents/workshop_${workshopId}_${eventId}`
);

const runBackfill = (extraArguments = [], expectedStatus = 0) => {
  const result = spawnSync(process.execPath, [
    'scripts/backfill-workshop-audit.mjs',
    '--project', projectId,
    ...extraArguments,
  ], {
    cwd: functionsRoot,
    env: {
      ...process.env,
      GCLOUD_PROJECT: projectId,
      GOOGLE_CLOUD_PROJECT: projectId,
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

test('audit backfill is tenant-safe, dry-run first, idempotent and verifiable', {
  timeout: process.platform === 'win32' ? 300_000 : 60_000,
}, async (context) => {
  context.after(async () => deleteApp(app));
  const createdAt = Timestamp.fromMillis(Date.now() - 60_000);
  await Promise.all([
    db.doc(`organizations/${organizationA}`).set({ name: 'Empresa A' }),
    db.doc(`organizations/${organizationB}`).set({ name: 'Empresa B' }),
    db.doc(`organizations/${organizationA}/members/${actorUid}`).set({
      role: 'facilitator',
      status: 'active',
      firstName: 'Persona',
      lastName: 'Empresa A',
      email: 'persona-a@example.test',
    }),
    db.doc(`organizations/${organizationB}/members/${actorUid}`).set({
      role: 'facilitator',
      status: 'active',
      firstName: 'Persona',
      lastName: 'Empresa B',
      email: 'persona-b@example.test',
    }),
    db.doc(`workshops/${workshopA}`).set({ organizationId: organizationA }),
    db.doc(`workshops/${workshopB}`).set({ organizationId: organizationB }),
  ]);
  await Promise.all([
    db.doc(`workshops/${workshopA}/auditEvents/created`).set({
      action: 'workshop.created', actorId: actorUid, metadata: {}, createdAt,
    }),
    db.doc(`workshops/${workshopA}/auditEvents/phase`).set({
      action: 'workshop.phaseChanged',
      actorId: actorUid,
      metadata: { from: 'Calcinar', to: 'Diluir' },
      createdAt: Timestamp.fromMillis(createdAt.toMillis() + 1),
    }),
    db.doc(`workshops/${workshopA}/auditEvents/ignored`).set({
      action: 'participant.heartbeat', actorId: actorUid, metadata: {}, createdAt,
    }),
    db.doc(`workshops/${workshopA}/auditEvents/system-transition`).set({
      action: 'workshop.phaseChanged',
      actorId: 'system:auto-transition',
      metadata: { from: 'Diluir', to: 'Conjugar' },
      createdAt: Timestamp.fromMillis(createdAt.toMillis() + 2),
    }),
    db.doc(`workshops/${workshopB}/auditEvents/created`).set({
      action: 'workshop.created', actorId: actorUid, metadata: {}, createdAt,
    }),
  ]);

  const dryRun = runBackfill();
  assert.match(dryRun.stdout, /"mode": "dry-run"/);
  assert.match(dryRun.stdout, /"missingEvents": 4/);
  assert.match(dryRun.stdout, /"ignoredEvents": 1/);
  assert.doesNotMatch(dryRun.stdout, /persona-a|persona-b|Persona Empresa/i);
  assert.equal((await db.doc(destinationPath(organizationA, workshopA, 'created')).get()).exists, false);

  const beforeApply = runBackfill(['--verify'], 2);
  assert.match(beforeApply.stdout, /"verified": false/);
  const scopedApply = runBackfill([
    '--apply', '--confirm-project', projectId, '--organization', organizationA,
  ]);
  assert.match(scopedApply.stdout, /"eventsCreated": 3/);
  assert.equal((await db.doc(destinationPath(organizationB, workshopB, 'created')).get()).exists, false);
  const scopedVerify = runBackfill(['--verify', '--organization', organizationA]);
  assert.match(scopedVerify.stdout, /"verified": true/);
  runBackfill(['--verify'], 2);
  const remainingApply = runBackfill(['--apply', '--confirm-project', projectId]);
  assert.match(remainingApply.stdout, /"eventsCreated": 1/);

  const [indexedA, indexedB, indexedSystem, allA, allB] = await Promise.all([
    db.doc(destinationPath(organizationA, workshopA, 'created')).get(),
    db.doc(destinationPath(organizationB, workshopB, 'created')).get(),
    db.doc(destinationPath(organizationA, workshopA, 'system-transition')).get(),
    db.collection(`organizations/${organizationA}/auditEvents`).get(),
    db.collection(`organizations/${organizationB}/auditEvents`).get(),
  ]);
  assert.equal(indexedA.data()?.actorName, 'Persona Empresa A');
  assert.equal(indexedA.data()?.actorEmail, 'persona-a@example.test');
  assert.equal(indexedA.data()?.source?.workshopId, workshopA);
  assert.equal(indexedB.data()?.actorName, 'Persona Empresa B');
  assert.equal(indexedB.data()?.actorEmail, 'persona-b@example.test');
  assert.equal(indexedB.data()?.source?.workshopId, workshopB);
  assert.equal(indexedSystem.data()?.actorId, 'system:auto-transition');
  assert.equal(indexedSystem.data()?.actorName, '');
  assert.equal(indexedSystem.data()?.actorEmail, '');
  assert.equal(allA.size, 3);
  assert.equal(allB.size, 1);

  const repeated = runBackfill(['--apply', '--confirm-project', projectId]);
  assert.match(repeated.stdout, /"eventsCreated": 0/);
  const verified = runBackfill(['--verify']);
  assert.match(verified.stdout, /"verified": true/);

  await db.doc(`workshops/${workshopA}/auditEvents/old-invalid-actor`).set({
    action: 'workshop.completed',
    actorId: 'invalid/actor',
    metadata: {},
    createdAt: Timestamp.fromMillis(createdAt.toMillis() - 86_400_000),
  });
  const cutoff = new Date(createdAt.toMillis() - 30_000).toISOString();
  const windowed = runBackfill(['--organization', organizationA, '--since', cutoff]);
  assert.match(windowed.stdout, /"reviewRequired": 0/);
  assert.match(windowed.stdout, /"outsideWindowEvents": 1/);

  await db.doc(`workshops/${workshopA}/auditEvents/conflict`).set({
    action: 'workshop.completed',
    actorId: actorUid,
    metadata: {},
    createdAt: Timestamp.fromMillis(createdAt.toMillis() + 2),
  });
  await db.doc(destinationPath(organizationA, workshopA, 'conflict')).set({
    action: 'workshop.deleted',
    actorId: actorUid,
    targetType: 'workshop',
    targetId: workshopA,
    source: { workshopId: workshopA, eventId: 'conflict' },
    createdAt: Timestamp.fromMillis(createdAt.toMillis() + 2),
    schemaVersion: 3,
  });
  await db.doc(`workshops/${workshopA}/auditEvents/pending`).set({
    action: 'workshop.resumed',
    actorId: actorUid,
    metadata: {},
    createdAt: Timestamp.fromMillis(createdAt.toMillis() + 3),
  });

  const blocked = runBackfill([
    '--apply', '--confirm-project', projectId, '--since', cutoff,
  ], 2);
  assert.match(blocked.stdout, /"conflictCount": 1/);
  assert.match(blocked.stdout, /"applied": false/);
  assert.equal((await db.doc(destinationPath(organizationA, workshopA, 'pending')).get()).exists, false);
});
