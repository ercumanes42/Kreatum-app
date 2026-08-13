import { getFirestore, Timestamp, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import type {
  ExportOrganizationWorkshopHistoryInput,
  ExportOrganizationWorkshopHistoryOutput,
  OrganizationRole,
  WorkshopHistoryLifecycleStatus,
} from '../../../shared/contracts.js';
import {
  HISTORY_EXPORT_MAX_ROWS,
  historyExportRowMatches,
  serializeHistoryExportCsv,
  type HistoryExportRow,
} from '../../../shared/historyExport.js';
import { assertOrganizationOperational } from '../security/organizationAccess.js';

const REGION = process.env.KREATUM_FUNCTIONS_REGION?.trim() || 'europe-west1';
const ENFORCE_APP_CHECK = process.env.KREATUM_ENFORCE_APP_CHECK === 'true';
const EXPORT_ROLES: OrganizationRole[] = ['owner', 'facilitator'];
const EXPORT_BATCH_SIZE = 500;
const EXPORT_SCAN_MAX_ROWS = 20_000;
const ALLOWED_STATUSES = new Set(['all', 'active', 'completed', 'archived', 'pendingDeletion']);

const validateIdentifier = (value: unknown, field: string) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{3,128}$/.test(value)) {
    throw new HttpsError('invalid-argument', `${field} no es válido.`);
  }
  return value;
};

const cleanText = (value: unknown, maxLength: number) => {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, maxLength);
};

const timestampMillis = (value: unknown): number | null => {
  if (value instanceof Timestamp) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
};

const normalizeStatus = (value: unknown): WorkshopHistoryLifecycleStatus =>
  value === 'active' || value === 'completed' || value === 'archived' || value === 'pendingDeletion'
    ? value
    : 'completed';

const toExportRow = (snapshot: QueryDocumentSnapshot): HistoryExportRow => {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    roomCode: cleanText(data.roomCode, 32) || '---',
    status: normalizeStatus(data.status),
    createdAt: timestampMillis(data.createdAt),
    completedAt: timestampMillis(data.completedAt),
    client: cleanText(data.client, 160),
    facilitator: cleanText(data.facilitator, 160),
    currentPhase: cleanText(data.currentPhase, 64),
  };
};

const requireExportMembership = async (uid: string, organizationId: string) => {
  const database = getFirestore();
  const organizationRef = database.doc(`organizations/${organizationId}`);
  const membershipRef = organizationRef.collection('members').doc(uid);
  const [organization, membership] = await database.getAll(organizationRef, membershipRef);
  const data = membership.data();
  if (
    !membership.exists
    || data?.status !== 'active'
    || !EXPORT_ROLES.includes(data?.role as OrganizationRole)
  ) {
    throw new HttpsError('permission-denied', 'No tienes permisos para exportar este historial.');
  }
  assertOrganizationOperational(organization);
  return data?.role as OrganizationRole;
};

export const exportOrganizationWorkshopHistory = onCall<ExportOrganizationWorkshopHistoryInput>(
  {
    region: REGION,
    enforceAppCheck: ENFORCE_APP_CHECK,
    memory: '512MiB',
    timeoutSeconds: 120,
  },
  async (
    request: CallableRequest<ExportOrganizationWorkshopHistoryInput>,
  ): Promise<ExportOrganizationWorkshopHistoryOutput> => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Debes iniciar una sesión válida.');
    const organizationId = validateIdentifier(request.data?.organizationId, 'organizationId');
    const role = await requireExportMembership(request.auth.uid, organizationId);

    const search = cleanText(request.data?.filters?.search, 128);
    const requestedStatus = request.data?.filters?.status ?? 'all';
    if (typeof requestedStatus !== 'string' || !ALLOWED_STATUSES.has(requestedStatus)) {
      throw new HttpsError('invalid-argument', 'El filtro de estado no es válido.');
    }

    const rows: HistoryExportRow[] = [];
    let scannedRows = 0;
    let cursor: QueryDocumentSnapshot | null = null;
    do {
      let workshopsQuery: FirebaseFirestore.Query = getFirestore()
        .collection('workshops')
        .where('organizationId', '==', organizationId);
      if (role === 'facilitator') {
        workshopsQuery = workshopsQuery.where('facilitatorUid', '==', request.auth.uid);
      }
      workshopsQuery = workshopsQuery
        .orderBy('createdAt', 'desc')
        .limit(EXPORT_BATCH_SIZE);
      if (cursor) workshopsQuery = workshopsQuery.startAfter(cursor);
      const snapshot = await workshopsQuery.get();
      for (const workshop of snapshot.docs) {
        scannedRows += 1;
        if (scannedRows > EXPORT_SCAN_MAX_ROWS) {
          throw new HttpsError(
            'resource-exhausted',
            'El historial supera el limite seguro de lectura. Acota la busqueda o el estado.',
          );
        }
        const row = toExportRow(workshop);
        if (historyExportRowMatches(row, search, requestedStatus)) rows.push(row);
        if (rows.length > HISTORY_EXPORT_MAX_ROWS) {
          throw new HttpsError(
            'resource-exhausted',
            'La exportación supera 10.000 partidas. Acota la búsqueda o el estado.',
          );
        }
      }
      cursor = snapshot.docs.at(-1) ?? null;
      if (snapshot.size < EXPORT_BATCH_SIZE) break;
    } while (cursor);

    const date = new Date().toISOString().slice(0, 10);
    return {
      csv: serializeHistoryExportCsv(rows),
      fileName: `Kreatum_Historial_${date}.csv`,
      rowCount: rows.length,
    };
  },
);
