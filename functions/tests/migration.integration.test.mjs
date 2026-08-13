import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error('Esta prueba solo puede ejecutarse con los emuladores de Auth y Firestore.');
}

const projectId = process.env.GCLOUD_PROJECT || 'demo-kreatum';
const organizationId = 'org-migration-test';
const ownerUid = 'owner-migration-test';
const app = initializeApp({ projectId }, `migration-${randomUUID()}`);
const db = getFirestore(app);
const auth = getAuth(app);

const runScript = (script, args, expectedStatus = 0) => {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  assert.equal(
    result.status,
    expectedStatus,
    `${script} terminó con ${result.status}.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
  );
  return result;
};

test('bootstrap is explicit and legacy migration is dry-run, idempotent and verifiable', {
  timeout: process.platform === 'win32' ? 300_000 : 60_000,
}, async (context) => {
  context.after(async () => deleteApp(app));
  await auth.createUser({
    uid: ownerUid,
    email: 'migration-owner@kreatum.test',
    password: 'Kreatum-Test-123!',
  });

  const bootstrapArguments = [
    '--project', projectId,
    '--organization', organizationId,
    '--organization-name', 'KREATUM Migration Test',
    '--uid', ownerUid,
    '--role', 'owner',
  ];
  const bootstrapDryRun = runScript('scripts/bootstrap-membership.mjs', bootstrapArguments);
  assert.match(bootstrapDryRun.stdout, /"mode": "dry-run"/);
  assert.equal((await db.doc(`organizations/${organizationId}`).get()).exists, false);

  runScript('scripts/bootstrap-membership.mjs', [
    ...bootstrapArguments,
    '--apply',
    '--confirm-project', projectId,
  ]);
  const membership = await db.doc(`organizations/${organizationId}/members/${ownerUid}`).get();
  assert.equal(membership.data()?.role, 'owner');
  assert.equal(membership.data()?.status, 'active');

  const legacyRef = db.doc('games/legacy-game');
  const legacyData = {
    client: 'Cliente legado',
    facilitator: 'Facilitador legado',
    challenge: 'Reto legado',
    roomCode: 'MIGR42',
    status: 'active',
    currentPhase: 'Sublimar',
    unlockedPhases: ['Selección', 'Calcinar', 'Diluir', 'Conjugar', 'Sublimar'],
    createdAt: 1_700_000_000_000,
  };
  await legacyRef.set(legacyData);
  await legacyRef.collection('teams').doc('Agua').set({
    team: 'Agua',
    playerId: 'participant-one',
    memberIds: ['participant-one'],
    selectedSolution: 'Solución preservada',
    createdAt: 1_700_000_000_000,
  });
  await legacyRef.collection('attacks').doc('attack-1').set({
    fromTeam: 'Agua',
    toTeam: 'Fuego',
    content: 'Ataque preservado',
    timestamp: 1_700_000_001_000,
  });
  await legacyRef.collection('defenses').doc('defense-ambiguous').set({
    team: 'Agua',
    content: 'Defensa sin ataque enlazado',
    timestamp: 1_700_000_002_000,
  });
  await legacyRef.collection('solutions').doc('Agua').set({
    team: 'Agua',
    content: 'Solución compartida',
    timestamp: 1_700_000_003_000,
  });

  const migrationArguments = [
    '--project', projectId,
    '--organization', organizationId,
  ];
  const dryRun = runScript('scripts/migrate-legacy.mjs', migrationArguments);
  assert.match(dryRun.stdout, /"mode": "dry-run"/);
  assert.equal((await db.doc('workshops/legacy-game').get()).exists, false);

  const applied = runScript('scripts/migrate-legacy.mjs', [
    ...migrationArguments,
    '--apply',
    '--confirm-project', projectId,
  ]);
  assert.match(applied.stdout, /"applied": 1/);

  const target = await db.doc('workshops/legacy-game').get();
  assert.equal(target.data()?.schemaVersion, 2);
  assert.equal(target.data()?.organizationId, organizationId);
  assert.equal(target.data()?.migration?.reviewRequired, true);
  assert.ok(target.data()?.migration?.reviewCodes.includes('ambiguous-defense'));
  assert.equal(target.data()?.summary?.attacksCount, 1);
  assert.equal(target.data()?.summary?.teamsCount, 1);
  assert.ok(target.data()?.createdAt instanceof Timestamp);

  const [sourceAfter, codeIndex, participantSession, migratedDefense] = await Promise.all([
    legacyRef.get(),
    db.doc('activeRoomCodes/MIGR42').get(),
    db.doc('workshops/legacy-game/participantSessions/participant-one').get(),
    db.doc('workshops/legacy-game/defenses/defense-ambiguous').get(),
  ]);
  assert.deepEqual(sourceAfter.data(), legacyData);
  assert.equal(codeIndex.data()?.workshopId, 'legacy-game');
  assert.equal(participantSession.data()?.team, 'Agua');
  assert.equal(migratedDefense.data()?.migrationReviewRequired, true);

  const repeated = runScript('scripts/migrate-legacy.mjs', [
    ...migrationArguments,
    '--apply',
    '--confirm-project', projectId,
  ]);
  assert.match(repeated.stdout, /"skipped": 1/);
  const verified = runScript('scripts/migrate-legacy.mjs', [
    ...migrationArguments,
    '--verify',
  ]);
  assert.match(verified.stdout, /"verificationErrors": 0/);
});