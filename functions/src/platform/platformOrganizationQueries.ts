import { FieldPath } from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import {
  INVITATION_STATUSES,
  type AuditTargetType,
  type GetPlatformOrganizationInput,
  type GetPlatformOrganizationOutput,
  type InvitationStatus,
  type ListPlatformOrganizationsInput,
  type ListPlatformOrganizationsOutput,
  type MemberStatus,
  type PlatformActivitySummary,
  type PlatformFacilitatorSummary,
  type PlatformInvitationSummary,
} from '../../../shared/contracts.js';
import {
  LIST_SCAN_LIMIT,
  authorizePlatformAdmin,
  callable,
  firestore,
  hashIdentifier,
  identifier,
  pageLimit,
  platformCursor,
  platformOrganizationSummary,
  writePlatformAudit,
} from './platformCore.js';
import {
  maskPlatformEmail,
  normalizePlatformSearch,
  resolvePlatformOrganizationStatus,
  timestampMillis,
} from './platformSecurity.js';

const invitationSummary = (
  id: string,
  data: Record<string, unknown> | undefined,
): PlatformInvitationSummary | null => {
  if (!data) return null;
  return {
    id,
    maskedEmail: maskPlatformEmail(String(data.email ?? '')),
    role: 'facilitator',
    status: INVITATION_STATUSES.includes(data.status as InvitationStatus)
      ? data.status as InvitationStatus
      : 'expired',
    createdAt: timestampMillis(data.createdAt),
    expiresAt: timestampMillis(data.expiresAt),
  };
};

export const loadPlatformOrganizationSummary = async (organizationId: string) => {
  const organizationSnapshot = await firestore().doc('organizations/' + organizationId).get();
  if (!organizationSnapshot.exists) {
    throw new HttpsError('not-found', 'La empresa no esta disponible.');
  }
  const data = organizationSnapshot.data() ?? {};
  const invitationId = typeof data.initialFacilitatorInvitationId === 'string'
    ? data.initialFacilitatorInvitationId
    : null;
  const invitationSnapshot = invitationId
    ? await firestore().doc('organizations/' + organizationId + '/invitations/' + invitationId).get()
    : null;
  return platformOrganizationSummary(
    organizationId,
    data,
    invitationId && invitationSnapshot?.exists
      ? invitationSummary(invitationId, invitationSnapshot.data())
      : null,
  );
};

export const listPlatformOrganizations = callable<
  ListPlatformOrganizationsInput,
  ListPlatformOrganizationsOutput
>('listPlatformOrganizations', async (request) => {
  await authorizePlatformAdmin(request as CallableRequest<unknown>, 'listPlatformOrganizations');
  const requestedLimit = pageLimit(request.data?.limit);
  const requestedCursor = platformCursor(request.data?.cursor);
  const search = normalizePlatformSearch(request.data?.search);
  const requestedStatus = request.data?.status ?? 'all';
  if (requestedStatus !== 'all'
    && !['pending', 'active', 'suspended', 'expired'].includes(String(requestedStatus))) {
    throw new HttpsError('invalid-argument', 'El estado no es valido.');
  }
  const scanLimit = Math.min(LIST_SCAN_LIMIT, Math.max(50, requestedLimit * 5));
  let query = firestore().collection('organizations')
    .orderBy(FieldPath.documentId())
    .limit(scanLimit);
  if (requestedCursor) query = query.startAfter(requestedCursor.documentId);
  const snapshot = await query.get();
  const raw = snapshot.docs
    .map((document) => ({ document, data: document.data() }))
    .filter(({ document, data }) => {
      const status = resolvePlatformOrganizationStatus(data);
      const haystack = (document.id + ' ' + String(data.name ?? '')).toLowerCase();
      return (requestedStatus === 'all' || requestedStatus === status)
        && (!search || haystack.includes(search));
    })
    .slice(0, requestedLimit);
  const invitationRefs = raw.flatMap(({ document, data }) => {
    const invitationId = typeof data.initialFacilitatorInvitationId === 'string'
      ? data.initialFacilitatorInvitationId
      : null;
    return invitationId
      ? [firestore().doc('organizations/' + document.id + '/invitations/' + invitationId)]
      : [];
  });
  const invitationSnapshots = invitationRefs.length > 0
    ? await firestore().getAll(...invitationRefs)
    : [];
  const invitations = new Map(invitationSnapshots.map((item) => [
    item.ref.parent.parent?.id ?? '',
    item.exists ? invitationSummary(item.id, item.data()) : null,
  ]));
  const organizations = raw.map(({ document, data }) =>
    platformOrganizationSummary(document.id, data, invitations.get(document.id) ?? null),
  );
  const lastScanned = snapshot.docs.at(-1);
  const hasMore = snapshot.size === scanLimit;
  return {
    organizations,
    hasMore,
    nextCursor: hasMore && lastScanned ? { documentId: lastScanned.id } : null,
  };
});

