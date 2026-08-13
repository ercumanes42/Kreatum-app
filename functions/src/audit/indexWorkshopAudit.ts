import { createHash } from 'node:crypto';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { RUNTIME_SERVICE_ACCOUNT } from '../runtimeOptions.js';

const REGION = process.env.KREATUM_FUNCTIONS_REGION?.trim() || 'europe-west1';
const INDEXED_ACTIONS = new Set([
  'workshop.created',
  'workshop.resumed',
  'workshop.phaseChanged',
  'workshop.selectionReset',
  'workshop.completed',
  'workshop.archived',
  'workshop.deleted',
  'workshop.restored',
  'report.generated',
  'report.published',
]);

const cleanText = (value: unknown, maxLength = 500) => typeof value === 'string'
  ? value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength)
  : '';

const hashIdentifier = (value: string) =>
  createHash('sha256').update(value).digest('hex').slice(0, 16);

const stateForAction = (
  action: string,
  metadata: Record<string, unknown>,
) => {
  if (action === 'workshop.created') return { previousState: null, newState: { status: 'active' } };
  if (action === 'workshop.resumed') return { previousState: { status: 'active' }, newState: { status: 'active' } };
  if (action === 'workshop.phaseChanged') return {
    previousState: { phase: cleanText(metadata.from, 80) },
    newState: { phase: cleanText(metadata.to, 80) },
  };
  if (action === 'workshop.selectionReset') return {
    previousState: { status: 'active' },
    newState: { status: 'active' },
  };
  if (action === 'workshop.completed') return {
    previousState: { status: 'active' },
    newState: { status: 'completed' },
  };
  if (action === 'workshop.archived') return {
    previousState: { status: cleanText(metadata.previousStatus, 40) || null },
    newState: { status: 'archived' },
  };
  if (action === 'workshop.deleted') return {
    previousState: { status: cleanText(metadata.previousStatus, 40) || null },
    newState: { status: 'pendingDeletion' },
  };
  if (action === 'workshop.restored') return {
    previousState: { status: 'pendingDeletion' },
    newState: { status: cleanText(metadata.restoredStatus, 40) || 'archived' },
  };
  if (action === 'report.generated') return {
    previousState: null,
    newState: { reportStatus: 'draft' },
  };
  if (action === 'report.published') return {
    previousState: { reportStatus: 'draft' },
    newState: { reportStatus: 'published' },
  };
  return { previousState: null, newState: null };
};

export const indexWorkshopAuditEvent = onDocumentCreated({
  region: REGION,
  serviceAccount: RUNTIME_SERVICE_ACCOUNT,
  document: 'workshops/{workshopId}/auditEvents/{eventId}',
  maxInstances: 20,
  memory: '256MiB',
}, async (event) => {
  const audit = event.data?.data() ?? {};
  const action = cleanText(audit.action, 120);
  if (!INDEXED_ACTIONS.has(action)) return;
  const workshopId = event.params.workshopId;
  const actorId = cleanText(audit.actorId, 128);
  if (!actorId) {
    logger.error('Workshop audit event lacks actor id.', {
      workshopIdHash: hashIdentifier(workshopId),
      eventIdHash: hashIdentifier(event.params.eventId),
    });
    return;
  }
  const db = getFirestore();
  const workshopSnapshot = await db.doc(`workshops/${workshopId}`).get();
  const organizationId = cleanText(workshopSnapshot.data()?.organizationId, 128);
  if (!organizationId) {
    logger.error('Workshop audit event lacks organization.', {
      workshopIdHash: hashIdentifier(workshopId),
      eventIdHash: hashIdentifier(event.params.eventId),
    });
    return;
  }
  const memberSnapshot = await db.doc(`organizations/${organizationId}/members/${actorId}`).get();
  const member = memberSnapshot.data() ?? {};
  const metadata = audit.metadata && typeof audit.metadata === 'object'
    ? audit.metadata as Record<string, unknown>
    : {};
  const targetType = action.startsWith('report.') ? 'report' : 'workshop';
  const targetId = targetType === 'report' && typeof metadata.reportId === 'string'
    ? metadata.reportId
    : workshopId;
  const { previousState, newState } = stateForAction(action, metadata);
  const indexedRef = db.doc(
    `organizations/${organizationId}/auditEvents/workshop_${workshopId}_${event.params.eventId}`,
  );
  try {
    await indexedRef.create({
      action,
      actorId,
      actorEmail: cleanText(member.email, 254),
      actorName: `${cleanText(member.firstName, 80)} ${cleanText(member.lastName, 80)}`.trim(),
      targetType,
      targetId,
      previousState,
      newState,
      reason: cleanText(metadata.reason) || null,
      createdAt: audit.createdAt instanceof Timestamp ? audit.createdAt : Timestamp.now(),
      source: { workshopId, eventId: event.params.eventId },
      schemaVersion: 3,
    });
  } catch (error) {
    if ((error as { code?: number }).code !== 6) throw error;
  }
});
