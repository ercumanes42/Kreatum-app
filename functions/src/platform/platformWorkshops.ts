import { FieldPath, FieldValue, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import {
  REPORT_STATUSES,
  WORKSHOP_STATUSES,
  type AssignWorkshopFacilitatorInput,
  type AssignWorkshopFacilitatorOutput,
  type GetPlatformWorkshopDataInput,
  type GetPlatformWorkshopDataOutput,
  type ListPlatformWorkshopsInput,
  type ListPlatformWorkshopsOutput,
  type PlatformReportFormat,
  type PlatformReportSummary,
  type ReportArtifact,
  type ReportStatus,
  type WorkshopStatus,
} from '../../../shared/contracts.js';
import {
  LIST_SCAN_LIMIT,
  authorizePlatformAdmin,
  buildPlatformDataset,
  callable,
  commandDocumentId,
  firestore,
  hashIdentifier,
  idempotencyKey,
  identifier,
  loadPlatformWorkshop,
  pageLimit,
  platformCursor,
  platformWorkshopSummary,
  requireReason,
  writePlatformAudit,
  type UnknownRecord,
} from './platformCore.js';
import { normalizePlatformSearch, timestampMillis } from './platformSecurity.js';

const reportArtifact = (value: unknown): ReportArtifact | null => {
  if (!value || typeof value !== 'object') return null;
  const item = value as UnknownRecord;
  if (typeof item.storagePath !== 'string'
    || typeof item.sha256 !== 'string'
    || typeof item.size !== 'number'
    || typeof item.mimeType !== 'string') return null;
  return {
    storagePath: item.storagePath,
    sha256: item.sha256,
    size: item.size,
    mimeType: item.mimeType,
    generatedAt: typeof item.generatedAt === 'number' ? item.generatedAt : 0,
    templateVersion: typeof item.templateVersion === 'string' ? item.templateVersion : '',
  };
};

const platformReportSummary = (item: QueryDocumentSnapshot): PlatformReportSummary => {
  const data = item.data();
  const storedArtifacts = data.artifacts && typeof data.artifacts === 'object'
    ? data.artifacts as UnknownRecord
    : {};
  const artifacts: Partial<Record<PlatformReportFormat, ReportArtifact>> = {};
  for (const format of ['json', 'pdf', 'pptx'] as const) {
    const artifact = reportArtifact(storedArtifacts[format]);
    if (artifact) artifacts[format] = artifact;
  }
  return {
    id: item.id,
    status: REPORT_STATUSES.includes(data.status as ReportStatus)
      ? data.status as ReportStatus
      : 'failed',
    generatedAt: timestampMillis(data.generatedAt),
    publishedAt: timestampMillis(data.publishedAt),
    artifacts,
  };
};

export const assignWorkshopFacilitator = callable<
  AssignWorkshopFacilitatorInput,
  AssignWorkshopFacilitatorOutput
>('assignWorkshopFacilitator', async (request) => {
  const auth = await authorizePlatformAdmin(
    request as CallableRequest<unknown>,
    'assignWorkshopFacilitator',
    true,
  );
  const organizationId = identifier(request.data?.organizationId, 'organizationId');
  const workshopId = identifier(request.data?.workshopId, 'workshopId');
  const facilitatorUid = identifier(request.data?.facilitatorUid, 'facilitatorUid');
  const auditReason = requireReason(request.data?.reason);
  const key = idempotencyKey(request.data?.idempotencyKey);
  const commandRef = firestore().doc(
    'platformCommandKeys/' + commandDocumentId(auth.uid, 'assignWorkshopFacilitator', key),
  );
  const updatedAt = Date.now();
  return firestore().runTransaction(async (transaction) => {
    const workshopRef = firestore().doc('workshops/' + workshopId);
    const memberRef = firestore().doc(
      'organizations/' + organizationId + '/members/' + facilitatorUid,
    );
    const organizationRef = firestore().doc('organizations/' + organizationId);
    const [commandSnapshot, workshopSnapshot, memberSnapshot, organizationSnapshot] =
      await Promise.all([
        transaction.get(commandRef),
        transaction.get(workshopRef),
        transaction.get(memberRef),
        transaction.get(organizationRef),
      ]);
    if (commandSnapshot.exists) {
      return commandSnapshot.data()?.result as AssignWorkshopFacilitatorOutput;
    }
    if (!workshopSnapshot.exists || !organizationSnapshot.exists) {
      throw new HttpsError('not-found', 'La partida no esta disponible.');
    }
    const workshop = workshopSnapshot.data() ?? {};
    if (workshop.organizationId !== organizationId) {
      throw new HttpsError('not-found', 'La partida no esta disponible.');
    }
    const member = memberSnapshot.data() ?? {};
    if (!memberSnapshot.exists || member.status !== 'active' || member.role !== 'facilitator') {
      throw new HttpsError(
        'failed-precondition',
        'El facilitador no esta activo en esta empresa.',
      );
    }
    const displayName = [
      typeof member.firstName === 'string' ? member.firstName.trim() : '',
      typeof member.lastName === 'string' ? member.lastName.trim() : '',
    ].filter(Boolean).join(' ') || 'Facilitador asignado';
    const previousFacilitatorUid = typeof workshop.facilitatorUid === 'string'
      ? workshop.facilitatorUid
      : '';
    const output: AssignWorkshopFacilitatorOutput = {
      organizationId,
      workshopId,
      facilitatorUid,
      updatedAt,
    };
    transaction.update(workshopRef, {
      facilitatorUid,
      facilitator: displayName,
      facilitatorAssignment: {
        facilitatorUid,
        assignedBy: auth.uid,
        assignedAt: FieldValue.serverTimestamp(),
        reason: auditReason,
      },
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(commandRef, {
      operation: 'assignWorkshopFacilitator',
      result: output,
      createdAt: FieldValue.serverTimestamp(),
    });
    writePlatformAudit(
      transaction,
      organizationId,
      auth.uid,
      previousFacilitatorUid === facilitatorUid
        ? 'workshop.facilitator_assignment_confirmed'
        : 'workshop.facilitator_reassigned',
      'workshop',
      workshopId,
      workshopId,
      auditReason,
      {
        previousFacilitatorHash: previousFacilitatorUid
          ? hashIdentifier(previousFacilitatorUid)
          : '',
        facilitatorHash: hashIdentifier(facilitatorUid),
      },
    );
    transaction.create(workshopRef.collection('auditEvents').doc(), {
      action: 'workshop.facilitator_reassigned_by_platform',
      actorId: auth.uid,
      actorHash: hashIdentifier(auth.uid),
      metadata: {
        previousFacilitatorHash: previousFacilitatorUid
          ? hashIdentifier(previousFacilitatorUid)
          : '',
        facilitatorHash: hashIdentifier(facilitatorUid),
        reason: auditReason,
      },
      createdAt: FieldValue.serverTimestamp(),
      schemaVersion: 2,
    });
    return output;
  });
});

export const listPlatformWorkshops = callable<
  ListPlatformWorkshopsInput,
  ListPlatformWorkshopsOutput
>('listPlatformWorkshops', async (request) => {
  const auth = await authorizePlatformAdmin(
    request as CallableRequest<unknown>,
    'listPlatformWorkshops',
  );
  const organizationId = request.data?.organizationId
    ? identifier(request.data.organizationId, 'organizationId')
    : '';
  const facilitatorUid = request.data?.facilitatorUid
    ? identifier(request.data.facilitatorUid, 'facilitatorUid')
    : '';
  const requestedStatus = request.data?.status ?? 'all';
  if (requestedStatus !== 'all' && !WORKSHOP_STATUSES.includes(requestedStatus as WorkshopStatus)) {
    throw new HttpsError('invalid-argument', 'El estado de partida no es valido.');
  }
  const requestedLimit = pageLimit(request.data?.limit);
  const requestedCursor = platformCursor(request.data?.cursor);
  const search = normalizePlatformSearch(request.data?.search);
  const scanLimit = Math.min(LIST_SCAN_LIMIT, Math.max(50, requestedLimit * 5));
  let query = firestore().collection('workshops')
    .orderBy(FieldPath.documentId())
    .limit(scanLimit);
  if (requestedCursor) query = query.startAfter(requestedCursor.documentId);
  const snapshot = await query.get();
  const organizationIds = [...new Set(snapshot.docs.flatMap((document) => {
    const value = document.data().organizationId;
    return typeof value === 'string' && /^[A-Za-z0-9_-]{3,128}$/.test(value)
      ? [value]
      : [];
  }))];
  const organizationSnapshots = organizationIds.length > 0
    ? await firestore().getAll(
      ...organizationIds.map((id) => firestore().doc('organizations/' + id)),
    )
    : [];
  const organizationNames = new Map(organizationSnapshots.flatMap((item) =>
    item.exists
      ? [[
        item.id,
        typeof item.data()?.name === 'string'
          ? String(item.data()?.name).slice(0, 120)
          : item.id,
      ] as const]
      : [],
  ));
  const workshops = snapshot.docs
    .flatMap((document) => {
      const data = document.data();
      const workshopOrganizationId = typeof data.organizationId === 'string'
        ? data.organizationId
        : '';
      if (!workshopOrganizationId || !organizationNames.has(workshopOrganizationId)) return [];
      const item = platformWorkshopSummary(
        document.id,
        data,
        organizationNames.get(workshopOrganizationId) ?? workshopOrganizationId,
      );
      const haystack = [
        item.id,
        item.organizationName,
        item.client,
        item.facilitator,
      ].join(' ').toLowerCase();
      return (organizationId && item.organizationId !== organizationId)
        || (facilitatorUid && item.facilitatorUid !== facilitatorUid)
        || (requestedStatus !== 'all' && item.status !== requestedStatus)
        || (search && !haystack.includes(search))
        ? []
        : [item];
    })
    .slice(0, requestedLimit);
  const lastScanned = snapshot.docs.at(-1);
  const hasMore = snapshot.size === scanLimit;
  if (workshops.length > 0) {
    await firestore().runTransaction(async (transaction) => {
      for (const workshop of workshops) {
        writePlatformAudit(
          transaction,
          workshop.organizationId,
          auth.uid,
          'workshop.global_listed',
          'workshop',
          workshop.id,
          workshop.id,
          null,
        );
      }
    });
  }
  return {
    workshops,
    hasMore,
    nextCursor: hasMore && lastScanned ? { documentId: lastScanned.id } : null,
  };
});

export const getPlatformWorkshopData = callable<
  GetPlatformWorkshopDataInput,
  GetPlatformWorkshopDataOutput
>('getPlatformWorkshopData', async (request) => {
  const auth = await authorizePlatformAdmin(
    request as CallableRequest<unknown>,
    'getPlatformWorkshopData',
  );
  const organizationId = identifier(request.data?.organizationId, 'organizationId');
  const workshopId = identifier(request.data?.workshopId, 'workshopId');
  const accessReason = request.data?.reason ? requireReason(request.data.reason) : null;
  const { workshopRef, workshop, organization } =
    await loadPlatformWorkshop(organizationId, workshopId);
  const [dataset, reportsSnapshot] = await Promise.all([
    buildPlatformDataset(workshopRef),
    workshopRef.collection('reports').limit(50).get(),
  ]);
  const reports = reportsSnapshot.docs
    .map(platformReportSummary)
    .sort((left, right) => (right.generatedAt ?? 0) - (left.generatedAt ?? 0));
  await firestore().runTransaction(async (transaction) => {
    writePlatformAudit(
      transaction,
      organizationId,
      auth.uid,
      'workshop.global_data_viewed',
      'workshop',
      workshopId,
      workshopId,
      accessReason,
      { reportCount: reports.length },
    );
  });
  return {
    workshop: platformWorkshopSummary(
      workshopId,
      workshop,
      typeof organization.name === 'string'
        ? organization.name.slice(0, 120)
        : organizationId,
    ),
    dataset,
    reports,
  };
});
