// Requires Firestore emulator; collected by the integration runner.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { deleteApp, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { revalidateWorkshopAdminInTransaction } from './workshopAdminAuthorization.js';

const projectId = process.env.GCLOUD_PROJECT || 'demo-kreatum';
const emulatorAvailable = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

const activeOrganization = () => ({
  status: 'active',
  schemaVersion: 3,
  commercial: {
    status: 'active',
    validFrom: Timestamp.fromMillis(Date.now() - 60_000),
    validUntil: null,
  },
});

test('rejects a commit when membership is revoked after stale preflight authorization', {
  skip: !emulatorAvailable,
  timeout: 30_000,
}, async () => {
  const suffix = randomUUID();
  const appName = `workshop-auth-revocation-${suffix}`;
  const app = initializeApp({ projectId }, appName);
  const firestore = getFirestore(app);
  const uid = `facilitator-${suffix}`;
  const organizationRef = firestore.doc(`organizations/org-${suffix}`);
  const membershipRef = organizationRef.collection('members').doc(uid);
  const workshopRef = firestore.doc(`workshops/workshop-${suffix}`);
  await Promise.all([
    organizationRef.set(activeOrganization()),
    membershipRef.set({ role: 'facilitator', status: 'active' }),
    workshopRef.set({
      organizationId: organizationRef.id,
      facilitatorUid: uid,
      status: 'active',
    }),
  ]);

  const staleWorkshopSnapshot = await workshopRef.get();
  assert.equal(staleWorkshopSnapshot.data()?.facilitatorUid, uid);
  await membershipRef.update({ status: 'disabled' });
  const mutation = firestore.runTransaction(async (transaction) => {
    const workshopSnapshot = await transaction.get(workshopRef);
    await revalidateWorkshopAdminInTransaction(
      transaction,
      firestore,
      uid,
      workshopSnapshot,
      ['owner', 'facilitator'],
    );
    transaction.update(workshopRef, { protectedMutation: FieldValue.serverTimestamp() });
  });

  await assert.rejects(mutation, (error: { code?: string }) => error.code === 'not-found');
  assert.equal((await workshopRef.get()).data()?.protectedMutation, undefined);
  await deleteApp(app);
  assert.equal(getApps().some((candidate) => candidate.name === appName), false);
});

test('rejects a commit when the workshop is reassigned after stale facilitator authorization', {
  skip: !emulatorAvailable,
  timeout: 30_000,
}, async () => {
  const suffix = randomUUID();
  const appName = `workshop-auth-reassignment-${suffix}`;
  const app = initializeApp({ projectId }, appName);
  const firestore = getFirestore(app);
  const uid = `facilitator-${suffix}`;
  const organizationRef = firestore.doc(`organizations/org-${suffix}`);
  const membershipRef = organizationRef.collection('members').doc(uid);
  const workshopRef = firestore.doc(`workshops/workshop-${suffix}`);
  await Promise.all([
    organizationRef.set(activeOrganization()),
    membershipRef.set({ role: 'facilitator', status: 'active' }),
    workshopRef.set({
      organizationId: organizationRef.id,
      facilitatorUid: uid,
      status: 'active',
    }),
  ]);

  const staleWorkshopSnapshot = await workshopRef.get();
  assert.equal(staleWorkshopSnapshot.data()?.facilitatorUid, uid);
  await workshopRef.update({ facilitatorUid: `other-${suffix}` });
  const mutation = firestore.runTransaction(async (transaction) => {
    const workshopSnapshot = await transaction.get(workshopRef);
    await revalidateWorkshopAdminInTransaction(
      transaction,
      firestore,
      uid,
      workshopSnapshot,
      ['owner', 'facilitator'],
    );
    transaction.update(workshopRef, { protectedMutation: FieldValue.serverTimestamp() });
  });

  await assert.rejects(mutation, (error: { code?: string }) => error.code === 'not-found');
  assert.equal((await workshopRef.get()).data()?.protectedMutation, undefined);
  await deleteApp(app);
  assert.equal(getApps().some((candidate) => candidate.name === appName), false);
});
