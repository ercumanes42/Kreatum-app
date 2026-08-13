import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error('Esta prueba solo puede ejecutarse con los emuladores de Auth y Firestore.');
}

const projectId = process.env.GCLOUD_PROJECT || 'demo-kreatum';
const organizationId = `org-access-${randomUUID().slice(0, 8)}`;
const app = initializeApp({ projectId }, `access-migration-${randomUUID()}`);
const db = getFirestore(app);
const auth = getAuth(app);

const runMigration = (extraArguments = []) => {
  const result = spawnSync(process.execPath, [
    'scripts/migrate-access.mjs',
    '--project', projectId,
    '--organization', organizationId,
    '--organization-name', 'KREATUM Access Test',
    ...extraArguments,
  ], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  assert.equal(result.status, 0, `STDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  return JSON.parse(result.stdout);
};

test('access migration is dry-run first, preserves analyst and is idempotent', {
  timeout: process.platform === 'win32' ? 300_000 : 60_000,
}, async (context) => {
  context.after(async () => deleteApp(app));
  const owner = await auth.createUser({
    uid: `owner-${randomUUID()}`,
    email: 'juanmartinez@gfs.es',
    password: 'Kreatum-Test-Owner-123!',
    displayName: 'Juan Martinez',
  });
  const analyst = await auth.createUser({
    uid: `analyst-${randomUUID()}`,
    email: `historical-${randomUUID().slice(0, 6)}@gfs.es`,
    password: 'Kreatum-Test-Analyst-123!',
  });
  await db.doc(`organizations/${organizationId}/members/${analyst.uid}`).set({
    role: 'analyst',
    status: 'active',
  });

  const dryRun = runMigration();
  assert.equal(dryRun.mode, 'dry-run');
  assert.equal(dryRun.ownerBootstrapRequired, true);
  assert.equal(dryRun.historicalAnalysts.length, 1);
  assert.equal((await db.doc(`organizations/${organizationId}`).get()).exists, false);

  runMigration(['--apply', '--confirm-project', projectId]);
  const organization = await db.doc(`organizations/${organizationId}`).get();
  assert.deepEqual(organization.data()?.allowedEmailDomains, ['gfs.es']);
  assert.equal(organization.data()?.minimumActiveOwners, 1);
  const ownerMembership = await db.doc(`organizations/${organizationId}/members/${owner.uid}`).get();
  assert.equal(ownerMembership.data()?.role, 'owner');
  assert.equal(ownerMembership.data()?.status, 'active');
  const historicalMembership = await db.doc(`organizations/${organizationId}/members/${analyst.uid}`).get();
  assert.equal(historicalMembership.data()?.role, 'analyst');

  runMigration(['--apply', '--confirm-project', projectId]);
  const audit = await db.collection(`organizations/${organizationId}/auditEvents`).get();
  assert.equal(audit.docs.filter((item) => item.id === 'migration-access-v3').length, 1);
});
