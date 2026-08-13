import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { assertOrganizationOperational } from './organizationAccess.js';

const unavailable = () =>
  new HttpsError('not-found', 'La empresa no est\u00e1 disponible.');

export const revalidateOrganizationOwnerInTransaction = async (
  transaction: Transaction,
  firestore: Firestore,
  uid: string,
  organizationId: string,
) => {
  const organizationRef = firestore.doc(`organizations/${organizationId}`);
  const membershipRef = organizationRef.collection('members').doc(uid);
  const [organizationSnapshot, membershipSnapshot] = await Promise.all([
    transaction.get(organizationRef),
    transaction.get(membershipRef),
  ]);
  const membership = membershipSnapshot.data();
  if (!organizationSnapshot.exists
    || !membershipSnapshot.exists
    || membership?.status !== 'active'
    || membership?.role !== 'owner') {
    throw unavailable();
  }
  assertOrganizationOperational(organizationSnapshot);
  return organizationRef;
};
