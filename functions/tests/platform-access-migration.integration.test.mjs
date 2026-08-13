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
const projectId = `demo-platform-migration-${suffix}`;
const organizationId = `org-platform-${suffix}`;
const legacyOrganizationId = `org-legacy-${suffix}`;
const otherOrganizationId = `org-other-${suffix}`;
const facilitatorUid = `facilitator-${suffix}`;
const legacyFacilitatorUid = `legacy-facilitator-${suffix}`;
const otherFacilitatorUid = `other-facilitator-${suffix}`;
const app = initializeApp({ projectId }, `platform-migration-${suffix}`);
const db = getFirestore(app);

const runMigration = (extraArguments = [], expectedStatus = 0) => {
  const result = spawnSync(process.execPath, [
    'scripts/migrate-platform-access.mjs',
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

test('platform access migration is dry-run first, preserves usage and is verifiable', {
  timeout: process.platform === 'win32' ? 300_000 : 60_000,
}, async (context) => {
  context.after(async () => deleteApp(app));
  const now = Date.now();
  const validFrom = Timestamp.fromMillis(now - 60_000);
  const validUntil = Timestamp.fromMillis(now + 86_400_000);

  await db.doc(`organizations/${organizationId}`).set({
    name: 'Plan migration test',
    status: 'active',
    schemaVersion: 2,
    validFrom,
    validUntil,
    commercialPlan: {
      status: 'active',
      credits: 7,
      creditsUsed: 3,
    },
  });
  await db.doc(`organizations/${organizationId}/members/${facilitatorUid}`).set({
    role: 'facilitator',
    status: 'active',
  });
  await db.doc('workshops/platform-plan-workshop').set({
    organizationId,
    createdBy: facilitatorUid,
    status: 'active',
    currentPhase: 'Sublimar',
    unlockedPhases: ['Selección', 'Calcinar', 'Diluir', 'Conjugar', 'Sublimar'],
  });

  await db.doc(`organizations/${legacyOrganizationId}`).set({
    name: 'Legacy migration test',
    status: 'suspended',
    schemaVersion: 2,
    validFrom,
    validUntil,
    workshopsContracted: 11,
    workshopsUsed: 4,
  });
  await db.doc(`organizations/${legacyOrganizationId}/members/${legacyFacilitatorUid}`).set({
    role: 'facilitator',
    status: 'active',
  });
  await db.doc('workshops/platform-legacy-workshop').set({
    organizationId: legacyOrganizationId,
    facilitatorAssignment: { facilitatorUid: legacyFacilitatorUid },
    status: 'archived',
    currentPhase: 'Proyectar',
    unlockedPhases: ['Selección', 'Calcinar', 'Diluir', 'Conjugar', 'Sublimar', 'Fermentar', 'Proyectar'],
  });

  const dryRun = runMigration();
  assert.match(dryRun.stdout, /"mode": "dry-run"/);
  assert.equal((await db.doc(`organizations/${organizationId}`).get()).data()?.commercial, undefined);
  assert.equal((await db.doc('workshops/platform-plan-workshop').get()).data()?.facilitatorUid, undefined);

  runMigration(['--apply', '--confirm-project', 'wrong-project'], 1);
  runMigration(['--apply', '--confirm-project', projectId]);

  const [organization, legacyOrganization, workshop, legacyWorkshop] = await Promise.all([
    db.doc(`organizations/${organizationId}`).get(),
    db.doc(`organizations/${legacyOrganizationId}`).get(),
    db.doc('workshops/platform-plan-workshop').get(),
    db.doc('workshops/platform-legacy-workshop').get(),
  ]);
  assert.equal(organization.data()?.commercial?.includedWorkshops, 7);
  assert.equal(organization.data()?.commercial?.additionalWorkshops, 0);
  assert.equal(organization.data()?.commercial?.consumedWorkshops, 3);
  assert.ok(organization.data()?.commercial?.validFrom instanceof Timestamp);
  assert.equal(organization.data()?.commercialMigrationVersion, 1);
  assert.equal(legacyOrganization.data()?.commercial?.status, 'suspended');
  assert.equal(legacyOrganization.data()?.commercial?.includedWorkshops, 11);
  assert.equal(legacyOrganization.data()?.commercial?.consumedWorkshops, 4);
  assert.equal(workshop.data()?.facilitatorUid, facilitatorUid);
  assert.equal(legacyWorkshop.data()?.facilitatorUid, legacyFacilitatorUid);

  const repeated = runMigration(['--apply', '--confirm-project', projectId]);
  assert.match(repeated.stdout, /"organizationsUpdated": 0/);
  assert.match(repeated.stdout, /"workshopsUpdated": 0/);
  const verified = runMigration(['--verify']);
  assert.match(verified.stdout, /"verified": true/);

  await db.doc(`organizations/${otherOrganizationId}`).set({
    status: 'active',
    schemaVersion: 3,
    commercialMigrationVersion: 1,
    commercial: {
      plan: 'enterprise',
      status: 'active',
      validFrom,
      validUntil,
      includedWorkshops: 1,
      additionalWorkshops: 0,
      consumedWorkshops: 0,
    },
  });
  await db.doc(`organizations/${otherOrganizationId}/members/${otherFacilitatorUid}`).set({
    role: 'facilitator',
    status: 'active',
  });
  await db.doc(`users/${otherFacilitatorUid}/organizationMemberships/${otherOrganizationId}`).set({
    organizationId: otherOrganizationId,
    role: 'facilitator',
    status: 'active',
  });
  await db.doc('workshops/platform-cross-tenant-workshop').set({
    organizationId,
    facilitatorUid: otherFacilitatorUid,
    createdBy: facilitatorUid,
    status: 'active',
  });

  const review = runMigration([], 2);
  assert.match(review.stdout, /facilitator-belongs-to-other-tenant/);
  const blockedApply = runMigration(['--apply', '--confirm-project', projectId], 2);
  assert.match(blockedApply.stdout, /"reviewRequired": 1/);
  const unchanged = await db.doc('workshops/platform-cross-tenant-workshop').get();
  assert.equal(unchanged.data()?.facilitatorUid, otherFacilitatorUid);
});