export const getPlatformOrganization = callable<
  GetPlatformOrganizationInput,
  GetPlatformOrganizationOutput
>('getPlatformOrganization', async (request) => {
  const auth = await authorizePlatformAdmin(
    request as CallableRequest<unknown>,
    'getPlatformOrganization',
  );
  const organizationId = identifier(request.data?.organizationId, 'organizationId');
  const activityLimit = pageLimit(request.data?.activityLimit, 30);
  const organization = await loadPlatformOrganizationSummary(organizationId);
  const [membersSnapshot, workshopsSnapshot, activitySnapshot] = await Promise.all([
    firestore().collection('organizations/' + organizationId + '/members')
      .where('role', '==', 'facilitator')
      .limit(101)
      .get(),
    firestore().collection('workshops')
      .where('organizationId', '==', organizationId)
      .select('facilitatorUid')
      .limit(1000)
      .get(),
    firestore().collection('organizations/' + organizationId + '/auditEvents')
      .orderBy('createdAt', 'desc')
      .limit(activityLimit)
      .get(),
  ]);
  if (workshopsSnapshot.size === 1000) {
    throw new HttpsError(
      'resource-exhausted',
      'Hay 1000 o mas partidas; el recuento requiere una consulta paginada.',
    );
  }
  if (membersSnapshot.size > 100) {
    throw new HttpsError(
      'resource-exhausted',
      'Hay mas de 100 facilitadores. Usa una consulta operativa paginada.',
    );
  }
  const assignedCounts = new Map<string, number>();
  for (const workshop of workshopsSnapshot.docs) {
    const data = workshop.data();
    const uid = typeof data.facilitatorUid === 'string' ? data.facilitatorUid : '';
    if (uid) assignedCounts.set(uid, (assignedCounts.get(uid) ?? 0) + 1);
  }
  const facilitators: PlatformFacilitatorSummary[] = membersSnapshot.docs.map((member) => {
    const data = member.data();
    const firstName = typeof data.firstName === 'string' ? data.firstName.trim() : '';
    const lastName = typeof data.lastName === 'string' ? data.lastName.trim() : '';
    return {
      uid: member.id,
      maskedEmail: maskPlatformEmail(String(data.email ?? '')),
      displayName: (firstName + ' ' + lastName).trim() || 'Facilitador',
      status: (data.status === 'disabled' ? 'disabled' : 'active') as MemberStatus,
      assignedWorkshops: assignedCounts.get(member.id) ?? 0,
    };
  });
  const recentActivity: PlatformActivitySummary[] = activitySnapshot.docs.map((event) => {
    const data = event.data();
    const targetType = ['workshop', 'member', 'invitation', 'report', 'organization']
      .includes(String(data.targetType))
      ? data.targetType as AuditTargetType
      : 'organization';
    return {
      id: event.id,
      action: typeof data.action === 'string' ? data.action.slice(0, 120) : 'unknown',
      actorHash: typeof data.actorHash === 'string'
        ? data.actorHash.slice(0, 64)
        : hashIdentifier(String(data.actorId ?? 'unknown')),
      targetType,
      targetId: typeof data.targetId === 'string' ? data.targetId.slice(0, 128) : '',
      workshopId: typeof data.workshopId === 'string'
        ? data.workshopId.slice(0, 128)
        : null,
      reason: typeof data.reason === 'string' ? data.reason.slice(0, 500) : null,
      createdAt: timestampMillis(data.createdAt),
    };
  });
  await firestore().runTransaction(async (transaction) => {
    writePlatformAudit(
      transaction,
      organizationId,
      auth.uid,
      'organization.global_viewed',
      'organization',
      organizationId,
      null,
      null,
    );
  });
  return { organization, facilitators, recentActivity };
});
