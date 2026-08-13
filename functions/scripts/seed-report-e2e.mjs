import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const projectId = process.env.GCLOUD_PROJECT || 'demo-kreatum';
const organizationId = 'org-e2e';
const workshopId = 'workshop-report-e2e';
const email = 'report-owner@example.test';
const password = 'ReportOwner123!';

const app = initializeApp({
  projectId,
  storageBucket: `${projectId}.appspot.com`,
});
const auth = getAuth(app);
const db = getFirestore(app);

const existingUser = await auth.getUserByEmail(email).catch(() => null);
const user = existingUser || await auth.createUser({ email, password, emailVerified: true });
const createdAt = Timestamp.fromMillis(Date.UTC(2026, 5, 15, 9, 0, 0));
const completedAt = Timestamp.fromMillis(Date.UTC(2026, 5, 15, 12, 30, 0));

await Promise.all([
  db.doc(`organizations/${organizationId}`).set({
    name: 'Organizacion E2E',
    schemaVersion: 3,
    status: 'active',
    commercial: {
      status: 'active',
      validFrom: Timestamp.fromMillis(Date.now() - 60_000),
      validUntil: null,
      includedWorkshops: 10,
      additionalWorkshops: 0,
      consumedWorkshops: 1,
    },
  }),
  db.doc(`organizations/${organizationId}/members/${user.uid}`).set({
    email,
    role: 'owner',
    schemaVersion: 3,
    status: 'active',
  }),
  db.doc(`workshops/${workshopId}`).set({
    organizationId,
    facilitatorUid: user.uid,
    roomCode: 'E2E123',
    status: 'completed',
    currentPhase: 'Fermentar',
    unlockedPhases: ['Seleccion', 'Calcinar', 'Diluir', 'Conjugar', 'Sublimar', 'Fermentar'],
    sublimarDefenseUnlocked: true,
    sublimarDefenseUnlockedAt: Timestamp.fromMillis(Date.UTC(2026, 5, 15, 11, 20, 0)),
    schemaVersion: 3,
    challenge: 'Reducir el tiempo de respuesta con datos verificables.',
    client: 'Cliente E2E',
    facilitator: 'Facilitador E2E',
    createdAt,
    completedAt,
    updatedAt: completedAt,
  }),
]);

const workshopRef = db.doc(`workshops/${workshopId}`);
await Promise.all([
  workshopRef.collection('teams').doc('Agua').set({
    team: 'Agua',
    currentPhase: 'Fermentar',
    perspectives: ['Medir tiempos actuales', 'Eliminar una espera evitable'],
    top3Perspectives: ['Medir tiempos actuales'],
    perspectiveVotes: [{ option: 'Medir tiempos actuales', votes: 3 }],
    selectedPerspective: 'Medir tiempos actuales',
    solutions: ['Panel de seguimiento operativo'],
    top3Solutions: ['Panel de seguimiento operativo'],
    solutionVotes: [{ option: 'Panel de seguimiento operativo', votes: 4 }],
    selectedSolution: 'Panel de seguimiento operativo',
    defenses: ['Piloto acotado con revision semanal'],
    reformulatedSolution: 'Panel con piloto acotado y revision semanal',
    expectedResults: 'Reducir el tiempo medio medido',
    audience: 'Equipo operativo',
    pilot: 'Piloto de dos semanas',
    pitchProblem: 'El tiempo actual no esta medido',
    pitchSolution: 'Panel de seguimiento operativo',
    pitchAction: 'Iniciar el piloto',
    isFinished: true,
  }),
  workshopRef.collection('teams').doc('Aire').set({
    team: 'Aire',
    currentPhase: 'Fermentar',
    perspectives: ['Contrastar la adopcion'],
    solutions: ['Prueba guiada'],
    isFinished: true,
  }),
  workshopRef.collection('attacks').doc('attack-e2e-1').set({
    fromTeam: 'Aire',
    toTeam: 'Agua',
    content: 'Como se comprobara la adopcion real?',
    timestamp: Timestamp.fromMillis(Date.UTC(2026, 5, 15, 11, 0, 0)),
  }),
  workshopRef.collection('solutions').doc('solution-e2e-1').set({
    team: 'Agua',
    content: 'Panel de seguimiento operativo',
    timestamp: Timestamp.fromMillis(Date.UTC(2026, 5, 15, 10, 30, 0)),
  }),
]);

console.log(JSON.stringify({ workshopId, organizationId }));
