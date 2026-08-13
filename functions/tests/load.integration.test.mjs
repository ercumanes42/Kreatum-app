import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('La prueba de carga solo puede ejecutarse con FIRESTORE_EMULATOR_HOST.');
}

const projectId = process.env.GCLOUD_PROJECT || 'demo-kreatum';
const workshopCount = Number(process.env.KREATUM_LOAD_WORKSHOPS || 100);
if (!Number.isInteger(workshopCount) || workshopCount < 1 || workshopCount > 500) {
  throw new Error('KREATUM_LOAD_WORKSHOPS debe estar entre 1 y 500.');
}
const auditEventCount = Number(process.env.KREATUM_LOAD_AUDIT_EVENTS || 5_000);
if (!Number.isInteger(auditEventCount) || auditEventCount < 1 || auditEventCount > 20_000) {
  throw new Error('KREATUM_LOAD_AUDIT_EVENTS debe estar entre 1 y 20000.');
}

const app = initializeApp({ projectId }, `load-${randomUUID()}`);
const db = getFirestore(app);
const organizationId = `org-load-${randomUUID().slice(0, 8)}`;
const adminCount = Number(process.env.KREATUM_LOAD_ADMINS || 100);
if (!Number.isInteger(adminCount) || adminCount < 1 || adminCount > 500) {
  throw new Error('KREATUM_LOAD_ADMINS debe estar entre 1 y 500.');
}

const percentile = (values, ratio) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
};
const TEAMS = ['Fuego', 'Agua', 'Aire', 'Tierra'];

const commitInChunks = async (operations) => {
  for (let offset = 0; offset < operations.length; offset += 450) {
    const batch = db.batch();
    for (const operation of operations.slice(offset, offset + 450)) operation(batch);
    await batch.commit();
  }
};

