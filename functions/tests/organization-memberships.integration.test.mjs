import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('Esta prueba solo puede ejecutarse con el emulador de Firestore.');
}

const suffix = randomUUID().slice(0, 8);
const projectId = `demo-kreatum-memberships-${suffix}`;
const organizationId = `org-memberships-${suffix}`;
const memberUid = `owner-memberships-${suffix}`;
const app = initializeApp({ projectId }, `memberships-${suffix}`);
const db = getFirestore(app);

const runMigration = (extraArguments = [], expectedStatus = 0) => {
  const result = spawnSync(process.execPath, [
    'scripts/migrate-organization-memberships.mjs',
    '--project', projectId,
    ...extraArguments,
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
  assert.equal(
    result.status,
    expectedStatus,
    `STDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
  );
  return result;
};

test('membership migration applies idempotently and verify detects drift', {
  timeout: process.platform === 'win32' ? 300_000 : 60_000,
}, async (context) => {
  context.after(async () => deleteApp(app));
  const memberRef = db.doc(`organizations/${organizationId}/members/${memberUid}`);
  const indexRef = db.doc(`users/${memberUid}/organizationMemberships/${organizationId}`);
  await memberRef.set({
    role: 'owner',
    status: 'active',
  });

  const dryRun = runMigration();
  assert.match(dryRun.stdout, /"mode": "dry-run"/);
  assert.equal((await indexRef.get()).exists, false);

  const initialVerify = runMigration(['--verify'], 2);
  assert.match(initialVerify.stdout, /"missingUidCount": 1/);
  assert.match(initialVerify.stdout, /"missingIndexCount": 1/);

  runMigration(['--apply', '--confirm-project', projectId]);
  runMigration(['--apply', '--confirm-project', projectId]);
  const member = await memberRef.get();
  const index = await indexRef.get();
  assert.equal(member.data()?.uid, memberUid);
  assert.deepEqual(index.data()?.organizationId, organizationId);
  assert.equal(index.data()?.role, 'owner');
  assert.equal(index.data()?.status, 'active');

  const verified = runMigration(['--verify']);
  assert.match(verified.stdout, /"verified": true/);

  await indexRef.update({ role: 'facilitator' });
  const drifted = runMigration(['--verify'], 2);
  assert.match(drifted.stdout, /"mismatchedIndexCount": 1/);

  runMigration(['--apply', '--confirm-project', projectId]);
  const repaired = runMigration(['--verify']);
  assert.match(repaired.stdout, /"verified": true/);
});
