import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { revalidateOrganizationOwnerInTransaction } from './organizationOwnerAuthorization.js';

const projectId = process.env.GCLOUD_PROJECT || 'demo-kreatum';
const emulatorAvailable = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

test('rejects organization writes after a stale owner preflight is revoked', {
  skip: !emulatorAvailable,
  timeout: 30_000,
}, async (context) => {
  const suffix = randomUUID();
  const app = initializeApp({ projectId }, `organization-owner-${suffix}`);
  context.after(async () => deleteApp(app));
  const firestore = getFirestore(app);
  const uid = `owner-${suffix}`;
  const organizationId = `org-${suffix}`;
  const organizationRef = firestore.doc(`organizations/${organizationId}`);
  const membershipRef = organizationRef.collection('members').doc(uid);
  await organizationRef.set({
    status: 'active',
    schemaVersion: 3,
    commercial: {
      status: 'active',
      validFrom: Timestamp.fromMillis(Date.now() - 60_000),
      validUntil: null,
    },
  });
  await membershipRef.set({ role: 'owner', status: 'active' });

  assert.equal((await membershipRef.get()).data()?.status, 'active');
  await membershipRef.update({ status: 'disabled' });

  await assert.rejects(
    firestore.runTransaction(async (transaction) => {
      await revalidateOrganizationOwnerInTransaction(
        transaction,
        firestore,
        uid,
        organizationId,
      );
      transaction.update(organizationRef, { forbiddenWrite: true });
    }),
    (error: { code?: string }) => error.code === 'not-found',
  );
  assert.equal((await organizationRef.get()).data()?.forbiddenWrite, undefined);
});
