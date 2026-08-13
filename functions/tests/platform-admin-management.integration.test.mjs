import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

if (!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('Esta prueba solo puede ejecutarse con los emuladores de Auth y Firestore.');
}

const suffix = randomUUID().slice(0, 8);
const projectId = `demo-platform-admin-${suffix}`;
const targetUid = `target-${suffix}`;
const operatorUid = `operator-${suffix}`;
const app = initializeApp({ projectId }, `platform-admin-${suffix}`);
const auth = getAuth(app);
const db = getFirestore(app);

const run = (action, extra = [], expectedStatus = 0) => {
  const result = spawnSync(process.execPath, [
    'scripts/manage-platform-admin.mjs',
    `--${action}`,
    '--project', projectId,
    '--uid', targetUid,
    ...extra,
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      GCLOUD_PROJECT: projectId,
      GOOGLE_CLOUD_PROJECT: projectId,
    },
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  assert.equal(result.status, expectedStatus, `STDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  return result;
};

test('platformAdmin grant is hashed, exclusive, audited, verified and reversible', {
  timeout: process.platform === 'win32' ? 300_000 : 60_000,
}, async (context) => {
  context.after(async () => deleteApp(app));
  await auth.createUser({
    uid: targetUid,
    email: `target-${suffix}@gfs.test`,
    emailVerified: true,
    password: 'Kreatum-Target-123!',
  });
  await auth.createUser({
    uid: operatorUid,
    email: `operator-${suffix}@gfs.test`,
    emailVerified: true,
    password: 'Kreatum-Operator-123!',
  });

  const dryRun = JSON.parse(run('grant').stdout);
  assert.equal(dryRun.mode, 'dry-run');
  assert.equal(dryRun.changesRequired, true);
  assert.equal(dryRun.activePlatformAdminCount, 0);
  assert.deepEqual(dryRun.errors, []);
  assert.match(dryRun.analysisHash, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(dryRun), new RegExp(targetUid));
  assert.doesNotMatch(JSON.stringify(dryRun), /@gfs\.test/);

  run('grant', [
    '--apply',
    '--confirm-project', projectId,
    '--operator-uid', operatorUid,
    '--confirm-analysis-hash', '0'.repeat(64),
    '--reason', 'Concesion productiva aprobada a JU',
  ], 1);
  const applied = JSON.parse(run('grant', [
    '--apply',
    '--confirm-project', projectId,
    '--operator-uid', operatorUid,
    '--confirm-analysis-hash', dryRun.analysisHash,
    '--reason', 'Concesion productiva aprobada a JU',
  ]).stdout);
  assert.equal(applied.applied, true);
  assert.equal(applied.verified, true);
  assert.equal((await auth.getUser(targetUid)).customClaims.platformAdmin, true);
  const grantAudit = await db.doc(`platformSecurityAuditEvents/${applied.eventId}`).get();
  assert.equal(grantAudit.data().status, 'completed');
  assert.equal(grantAudit.data().action, 'platformAdmin.granted');
  assert.equal(grantAudit.data().reason, 'Concesion productiva aprobada a JU');
  assert.equal('targetUid' in grantAudit.data(), false);

  const verifiedGrant = JSON.parse(run('grant', [
    '--verify', '--event-id', applied.eventId,
  ]).stdout);
  assert.equal(verifiedGrant.verified, true);

  const secondUid = `second-${suffix}`;
  await auth.createUser({
    uid: secondUid,
    email: `second-${suffix}@gfs.test`,
    emailVerified: true,
    password: 'Kreatum-Second-123!',
  });
  const blocked = spawnSync(process.execPath, [
    'scripts/manage-platform-admin.mjs',
    '--grant', '--project', projectId, '--uid', secondUid,
  ], {
    cwd: process.cwd(),
    env: { ...process.env, GCLOUD_PROJECT: projectId, GOOGLE_CLOUD_PROJECT: projectId },
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  assert.equal(blocked.status, 2);
  assert.match(blocked.stdout, /other-platform-admins-present/);

  const revokeDryRun = JSON.parse(run('revoke').stdout);
  const revoked = JSON.parse(run('revoke', [
    '--apply',
    '--confirm-project', projectId,
    '--operator-uid', operatorUid,
    '--confirm-analysis-hash', revokeDryRun.analysisHash,
    '--reason', 'Revocacion productiva de comprobacion',
  ]).stdout);
  assert.equal(revoked.verified, true);
  assert.equal((await auth.getUser(targetUid)).customClaims?.platformAdmin, undefined);
  const verifiedRevoke = JSON.parse(run('revoke', [
    '--verify', '--event-id', revoked.eventId,
  ]).stdout);
  assert.equal(verifiedRevoke.verified, true);
});