test('workshop and 5000-event audit load baseline', {
  timeout: process.platform === 'win32' ? 600_000 : 60_000,
}, async (context) => {
  context.after(async () => deleteApp(app));
  const seedStartedAt = performance.now();
  const operations = [];
  operations.push((batch) => batch.set(db.doc(`organizations/${organizationId}`), {
    name: 'KREATUM Load',
    status: 'active',
    schemaVersion: 3,
  }));
  for (let adminIndex = 0; adminIndex < adminCount; adminIndex += 1) {
    operations.push((batch) => batch.set(
      db.doc(`organizations/${organizationId}/members/load-admin-${adminIndex}`),
      {
        role: 'owner',
        status: 'active',
        schemaVersion: 3,
      },
    ));
  }
  for (let workshopIndex = 0; workshopIndex < workshopCount; workshopIndex += 1) {
    const workshopId = `load-${String(workshopIndex).padStart(4, '0')}`;
    const workshopRef = db.doc(`workshops/${workshopId}`);
    operations.push((batch) => batch.set(workshopRef, {
      organizationId,
      roomCode: `L${String(workshopIndex).padStart(5, '0')}`,
      client: `Cliente ${workshopIndex}`,
      facilitator: 'Carga local',
      challenge: 'Validación de rendimiento local',
      status: workshopIndex % 2 === 0 ? 'active' : 'completed',
      currentPhase: 'Proyectar',
      unlockedPhases: ['Selección', 'Calcinar', 'Diluir', 'Conjugar', 'Sublimar', 'Fermentar', 'Proyectar'],
      createdAt: Timestamp.fromMillis(Date.now() - workshopIndex * 1000),
      updatedAt: FieldValue.serverTimestamp(),
      schemaVersion: 2,
      summary: { attacksCount: 10, teamsCount: 4, updatedAt: FieldValue.serverTimestamp() },
    }));
    for (const team of TEAMS) {
      operations.push((batch) => batch.set(workshopRef.collection('teams').doc(team), {
        team,
        revision: 1,
        activeDeviceId: `device-${workshopIndex}-${team}`,
        lastSavedAt: FieldValue.serverTimestamp(),
        selectedSolution: `Solución ${team}`,
        schemaVersion: 2,
        updatedAt: FieldValue.serverTimestamp(),
      }));
      operations.push((batch) => batch.set(
        workshopRef.collection('participantSessions').doc(`device-${workshopIndex}-${team}`),
        {
          team,
          status: 'active',
          persistedRevision: 1,
          acknowledgedRevision: 1,
          lastSeenAt: FieldValue.serverTimestamp(),
          expiresAt: Timestamp.fromMillis(Date.now() + 10 * 60_000),
          schemaVersion: 2,
        },
      ));
    }
    for (let attackIndex = 0; attackIndex < 10; attackIndex += 1) {
      const fromTeam = TEAMS[attackIndex % TEAMS.length];
      const toTeam = TEAMS[(attackIndex + 1) % TEAMS.length];
      operations.push((batch) => batch.set(workshopRef.collection('attacks').doc(`attack-${attackIndex}`), {
        fromTeam,
        toTeam,
        content: `Ataque ${attackIndex}`,
        timestamp: FieldValue.serverTimestamp(),
        schemaVersion: 2,
      }));
    }
  }
  const auditBaseTime = Date.now();
  const auditActions = [
    'workshop.created',
    'workshop.phaseChanged',
    'workshop.completed',
    'invitation.created',
    'member.roleChanged',
  ];
  for (let auditIndex = 0; auditIndex < auditEventCount; auditIndex += 1) {
    const actionIndex = auditIndex % auditActions.length;
    const targetType = actionIndex < 3
      ? 'workshop'
      : actionIndex === 3
        ? 'invitation'
        : 'member';
    const workshopTarget = String(
      Math.floor(auditIndex / auditActions.length) % workshopCount,
    ).padStart(4, '0');
    const targetId = targetType === 'workshop'
      ? 'load-' + workshopTarget
      : targetType + '-' + auditIndex;
    const auditId = String(auditIndex).padStart(5, '0');
    const auditRef = db.doc(
      'organizations/' + organizationId + '/auditEvents/audit-' + auditId,
    );
    operations.push((batch) => batch.set(auditRef, {
      action: auditActions[actionIndex],
      actorId: 'load-actor-' + (auditIndex % 25),
      actorEmail: 'load-actor-' + (auditIndex % 25) + '@gfs.es',
      actorName: 'Actor de carga ' + (auditIndex % 25),
      targetType,
      targetId,
      previousState: null,
      newState: null,
      reason: 'Validación de carga de actividad',
      createdAt: Timestamp.fromMillis(auditBaseTime - auditIndex),
      schemaVersion: 3,
    }));
  }
  await commitInChunks(operations);
  const seedDurationMs = performance.now() - seedStartedAt;

  const listStartedAt = performance.now();
  const firstPage = await db.collection('workshops')
    .where('organizationId', '==', organizationId)
    .orderBy('createdAt', 'desc')
    .limit(20)
    .get();
  const listDurationMs = performance.now() - listStartedAt;
  assert.equal(firstPage.size, Math.min(20, workshopCount));

  const detailStartedAt = performance.now();
  const selected = firstPage.docs[0];
  const [teams, attacks, defenses, solutions] = await Promise.all([
    selected.ref.collection('teams').get(),
    selected.ref.collection('attacks').get(),
    selected.ref.collection('defenses').get(),
    selected.ref.collection('solutions').get(),
  ]);
  const detailDurationMs = performance.now() - detailStartedAt;
  assert.equal(teams.size, 4);
  assert.equal(attacks.size, 10);
  assert.equal(defenses.size, 0);
  assert.equal(solutions.size, 0);

  const auditCollection = db.collection(
    'organizations/' + organizationId + '/auditEvents',
  );
  const participantSessions = await selected.ref.collection('participantSessions').get();
  assert.equal(participantSessions.size, 4);
  const auditListStartedAt = performance.now();
  const auditFirstPage = await auditCollection
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get();
  const auditListDurationMs = performance.now() - auditListStartedAt;
  assert.equal(auditFirstPage.size, Math.min(50, auditEventCount));

  const auditOverviewStartedAt = performance.now();
  const auditSnapshot = await auditCollection
    .where(
      'createdAt',
      '>=',
      Timestamp.fromMillis(Date.now() - 30 * 24 * 60 * 60 * 1000),
    )
    .orderBy('createdAt', 'desc')
    .limit(20_001)
    .get();
  const metrics = {
    totalEvents: auditSnapshot.size,
    uniqueActors: new Set(
      auditSnapshot.docs.map((item) => item.data().actorEmail),
    ).size,
    workshopsAffected: new Set(
      auditSnapshot.docs
        .filter((item) => item.data().targetType === 'workshop')
        .map((item) => item.data().targetId),
    ).size,
    accessOperations: auditSnapshot.docs.filter((item) => (
      item.data().targetType === 'member'
      || item.data().targetType === 'invitation'
    )).length,
  };
  const auditOverviewDurationMs = performance.now() - auditOverviewStartedAt;
  assert.deepEqual(metrics, {
    totalEvents: auditEventCount,
    uniqueActors: Math.min(25, auditEventCount),
    workshopsAffected: Math.min(
      workshopCount,
      Math.ceil(auditEventCount / auditActions.length),
    ),
    accessOperations: Math.floor(auditEventCount / auditActions.length) * 2
      + Math.max(0, auditEventCount % auditActions.length - 3),
  });

  const members = await db.collection(`organizations/${organizationId}/members`)
    .where('role', '==', 'owner')
    .get();
  assert.equal(members.size, adminCount);

  const concurrentControlDurations = [];
  const controlErrors = [];
  await Promise.all(Array.from({ length: workshopCount }, async (_, workshopIndex) => {
    const startedAt = performance.now();
    try {
      const workshopId = `load-${String(workshopIndex).padStart(4, '0')}`;
      const workshopRef = db.doc(`workshops/${workshopId}`);
      const [workshop, sessions] = await Promise.all([
        workshopRef.get(),
        workshopRef.collection('participantSessions').get(),
      ]);
      assert.equal(workshop.exists, true);
      assert.equal(sessions.size, 4);
    } catch (error) {
      controlErrors.push(error);
    } finally {
      concurrentControlDurations.push(performance.now() - startedAt);
    }
  }));
  assert.equal(controlErrors.length, 0, 'la carga de control no debe producir errores');
  const controlP95Ms = percentile(concurrentControlDurations, 0.95);

  const saveDurations = [];
  const saveErrors = [];
  await Promise.all(Array.from({ length: workshopCount }, (_, workshopIndex) => (
    Promise.all(TEAMS.map(async (team) => {
      const startedAt = performance.now();
      try {
        await db.doc(`workshops/load-${String(workshopIndex).padStart(4, '0')}/teams/${team}`)
          .set({
            revision: 2,
            lastSavedAt: FieldValue.serverTimestamp(),
            loadProbe: true,
          }, { merge: true });
      } catch (error) {
        saveErrors.push(error);
      } finally {
        saveDurations.push(performance.now() - startedAt);
      }
    }))
  )));
  assert.equal(saveErrors.length, 0, 'los 400 guardados concurrentes no deben fallar');
  assert.equal(saveDurations.length, workshopCount * TEAMS.length);
  const saveP95Ms = percentile(saveDurations, 0.95);

  assert.ok(seedDurationMs < 30_000, `seed demasiado lento: ${seedDurationMs.toFixed(0)} ms`);
  assert.ok(listDurationMs < 3_000, `listado demasiado lento: ${listDurationMs.toFixed(0)} ms`);
  assert.ok(detailDurationMs < 3_000, `detalle demasiado lento: ${detailDurationMs.toFixed(0)} ms`);
  assert.ok(
    auditListDurationMs < 2_000,
    'listado de actividad demasiado lento: ' + auditListDurationMs.toFixed(0) + ' ms',
  );
  assert.ok(
    auditOverviewDurationMs < 2_000,
    'overview de actividad demasiado lento: ' + auditOverviewDurationMs.toFixed(0) + ' ms',
  );
  assert.ok(controlP95Ms < 1_500, `control p95 demasiado lento: ${controlP95Ms.toFixed(0)} ms`);
  assert.ok(saveP95Ms < 2_000, `guardado p95 demasiado lento: ${saveP95Ms.toFixed(0)} ms`);
  console.log(JSON.stringify({
    workshopCount,
    participantSessionCount: workshopCount * TEAMS.length,
    adminCount,
    auditEventCount,
    seedDurationMs,
    listDurationMs,
    detailDurationMs,
    auditListDurationMs,
    auditOverviewDurationMs,
    controlP95Ms,
    saveP95Ms,
    errorRate: 0,
  }));
});
