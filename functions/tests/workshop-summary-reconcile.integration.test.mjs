import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('Esta prueba solo puede ejecutarse con el emulador de Firestore.');
}

const suffix = randomUUID().slice(0, 8);
const projectId = `demo-summary-reconcile-${suffix}`;
const organizationA = `org-a-${suffix}`;
const organizationB = `org-b-${suffix}`;
const workshopA = `workshop-a-${suffix}`;
const workshopB = `workshop-b-${suffix}`;
const conflictWorkshop = `workshop-conflict-${suffix}`;
const functionsRoot = fileURLToPath(new URL('..', import.meta.url));
const app = initializeApp({ projectId }, `summary-reconcile-${suffix}`);
const db = getFirestore(app);

after(async () => deleteApp(app));

const hash = (value) => createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
const technicalAuditId = (organizationId, workshopId, previousSummary, reconciledSummary) => {
  const signature = JSON.stringify({
    organizationId,
    workshopId,
    previousSummary,
    reconciledSummary,
  });
  return `summary-reconciliation-v1-${hash(signature)}`;
};

const runReconciliation = (extraArguments = [], expectedStatus = 0, overrides = {}) => {
  const result = spawnSync(process.execPath, [
    'scripts/reconcile-workshop-summary.mjs',
    '--project', overrides.projectId ?? projectId,
    ...extraArguments,
  ], {
    cwd: functionsRoot,
    env: {
      ...process.env,
      GCLOUD_PROJECT: overrides.projectId ?? projectId,
      GOOGLE_CLOUD_PROJECT: overrides.projectId ?? projectId,
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

test('summary reconciliation is tenant-safe, absolute, idempotent and preserves summary events', {
  timeout: process.platform === 'win32' ? 300_000 : 60_000,
}, async () => {
  await Promise.all([
    db.doc(`organizations/${organizationA}`).set({ name: 'Empresa confidencial A' }),
    db.doc(`organizations/${organizationB}`).set({ name: 'Empresa confidencial B' }),
    db.doc(`workshops/${workshopA}`).set({
      organizationId: organizationA,
      roomCode: 'NO-MOSTRAR',
      challenge: 'Contenido que nunca debe salir por consola',
      summary: { teamsCount: 0, attacksCount: 9 },
    }),
    db.doc(`workshops/${workshopB}`).set({
      organizationId: organizationB,
      summary: { teamsCount: 12, attacksCount: 0 },
    }),
    db.doc(`workshops/${workshopA}/teams/agua`).set({ answer: 'privada' }),
    db.doc(`workshops/${workshopA}/teams/aire`).set({ answer: 'privada' }),
    db.doc(`workshops/${workshopA}/attacks/a1`).set({ text: 'privado' }),
    db.doc(`workshops/${workshopA}/summaryEvents/existing-trigger-event`).set({
      field: 'teamsCount', delta: 1,
    }),
    db.doc(`workshops/${workshopB}/teams/fuego`).set({ answer: 'privada' }),
    db.doc(`workshops/${workshopB}/attacks/b1`).set({ text: 'privado' }),
    db.doc(`workshops/${workshopB}/attacks/b2`).set({ text: 'privado' }),
  ]);

  const dryRun = runReconciliation(['--organization', organizationA]);
  assert.match(dryRun.stdout, /"mode": "dry-run"/);
  assert.match(dryRun.stdout, /"driftCount": 1/);
  assert.match(dryRun.stdout, /"teamsCount": 2/);
  assert.match(dryRun.stdout, /"attacksCount": 1/);
  assert.doesNotMatch(dryRun.stdout, /NO-MOSTRAR|Contenido|Empresa confidencial|privad/i);
  assert.deepEqual((await db.doc(`workshops/${workshopA}`).get()).data()?.summary, {
    teamsCount: 0,
    attacksCount: 9,
  });

  const beforeApply = runReconciliation(['--verify', '--organization', organizationA], 2);
  assert.match(beforeApply.stdout, /"verified": false/);
  const applied = runReconciliation([
    '--apply',
    '--confirm-project', projectId,
    '--organization', organizationA,
  ]);
  assert.match(applied.stdout, /"workshopsUpdated": 1/);
  assert.match(applied.stdout, /"verified": true/);

  const [updatedA, untouchedB, summaryEvent, auditEvents] = await Promise.all([
    db.doc(`workshops/${workshopA}`).get(),
    db.doc(`workshops/${workshopB}`).get(),
    db.doc(`workshops/${workshopA}/summaryEvents/existing-trigger-event`).get(),
    db.collection(`workshops/${workshopA}/auditEvents`).get(),
  ]);
  assert.equal(updatedA.data()?.summary?.teamsCount, 2);
  assert.equal(updatedA.data()?.summary?.attacksCount, 1);
  assert.equal(untouchedB.data()?.summary?.teamsCount, 12);
  assert.equal(untouchedB.data()?.summary?.attacksCount, 0);
  assert.equal(summaryEvent.exists, true);
  assert.equal(auditEvents.size, 1);
  const technicalAudit = auditEvents.docs[0].data();
  assert.equal(technicalAudit.action, 'workshop.summaryReconciled');
  assert.equal(technicalAudit.actorId, 'system:summary-reconciliation');
  assert.deepEqual(technicalAudit.metadata?.previousSummary, {
    teamsCount: 0,
    attacksCount: 9,
  });
  assert.deepEqual(technicalAudit.metadata?.reconciledSummary, {
    teamsCount: 2,
    attacksCount: 1,
  });
  assert.equal(typeof technicalAudit.metadata?.reason, 'string');
  assert.equal(Object.hasOwn(technicalAudit.metadata ?? {}, 'roomCode'), false);

  const repeated = runReconciliation([
    '--apply',
    '--confirm-project', projectId,
    '--organization', organizationA,
  ]);
  assert.match(repeated.stdout, /"workshopsUpdated": 0/);
  assert.match(repeated.stdout, /"verified": true/);
  assert.equal((await db.collection(`workshops/${workshopA}/auditEvents`).get()).size, 1);

  const scopedVerification = runReconciliation(['--verify', '--organization', organizationA]);
  assert.match(scopedVerification.stdout, /"verified": true/);
  const otherTenantVerification = runReconciliation([
    '--verify', '--organization', organizationB,
  ], 2);
  assert.match(otherTenantVerification.stdout, /"driftCount": 1/);
});

test('summary reconciliation blocks a conflicting technical audit without changing the workshop', {
  timeout: process.platform === 'win32' ? 300_000 : 60_000,
}, async () => {
  const previousSummary = { teamsCount: 0, attacksCount: 0 };
  const reconciledSummary = { teamsCount: 1, attacksCount: 0 };
  const conflictingAuditId = technicalAuditId(
    organizationA,
    conflictWorkshop,
    previousSummary,
    reconciledSummary,
  );
  await Promise.all([
    db.doc(`workshops/${conflictWorkshop}`).set({
      organizationId: organizationA,
      summary: previousSummary,
    }),
    db.doc(`workshops/${conflictWorkshop}/teams/tierra`).set({ answer: 'privada' }),
    db.doc(`workshops/${conflictWorkshop}/auditEvents/${conflictingAuditId}`).set({
      action: 'workshop.summaryReconciled',
      actorId: 'system:summary-reconciliation',
      metadata: {
        previousSummary,
        reconciledSummary: { teamsCount: 999, attacksCount: 999 },
        reason: 'conflict',
      },
      schemaVersion: 3,
    }),
  ]);

  const blocked = runReconciliation([
    '--apply',
    '--confirm-project', projectId,
    '--organization', organizationA,
  ], 2);
  assert.match(blocked.stdout, /"conflictCount": 1/);
  assert.match(blocked.stdout, /"applied": false/);
  const unchanged = await db.doc(`workshops/${conflictWorkshop}`).get();
  assert.deepEqual(unchanged.data()?.summary, previousSummary);
});

test('production project requires an explicit organization before any scan', () => {
  const productionProject = 'kreatum-dinamic';
  const result = runReconciliation([], 1, {
    projectId: productionProject,
    allowedProjects: productionProject,
  });
  assert.match(result.stderr, /Produccion exige --organization/);
});
