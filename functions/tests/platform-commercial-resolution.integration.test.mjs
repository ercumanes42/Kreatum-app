import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('Esta prueba solo puede ejecutarse con el emulador de Firestore.');
}

const suffix = randomUUID().slice(0, 8);
const projectId = `demo-commercial-resolution-${suffix}`;
const organizationId = `org-${suffix}`;
const app = initializeApp({ projectId }, `commercial-resolution-${suffix}`);
const db = getFirestore(app);

const run = (extra = [], expectedStatus = 0) => {
  const result = spawnSync(process.execPath, [
    'scripts/resolve-platform-commercial.mjs',
    '--project', projectId,
    '--organization', organizationId,
    '--contracted', '5',
    '--used', '5',
    ...extra,
  ], {
    cwd: process.cwd(),
    env: { ...process.env, GCLOUD_PROJECT: projectId, GOOGLE_CLOUD_PROJECT: projectId },
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  assert.equal(result.status, expectedStatus, `STDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  return result;
};

test('commercial resolution is hashed, atomic, idempotent and never writes workshops', {
  timeout: process.platform === 'win32' ? 300_000 : 60_000,
}, async (context) => {
  context.after(async () => deleteApp(app));
  const validFrom = Timestamp.fromMillis(Date.now() - 86_400_000);
  await db.doc(`organizations/${organizationId}`).set({
    name: 'GFS fixture', status: 'active', schemaVersion: 3, validFrom,
  });
  for (let index = 0; index < 5; index += 1) {
    await db.doc(`workshops/workshop-${suffix}-${index}`).set({
      organizationId,
      status: index === 4 ? 'active' : 'completed',
      facilitator: index === 0 ? 'Joaquin' : index === 1 ? 'Tomas' : 'Legacy',
      challenge: `preserved-${index}`,
    });
  }
  const before = await db.collection('workshops').where('organizationId', '==', organizationId).get();
  const beforeData = new Map(before.docs.map((item) => [item.id, item.data()]));

  const dryRun = run();
  const dryRunReport = JSON.parse(dryRun.stdout);
  assert.equal(dryRunReport.allowance.contracted, 5);
  assert.equal(dryRunReport.allowance.used, 5);
  assert.equal(dryRunReport.allowance.available, 0);
  assert.equal(dryRunReport.workshopsScanned, 5);
  assert.equal(dryRunReport.organizationToUpdate, true);
  assert.match(dryRunReport.analysisHash, /^[a-f0-9]{64}$/);

  run(['--apply', '--confirm-project', projectId, '--confirm-analysis-hash', '0'.repeat(64), '--reason', 'Alta productiva GFS'], 1);
  run([
    '--apply', '--confirm-project', projectId,
    '--confirm-analysis-hash', dryRunReport.analysisHash,
    '--reason', 'Alta productiva GFS',
  ]);

  const organization = (await db.doc(`organizations/${organizationId}`).get()).data();
  assert.equal(organization.status, 'active');
  assert.equal(organization.schemaVersion, 3);
  assert.equal(organization.commercial.status, 'active');
  assert.equal(organization.commercial.includedWorkshops, 5);
  assert.equal(organization.commercial.additionalWorkshops, 0);
  assert.equal(organization.commercial.consumedWorkshops, 5);
  assert.equal(organization.commercial.validUntil, null);
  assert.equal(organization.commercialMigrationVersion, 1);
  assert.ok((await db.doc(`organizations/${organizationId}/auditEvents/migration-platform-commercial-resolution-v1`).get()).exists);

  const after = await db.collection('workshops').where('organizationId', '==', organizationId).get();
  assert.equal(after.size, before.size);
  for (const workshop of after.docs) assert.deepEqual(workshop.data(), beforeData.get(workshop.id));

  const repeatedDryRun = run();
  const repeatedReport = JSON.parse(repeatedDryRun.stdout);
  assert.equal(repeatedReport.organizationToUpdate, false);
  const verify = run(['--verify']);
  assert.equal(JSON.parse(verify.stdout).verified, true);
});

test('commercial resolution refuses a usage count different from current workshops', async () => {
  const result = spawnSync(process.execPath, [
    'scripts/resolve-platform-commercial.mjs',
    '--project', projectId,
    '--organization', organizationId,
    '--contracted', '6',
    '--used', '6',
  ], {
    cwd: process.cwd(),
    env: { ...process.env, GCLOUD_PROJECT: projectId, GOOGLE_CLOUD_PROJECT: projectId },
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  assert.equal(result.status, 2);
  assert.match(result.stdout, /used-does-not-match-workshop-count/);
});
