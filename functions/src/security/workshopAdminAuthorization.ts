import type {
  DocumentData,
  DocumentSnapshot,
  Firestore,
  Transaction,
} from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { assertOrganizationOperational } from './organizationAccess.js';

export type WorkshopAdminRole = 'owner' | 'facilitator';

interface WorkshopAuthorizationRecord extends DocumentData {
  organizationId?: unknown;
  facilitatorUid?: unknown;
}

const isDocumentIdentifier = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{3,128}$/.test(value);

const unavailable = () =>
  new HttpsError('not-found', 'La partida no est\u00e1 disponible.');

export const revalidateWorkshopAdminInTransaction = async (
  transaction: Transaction,
  firestore: Firestore,
  uid: string,
  workshopSnapshot: DocumentSnapshot<DocumentData>,
  allowedRoles: readonly WorkshopAdminRole[],
) => {
  if (!workshopSnapshot.exists) throw unavailable();
  const workshop = workshopSnapshot.data() as WorkshopAuthorizationRecord;
  if (!isDocumentIdentifier(workshop.organizationId)) throw unavailable();

  const organizationId = workshop.organizationId;
  const organizationRef = firestore.doc(`organizations/${organizationId}`);
  const membershipRef = organizationRef.collection('members').doc(uid);
  const [organizationSnapshot, membershipSnapshot] = await Promise.all([
    transaction.get(organizationRef),
    transaction.get(membershipRef),
  ]);
  const membership = membershipSnapshot.data();
  const role = membership?.role;
  if (!membershipSnapshot.exists
    || membership?.status !== 'active'
    || (role !== 'owner' && role !== 'facilitator')
    || !allowedRoles.includes(role)) {
    throw unavailable();
  }

  assertOrganizationOperational(organizationSnapshot);
  if (role === 'facilitator' && workshop.facilitatorUid !== uid) {
    throw unavailable();
  }
  return { workshop, organizationId, role };
};
