import { createHash, randomInt, randomUUID } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
import { getFunctions } from 'firebase-admin/functions';
import {
  FieldValue,
  Timestamp,
  getFirestore,
  type DocumentData,
  type DocumentReference,
  type Transaction,
} from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { setGlobalOptions } from 'firebase-functions/v2';
import {
  HttpsError,
  onCall,
  type CallableRequest,
} from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onDocumentCreated, onDocumentDeleted } from 'firebase-functions/v2/firestore';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import {
  DEFAULT_RETENTION_MONTHS,
  EXPORT_VERSION,
  MAX_ATTACKS_PER_TEAM,
  MAX_CONTENT_LENGTH,
  MAX_PARTICIPANT_DEVICES,
  MAX_SHORT_TEXT_LENGTH,
  PARTICIPANT_SESSION_TTL_MS,
  PHASES,
  REPORT_TEMPLATE_VERSION,
  SCHEMA_VERSION,
  isPhase,
  isPhaseChangeAllowed,
  isRoomCodeValid,
  isTeam,
  normalizeRoomCode,
  type AckWorkshopTransitionInput,
  type AckWorkshopTransitionOutput,
  type CancelWorkshopTransitionInput,
  type CancelWorkshopTransitionOutput,
  type CommitWorkshopTransitionInput,
  type CommitWorkshopTransitionOutput,
  type DeleteWorkshopAttackInput,
  type GetReportJobInput,
  type GetReportJobOutput,
  type HeartbeatParticipantSessionInput,
  type HeartbeatParticipantSessionOutput,
  type QueueReportGenerationInput,
  type QueueReportGenerationOutput,
  type ReleaseParticipantSessionInput,
  type RequestWorkshopTransitionInput,
  type RequestWorkshopTransitionOutput,
  type ReportJobStatus,
  type SaveWorkshopDefenseInput,
  type SaveWorkshopDefenseOutput,
  type SelectTeamOutput,
  type SubmitWorkshopAttackInput,
  type UpdateWorkshopAttackInput,
  type WorkshopAttackCommandOutput,
  type WorkshopTransitionKind,
  type WorkshopTransitionState,

  type AdvanceWorkshopPhaseInput,
  type ArchiveOrganizationWorkshopsInput,
  type ArchiveOrganizationWorkshopsOutput,
  type CompleteWorkshopInput,
  type CreateWorkshopInput,
  type CreateWorkshopOutput,
  type DeleteWorkshopInput,
  type GenerateReportSnapshotInput,
  type GenerateReportSnapshotOutput,
  type GenerateReportArtifactsInput,
  type GenerateReportArtifactsOutput,
  type JoinWorkshopInput,
  type JoinWorkshopOutput,
  type OrganizationRole,

  type PublishReportInput,
  type PublishReportOutput,
  type ReassignParticipantInput,
  type ResetWorkshopInput,
  type RestoreWorkshopInput,
  type ResumeWorkshopInput,
  type ResumeWorkshopOutput,
  type SelectTeamInput,
  type Team,
  type UpdateReportEditorialInput,
  type UpdateReportEditorialOutput,
  type UpdateWorkshopControlInput,
  type WorkshopCommandOutput,
} from '../../shared/contracts.js';
import {
  buildReportDataset,
  buildReportDeck,
  reportSourceFromSnapshotDocument,
} from '../../shared/reporting.js';
import {
  loadReportAssets,
  renderReportPdf,
  renderReportPptx,
} from './reporting/renderReportArtifacts.js';
import { assertOrganizationOperational } from './security/organizationAccess.js';
import { revalidateWorkshopAdminInTransaction } from './security/workshopAdminAuthorization.js';
import { revalidateOrganizationOwnerInTransaction } from './security/organizationOwnerAuthorization.js';
import { RUNTIME_SERVICE_ACCOUNT } from './runtimeOptions.js';
export {
  acceptInvitation,
  cancelInvitation,
  changeMemberRole,
  changeMemberStatus,
  getOrganizationAuditOverview,
  getInvitationActivation,
  inviteMember,
  listOrganizationAudit,
  listTeamAccess,
  resendInvitation,
  verifyInvitationCode,
} from './access/accessFunctions.js';
export { indexWorkshopAuditEvent } from './audit/indexWorkshopAudit.js';
export { reconnectParticipantSession } from './recovery/participantRecovery.js';
export { createReportDownload } from './reporting/createReportDownload.js';
export {
  listPlatformOrganizations,
  getPlatformOrganization,
  provisionOrganizationAndInviteFacilitator,
  updatePlatformOrganization,
  suspendPlatformOrganization,
  reactivatePlatformOrganization,
  resendPlatformFacilitatorInvitation,
  cancelPlatformFacilitatorInvitation,
  adjustWorkshopAllowance,
  assignWorkshopFacilitator,
  listPlatformWorkshops,
  getPlatformWorkshopData,
  generatePlatformReportSnapshot,
  queuePlatformReportGeneration,
  getPlatformReportJob,
  createPlatformReportDownload,
} from './platform/platformFunctions.js';
export { exportOrganizationWorkshopHistory } from './history/exportWorkshopHistory.js';
export {
  listMyOrganizations,
  provisionOrganization,
  updateOrganizationCommercial,
} from './organizations/organizationFunctions.js';

initializeApp();
const db = getFirestore();
const storage = getStorage();

const REGION = process.env.KREATUM_FUNCTIONS_REGION?.trim() || 'europe-west1';
const SCHEDULE_REGION = process.env.KREATUM_SCHEDULE_FUNCTIONS_REGION?.trim() || 'europe-west1';
const JOIN_ATTEMPT_LIMIT = 10;
const JOIN_WINDOW_MS = 60_000;
const JOIN_GLOBAL_UID_ATTEMPT_LIMIT = 10;
const JOIN_GLOBAL_IP_ATTEMPT_LIMIT = 120;
const PENDING_DELETION_GRACE_MS = 30 * 24 * 60 * 60 * 1000;
const WORKSHOP_TRANSITION_TTL_MS = 2 * 60 * 1000;
const PARTICIPANT_HEARTBEAT_TTL_MS = PARTICIPANT_SESSION_TTL_MS;
const REPORT_JOB_LEASE_MS = 12 * 60 * 1000;
const REPORT_JOB_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const ROOM_CODE_CHARACTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ADMIN_ROLES: OrganizationRole[] = ['owner', 'facilitator'];
const ENFORCE_APP_CHECK = process.env.KREATUM_ENFORCE_APP_CHECK === 'true';

const safeOperationalErrorCode = (error: unknown): string => {
  if (!error || typeof error !== 'object' || !('code' in error)) return 'unknown';
  const code = String((error as { code?: unknown }).code ?? '');
  return /^[a-zA-Z0-9_.:/-]{1,100}$/.test(code) ? code : 'unknown';
};

setGlobalOptions({
  region: REGION,
  serviceAccount: RUNTIME_SERVICE_ACCOUNT,
  maxInstances: 50,
  memory: '256MiB',
  timeoutSeconds: 60,
});

type AuthContext = NonNullable<CallableRequest<unknown>['auth']>;

interface MembershipRecord {
  role?: unknown;
  status?: unknown;
}

interface WorkshopRecord {
  organizationId?: unknown;
  facilitatorUid?: unknown;
  createdBy?: unknown;
  roomCode?: unknown;
  currentPhase?: unknown;
  unlockedPhases?: unknown;
  status?: unknown;
  pendingTransitionId?: unknown;
  transitionState?: unknown;
  transitionKind?: unknown;
  transitionTargetPhase?: unknown;
  transitionExpiresAt?: unknown;
  transition?: {
    id?: unknown;
    state?: unknown;
    kind?: unknown;
    targetPhase?: unknown;
    requiredTeams?: unknown;
    acknowledgedTeams?: unknown;
    requestedAt?: unknown;
    deadline?: unknown;
    requestedByHash?: unknown;
    override?: unknown;
  };
  schemaVersion?: unknown;
}

const hashIdentifier = (value: string) =>
  createHash('sha256').update(value).digest('hex').slice(0, 20);

const commandDocumentId = (uid: string, idempotencyKey: string) =>
  hashIdentifier(uid + ':' + idempotencyKey);

const requireAuth = (request: CallableRequest<unknown>): AuthContext => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Debes iniciar una sesión válida.');
  return request.auth;
};

const requireAdminAuth = (request: CallableRequest<unknown>): AuthContext => {
  const auth = requireAuth(request);
  const firebaseToken = auth.token.firebase as { sign_in_provider?: unknown } | undefined;
  if (firebaseToken?.sign_in_provider === 'anonymous') {
    throw new HttpsError(
      'permission-denied',
      'Las operaciones del Alquimista requieren una cuenta autenticada.',
    );
  }
  return auth;
};

const requireParticipantAuth = (request: CallableRequest<unknown>): AuthContext => {
  const auth = requireAuth(request);
  const firebaseToken = auth.token.firebase as { sign_in_provider?: unknown } | undefined;
  if (firebaseToken?.sign_in_provider !== 'anonymous') {
    throw new HttpsError(
      'permission-denied',
      'La entrada a una sala requiere una identidad participante an\u00f3nima.',
    );
  }
  return auth;
};

const validateIdentifier = (value: unknown, field: string) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{3,128}$/.test(value)) {
    throw new HttpsError('invalid-argument', field + ' no es válido.');
  }
  return value;
};

const validateIdempotencyKey = (value: unknown) => {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) {
    throw new HttpsError('invalid-argument', 'La clave de idempotencia no es válida.');
  }
  return value;
};

const validateText = (
  value: unknown,
  field: string,
  options: { required?: boolean; maxLength?: number } = {},
) => {
  const required = options.required ?? false;
  const maxLength = options.maxLength ?? MAX_SHORT_TEXT_LENGTH;
  if (typeof value !== 'string') {
    throw new HttpsError('invalid-argument', field + ' debe ser texto.');
  }
  if (required && value.trim().length === 0) {
    throw new HttpsError('invalid-argument', field + ' es obligatorio.');
  }
  if (value.length > maxLength) {
    throw new HttpsError('invalid-argument', field + ' supera el límite permitido.');
  }
  return value;
};

const validateCriticalReason = (value: unknown) => {
  const reason = validateText(value, 'reason', { required: true, maxLength: 500 })
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (reason.length < 4) {
    throw new HttpsError('invalid-argument', 'Indica un motivo de al menos 4 caracteres.');
  }
  return reason;
};

const assertMembership = async (
  uid: string,
  organizationId: string,
  allowedRoles: readonly OrganizationRole[],
) => {
  const organizationRef = db.doc('organizations/' + organizationId);
  const membershipRef = organizationRef.collection('members').doc(uid);
  const [organizationSnapshot, snapshot] = await db.getAll(organizationRef, membershipRef);
  const membership = snapshot.data() as MembershipRecord | undefined;
  const isAllowed = snapshot.exists
    && membership?.status === 'active'
    && typeof membership.role === 'string'
    && allowedRoles.includes(membership.role as OrganizationRole);
  if (!isAllowed) {
    throw new HttpsError('permission-denied', 'No tienes permisos para esta organización.');
  }
  assertOrganizationOperational(organizationSnapshot);
  return membership.role as OrganizationRole;
};


const loadWorkshopForAdmin = async (
  uid: string,
  workshopId: string,
  allowedRoles: readonly OrganizationRole[] = ADMIN_ROLES,
) => {
  const unavailable = () =>
    new HttpsError('not-found', 'La partida no est\u00e1 disponible.');
  const workshopRef = db.doc('workshops/' + workshopId);
  const snapshot = await workshopRef.get();
  if (!snapshot.exists) throw unavailable();
  const workshop = snapshot.data() as WorkshopRecord;
  const organizationId = validateIdentifier(workshop.organizationId, 'organizationId');
  let role: OrganizationRole;
  try {
    role = await assertMembership(uid, organizationId, allowedRoles);
  } catch (error) {
    if (error instanceof HttpsError && error.code === 'permission-denied') {
      throw unavailable();
    }
    throw error;
  }
  if (role === 'facilitator' && workshop.facilitatorUid !== uid) {
    throw unavailable();
  }
  return { workshopRef, workshop, organizationId, role };
};

const generateRoomCode = () => {
  let result = '';
  for (let index = 0; index < 6; index += 1) {
    result += ROOM_CODE_CHARACTERS[randomInt(0, ROOM_CODE_CHARACTERS.length)];
  }
  return result;
};

const createAuditEvent = (
  transaction: Transaction,
  workshopRef: DocumentReference<DocumentData>,
  actorId: string,
  action: string,
  metadata: Record<string, string | number | boolean | null> = {},
) => {
  const auditRef = workshopRef.collection('auditEvents').doc();
  transaction.create(auditRef, {
    action,
    actorId,
    actorHash: hashIdentifier(actorId),
    metadata,
    createdAt: FieldValue.serverTimestamp(),
    schemaVersion: SCHEMA_VERSION,
  });
};

const REPORT_PRIVATE_FIELDS = new Set([
  'actorHash',
  'activeDeviceExpiresAt',
  'activeParticipantHash',
  'activeParticipantId',
  'createdBy',
  'memberIds',
  'organizationId',
  'ownerId',
  'participantHash',
  'participantId',
  'participantIds',
  'playerId',
  'playerIds',
  'reassignments',
  'roomCode',
  'lastHeartbeatAt',
  'transitionAckAt',
  'transitionAckId',
  'uid',
]);

const REPORT_WORKSHOP_FIELDS = [
  'challenge',
  'client',
  'completedAt',
  'createdAt',
  'currentPhase',
  'facilitator',
  'schemaVersion',
  'status',
  'sublimarDefenseUnlocked',
  'sublimarDefenseUnlockedAt',
  'unlockedPhases',
] as const;

const normalizeReportValue = (value: unknown): unknown => {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeReportValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key, nestedValue]) => !REPORT_PRIVATE_FIELDS.has(key) && nestedValue !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, normalizeReportValue(nestedValue)]),
    );
  }
  return value;
};

const buildCanonicalReportSnapshot = async (
  workshopRef: DocumentReference<DocumentData>,
) => {
  const workshopSnapshot = await workshopRef.get();
  if (!workshopSnapshot.exists) throw new HttpsError('not-found', 'La partida no existe.');
  const workshopData = workshopSnapshot.data() ?? {};
  const workshop = Object.fromEntries(
    REPORT_WORKSHOP_FIELDS
      .filter((field) => workshopData[field] !== undefined)
      .map((field) => [field, normalizeReportValue(workshopData[field])]),
  );

  const collectionNames = ['teams', 'attacks', 'defenses', 'solutions'] as const;
  const collectionSnapshots = await Promise.all(
    collectionNames.map((name) => workshopRef.collection(name).get()),
  );
  const collections = Object.fromEntries(
    collectionSnapshots.map((snapshot, index) => {
      const collectionName = collectionNames[index];
      return [
        collectionName,
        snapshot.docs
          .slice()
          .sort((left, right) => left.id.localeCompare(right.id))
          .map((item) => {
            const data = item.data();
            if (collectionName === 'attacks' || collectionName === 'defenses') {
              return normalizeReportValue({ id: item.id, ...data });
            }
            if (collectionName === 'teams') {
              return normalizeReportValue({ ...data, team: data.team ?? item.id });
            }
            return normalizeReportValue(data);
          }),
      ];
    }),
  );

  const snapshot = normalizeReportValue({
    exportVersion: EXPORT_VERSION,
    reportTemplateVersion: REPORT_TEMPLATE_VERSION,
    schemaVersion: SCHEMA_VERSION,
    workshop: { id: workshopRef.id, ...workshop },
    ...collections,
  });
  const canonicalJson = JSON.stringify(snapshot);
  const sourceSnapshotHash = createHash('sha256').update(canonicalJson).digest('hex');
  return { snapshot, sourceSnapshotHash };
};
const safeRequestContext = (data: unknown) => {
  if (!data || typeof data !== 'object') return {};
  const record = data as Record<string, unknown>;
  const context: Record<string, string> = {};
  for (const field of ['organizationId', 'workshopId', 'reportId']) {
    if (typeof record[field] === 'string') {
      context[field + 'Hash'] = hashIdentifier(record[field]);
    }
  }
  return context;
};

const callable = <Input, Output>(
  name: string,
  handler: (
    request: CallableRequest<Input>,
    correlationId: string,
  ) => Promise<Output>,
  options: { memory?: '256MiB' | '1GiB'; timeoutSeconds?: number } = {},
) => onCall<Input>(
  { enforceAppCheck: ENFORCE_APP_CHECK, ...options },
  async (request): Promise<Output> => {
    const correlationId = randomUUID();
    const requestContext = safeRequestContext(request.data);
    if (!request.app) {
      logger.warn('Callable request without App Check token.', {
        operation: name,
        correlationId,
        ...requestContext,
      });
    }
    try {
      return await handler(request, correlationId);
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      logger.error('Unhandled callable error.', {
        operation: name,
        correlationId,
        ...requestContext,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      throw new HttpsError(
        'internal',
        'No se pudo completar la operación. Referencia: ' + correlationId,
      );
    }
  },
);
const createWorkshopWithCode = async (
  uid: string,
  input: CreateWorkshopInput,
  roomCode: string,
): Promise<CreateWorkshopOutput> => {
  const workshopRef = db.collection('workshops').doc();
  const roomCodeRef = db.doc('activeRoomCodes/' + roomCode);
  const organizationRef = db.doc('organizations/' + input.organizationId);
  const membershipRef = organizationRef.collection('members').doc(uid);
  const commandRef = db.doc(
    'organizations/' + input.organizationId + '/commandKeys/'
      + commandDocumentId(uid, input.idempotencyKey),
  );

  return db.runTransaction(async (transaction) => {
    const [commandSnapshot, roomCodeSnapshot, organizationSnapshot, membershipSnapshot] = await Promise.all([
      transaction.get(commandRef),
      transaction.get(roomCodeRef),
      transaction.get(organizationRef),
      transaction.get(membershipRef),
    ]);

    if (commandSnapshot.exists) {
      return commandSnapshot.data()?.result as CreateWorkshopOutput;
    }
    if (roomCodeSnapshot.exists) {
      throw new HttpsError('already-exists', 'El código de sala ya está en uso.');
    }
    if (!organizationSnapshot.exists) {
      throw new HttpsError('failed-precondition', 'La organizacion no esta configurada.');
    }
    const membership = membershipSnapshot.data();
    if (!membershipSnapshot.exists
      || membership?.status !== 'active'
      || !ADMIN_ROLES.includes(membership?.role as OrganizationRole)) {
      throw new HttpsError('permission-denied', 'La membresia ya no permite crear partidas.');
    }
    assertOrganizationOperational(organizationSnapshot);

    const organization = organizationSnapshot.data() ?? {};
    const configuredRetention = Number(organization.retentionMonths);
    const retentionMonths = Number.isInteger(configuredRetention)
      && configuredRetention >= 1
      && configuredRetention <= 120
      ? configuredRetention
      : DEFAULT_RETENTION_MONTHS;
    const commercial = organization.commercial as Record<string, unknown> | undefined;
    let creditsRemaining: number | null = null;
    if (commercial) {
      const status = commercial.status;
      const validFrom = commercial.validFrom instanceof Timestamp
        ? commercial.validFrom.toMillis()
        : Number(commercial.validFrom);
      const validUntil = commercial.validUntil instanceof Timestamp
        ? commercial.validUntil.toMillis()
        : commercial.validUntil === null ? null : Number(commercial.validUntil);
      const included = Number(commercial.includedWorkshops);
      const additional = Number(commercial.additionalWorkshops);
      const consumed = Number(commercial.consumedWorkshops);
      const now = Date.now();
      if (!['trial', 'active'].includes(String(status))
        || !Number.isFinite(validFrom)
        || validFrom > now
        || (validUntil !== null && (!Number.isFinite(validUntil) || validUntil <= now))) {
        throw new HttpsError('failed-precondition', 'La suscripción de la organización no está activa.');
      }
      if (![included, additional, consumed].every(Number.isInteger)
        || included < 0 || additional < 0 || consumed < 0) {
        throw new HttpsError('failed-precondition', 'Los créditos contratados no están configurados correctamente.');
      }
      creditsRemaining = included + additional - consumed;
      if (creditsRemaining <= 0) {
        throw new HttpsError('resource-exhausted', 'La organización no dispone de partidas contratadas.');
      }
      creditsRemaining -= 1;
      transaction.update(organizationRef, {
        'commercial.consumedWorkshops': consumed + 1,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    const result: CreateWorkshopOutput = {
      workshopId: workshopRef.id,
      roomCode,
      schemaVersion: SCHEMA_VERSION,
      creditsRemaining,
    };
    const retentionDeleteAt = Timestamp.fromMillis(
      Date.now() + retentionMonths * 30 * 24 * 60 * 60 * 1000,
    );

    transaction.create(workshopRef, {
      organizationId: input.organizationId,
      client: input.client,
      facilitator: input.facilitator,
      facilitatorUid: uid,
      assignment: {
        assignedBy: uid,
        assignedAt: FieldValue.serverTimestamp(),
      },
      challenge: input.challenge,
      roomCode,
      status: 'active',
      currentPhase: PHASES[0],
      unlockedPhases: [PHASES[0]],
      schemaVersion: SCHEMA_VERSION,
      createdBy: uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      retentionMonths,
      retentionDeleteAt,
      summary: {
        attacksCount: 0,
        teamsCount: 0,
        updatedAt: FieldValue.serverTimestamp(),
      },
    });
    transaction.create(roomCodeRef, {
      workshopId: workshopRef.id,
      organizationId: input.organizationId,
      createdAt: FieldValue.serverTimestamp(),
    });
    transaction.create(commandRef, {
      operation: 'createWorkshop',
      result,
      createdAt: FieldValue.serverTimestamp(),
    });
    createAuditEvent(transaction, workshopRef, uid, 'workshop.created');

    return result;
  });
};

export const createWorkshop = callable<CreateWorkshopInput, CreateWorkshopOutput>(
  'createWorkshop',
  async (request) => {
    const auth = requireAdminAuth(request as CallableRequest<unknown>);
    const input: CreateWorkshopInput = {
      organizationId: validateIdentifier(request.data?.organizationId, 'organizationId'),
      client: validateText(request.data?.client ?? '', 'client', { required: true }),
      facilitator: validateText(request.data?.facilitator ?? '', 'facilitator', { required: true }),
      challenge: validateText(request.data?.challenge, 'challenge', {
        required: true,
        maxLength: MAX_CONTENT_LENGTH,
      }),
      customCode: request.data?.customCode
        ? normalizeRoomCode(validateText(request.data.customCode, 'customCode'))
        : undefined,
      idempotencyKey: validateIdempotencyKey(request.data?.idempotencyKey),
    };

    await assertMembership(auth.uid, input.organizationId, ADMIN_ROLES);

    if (input.customCode && !isRoomCodeValid(input.customCode)) {
      throw new HttpsError('invalid-argument', 'El código personalizado no es válido.');
    }

    if (input.customCode) {
      return createWorkshopWithCode(auth.uid, input, input.customCode);
    }

    for (let attempt = 0; attempt < 12; attempt += 1) {
      try {
        return await createWorkshopWithCode(auth.uid, input, generateRoomCode());
      } catch (error) {
        if (!(error instanceof HttpsError) || error.code !== 'already-exists') throw error;
      }
    }
    throw new HttpsError('resource-exhausted', 'No se pudo reservar un código único.');
  },
);

const enforceJoinRateLimitBucket = async (bucketId: string, limit: number) => {
  const rateRef = db.doc('joinRateLimits/' + hashIdentifier(bucketId));
  const now = Date.now();
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(rateRef);
    const data = snapshot.data();
    const windowStartedAt = data?.windowStartedAt?.toMillis?.() ?? 0;
    const count = typeof data?.count === 'number' ? data.count : 0;
    if (now - windowStartedAt < JOIN_WINDOW_MS && count >= limit) {
      throw new HttpsError('resource-exhausted', 'Demasiados intentos. Espera un minuto.');
    }
    transaction.set(rateRef, {
      count: now - windowStartedAt < JOIN_WINDOW_MS ? count + 1 : 1,
      windowStartedAt: now - windowStartedAt < JOIN_WINDOW_MS
        ? data?.windowStartedAt
        : Timestamp.fromMillis(now),
      expiresAt: Timestamp.fromMillis(now + 2 * JOIN_WINDOW_MS),
    });
  });
};

const enforceJoinRateLimit = async (uid: string, networkId: string, roomCode: string) => {
  await Promise.all([
    enforceJoinRateLimitBucket(`uid:${uid}`, JOIN_GLOBAL_UID_ATTEMPT_LIMIT),
    enforceJoinRateLimitBucket(`ip:${networkId}`, JOIN_GLOBAL_IP_ATTEMPT_LIMIT),
    enforceJoinRateLimitBucket(`uid:${uid}:${roomCode}`, JOIN_ATTEMPT_LIMIT),
    enforceJoinRateLimitBucket(`ip:${networkId}:${roomCode}`, 40),
  ]);
};
export const joinWorkshopByCode = callable<JoinWorkshopInput, JoinWorkshopOutput>(
  'joinWorkshopByCode',
  async (request) => {
    const auth = requireParticipantAuth(request as CallableRequest<unknown>);
    const roomCode = normalizeRoomCode(
      validateText(request.data?.roomCode, 'roomCode', { required: true }),
    );
    validateIdempotencyKey(request.data?.idempotencyKey);
    if (!isRoomCodeValid(roomCode)) {
      throw new HttpsError('invalid-argument', 'El código de sala no es válido.');
    }

    await enforceJoinRateLimit(
      auth.uid,
      request.rawRequest.ip || 'unknown',
      roomCode,
    );

    const roomCodeRef = db.doc('activeRoomCodes/' + roomCode);
    const expiresAtMs = Date.now() + PARTICIPANT_SESSION_TTL_MS;

    return db.runTransaction(async (transaction) => {
      const roomCodeSnapshot = await transaction.get(roomCodeRef);
      if (!roomCodeSnapshot.exists) {
        throw new HttpsError('not-found', 'La partida no está disponible.');
      }

      const workshopId = validateIdentifier(
        roomCodeSnapshot.data()?.workshopId,
        'workshopId',
      );
      const organizationId = validateIdentifier(roomCodeSnapshot.data()?.organizationId, 'organizationId');
      const organizationRef = db.doc('organizations/' + organizationId);
      const workshopRef = db.doc('workshops/' + workshopId);
      const sessionRef = workshopRef.collection('participantSessions').doc(auth.uid);
      const slotRefs = Array.from({ length: MAX_PARTICIPANT_DEVICES }, (_, index) =>
        workshopRef.collection('participantDeviceSlots').doc(String(index)),
      );
      const [workshopSnapshot, organizationSnapshot, sessionSnapshot, ...slotSnapshots] = await Promise.all([
        transaction.get(workshopRef),
        transaction.get(organizationRef),
        transaction.get(sessionRef),
        ...slotRefs.map((slotRef) => transaction.get(slotRef)),
      ]);
      const workshop = workshopSnapshot.data() as WorkshopRecord | undefined;

      if (!workshopSnapshot.exists || workshop?.status !== 'active') {
        throw new HttpsError('not-found', 'La partida no está disponible.');
      }
      if (workshop.organizationId !== organizationId) {
        throw new HttpsError('not-found', 'La partida no est\u00e1 disponible.');
      }
      assertOrganizationOperational(organizationSnapshot);

      const existingSlot = sessionSnapshot.data()?.deviceSlot;
      const reusableSlotIndex = typeof existingSlot === 'number'
        && existingSlot >= 0
        && existingSlot < MAX_PARTICIPANT_DEVICES
        && slotSnapshots[existingSlot]?.data()?.participantId === auth.uid
        ? existingSlot
        : slotSnapshots.findIndex((slot) => {
          const expiresAt = slot.data()?.expiresAt;
          return !slot.exists
            || slot.data()?.participantId === auth.uid
            || !(expiresAt instanceof Timestamp)
            || expiresAt.toMillis() <= Date.now();
        });
      if (reusableSlotIndex < 0) {
        throw new HttpsError('resource-exhausted', 'La partida ya tiene cuatro dispositivos activos.');
      }

      const existingTeam = sessionSnapshot.data()?.team;
      const team = isTeam(existingTeam) ? existingTeam : null;
      transaction.set(slotRefs[reusableSlotIndex], {
        participantId: auth.uid,
        participantHash: hashIdentifier(auth.uid),
        expiresAt: Timestamp.fromMillis(expiresAtMs),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.set(sessionRef, {
        team,
        deviceSlot: reusableSlotIndex,
        status: 'active',
        schemaVersion: SCHEMA_VERSION,
        joinedAt: sessionSnapshot.exists
          ? sessionSnapshot.data()?.joinedAt
          : FieldValue.serverTimestamp(),
        lastSeenAt: FieldValue.serverTimestamp(),
        expiresAt: Timestamp.fromMillis(expiresAtMs),
      }, { merge: true });

      return {
        workshopId,
        roomCode,
        status: 'active' as const,
        team,
        expiresAt: expiresAtMs,
      };
    });
  },
);

export const heartbeatParticipantSession = callable<
  HeartbeatParticipantSessionInput,
  HeartbeatParticipantSessionOutput
>('heartbeatParticipantSession', async (request) => {
  const auth = requireAuth(request as CallableRequest<unknown>);
  const workshopId = validateIdentifier(request.data?.workshopId, 'workshopId');
  const workshopRef = db.doc('workshops/' + workshopId);
  const sessionRef = workshopRef.collection('participantSessions').doc(auth.uid);
  const expiresAtMs = Date.now() + PARTICIPANT_HEARTBEAT_TTL_MS;

  return db.runTransaction(async (transaction) => {
    const [workshopSnapshot, sessionSnapshot] = await Promise.all([
      transaction.get(workshopRef),
      transaction.get(sessionRef),
    ]);
    if (!workshopSnapshot.exists || workshopSnapshot.data()?.status !== 'active') {
      throw new HttpsError('failed-precondition', 'La partida ya no esta activa.');
    }
    const currentExpiresAt = sessionSnapshot.data()?.expiresAt;
    if (!sessionSnapshot.exists
      || sessionSnapshot.data()?.status !== 'active'
      || !(currentExpiresAt instanceof Timestamp)
      || currentExpiresAt.toMillis() <= Date.now()) {
      throw new HttpsError('permission-denied', 'La sesion ha expirado. Vuelve a entrar con el codigo de sala.');
    }
    const organizationId = validateIdentifier(workshopSnapshot.data()?.organizationId, 'organizationId');
    const organizationSnapshot = await transaction.get(db.doc('organizations/' + organizationId));
    assertOrganizationOperational(organizationSnapshot);
    const deviceSlot = sessionSnapshot.data()?.deviceSlot;
    if (typeof deviceSlot !== 'number'
      || deviceSlot < 0
      || deviceSlot >= MAX_PARTICIPANT_DEVICES) {
      throw new HttpsError('failed-precondition', 'La sesion no tiene una reserva de dispositivo valida.');
    }
    const slotRef = workshopRef.collection('participantDeviceSlots').doc(String(deviceSlot));
    const slotSnapshot = await transaction.get(slotRef);
    if (!slotSnapshot.exists || slotSnapshot.data()?.participantId !== auth.uid) {
      throw new HttpsError('permission-denied', 'La reserva de este dispositivo ya no esta activa.');
    }
    const rawTeam = sessionSnapshot.data()?.team;
    const team = isTeam(rawTeam) ? rawTeam : null;
    const teamRef = team ? workshopRef.collection('teams').doc(team) : null;
    const teamSnapshot = teamRef ? await transaction.get(teamRef) : null;
    if (teamRef && teamSnapshot?.data()?.activeParticipantId !== auth.uid) {
      throw new HttpsError('permission-denied', 'El equipo esta reservado por otro dispositivo.');
    }

    transaction.update(sessionRef, {
      lastSeenAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromMillis(expiresAtMs),
    });
    transaction.set(slotRef, {
      participantId: auth.uid,
      participantHash: hashIdentifier(auth.uid),
      expiresAt: Timestamp.fromMillis(expiresAtMs),
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (teamRef) {
      transaction.set(teamRef, {
        activeParticipantId: auth.uid,
        activeParticipantHash: hashIdentifier(auth.uid),
        activeDeviceExpiresAt: Timestamp.fromMillis(expiresAtMs),
        lastHeartbeatAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    return { workshopId, team, expiresAt: expiresAtMs };
  });
});

export const resumeWorkshopByCode = callable<
  ResumeWorkshopInput,
  ResumeWorkshopOutput
>('resumeWorkshopByCode', async (request) => {
  const auth = requireAdminAuth(request as CallableRequest<unknown>);
  const roomCode = normalizeRoomCode(
    validateText(request.data?.roomCode, 'roomCode', { required: true }),
  );
  const idempotencyKey = validateIdempotencyKey(request.data?.idempotencyKey);
  if (!isRoomCodeValid(roomCode)) {
    throw new HttpsError('invalid-argument', 'El código de sala no es válido.');
  }

  const roomCodeSnapshot = await db.doc('activeRoomCodes/' + roomCode).get();
  if (!roomCodeSnapshot.exists) {
    throw new HttpsError('not-found', 'La partida no está disponible.');
  }
  const workshopId = validateIdentifier(
    roomCodeSnapshot.data()?.workshopId,
    'workshopId',
  );
  const { workshopRef, workshop } = await loadWorkshopForAdmin(auth.uid, workshopId);
  if (workshop.status !== 'active' || workshop.roomCode !== roomCode) {
    throw new HttpsError('not-found', 'La partida no está disponible.');
  }

  const auditRef = workshopRef.collection('auditEvents').doc(
    commandDocumentId(auth.uid, idempotencyKey),
  );
  await auditRef.create({
    action: 'workshop.resumed',
    actorId: auth.uid,
    actorHash: hashIdentifier(auth.uid),
    metadata: {},
    createdAt: FieldValue.serverTimestamp(),
    schemaVersion: SCHEMA_VERSION,
  }).catch((error: unknown) => {
    if ((error as { code?: number }).code !== 6) throw error;
  });
  return { workshopId, roomCode, status: 'active' as const };
});

export const selectTeam = callable<SelectTeamInput, SelectTeamOutput>(  'selectTeam',
  async (request) => {
    const auth = requireAuth(request as CallableRequest<unknown>);
    const workshopId = validateIdentifier(request.data?.workshopId, 'workshopId');
    const idempotencyKey = validateIdempotencyKey(request.data?.idempotencyKey);
    if (!isTeam(request.data?.team)) {
      throw new HttpsError('invalid-argument', 'El equipo no es válido.');
    }
    const team = request.data.team;
    const workshopRef = db.doc('workshops/' + workshopId);
    const sessionRef = workshopRef.collection('participantSessions').doc(auth.uid);
    const teamRef = workshopRef.collection('teams').doc(team);
    const commandRef = workshopRef.collection('commandKeys').doc(
      commandDocumentId(auth.uid, idempotencyKey),
    );
    const now = Date.now();

    return db.runTransaction(async (transaction) => {
      const [workshopSnapshot, sessionSnapshot, commandSnapshot, teamSnapshot] = await Promise.all([
        transaction.get(workshopRef),
        transaction.get(sessionRef),
        transaction.get(commandRef),
        transaction.get(teamRef),
      ]);
      if (!workshopSnapshot.exists || workshopSnapshot.data()?.status !== 'active') {
        throw new HttpsError('failed-precondition', 'La partida ya no está activa.');
      }
      const sessionExpiresAt = sessionSnapshot.data()?.expiresAt;
      if (
        !sessionSnapshot.exists
        || sessionSnapshot.data()?.status !== 'active'
        || !(sessionExpiresAt instanceof Timestamp)
        || sessionExpiresAt.toMillis() <= Date.now()
      ) {
        throw new HttpsError('permission-denied', 'Primero debes validar el código de sala.');
      }
      const organizationId = validateIdentifier(workshopSnapshot.data()?.organizationId, 'organizationId');
      const organizationSnapshot = await transaction.get(db.doc('organizations/' + organizationId));
      assertOrganizationOperational(organizationSnapshot);
      const currentTeam = sessionSnapshot.data()?.team;
      if (isTeam(currentTeam) && currentTeam !== team) {
        throw new HttpsError(
          'failed-precondition',
          'Ya perteneces a otro equipo. El Alquimista debe reasignarte.',
        );
      }

      const activeParticipantId = teamSnapshot.data()?.activeParticipantId;
      const activeDeviceExpiresAt = teamSnapshot.data()?.activeDeviceExpiresAt;
      if (typeof activeParticipantId === 'string'
        && activeParticipantId !== auth.uid
        && activeDeviceExpiresAt instanceof Timestamp
        && activeDeviceExpiresAt.toMillis() > Date.now()) {
        throw new HttpsError('already-exists', 'Este equipo ya esta reservado por otro dispositivo.');
      }
      if (commandSnapshot.exists) {
        return commandSnapshot.data()?.result as SelectTeamOutput;
      }

      const expiresAtMs = Date.now() + PARTICIPANT_HEARTBEAT_TTL_MS;
      const result: SelectTeamOutput = { workshopId, team, expiresAt: expiresAtMs, updatedAt: now };
      transaction.set(teamRef, {
        team,
        schemaVersion: SCHEMA_VERSION,
        activeParticipantId: auth.uid,
        activeParticipantHash: hashIdentifier(auth.uid),
        activeDeviceExpiresAt: Timestamp.fromMillis(expiresAtMs),
        lastHeartbeatAt: FieldValue.serverTimestamp(),
        createdAt: teamSnapshot.exists
          ? teamSnapshot.data()?.createdAt ?? FieldValue.serverTimestamp()
          : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      transaction.update(sessionRef, {
        team,
        selectedAt: FieldValue.serverTimestamp(),
        lastSeenAt: FieldValue.serverTimestamp(),
        expiresAt: Timestamp.fromMillis(expiresAtMs),
      });
      transaction.create(commandRef, {
        operation: 'selectTeam',
        result,
        createdAt: FieldValue.serverTimestamp(),
      });
      return result;
    });
  },
);

export const requestWorkshopTransition = callable<
  RequestWorkshopTransitionInput,
  RequestWorkshopTransitionOutput
>('requestWorkshopTransition', async (request) => {
  const auth = requireAdminAuth(request as CallableRequest<unknown>);
  const workshopId = validateIdentifier(request.data?.workshopId, 'workshopId');
  const idempotencyKey = validateIdempotencyKey(request.data?.idempotencyKey);
  const wantsComplete = request.data?.complete === true;
  const targetPhase = request.data?.targetPhase;
  if (wantsComplete === isPhase(targetPhase)) {
    throw new HttpsError('invalid-argument', 'Indica una fase de destino o la finalizacion, pero no ambas.');
  }
  const { workshopRef } = await loadWorkshopForAdmin(auth.uid, workshopId);
  const commandRef = workshopRef.collection('commandKeys').doc(
    commandDocumentId(auth.uid, idempotencyKey),
  );
  const transitionId = 'transition-' + commandDocumentId(auth.uid, idempotencyKey);
  const now = Date.now();
  const expiresAt = now + WORKSHOP_TRANSITION_TTL_MS;

  return db.runTransaction(async (transaction) => {
    const [workshopSnapshot, commandSnapshot, sessionSnapshots] = await Promise.all([
      transaction.get(workshopRef),
      transaction.get(commandRef),
      transaction.get(workshopRef.collection('participantSessions').where('status', '==', 'active')),
    ]);
    await revalidateWorkshopAdminInTransaction(
      transaction, db, auth.uid, workshopSnapshot, ADMIN_ROLES,
    );
    if (commandSnapshot.exists) {
      return commandSnapshot.data()?.result as RequestWorkshopTransitionOutput;
    }
    const workshop = workshopSnapshot.data() as WorkshopRecord | undefined;
    if (!workshopSnapshot.exists || workshop?.status !== 'active') {
      throw new HttpsError('failed-precondition', 'La partida ya no esta activa.');
    }
    const existingTransition = workshop.transition;
    const existingDeadline = existingTransition?.deadline;
    if (existingTransition?.state === 'requested'
      && existingDeadline instanceof Timestamp
      && existingDeadline.toMillis() > now) {
      throw new HttpsError('aborted', 'Ya hay una transicion pendiente.');
    }
    const currentPhase = isPhase(workshop.currentPhase) ? workshop.currentPhase : PHASES[0];
    const unlockedPhases = Array.isArray(workshop.unlockedPhases)
      ? workshop.unlockedPhases.filter(isPhase)
      : [PHASES[0]];
    if (isPhase(targetPhase)
      && !isPhaseChangeAllowed(currentPhase, targetPhase, unlockedPhases)) {
      throw new HttpsError('failed-precondition', 'No se pueden omitir fases del juego.');
    }
    const requiredTeams = [...new Set(sessionSnapshots.docs
      .filter((session) => {
        const expiration = session.data().expiresAt;
        return expiration instanceof Timestamp && expiration.toMillis() > now;
      })
      .map((session) => session.data().team)
      .filter(isTeam))].slice(0, MAX_PARTICIPANT_DEVICES);
    const kind: WorkshopTransitionKind = wantsComplete ? 'complete' : 'phase';
    const result: RequestWorkshopTransitionOutput = {
      workshopId,
      transitionId,
      kind,
      targetPhase: isPhase(targetPhase) ? targetPhase : null,
      state: 'requested',
      requiredAcks: requiredTeams.length,
      receivedAcks: 0,
      expiresAt,
    };
    transaction.update(workshopRef, {
      transition: {
        id: transitionId,
        state: 'requested' satisfies WorkshopTransitionState,
        kind,
        targetPhase: isPhase(targetPhase) ? targetPhase : null,
        requiredTeams,
        acknowledgedTeams: [],
        requiredAcks: requiredTeams.length,
        receivedAcks: 0,
        requestedAt: FieldValue.serverTimestamp(),
        deadline: Timestamp.fromMillis(expiresAt),
        requestedByHash: hashIdentifier(auth.uid),
      },
      pendingTransitionId: transitionId,
      transitionState: 'requested',
      transitionKind: kind,
      transitionTargetPhase: isPhase(targetPhase) ? targetPhase : null,
      transitionExpiresAt: Timestamp.fromMillis(expiresAt),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(commandRef, {
      operation: 'requestWorkshopTransition',
      result,
      createdAt: FieldValue.serverTimestamp(),
    });
    createAuditEvent(transaction, workshopRef, auth.uid, 'workshop.transitionRequested', {
      transitionId,
      kind,
      targetPhase: isPhase(targetPhase) ? targetPhase : null,
      requiredTeams: requiredTeams.join(','),
    });
    return result;
  });
});

export const acknowledgeWorkshopTransition = callable<
  AckWorkshopTransitionInput,
  AckWorkshopTransitionOutput
>('acknowledgeWorkshopTransition', async (request) => {
  const auth = requireAuth(request as CallableRequest<unknown>);
  const workshopId = validateIdentifier(request.data?.workshopId, 'workshopId');
  const transitionId = validateIdentifier(request.data?.transitionId, 'transitionId');
  const idempotencyKey = validateIdempotencyKey(request.data?.idempotencyKey);
  const workshopRef = db.doc('workshops/' + workshopId);
  const sessionRef = workshopRef.collection('participantSessions').doc(auth.uid);
  const commandRef = workshopRef.collection('commandKeys').doc(
    commandDocumentId(auth.uid, idempotencyKey),
  );

  return db.runTransaction(async (transaction) => {
    const [workshopSnapshot, sessionSnapshot, commandSnapshot] = await Promise.all([
      transaction.get(workshopRef),
      transaction.get(sessionRef),
      transaction.get(commandRef),
    ]);
    const workshop = workshopSnapshot.data() as WorkshopRecord | undefined;
    const sessionExpiration = sessionSnapshot.data()?.expiresAt;
    const rawTeam = sessionSnapshot.data()?.team;
    if (!sessionSnapshot.exists
      || sessionSnapshot.data()?.status !== 'active'
      || !(sessionExpiration instanceof Timestamp)
      || sessionExpiration.toMillis() <= Date.now()
      || !isTeam(rawTeam)) {
      throw new HttpsError('permission-denied', 'No hay una sesion de equipo activa.');
    }
    const organizationId = validateIdentifier(workshop?.organizationId, 'organizationId');
    const organizationSnapshot = await transaction.get(db.doc('organizations/' + organizationId));
    assertOrganizationOperational(organizationSnapshot);
    if (commandSnapshot.exists) {
      return commandSnapshot.data()?.result as AckWorkshopTransitionOutput;
    }
    const transition = workshop?.transition;
    if (!workshopSnapshot.exists || workshop?.status !== 'active'
      || transition?.id !== transitionId || transition.state !== 'requested') {
      throw new HttpsError('failed-precondition', 'La transicion ya no esta pendiente.');
    }
    const deadline = transition.deadline;
    if (!(deadline instanceof Timestamp) || deadline.toMillis() <= Date.now()) {
      throw new HttpsError('deadline-exceeded', 'La transicion ha expirado.');
    }
    const requiredTeams = Array.isArray(transition.requiredTeams)
      ? transition.requiredTeams.filter(isTeam)
      : [];
    if (!requiredTeams.includes(rawTeam)) {
      throw new HttpsError('failed-precondition', 'Este equipo no participa en la transicion.');
    }
    const teamRef = workshopRef.collection('teams').doc(rawTeam);
    const teamSnapshot = await transaction.get(teamRef);
    if (!teamSnapshot.exists || teamSnapshot.data()?.activeParticipantId !== auth.uid) {
      throw new HttpsError('permission-denied', 'El equipo no esta reservado por este dispositivo.');
    }
    const currentAcks = Array.isArray(transition.acknowledgedTeams)
      ? transition.acknowledgedTeams.filter(isTeam)
      : [];
    const acknowledgedTeams = currentAcks.includes(rawTeam)
      ? currentAcks
      : [...currentAcks, rawTeam];
    const teamUpdatedAt = teamSnapshot.data()?.updatedAt;
    const persistedRevision = typeof teamSnapshot.data()?.revision === 'number'
      ? teamSnapshot.data()?.revision
      : teamUpdatedAt instanceof Timestamp ? teamUpdatedAt.toMillis() : 0;
    const allTeamsAcknowledged = acknowledgedTeams.length >= requiredTeams.length;
    const result: AckWorkshopTransitionOutput = {
      workshopId,
      transitionId,
      state: allTeamsAcknowledged ? 'committed' : 'requested',
      requiredAcks: requiredTeams.length,
      receivedAcks: acknowledgedTeams.length,
    };
    transaction.update(sessionRef, {
      transitionAckId: transitionId,
      transitionAckAt: FieldValue.serverTimestamp(),
      persistedRevision,
      lastSavedAt: teamUpdatedAt instanceof Timestamp ? teamUpdatedAt : FieldValue.serverTimestamp(),
      lastSeenAt: FieldValue.serverTimestamp(),
    });
    transaction.set(teamRef, {
      persistedRevision,
      lastSavedAt: teamUpdatedAt instanceof Timestamp ? teamUpdatedAt : FieldValue.serverTimestamp(),
      transitionAckId: transitionId,
      transitionAckAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    if (allTeamsAcknowledged) {
      const kind = transition.kind === 'complete' ? 'complete' : 'phase';
      const targetPhase = isPhase(transition.targetPhase) ? transition.targetPhase : null;
      const update: Record<string, unknown> = {
        transition: {
          ...transition,
          acknowledgedTeams,
          receivedAcks: acknowledgedTeams.length,
          state: 'committed' satisfies WorkshopTransitionState,
          committedAt: FieldValue.serverTimestamp(),
          committedByHash: typeof transition.requestedByHash === 'string'
            ? transition.requestedByHash
            : hashIdentifier('system:auto-transition'),
          override: null,
        },
        pendingTransitionId: FieldValue.delete(),
        transitionState: 'committed',
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (kind === 'complete') {
        update.status = 'completed';
        update.completedAt = FieldValue.serverTimestamp();
        if (typeof workshop.roomCode === 'string') {
          transaction.delete(db.doc('activeRoomCodes/' + workshop.roomCode));
        }
      } else {
        if (!targetPhase) throw new HttpsError('data-loss', 'La fase de destino no es valida.');
        const unlockedPhases = Array.isArray(workshop.unlockedPhases)
          ? workshop.unlockedPhases.filter(isPhase)
          : [PHASES[0]];
        update.currentPhase = targetPhase;
        update.unlockedPhases = unlockedPhases.includes(targetPhase)
          ? unlockedPhases
          : [...unlockedPhases, targetPhase];
      }
      transaction.update(workshopRef, update as FirebaseFirestore.UpdateData<DocumentData>);
      createAuditEvent(transaction, workshopRef, 'system:auto-transition', 'workshop.transitionCommitted', {
        transitionId,
        kind,
        targetPhase,
        override: false,
        requestedByHash: typeof transition.requestedByHash === 'string'
          ? transition.requestedByHash
          : null,
      });
    } else {
      transaction.update(workshopRef, {
        'transition.acknowledgedTeams': acknowledgedTeams,
        'transition.receivedAcks': acknowledgedTeams.length,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    transaction.create(commandRef, {
      operation: 'acknowledgeWorkshopTransition',
      result,
      createdAt: FieldValue.serverTimestamp(),
    });
    return result;
  });
});

export const commitWorkshopTransition = callable<
  CommitWorkshopTransitionInput,
  CommitWorkshopTransitionOutput
>('commitWorkshopTransition', async (request) => {
  const auth = requireAdminAuth(request as CallableRequest<unknown>);
  const workshopId = validateIdentifier(request.data?.workshopId, 'workshopId');
  const transitionId = validateIdentifier(request.data?.transitionId, 'transitionId');
  const idempotencyKey = validateIdempotencyKey(request.data?.idempotencyKey);
  const overrideReason = request.data?.overrideReason === undefined
    ? null
    : validateCriticalReason(request.data.overrideReason);
  const { workshopRef } = await loadWorkshopForAdmin(auth.uid, workshopId);
  const commandRef = workshopRef.collection('commandKeys').doc(
    commandDocumentId(auth.uid, idempotencyKey),
  );
  const now = Date.now();

  return db.runTransaction(async (transaction) => {
    const [workshopSnapshot, commandSnapshot] = await Promise.all([
      transaction.get(workshopRef),
      transaction.get(commandRef),
    ]);
    await revalidateWorkshopAdminInTransaction(
      transaction, db, auth.uid, workshopSnapshot, ADMIN_ROLES,
    );
    if (commandSnapshot.exists) {
      return commandSnapshot.data()?.result as CommitWorkshopTransitionOutput;
    }
    const workshop = workshopSnapshot.data() as WorkshopRecord | undefined;
    const transition = workshop?.transition;
    if (workshopSnapshot.exists && transition?.id === transitionId && transition.state === 'committed') {
      const result: CommitWorkshopTransitionOutput = {
        workshopId,
        transitionId,
        state: 'committed',
        updatedAt: now,
      };
      transaction.create(commandRef, {
        operation: 'commitWorkshopTransition',
        result,
        createdAt: FieldValue.serverTimestamp(),
      });
      return result;
    }
    if (!workshopSnapshot.exists || workshop?.status !== 'active'
      || transition?.id !== transitionId || transition.state !== 'requested') {
      throw new HttpsError('failed-precondition', 'La transicion ya no esta pendiente.');
    }
    const requiredTeams = Array.isArray(transition.requiredTeams)
      ? transition.requiredTeams.filter(isTeam)
      : [];
    const acknowledgedTeams = Array.isArray(transition.acknowledgedTeams)
      ? transition.acknowledgedTeams.filter(isTeam)
      : [];
    const missingTeams = requiredTeams.filter((team) => !acknowledgedTeams.includes(team));
    if (missingTeams.length > 0 && !overrideReason) {
      throw new HttpsError(
        'failed-precondition',
        'Faltan equipos por guardar. Solo puedes forzar con un motivo auditado.',
      );
    }
    const kind = transition.kind === 'complete' ? 'complete' : 'phase';
    const targetPhase = isPhase(transition.targetPhase) ? transition.targetPhase : null;
    const update: Record<string, unknown> = {
      transition: {
        ...transition,
        state: 'committed' satisfies WorkshopTransitionState,
        committedAt: FieldValue.serverTimestamp(),
        committedByHash: hashIdentifier(auth.uid),
        override: missingTeams.length > 0 ? {
          reason: overrideReason,
          pendingTeams: missingTeams,
          at: FieldValue.serverTimestamp(),
        } : null,
      },
      pendingTransitionId: FieldValue.delete(),
      transitionState: 'committed',
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (kind === 'complete') {
      update.status = 'completed';
      update.completedAt = FieldValue.serverTimestamp();
      if (typeof workshop.roomCode === 'string') {
        transaction.delete(db.doc('activeRoomCodes/' + workshop.roomCode));
      }
    } else {
      if (!targetPhase) throw new HttpsError('data-loss', 'La fase de destino no es valida.');
      const unlockedPhases = Array.isArray(workshop.unlockedPhases)
        ? workshop.unlockedPhases.filter(isPhase)
        : [PHASES[0]];
      update.currentPhase = targetPhase;
      update.unlockedPhases = unlockedPhases.includes(targetPhase)
        ? unlockedPhases
        : [...unlockedPhases, targetPhase];
    }
    const result: CommitWorkshopTransitionOutput = {
      workshopId,
      transitionId,
      state: 'committed',
      updatedAt: now,
    };
    transaction.update(workshopRef, update as FirebaseFirestore.UpdateData<DocumentData>);
    transaction.create(commandRef, {
      operation: 'commitWorkshopTransition',
      result,
      createdAt: FieldValue.serverTimestamp(),
    });
    createAuditEvent(transaction, workshopRef, auth.uid, 'workshop.transitionCommitted', {
      transitionId,
      kind,
      targetPhase,
      override: missingTeams.length > 0,
      overrideReason,
      pendingTeams: missingTeams.join(','),
    });
    return result;
  });
});

export const cancelWorkshopTransition = callable<
  CancelWorkshopTransitionInput,
  CancelWorkshopTransitionOutput
>('cancelWorkshopTransition', async (request) => {
  const auth = requireAdminAuth(request as CallableRequest<unknown>);
  const workshopId = validateIdentifier(request.data?.workshopId, 'workshopId');
  const transitionId = validateIdentifier(request.data?.transitionId, 'transitionId');
  const reason = validateCriticalReason(request.data?.reason);
  const idempotencyKey = validateIdempotencyKey(request.data?.idempotencyKey);
  const { workshopRef } = await loadWorkshopForAdmin(auth.uid, workshopId);
  const commandRef = workshopRef.collection('commandKeys').doc(
    commandDocumentId(auth.uid, idempotencyKey),
  );
  const now = Date.now();

  return db.runTransaction(async (transaction) => {
    const [workshopSnapshot, commandSnapshot] = await Promise.all([
      transaction.get(workshopRef),
      transaction.get(commandRef),
    ]);
    await revalidateWorkshopAdminInTransaction(
      transaction, db, auth.uid, workshopSnapshot, ADMIN_ROLES,
    );
    if (commandSnapshot.exists) {
      return commandSnapshot.data()?.result as CancelWorkshopTransitionOutput;
    }
    const workshop = workshopSnapshot.data() as WorkshopRecord | undefined;
    const transition = workshop?.transition;
    if (!workshopSnapshot.exists || transition?.id !== transitionId
      || transition.state !== 'requested') {
      throw new HttpsError('failed-precondition', 'La transicion ya no esta pendiente.');
    }
    const result: CancelWorkshopTransitionOutput = {
      workshopId,
      transitionId,
      state: 'cancelled',
      updatedAt: now,
    };
    transaction.update(workshopRef, {
      transition: {
        ...transition,
        state: 'cancelled' satisfies WorkshopTransitionState,
        cancelledAt: FieldValue.serverTimestamp(),
        cancelledByHash: hashIdentifier(auth.uid),
        reason,
      },
      pendingTransitionId: FieldValue.delete(),
      transitionState: 'cancelled',
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(commandRef, {
      operation: 'cancelWorkshopTransition',
      result,
      createdAt: FieldValue.serverTimestamp(),
    });
    createAuditEvent(transaction, workshopRef, auth.uid, 'workshop.transitionCancelled', {
      transitionId,
      reason,
    });
    return result;
  });
});

export const advanceWorkshopPhase = callable<
  AdvanceWorkshopPhaseInput,
  WorkshopCommandOutput
>('advanceWorkshopPhase', async () => {
  throw new HttpsError(
    'failed-precondition',
    'Usa la transicion segura con confirmacion de guardado de los equipos.',
  );
});
export const completeWorkshop = callable<CompleteWorkshopInput, WorkshopCommandOutput>(
  'completeWorkshop',
  async () => {
    throw new HttpsError(
      'failed-precondition',
      'Usa la finalizacion segura con confirmacion de guardado de los equipos.',
    );
  },
);
export const updateWorkshopControl = callable<
  UpdateWorkshopControlInput,
  WorkshopCommandOutput
>('updateWorkshopControl', async (request) => {
  const auth = requireAdminAuth(request as CallableRequest<unknown>);
  const workshopId = validateIdentifier(request.data?.workshopId, 'workshopId');
  const idempotencyKey = validateIdempotencyKey(request.data?.idempotencyKey);
  if (typeof request.data?.sublimarDefenseUnlocked !== 'boolean') {
    throw new HttpsError('invalid-argument', 'El estado de defensa no es válido.');
  }
  const { workshopRef } = await loadWorkshopForAdmin(auth.uid, workshopId);
  const commandRef = workshopRef.collection('commandKeys').doc(
    commandDocumentId(auth.uid, idempotencyKey),
  );
  const now = Date.now();

  return db.runTransaction(async (transaction) => {
    const [workshopSnapshot, commandSnapshot] = await Promise.all([
      transaction.get(workshopRef),
      transaction.get(commandRef),
    ]);
    await revalidateWorkshopAdminInTransaction(
      transaction, db, auth.uid, workshopSnapshot, ADMIN_ROLES,
    );
    if (commandSnapshot.exists) {
      return commandSnapshot.data()?.result as WorkshopCommandOutput;
    }
    if (!workshopSnapshot.exists || workshopSnapshot.data()?.status !== 'active') {
      throw new HttpsError('failed-precondition', 'La partida ya no está activa.');
    }
    const result = { workshopId, updatedAt: now };
    transaction.update(workshopRef, {
      sublimarDefenseUnlocked: request.data.sublimarDefenseUnlocked,
      sublimarDefenseUnlockedAt: request.data.sublimarDefenseUnlocked
        ? FieldValue.serverTimestamp()
        : FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(commandRef, {
      operation: 'updateWorkshopControl',
      result,
      createdAt: FieldValue.serverTimestamp(),
    });
    createAuditEvent(transaction, workshopRef, auth.uid, 'workshop.controlUpdated', {
      sublimarDefenseUnlocked: request.data.sublimarDefenseUnlocked,
    });
    return result;
  });
});

export const reassignParticipant = callable<  ReassignParticipantInput,
  WorkshopCommandOutput
>('reassignParticipant', async (request) => {
  const auth = requireAdminAuth(request as CallableRequest<unknown>);
  const workshopId = validateIdentifier(request.data?.workshopId, 'workshopId');
  const participantId = validateIdentifier(request.data?.participantId, 'participantId');
  const idempotencyKey = validateIdempotencyKey(request.data?.idempotencyKey);
  const destinationTeam = request.data?.destinationTeam;
  if (destinationTeam !== null && !isTeam(destinationTeam)) {
    throw new HttpsError('invalid-argument', 'El equipo de destino no es válido.');
  }
  const { workshopRef } = await loadWorkshopForAdmin(auth.uid, workshopId);
  const sessionRef = workshopRef.collection('participantSessions').doc(participantId);
  const commandRef = workshopRef.collection('commandKeys').doc(
    commandDocumentId(auth.uid, idempotencyKey),
  );
  const now = Date.now();

  return db.runTransaction(async (transaction) => {
    const [workshopSnapshot, sessionSnapshot, commandSnapshot] = await Promise.all([
      transaction.get(workshopRef),
      transaction.get(sessionRef),
      transaction.get(commandRef),
    ]);
    await revalidateWorkshopAdminInTransaction(
      transaction, db, auth.uid, workshopSnapshot, ADMIN_ROLES,
    );
    if (commandSnapshot.exists) {
      return commandSnapshot.data()?.result as WorkshopCommandOutput;
    }
    if (!workshopSnapshot.exists || workshopSnapshot.data()?.status !== 'active') {
      throw new HttpsError('failed-precondition', 'La partida ya no está activa.');
    }
    if (!sessionSnapshot.exists) {
      throw new HttpsError('not-found', 'El participante no está conectado.');
    }
    const fromTeam = isTeam(sessionSnapshot.data()?.team)
      ? sessionSnapshot.data()?.team as Team
      : null;
    const fromTeamRef = fromTeam ? workshopRef.collection('teams').doc(fromTeam) : null;
    const destinationTeamRef = destinationTeam
      ? workshopRef.collection('teams').doc(destinationTeam)
      : null;
    const [fromTeamSnapshot, destinationTeamSnapshot] = await Promise.all([
      fromTeamRef ? transaction.get(fromTeamRef) : Promise.resolve(null),
      destinationTeamRef && destinationTeam !== fromTeam
        ? transaction.get(destinationTeamRef)
        : Promise.resolve(null),
    ]);
    const destinationData = destinationTeam === fromTeam
      ? fromTeamSnapshot?.data()
      : destinationTeamSnapshot?.data();
    const destinationExpiresAt = destinationData?.activeDeviceExpiresAt;
    if (destinationTeam
      && typeof destinationData?.activeParticipantId === 'string'
      && destinationData.activeParticipantId !== participantId
      && destinationExpiresAt instanceof Timestamp
      && destinationExpiresAt.toMillis() > Date.now()) {
      throw new HttpsError('already-exists', 'El equipo de destino ya tiene un dispositivo activo.');
    }

    const sessionExpiresAt = sessionSnapshot.data()?.expiresAt;
    const leaseUntil = sessionExpiresAt instanceof Timestamp
      && sessionExpiresAt.toMillis() > Date.now()
      ? sessionExpiresAt
      : Timestamp.fromMillis(Date.now() + PARTICIPANT_HEARTBEAT_TTL_MS);
    const result = { workshopId, updatedAt: now };
    transaction.update(sessionRef, {
      team: destinationTeam,
      reassignedAt: FieldValue.serverTimestamp(),
      lastSeenAt: FieldValue.serverTimestamp(),
      transitionAckId: FieldValue.delete(),
    });
    if (fromTeamRef && fromTeam !== destinationTeam
      && fromTeamSnapshot?.data()?.activeParticipantId === participantId) {
      transaction.set(fromTeamRef, {
        activeParticipantId: FieldValue.delete(),
        activeParticipantHash: FieldValue.delete(),
        activeDeviceExpiresAt: FieldValue.delete(),
        releasedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    if (destinationTeamRef) {
      transaction.set(destinationTeamRef, {
        team: destinationTeam,
        schemaVersion: SCHEMA_VERSION,
        activeParticipantId: participantId,
        activeParticipantHash: hashIdentifier(participantId),
        activeDeviceExpiresAt: leaseUntil,
        lastHeartbeatAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    transaction.create(commandRef, {
      operation: 'reassignParticipant',
      result,
      createdAt: FieldValue.serverTimestamp(),
    });
    createAuditEvent(transaction, workshopRef, auth.uid, 'participant.reassigned', {
      participantHash: hashIdentifier(participantId),
      fromTeam,
      toTeam: destinationTeam,
    });
    return result;
  });
});

export const releaseParticipantSession = callable<
  ReleaseParticipantSessionInput,
  WorkshopCommandOutput
>('releaseParticipantSession', async (request) => {
  const auth = requireAdminAuth(request as CallableRequest<unknown>);
  const workshopId = validateIdentifier(request.data?.workshopId, 'workshopId');
  const participantId = validateIdentifier(request.data?.participantId, 'participantId');
  const reason = validateCriticalReason(request.data?.reason);
  const idempotencyKey = validateIdempotencyKey(request.data?.idempotencyKey);
  const { workshopRef } = await loadWorkshopForAdmin(auth.uid, workshopId);
  const sessionRef = workshopRef.collection('participantSessions').doc(participantId);
  const commandRef = workshopRef.collection('commandKeys').doc(
    commandDocumentId(auth.uid, idempotencyKey),
  );
  const now = Date.now();

  return db.runTransaction(async (transaction) => {
    const [workshopSnapshot, sessionSnapshot, commandSnapshot] = await Promise.all([
      transaction.get(workshopRef),
      transaction.get(sessionRef),
      transaction.get(commandRef),
    ]);
    await revalidateWorkshopAdminInTransaction(
      transaction, db, auth.uid, workshopSnapshot, ADMIN_ROLES,
    );
    if (commandSnapshot.exists) {
      return commandSnapshot.data()?.result as WorkshopCommandOutput;
    }
    if (!workshopSnapshot.exists || !sessionSnapshot.exists) {
      throw new HttpsError('not-found', 'La sesion no existe.');
    }
    const team = isTeam(sessionSnapshot.data()?.team)
      ? sessionSnapshot.data()?.team as Team
      : null;
    const deviceSlot = sessionSnapshot.data()?.deviceSlot;
    const slotRef = typeof deviceSlot === 'number'
      && deviceSlot >= 0
      && deviceSlot < MAX_PARTICIPANT_DEVICES
      ? workshopRef.collection('participantDeviceSlots').doc(String(deviceSlot))
      : null;
    const teamRef = team ? workshopRef.collection('teams').doc(team) : null;
    const [slotSnapshot, teamSnapshot] = await Promise.all([
      slotRef ? transaction.get(slotRef) : Promise.resolve(null),
      teamRef ? transaction.get(teamRef) : Promise.resolve(null),
    ]);
    const result: WorkshopCommandOutput = { workshopId, updatedAt: now };
    transaction.update(sessionRef, {
      status: 'released',
      expiresAt: Timestamp.fromMillis(now),
      releasedAt: FieldValue.serverTimestamp(),
      releasedByHash: hashIdentifier(auth.uid),
      releaseReason: reason,
      transitionAckId: FieldValue.delete(),
    });
    if (slotRef && slotSnapshot?.data()?.participantId === participantId) {
      transaction.set(slotRef, {
        participantId: FieldValue.delete(),
        participantHash: FieldValue.delete(),
        expiresAt: Timestamp.fromMillis(now),
        releasedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    if (teamRef && teamSnapshot?.data()?.activeParticipantId === participantId) {
      transaction.set(teamRef, {
        activeParticipantId: FieldValue.delete(),
        activeParticipantHash: FieldValue.delete(),
        activeDeviceExpiresAt: FieldValue.delete(),
        transitionAckId: FieldValue.delete(),
        releasedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    transaction.create(commandRef, {
      operation: 'releaseParticipantSession',
      result,
      createdAt: FieldValue.serverTimestamp(),
    });
    createAuditEvent(transaction, workshopRef, auth.uid, 'participant.sessionReleased', {
      participantHash: hashIdentifier(participantId),
      team,
      reason,
    });
    return result;
  });
});

const loadActiveParticipantForCommand = async (
  transaction: Transaction,
  workshopRef: DocumentReference<DocumentData>,
  sessionRef: DocumentReference<DocumentData>,
) => {
  const [workshopSnapshot, sessionSnapshot] = await Promise.all([
    transaction.get(workshopRef),
    transaction.get(sessionRef),
  ]);
  const workshop = workshopSnapshot.data() as WorkshopRecord | undefined;
  const expiresAt = sessionSnapshot.data()?.expiresAt;
  const team = sessionSnapshot.data()?.team;
  if (!workshopSnapshot.exists || workshop?.status !== 'active'
    || workshop.currentPhase !== 'Sublimar') {
    throw new HttpsError('failed-precondition', 'La partida no esta en la fase Sublimar.');
  }
  if (!sessionSnapshot.exists || sessionSnapshot.data()?.status !== 'active'
    || !(expiresAt instanceof Timestamp) || expiresAt.toMillis() <= Date.now()
    || !isTeam(team)) {
    throw new HttpsError('permission-denied', 'No hay una sesion de equipo activa.');
  }
  const organizationId = validateIdentifier(workshop.organizationId, 'organizationId');
  const organizationSnapshot = await transaction.get(db.doc('organizations/' + organizationId));
  assertOrganizationOperational(organizationSnapshot);
  return { workshop, team };
};

export const submitWorkshopAttack = callable<
  SubmitWorkshopAttackInput,
  WorkshopAttackCommandOutput
>('submitWorkshopAttack', async (request) => {
  const auth = requireAuth(request as CallableRequest<unknown>);
  const workshopId = validateIdentifier(request.data?.workshopId, 'workshopId');
  const idempotencyKey = validateIdempotencyKey(request.data?.idempotencyKey);
  if (!isTeam(request.data?.toTeam)) {
    throw new HttpsError('invalid-argument', 'El equipo de destino no es valido.');
  }
  const toTeam = request.data.toTeam;
  const content = validateText(request.data?.content, 'content', {
    required: true,
    maxLength: MAX_CONTENT_LENGTH,
  });
  const workshopRef = db.doc('workshops/' + workshopId);
  const sessionRef = workshopRef.collection('participantSessions').doc(auth.uid);
  const commandId = commandDocumentId(auth.uid, idempotencyKey);
  const commandRef = workshopRef.collection('commandKeys').doc(commandId);
  const attackRef = workshopRef.collection('attacks').doc('attack-' + commandId);
  const now = Date.now();

  return db.runTransaction(async (transaction) => {
    const { team } = await loadActiveParticipantForCommand(transaction, workshopRef, sessionRef);
    const commandSnapshot = await transaction.get(commandRef);
    if (commandSnapshot.exists) {
      return commandSnapshot.data()?.result as WorkshopAttackCommandOutput;
    }
    if (team === toTeam) {
      throw new HttpsError('invalid-argument', 'No puedes atacar a tu propio equipo.');
    }
    const teamRef = workshopRef.collection('teams').doc(team);
    const teamSnapshot = await transaction.get(teamRef);
    const existingAttacks = typeof teamSnapshot.data()?.attackCount === 'number'
      ? teamSnapshot.data()?.attackCount as number
      : (await transaction.get(
        workshopRef.collection('attacks').where('fromTeam', '==', team).limit(MAX_ATTACKS_PER_TEAM + 1),
      )).size;
    if (existingAttacks >= MAX_ATTACKS_PER_TEAM) {
      throw new HttpsError('resource-exhausted', 'El equipo ya alcanzo el limite de diez ataques.');
    }
    const result: WorkshopAttackCommandOutput = {
      workshopId,
      attackId: attackRef.id,
      attackCount: existingAttacks + 1,
      updatedAt: now,
    };
    transaction.set(teamRef, {
      attackCount: existingAttacks + 1,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.create(attackRef, {
      fromTeam: team,
      toTeam,
      content,
      createdByHash: hashIdentifier(auth.uid),
      timestamp: FieldValue.serverTimestamp(),
      schemaVersion: SCHEMA_VERSION,
    });
    transaction.create(commandRef, {
      operation: 'submitWorkshopAttack',
      result,
      createdAt: FieldValue.serverTimestamp(),
    });
    return result;
  });
});

export const updateWorkshopAttack = callable<
  UpdateWorkshopAttackInput,
  WorkshopAttackCommandOutput
>('updateWorkshopAttack', async (request) => {
  const auth = requireAuth(request as CallableRequest<unknown>);
  const workshopId = validateIdentifier(request.data?.workshopId, 'workshopId');
  const attackId = validateIdentifier(request.data?.attackId, 'attackId');
  const idempotencyKey = validateIdempotencyKey(request.data?.idempotencyKey);
  const content = validateText(request.data?.content, 'content', {
    required: true,
    maxLength: MAX_CONTENT_LENGTH,
  });
  const workshopRef = db.doc('workshops/' + workshopId);
  const sessionRef = workshopRef.collection('participantSessions').doc(auth.uid);
  const commandRef = workshopRef.collection('commandKeys').doc(
    commandDocumentId(auth.uid, idempotencyKey),
  );
  const attackRef = workshopRef.collection('attacks').doc(attackId);
  const now = Date.now();

  return db.runTransaction(async (transaction) => {
    const { team } = await loadActiveParticipantForCommand(transaction, workshopRef, sessionRef);
    const commandSnapshot = await transaction.get(commandRef);
    if (commandSnapshot.exists) {
      return commandSnapshot.data()?.result as WorkshopAttackCommandOutput;
    }
    const attackSnapshot = await transaction.get(attackRef);
    if (!attackSnapshot.exists || attackSnapshot.data()?.fromTeam !== team) {
      throw new HttpsError('permission-denied', 'El ataque no pertenece a este equipo.');
    }
    const teamSnapshot = await transaction.get(workshopRef.collection('teams').doc(team));
    const result: WorkshopAttackCommandOutput = {
      workshopId,
      attackId,
      attackCount: typeof teamSnapshot.data()?.attackCount === 'number'
        ? teamSnapshot.data()?.attackCount
        : 0,
      updatedAt: now,
    };
    transaction.update(attackRef, {
      content,
      editedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(commandRef, {
      operation: 'updateWorkshopAttack',
      result,
      createdAt: FieldValue.serverTimestamp(),
    });
    return result;
  });
});

export const deleteWorkshopAttack = callable<
  DeleteWorkshopAttackInput,
  WorkshopAttackCommandOutput
>('deleteWorkshopAttack', async (request) => {
  const auth = requireAuth(request as CallableRequest<unknown>);
  const workshopId = validateIdentifier(request.data?.workshopId, 'workshopId');
  const attackId = validateIdentifier(request.data?.attackId, 'attackId');
  const idempotencyKey = validateIdempotencyKey(request.data?.idempotencyKey);
  const workshopRef = db.doc('workshops/' + workshopId);
  const sessionRef = workshopRef.collection('participantSessions').doc(auth.uid);
  const commandRef = workshopRef.collection('commandKeys').doc(
    commandDocumentId(auth.uid, idempotencyKey),
  );
  const attackRef = workshopRef.collection('attacks').doc(attackId);
  const defenseRef = workshopRef.collection('defenses').doc(attackId);
  const now = Date.now();

  return db.runTransaction(async (transaction) => {
    const { team } = await loadActiveParticipantForCommand(transaction, workshopRef, sessionRef);
    const commandSnapshot = await transaction.get(commandRef);
    if (commandSnapshot.exists) {
      return commandSnapshot.data()?.result as WorkshopAttackCommandOutput;
    }
    const [attackSnapshot, defenseSnapshot] = await Promise.all([
      transaction.get(attackRef),
      transaction.get(defenseRef),
    ]);
    if (!attackSnapshot.exists || attackSnapshot.data()?.fromTeam !== team) {
      throw new HttpsError('permission-denied', 'El ataque no pertenece a este equipo.');
    }
    const teamRef = workshopRef.collection('teams').doc(team);
    const teamSnapshot = await transaction.get(teamRef);
    const currentAttackCount = typeof teamSnapshot.data()?.attackCount === 'number'
      ? teamSnapshot.data()?.attackCount as number
      : 1;
    const result: WorkshopAttackCommandOutput = {
      workshopId,
      attackId,
      attackCount: Math.max(0, currentAttackCount - 1),
      updatedAt: now,
    };
    transaction.set(teamRef, {
      attackCount: Math.max(0, currentAttackCount - 1),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.delete(attackRef);
    if (defenseSnapshot.exists) transaction.delete(defenseRef);
    transaction.create(commandRef, {
      operation: 'deleteWorkshopAttack',
      result,
      createdAt: FieldValue.serverTimestamp(),
    });
    return result;
  });
});

export const saveWorkshopDefense = callable<
  SaveWorkshopDefenseInput,
  SaveWorkshopDefenseOutput
>('saveWorkshopDefense', async (request) => {
  const auth = requireAuth(request as CallableRequest<unknown>);
  const workshopId = validateIdentifier(request.data?.workshopId, 'workshopId');
  const attackId = validateIdentifier(request.data?.attackId, 'attackId');
  const idempotencyKey = validateIdempotencyKey(request.data?.idempotencyKey);
  const content = validateText(request.data?.content, 'content', {
    required: true,
    maxLength: MAX_CONTENT_LENGTH,
  });
  const workshopRef = db.doc('workshops/' + workshopId);
  const sessionRef = workshopRef.collection('participantSessions').doc(auth.uid);
  const commandRef = workshopRef.collection('commandKeys').doc(
    commandDocumentId(auth.uid, idempotencyKey),
  );
  const attackRef = workshopRef.collection('attacks').doc(attackId);
  const defenseRef = workshopRef.collection('defenses').doc(attackId);
  const now = Date.now();

  return db.runTransaction(async (transaction) => {
    const { team } = await loadActiveParticipantForCommand(transaction, workshopRef, sessionRef);
    const commandSnapshot = await transaction.get(commandRef);
    if (commandSnapshot.exists) {
      return commandSnapshot.data()?.result as SaveWorkshopDefenseOutput;
    }
    const [attackSnapshot, defenseSnapshot] = await Promise.all([
      transaction.get(attackRef),
      transaction.get(defenseRef),
    ]);
    if (!attackSnapshot.exists || attackSnapshot.data()?.toTeam !== team) {
      throw new HttpsError('permission-denied', 'El ataque no esta dirigido a este equipo.');
    }
    const result: SaveWorkshopDefenseOutput = {
      workshopId,
      defenseId: defenseRef.id,
      defenseCount: 1,
      updatedAt: now,
    };
    transaction.set(defenseRef, {
      attackId,
      team,
      content,
      createdByHash: hashIdentifier(auth.uid),
      timestamp: defenseSnapshot.exists
        ? defenseSnapshot.data()?.timestamp ?? FieldValue.serverTimestamp()
        : FieldValue.serverTimestamp(),
      ...(defenseSnapshot.exists ? { editedAt: FieldValue.serverTimestamp() } : {}),
      schemaVersion: SCHEMA_VERSION,
    });
    transaction.create(commandRef, {
      operation: 'saveWorkshopDefense',
      result,
      createdAt: FieldValue.serverTimestamp(),
    });
    return result;
  });
});

export const archiveOrganizationWorkshops = callable<
  ArchiveOrganizationWorkshopsInput,
  ArchiveOrganizationWorkshopsOutput
>('archiveOrganizationWorkshops', async (request) => {
  const auth = requireAdminAuth(request as CallableRequest<unknown>);
  const organizationId = validateIdentifier(
    request.data?.organizationId,
    'organizationId',
  );
  const reason = validateCriticalReason(request.data?.reason);
  const idempotencyKey = validateIdempotencyKey(request.data?.idempotencyKey);
  const commandRef = db.doc(
    'organizations/' + organizationId + '/commandKeys/'
      + commandDocumentId(auth.uid, idempotencyKey),
  );
  const requestedAt = Date.now();
  const archiveChunkSize = 100;
  type ArchiveReservation = {
    completed: true;
    result: ArchiveOrganizationWorkshopsOutput;
  } | {
    completed: false;
    workshopIds: string[];
    requestedAt: number;
  };

  const existing = await db.runTransaction<ArchiveReservation | null>(async (transaction) => {
    await revalidateOrganizationOwnerInTransaction(
      transaction,
      db,
      auth.uid,
      organizationId,
    );
    const commandSnapshot = await transaction.get(commandRef);
    if (!commandSnapshot.exists) return null;
    const command = commandSnapshot.data() ?? {};
    if (command.operation !== 'archiveOrganizationWorkshops') {
      throw new HttpsError('failed-precondition', 'La clave de idempotencia ya est\u00e1 en uso.');
    }
    if (command.status !== 'processing') {
      return {
        completed: true,
        result: command.result as ArchiveOrganizationWorkshopsOutput,
      };
    }
    const workshopIds = Array.isArray(command.workshopIds)
      ? command.workshopIds.filter((value): value is string => typeof value === 'string')
      : [];
    if (workshopIds.length !== command.workshopIds?.length) {
      throw new HttpsError('data-loss', 'El comando de archivado no es v\u00e1lido.');
    }
    return {
      completed: false,
      workshopIds,
      requestedAt: typeof command.requestedAt === 'number' ? command.requestedAt : requestedAt,
    };
  });
  if (existing?.completed) return existing.result;

  let reservation: ArchiveReservation | null = existing;
  if (!reservation) {
    const snapshot = await db.collection('workshops')
      .where('organizationId', '==', organizationId)
      .limit(501)
      .get();
    const requestedWorkshopIds = snapshot.docs
      .filter((item) => ['active', 'completed'].includes(String(item.data().status)))
      .map((item) => item.id)
      .sort();
    reservation = await db.runTransaction<ArchiveReservation>(async (transaction) => {
      await revalidateOrganizationOwnerInTransaction(
        transaction,
        db,
        auth.uid,
        organizationId,
      );
      const commandSnapshot = await transaction.get(commandRef);
      if (commandSnapshot.exists) {
        const command = commandSnapshot.data() ?? {};
        if (command.operation !== 'archiveOrganizationWorkshops') {
          throw new HttpsError('failed-precondition', 'La clave de idempotencia ya est\u00e1 en uso.');
        }
        if (command.status !== 'processing') {
          return {
            completed: true,
            result: command.result as ArchiveOrganizationWorkshopsOutput,
          };
        }
        const workshopIds = Array.isArray(command.workshopIds)
          ? command.workshopIds.filter((value): value is string => typeof value === 'string')
          : [];
        if (workshopIds.length !== command.workshopIds?.length) {
          throw new HttpsError('data-loss', 'El comando de archivado no es v\u00e1lido.');
        }
        return {
          completed: false,
          workshopIds,
          requestedAt: typeof command.requestedAt === 'number' ? command.requestedAt : requestedAt,
        };
      }
      if (snapshot.size > 500) {
        throw new HttpsError(
          'resource-exhausted',
          'Hay m\u00e1s de 500 partidas. Ejecuta el archivado operativo por lotes.',
        );
      }
      transaction.create(commandRef, {
        operation: 'archiveOrganizationWorkshops',
        status: 'processing',
        reason,
        workshopIds: requestedWorkshopIds,
        nextChunkIndex: 0,
        archivedCount: 0,
        requestedAt,
        createdAt: FieldValue.serverTimestamp(),
      });
      return {
        completed: false,
        workshopIds: requestedWorkshopIds,
        requestedAt,
      };
    });
    if (reservation.completed) return reservation.result;
    if (!reservation) throw new HttpsError('internal', 'No se pudo reservar el archivado.');
  }

  while (true) {
    const state = await db.runTransaction<
      { completed: true; result: ArchiveOrganizationWorkshopsOutput }
      | { completed: false; result: null }
    >(async (transaction) => {
      await revalidateOrganizationOwnerInTransaction(
        transaction,
        db,
        auth.uid,
        organizationId,
      );
      const commandSnapshot = await transaction.get(commandRef);
      if (!commandSnapshot.exists) {
        throw new HttpsError('data-loss', 'No existe el comando de archivado autorizado.');
      }
      const command = commandSnapshot.data() ?? {};
      if (command.operation !== 'archiveOrganizationWorkshops') {
        throw new HttpsError('data-loss', 'El comando de archivado no es v\u00e1lido.');
      }
      if (command.status !== 'processing') {
        return {
          completed: true,
          result: command.result as ArchiveOrganizationWorkshopsOutput,
        };
      }
      const workshopIds = Array.isArray(command.workshopIds)
        ? command.workshopIds.filter((value): value is string => typeof value === 'string')
        : [];
      if (workshopIds.length !== command.workshopIds?.length) {
        throw new HttpsError('data-loss', 'El comando de archivado no es v\u00e1lido.');
      }
      const nextChunkIndex = Number.isInteger(command.nextChunkIndex)
        ? Number(command.nextChunkIndex)
        : 0;
      const chunkIds = workshopIds.slice(
        nextChunkIndex * archiveChunkSize,
        (nextChunkIndex + 1) * archiveChunkSize,
      );
      const workshopSnapshots = await Promise.all(
        chunkIds.map((workshopId) => transaction.get(db.doc(`workshops/${workshopId}`))),
      );
      if (workshopSnapshots.some((item) => (
        !item.exists || item.data()?.organizationId !== organizationId
      ))) {
        throw new HttpsError('not-found', 'Una partida ya no pertenece a esta empresa.');
      }

      let archivedInChunk = 0;
      for (const workshop of workshopSnapshots) {
        const workshopData = workshop.data() ?? {};
        if (!['active', 'completed'].includes(String(workshopData.status))) continue;
        transaction.update(workshop.ref, {
          status: 'archived',
          archivedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          archiveReason: command.reason,
          archiveCommandId: commandRef.id,
        });
        if (typeof workshopData.roomCode === 'string') {
          transaction.delete(db.doc('activeRoomCodes/' + workshopData.roomCode));
        }
        transaction.set(
          workshop.ref.collection('auditEvents').doc('bulk-' + commandRef.id),
          {
            action: 'workshop.archived',
            actorId: auth.uid,
            actorHash: hashIdentifier(auth.uid),
            metadata: {
              bulk: true,
              previousStatus: String(workshopData.status),
              reason: command.reason,
            },
            createdAt: FieldValue.serverTimestamp(),
            schemaVersion: SCHEMA_VERSION,
          },
        );
        archivedInChunk += 1;
      }

      const archivedCount = (Number(command.archivedCount) || 0) + archivedInChunk;
      const followingChunkIndex = nextChunkIndex + 1;
      const completed = followingChunkIndex * archiveChunkSize >= workshopIds.length;
      if (completed) {
        const result: ArchiveOrganizationWorkshopsOutput = {
          organizationId,
          archivedCount,
          updatedAt: typeof command.requestedAt === 'number' ? command.requestedAt : requestedAt,
        };
        transaction.update(commandRef, {
          status: 'completed',
          nextChunkIndex: followingChunkIndex,
          archivedCount,
          result,
          completedAt: FieldValue.serverTimestamp(),
        });
        return { completed: true, result };
      }
      transaction.update(commandRef, {
        nextChunkIndex: followingChunkIndex,
        archivedCount,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { completed: false, result: null };
    });
    if (state.completed) return state.result;
  }
});
export const generateReportSnapshot = callable<
  GenerateReportSnapshotInput,
  GenerateReportSnapshotOutput
>('generateReportSnapshot', async (request) => {
  const auth = requireAdminAuth(request as CallableRequest<unknown>);
  const workshopId = validateIdentifier(request.data?.workshopId, 'workshopId');
  const idempotencyKey = validateIdempotencyKey(request.data?.idempotencyKey);
  const { workshopRef, organizationId, workshop } = await loadWorkshopForAdmin(auth.uid, workshopId);
  if (workshop.status !== 'completed') {
    throw new HttpsError(
      'failed-precondition',
      'El informe solo se puede generar cuando la partida está finalizada.',
    );
  }
  const commandId = commandDocumentId(auth.uid, idempotencyKey);
  const commandRef = workshopRef.collection('commandKeys').doc(commandId);
  const reportId = 'report-' + commandId;
  const reportRef = workshopRef.collection('reports').doc(reportId);
  const storagePath = 'organizations/' + organizationId + '/workshops/'
    + workshopId + '/reports/' + reportId + '.json';
  const now = Date.now();

  const existingResult = await db.runTransaction(async (transaction) => {
    const [workshopSnapshot, commandSnapshot, reportSnapshot] = await Promise.all([
      transaction.get(workshopRef),
      transaction.get(commandRef),
      transaction.get(reportRef),
    ]);
    await revalidateWorkshopAdminInTransaction(
      transaction, db, auth.uid, workshopSnapshot, ADMIN_ROLES,
    );
    if (commandSnapshot.exists) {
      return commandSnapshot.data()?.result as GenerateReportSnapshotOutput;
    }
    const report = reportSnapshot.data();
    const leaseUntil = report?.generationLeaseUntil?.toMillis?.() ?? 0;
    if (report?.status === 'generating' && leaseUntil > now) {
      throw new HttpsError('aborted', 'El informe ya se está generando.');
    }
    transaction.set(reportRef, {
      workshopId,
      organizationId,
      templateVersion: REPORT_TEMPLATE_VERSION,
      sourceSchemaVersion: SCHEMA_VERSION,
      status: 'generating',
      storagePath,
      createdByHash: hashIdentifier(auth.uid),
      generationLeaseUntil: Timestamp.fromMillis(now + 5 * 60 * 1000),
      createdAt: report?.createdAt ?? FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return null;
  });
  if (existingResult) return existingResult;

  try {
    const { snapshot, sourceSnapshotHash } = await buildCanonicalReportSnapshot(workshopRef);
    const generatedAt = Date.now();
    const reportDocument = {
      exportVersion: EXPORT_VERSION,
      reportTemplateVersion: REPORT_TEMPLATE_VERSION,
      generatedAt: new Date(generatedAt).toISOString(),
      sourceSnapshotHash,
      snapshot,
    };
    const reportJson = Buffer.from(JSON.stringify(reportDocument, null, 2), 'utf8');
    const jsonArtifact = {
      storagePath,
      sha256: createHash('sha256').update(reportJson).digest('hex'),
      size: reportJson.length,
      mimeType: 'application/json',
      generatedAt,
      templateVersion: REPORT_TEMPLATE_VERSION,
    };
    await storage.bucket().file(storagePath).save(
      reportJson,
      {
        resumable: false,
        contentType: 'application/json; charset=utf-8',
        metadata: {
          cacheControl: 'private, no-store, max-age=0',
          metadata: { reportStatus: 'draft' },
        },
      },
    );

    const result: GenerateReportSnapshotOutput = {
      workshopId,
      reportId,
      status: 'draft',
      storagePath,
      sourceSnapshotHash,
      generatedAt,
    };
    return await db.runTransaction(async (transaction) => {
      const [workshopSnapshot, commandSnapshot] = await Promise.all([
        transaction.get(workshopRef),
        transaction.get(commandRef),
      ]);
      await revalidateWorkshopAdminInTransaction(
        transaction, db, auth.uid, workshopSnapshot, ADMIN_ROLES,
      );
      if (commandSnapshot.exists) {
        return commandSnapshot.data()?.result as GenerateReportSnapshotOutput;
      }
      transaction.update(reportRef, {
        status: 'draft',
        sourceSnapshotHash,
        generatedAt: FieldValue.serverTimestamp(),
        artifacts: { json: jsonArtifact },
        generationLeaseUntil: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.create(commandRef, {
        operation: 'generateReportSnapshot',
        result,
        createdAt: FieldValue.serverTimestamp(),
      });
      createAuditEvent(transaction, workshopRef, auth.uid, 'report.generated', {
        reportId,
      });
      return result;
    });
  } catch (error) {
    await reportRef.set({
      status: 'failed',
      failureCode: 'generation-failed',
      generationLeaseUntil: FieldValue.delete(),
      failedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }).catch((reportError) => {
      logger.error('Could not persist report failure state.', {
        workshopIdHash: hashIdentifier(workshopId),
        reportIdHash: hashIdentifier(reportId),
        errorName: reportError instanceof Error ? reportError.name : 'UnknownError',
      });
    });
    throw error;
  }
});

const REPORT_ARTIFACT_MAX_BYTES = 50 * 1024 * 1024;

const isReportArtifact = (value: unknown): value is {
  storagePath: string;
  sha256: string;
  size: number;
  mimeType: string;
  generatedAt: number;
  templateVersion: string;
} => {
  if (!value || typeof value !== 'object') return false;
  const artifact = value as Record<string, unknown>;
  return typeof artifact.storagePath === 'string'
    && typeof artifact.sha256 === 'string'
    && /^[a-f0-9]{64}$/.test(artifact.sha256)
    && typeof artifact.size === 'number'
    && artifact.size > 0
    && typeof artifact.mimeType === 'string'
    && typeof artifact.generatedAt === 'number'
    && typeof artifact.templateVersion === 'string';
};

const createReportArtifact = (
  storagePath: string,
  buffer: Buffer,
  mimeType: string,
  generatedAt: number,
) => ({
  storagePath,
  sha256: createHash('sha256').update(buffer).digest('hex'),
  size: buffer.length,
  mimeType,
  generatedAt,
  templateVersion: REPORT_TEMPLATE_VERSION,
});

const validateGeneratedArtifact = (
  buffer: Buffer,
  format: 'pdf' | 'pptx',
) => {
  if (buffer.length === 0 || buffer.length > REPORT_ARTIFACT_MAX_BYTES) {
    throw new HttpsError('resource-exhausted', `El ${format.toUpperCase()} generado no tiene un tamaño válido.`);
  }
  if (format === 'pdf' && !buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    throw new HttpsError('data-loss', 'El PDF generado no es válido.');
  }
  if (format === 'pptx' && !buffer.subarray(0, 2).equals(Buffer.from('PK'))) {
    throw new HttpsError('data-loss', 'El PPTX generado no es válido.');
  }
};

const generateReportArtifactsForAdmin = async (
  authUid: string,
  input: GenerateReportArtifactsInput,
  options: { platformOrganizationId?: string } = {},
): Promise<GenerateReportArtifactsOutput> => {
  const workshopId = validateIdentifier(input.workshopId, 'workshopId');
  const reportId = validateIdentifier(input.reportId, 'reportId');
  const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
  let workshopRef: DocumentReference<DocumentData>;
  let organizationId: string;
  let workshop: WorkshopRecord;
  if (options.platformOrganizationId) {
    const requestedOrganizationId = validateIdentifier(
      options.platformOrganizationId,
      'organizationId',
    );
    const currentUser = await getAuth().getUser(authUid).catch(() => null);
    if (!currentUser || currentUser.disabled || currentUser.customClaims?.platformAdmin !== true) {
      throw new HttpsError(
        'permission-denied',
        'La autorizacion actual de Plataforma GFS no esta vigente.',
      );
    }
    workshopRef = db.doc('workshops/' + workshopId);
    const workshopSnapshot = await workshopRef.get();
    if (!workshopSnapshot.exists
      || workshopSnapshot.data()?.organizationId !== requestedOrganizationId) {
      throw new HttpsError('not-found', 'La partida no esta disponible.');
    }
    organizationId = requestedOrganizationId;
    workshop = workshopSnapshot.data() as WorkshopRecord;
  } else {
    ({ workshopRef, organizationId, workshop } = await loadWorkshopForAdmin(authUid, workshopId));
  }
  if (workshop.status !== 'completed') {
    throw new HttpsError(
      'failed-precondition',
      'El informe solo se puede generar cuando la partida está finalizada.',
    );
  }

  const reportRef = workshopRef.collection('reports').doc(reportId);
  const commandRef = workshopRef.collection('commandKeys').doc(
    commandDocumentId(authUid, idempotencyKey),
  );
  const basePath = `organizations/${organizationId}/workshops/${workshopId}/reports/${reportId}`;
  const jsonPath = `${basePath}.json`;
  const pdfPath = `${basePath}.pdf`;
  const pptxPath = `${basePath}.pptx`;
  const leaseNow = Date.now();

  const existingResult = await db.runTransaction(async (transaction) => {
    const [workshopSnapshot, commandSnapshot, reportSnapshot] = await Promise.all([
      options.platformOrganizationId ? Promise.resolve(null) : transaction.get(workshopRef),
      transaction.get(commandRef),
      transaction.get(reportRef),
    ]);
    if (workshopSnapshot) {
      await revalidateWorkshopAdminInTransaction(
        transaction, db, authUid, workshopSnapshot, ADMIN_ROLES,
      );
    }
    if (commandSnapshot.exists) {
      return commandSnapshot.data()?.result as GenerateReportArtifactsOutput;
    }
    if (!reportSnapshot.exists) throw new HttpsError('not-found', 'El informe no existe.');
    const report = reportSnapshot.data() ?? {};
    if (report.workshopId !== workshopId
      || report.organizationId !== organizationId
      || report.storagePath !== jsonPath) {
      throw new HttpsError('data-loss', 'La versión del informe no pertenece a esta partida.');
    }
    if (report.status === 'published') {
      throw new HttpsError('failed-precondition', 'Un informe publicado es inmutable.');
    }
    const artifacts = report.artifacts as Record<string, unknown> | undefined;
    if (isReportArtifact(artifacts?.pdf)
      && isReportArtifact(artifacts?.pptx)
      && isReportArtifact(artifacts?.json)
      && typeof report.pageCount === 'number') {
      const result: GenerateReportArtifactsOutput = {
        workshopId,
        reportId,
        status: 'draft',
        pageCount: report.pageCount,
        artifacts: {
          pdf: artifacts.pdf,
          pptx: artifacts.pptx,
          json: artifacts.json,
        },
        generatedAt: Math.max(
          artifacts.pdf.generatedAt,
          artifacts.pptx.generatedAt,
          artifacts.json.generatedAt,
        ),
      };
      transaction.create(commandRef, {
        operation: 'generateReportArtifacts',
        result,
        createdAt: FieldValue.serverTimestamp(),
      });
      return result;
    }
    const leaseUntil = report.artifactGenerationLeaseUntil?.toMillis?.() ?? 0;
    if (report.status === 'generating' && leaseUntil > leaseNow) {
      throw new HttpsError('aborted', 'Los archivos del informe ya se están generando.');
    }
    if (!['draft', 'failed', 'queued', 'generating'].includes(String(report.status))) {
      throw new HttpsError('failed-precondition', 'El snapshot del informe todavía no está listo.');
    }
    transaction.update(reportRef, {
      status: 'generating',
      artifactGenerationLeaseUntil: Timestamp.fromMillis(leaseNow + 9 * 60 * 1000),
      failureCode: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return null;
  });
  if (existingResult) return existingResult;

  const bucket = storage.bucket();
  const pdfFile = bucket.file(pdfPath);
  const pptxFile = bucket.file(pptxPath);
  try {
    const [storedJson] = await bucket.file(jsonPath).download();
    let reportDocument: Record<string, unknown>;
    try {
      const parsed = JSON.parse(storedJson.toString('utf8')) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      reportDocument = parsed as Record<string, unknown>;
    } catch {
      throw new HttpsError('data-loss', 'El snapshot JSON del informe no es válido.');
    }

    const reportSnapshot = await reportRef.get();
    const report = reportSnapshot.data() ?? {};
    if (report.sourceSnapshotHash !== reportDocument.sourceSnapshotHash) {
      throw new HttpsError('data-loss', 'El hash del snapshot no coincide con la versión registrada.');
    }
    const sanitizedReportDocument = normalizeReportValue(reportDocument) as Record<string, unknown>;
    const editorialSource = report.editorial as Record<string, unknown> | undefined;
    const editorial = {
      executiveSummary: typeof editorialSource?.executiveSummary === 'string'
        ? editorialSource.executiveSummary
        : '',
      observations: typeof editorialSource?.observations === 'string'
        ? editorialSource.observations
        : '',
      nextSteps: typeof editorialSource?.nextSteps === 'string'
        ? editorialSource.nextSteps
        : '',
    };
    const source = reportSourceFromSnapshotDocument(sanitizedReportDocument);
    if (source.status !== 'completed') {
      throw new HttpsError('failed-precondition', 'El snapshot corresponde a una partida no finalizada.');
    }
    const dataset = buildReportDataset(source, editorial);
    const deck = buildReportDeck(dataset, REPORT_TEMPLATE_VERSION);
    const assets = await loadReportAssets();
    const [pdfBuffer, pptxBuffer] = await Promise.all([
      renderReportPdf(deck, assets),
      renderReportPptx(deck, assets),
    ]);
    validateGeneratedArtifact(pdfBuffer, 'pdf');
    validateGeneratedArtifact(pptxBuffer, 'pptx');

    const generatedAt = Date.now();
    const auditJson = Buffer.from(JSON.stringify({
      ...sanitizedReportDocument,
      reportDataset: dataset,
      editorial,
      artifactGeneratedAt: new Date(generatedAt).toISOString(),
      pageCount: deck.pages.length,
    }, null, 2), 'utf8');
    if (auditJson.length > REPORT_ARTIFACT_MAX_BYTES) {
      throw new HttpsError('resource-exhausted', 'El JSON de auditoría supera el tamaño permitido.');
    }
    const artifacts = {
      pdf: createReportArtifact(pdfPath, pdfBuffer, 'application/pdf', generatedAt),
      pptx: createReportArtifact(
        pptxPath,
        pptxBuffer,
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        generatedAt,
      ),
      json: createReportArtifact(jsonPath, auditJson, 'application/json', generatedAt),
    };
    const metadataFor = (artifact: typeof artifacts.pdf) => ({
      cacheControl: 'private, no-store, max-age=0',
      metadata: {
        reportStatus: 'draft',
        reportId,
        reportSha256: artifact.sha256,
        reportTemplateVersion: REPORT_TEMPLATE_VERSION,
      },
    });

    await Promise.all([
      bucket.file(jsonPath).save(auditJson, {
        resumable: false,
        contentType: 'application/json; charset=utf-8',
        metadata: metadataFor(artifacts.json),
      }),
      pdfFile.save(pdfBuffer, {
        resumable: false,
        contentType: artifacts.pdf.mimeType,
        metadata: metadataFor(artifacts.pdf),
      }),
      pptxFile.save(pptxBuffer, {
        resumable: false,
        contentType: artifacts.pptx.mimeType,
        metadata: metadataFor(artifacts.pptx),
      }),
    ]);

    const result: GenerateReportArtifactsOutput = {
      workshopId,
      reportId,
      status: 'draft',
      pageCount: deck.pages.length,
      artifacts,
      generatedAt,
    };
    return await db.runTransaction(async (transaction) => {
      const [workshopSnapshot, commandSnapshot, latestReportSnapshot] = await Promise.all([
        options.platformOrganizationId ? Promise.resolve(null) : transaction.get(workshopRef),
        transaction.get(commandRef),
        transaction.get(reportRef),
      ]);
      if (workshopSnapshot) {
        await revalidateWorkshopAdminInTransaction(
          transaction, db, authUid, workshopSnapshot, ADMIN_ROLES,
        );
      }
      if (commandSnapshot.exists) {
        return commandSnapshot.data()?.result as GenerateReportArtifactsOutput;
      }
      if (!latestReportSnapshot.exists || latestReportSnapshot.data()?.status === 'published') {
        throw new HttpsError('failed-precondition', 'La versión dejó de estar disponible durante la generación.');
      }
      transaction.update(reportRef, {
        status: 'draft',
        artifacts,
        pageCount: deck.pages.length,
        datasetVersion: dataset.version,
        artifactGeneratedAt: FieldValue.serverTimestamp(),
        artifactGenerationLeaseUntil: FieldValue.delete(),
        generatedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.create(commandRef, {
        operation: 'generateReportArtifacts',
        result,
        createdAt: FieldValue.serverTimestamp(),
      });
      createAuditEvent(transaction, workshopRef, authUid, 'report.artifacts_generated', {
        reportId,
        pageCount: deck.pages.length,
        pdfSize: pdfBuffer.length,
        pptxSize: pptxBuffer.length,
      });
      return result;
    });
  } catch (error) {
    logger.error('Report artifact generation failed.', {
      workshopIdHash: hashIdentifier(workshopId),
      reportIdHash: hashIdentifier(reportId),
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    await Promise.allSettled([
      pdfFile.delete(),
      pptxFile.delete(),
    ]);
    await reportRef.set({
      status: 'failed',
      failureCode: 'artifact-generation-failed',
      artifactGenerationLeaseUntil: FieldValue.delete(),
      failedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }).catch((reportError) => {
      logger.error('Could not persist artifact generation failure.', {
        workshopIdHash: hashIdentifier(workshopId),
        reportIdHash: hashIdentifier(reportId),
        errorName: reportError instanceof Error ? reportError.name : 'UnknownError',
      });
    });
    throw error;
  }
};

export const generateReportArtifacts = callable<
  GenerateReportArtifactsInput,
  GenerateReportArtifactsOutput
>('generateReportArtifacts', async (request) => {
  requireAdminAuth(request as CallableRequest<unknown>);
  throw new HttpsError(
    'failed-precondition',
    'La generacion directa esta desactivada. Usa la cola de informes.',
  );
}, { timeoutSeconds: 30 });

export const queueReportGeneration = callable<
  QueueReportGenerationInput,
  QueueReportGenerationOutput
>('queueReportGeneration', async (request) => {
  const auth = requireAdminAuth(request as CallableRequest<unknown>);
  const workshopId = validateIdentifier(request.data?.workshopId, 'workshopId');
  const reportId = validateIdentifier(request.data?.reportId, 'reportId');
  const idempotencyKey = validateIdempotencyKey(request.data?.idempotencyKey);
  const { workshopRef, workshop } = await loadWorkshopForAdmin(auth.uid, workshopId);
  if (workshop.status !== 'completed') {
    throw new HttpsError('failed-precondition', 'La partida debe estar finalizada.');
  }
  const commandId = commandDocumentId(auth.uid, idempotencyKey);
  const jobId = 'job-' + commandId;
  const jobRef = workshopRef.collection('reportJobs').doc(jobId);
  const reportRef = workshopRef.collection('reports').doc(reportId);
  const commandRef = workshopRef.collection('commandKeys').doc(commandId);
  const createdAt = Date.now();

  const result = await db.runTransaction(async (transaction) => {
    const [latestWorkshop, reportSnapshot, jobSnapshot, commandSnapshot] = await Promise.all([
      transaction.get(workshopRef),
      transaction.get(reportRef),
      transaction.get(jobRef),
      transaction.get(commandRef),
    ]);
    await revalidateWorkshopAdminInTransaction(
      transaction, db, auth.uid, latestWorkshop, ADMIN_ROLES,
    );
    if (commandSnapshot.exists) {
      return commandSnapshot.data()?.result as QueueReportGenerationOutput;
    }
    if (latestWorkshop.data()?.status !== 'completed') {
      throw new HttpsError('failed-precondition', 'La partida debe estar finalizada.');
    }
    if (!reportSnapshot.exists || reportSnapshot.data()?.workshopId !== workshopId) {
      throw new HttpsError('not-found', 'El informe no existe.');
    }
    if (!['draft', 'failed'].includes(String(reportSnapshot.data()?.status))) {
      throw new HttpsError('failed-precondition', 'El informe no está listo para generar archivos.');
    }
    const activeStatus = latestWorkshop.data()?.activeReportJobStatus;
    const activeJobId = latestWorkshop.data()?.activeReportJobId;
    if (['queued', 'processing'].includes(String(activeStatus)) && activeJobId !== jobId) {
      throw new HttpsError('already-exists', 'Ya hay un informe activo para esta partida.');
    }
    const output: QueueReportGenerationOutput = {
      workshopId,
      reportId,
      jobId,
      status: jobSnapshot.exists
        ? jobSnapshot.data()?.status as ReportJobStatus
        : 'queued',
      createdAt,
    };
    if (!jobSnapshot.exists) {
      transaction.create(jobRef, {
        workshopId,
        reportId,
        status: 'queued' satisfies ReportJobStatus,
        progress: 0,
        attempts: 0,
        requestedBy: auth.uid,
        requestedByHash: hashIdentifier(auth.uid),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        schemaVersion: SCHEMA_VERSION,
      });
    }
    transaction.update(reportRef, {
      status: 'queued',
      activeReportJobId: jobId,
      activeReportJobStatus: 'queued',
      failureCode: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(workshopRef, {
      activeReportJobId: jobId,
      activeReportJobStatus: 'queued',
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(commandRef, {
      operation: 'queueReportGeneration',
      result: output,
      createdAt: FieldValue.serverTimestamp(),
    });
    createAuditEvent(transaction, workshopRef, auth.uid, 'report.jobQueued', {
      reportId,
      jobId,
    });
    return output;
  });

  try {
    await getFunctions()
      .taskQueue('locations/' + SCHEDULE_REGION + '/functions/processReportGeneration')
      .enqueue({ workshopId, jobId });
    await jobRef.set({
      enqueuedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return result;
  } catch (error) {
    logger.error('Could not enqueue report job.', {
      workshopIdHash: hashIdentifier(workshopId),
      jobIdHash: hashIdentifier(jobId),
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorCode: safeOperationalErrorCode(error),
    });
    const batch = db.batch();
    batch.set(jobRef, {
      status: 'failed',
      errorCode: 'queue-unavailable',
      failedAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + REPORT_JOB_RETENTION_MS),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    batch.set(reportRef, {
      status: 'failed',
      activeReportJobId: jobId,
      activeReportJobStatus: 'failed',
      failureCode: 'artifact-queue-unavailable',
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    batch.update(workshopRef, {
      activeReportJobStatus: 'failed',
      updatedAt: FieldValue.serverTimestamp(),
    });
    batch.set(commandRef, {
      result: { ...result, status: 'failed' },
    }, { merge: true });
    await batch.commit();
    throw new HttpsError('unavailable', 'No se pudo encolar el informe. Intentalo de nuevo.');
  }
});

export const getReportJob = callable<GetReportJobInput, GetReportJobOutput>(
  'getReportJob',
  async (request) => {
    const auth = requireAdminAuth(request as CallableRequest<unknown>);
    const workshopId = validateIdentifier(request.data?.workshopId, 'workshopId');
    const jobId = validateIdentifier(request.data?.jobId, 'jobId');
    const { workshopRef } = await loadWorkshopForAdmin(auth.uid, workshopId);
    const snapshot = await workshopRef.collection('reportJobs').doc(jobId).get();
    if (!snapshot.exists) throw new HttpsError('not-found', 'El trabajo de informe no existe.');
    const data = snapshot.data() ?? {};
    const toMillis = (value: unknown) => value instanceof Timestamp ? value.toMillis() : null;
    return {
      workshopId,
      reportId: validateIdentifier(data.reportId, 'reportId'),
      jobId,
      status: data.status as ReportJobStatus,
      attempts: typeof data.attempts === 'number' ? data.attempts : 0,
      progress: typeof data.progress === 'number'
        ? Math.max(0, Math.min(100, data.progress))
        : 0,
      errorCode: typeof data.errorCode === 'string' ? data.errorCode : null,
      createdAt: toMillis(data.createdAt),
      updatedAt: toMillis(data.updatedAt),
      completedAt: toMillis(data.completedAt),
      result: data.status === 'completed'
        ? data.result as GenerateReportArtifactsOutput
        : null,
    };
  },
);

export const processReportGeneration = onTaskDispatched(
  {
    region: SCHEDULE_REGION,
    retryConfig: { maxAttempts: 3, minBackoffSeconds: 15, maxBackoffSeconds: 120 },
    rateLimits: { maxConcurrentDispatches: 2 },
    memory: '1GiB',
    timeoutSeconds: 540,
  },
  async (request) => {
    const workshopId = validateIdentifier(request.data?.workshopId, 'workshopId');
    const jobId = validateIdentifier(request.data?.jobId, 'jobId');
    const workshopRef = db.doc('workshops/' + workshopId);
    const jobRef = workshopRef.collection('reportJobs').doc(jobId);
    const leaseUntil = Date.now() + REPORT_JOB_LEASE_MS;

    const job = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(jobRef);
      if (!snapshot.exists) throw new HttpsError('not-found', 'El trabajo no existe.');
      const data = snapshot.data() ?? {};
      if (data.status === 'completed') return null;
      const attempts = typeof data.attempts === 'number' ? data.attempts : 0;
      if (data.status === 'failed' && attempts >= 3) return null;
      const currentLease = data.leaseUntil;
      if (data.status === 'processing'
        && currentLease instanceof Timestamp
        && currentLease.toMillis() > Date.now()) {
        throw new HttpsError('aborted', 'El trabajo ya esta en proceso.');
      }
      transaction.update(jobRef, {
        status: 'processing',
        progress: 10,
        attempts: attempts + 1,
        leaseUntil: Timestamp.fromMillis(leaseUntil),
        startedAt: data.startedAt ?? FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        errorCode: FieldValue.delete(),
      });
      transaction.update(workshopRef, {
        activeReportJobId: jobId,
        activeReportJobStatus: 'processing',
        updatedAt: FieldValue.serverTimestamp(),
      });
      return {
        reportId: validateIdentifier(data.reportId, 'reportId'),
        requestedBy: validateIdentifier(data.requestedBy, 'requestedBy'),
        requestedByPlatformAdmin: data.requestedByPlatformAdmin === true,
        organizationId: data.requestedByPlatformAdmin === true
          ? validateIdentifier(data.organizationId, 'organizationId')
          : null,
        attempts: attempts + 1,
      };
    });
    if (!job) return;

    try {
      await jobRef.set({ progress: 25, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      const result = await generateReportArtifactsForAdmin(
        job.requestedBy,
        {
          workshopId,
          reportId: job.reportId,
          idempotencyKey: 'report-job-' + jobId,
        },
        job.requestedByPlatformAdmin
          ? { platformOrganizationId: job.organizationId ?? undefined }
          : {},
      );

      const batch = db.batch();
      const reportRef = workshopRef.collection('reports').doc(job.reportId);
      batch.update(jobRef, {
        status: 'completed',
        progress: 100,
        result,
        completedAt: FieldValue.serverTimestamp(),
        expiresAt: Timestamp.fromMillis(Date.now() + REPORT_JOB_RETENTION_MS),
        leaseUntil: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      batch.update(reportRef, {
        status: 'draft',
        activeReportJobId: FieldValue.delete(),
        activeReportJobStatus: 'completed',
        failureCode: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      batch.update(workshopRef, {
        activeReportJobId: FieldValue.delete(),
        activeReportJobStatus: 'completed',
        updatedAt: FieldValue.serverTimestamp(),
      });
      await batch.commit();
    } catch (error) {
      const retryable = job.attempts < 3;
      const errorCode = error instanceof HttpsError ? error.code : 'internal';
      const batch = db.batch();
      const reportRef = workshopRef.collection('reports').doc(job.reportId);
      batch.update(jobRef, {
        status: retryable ? 'queued' : 'failed',
        errorCode,
        leaseUntil: FieldValue.delete(),
        failedAt: retryable ? FieldValue.delete() : FieldValue.serverTimestamp(),
        expiresAt: retryable
          ? FieldValue.delete()
          : Timestamp.fromMillis(Date.now() + REPORT_JOB_RETENTION_MS),
        updatedAt: FieldValue.serverTimestamp(),
      });
      batch.set(reportRef, {
        status: retryable ? 'queued' : 'failed',
        activeReportJobId: jobId,
        activeReportJobStatus: retryable ? 'queued' : 'failed',
        failureCode: retryable ? FieldValue.delete() : 'artifact-generation-failed',
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      batch.update(workshopRef, {
        activeReportJobStatus: retryable ? 'queued' : 'failed',
        updatedAt: FieldValue.serverTimestamp(),
      });
      await batch.commit();
      throw error;
    }
  },
);

export const updateReportEditorial = callable<
  UpdateReportEditorialInput,
  UpdateReportEditorialOutput
>('updateReportEditorial', async (request) => {
  const auth = requireAdminAuth(request as CallableRequest<unknown>);
  const workshopId = validateIdentifier(request.data?.workshopId, 'workshopId');
  const reportId = validateIdentifier(request.data?.reportId, 'reportId');
  const idempotencyKey = validateIdempotencyKey(request.data?.idempotencyKey);
  const editorial = {
    executiveSummary: validateText(
      request.data?.executiveSummary ?? '',
      'executiveSummary',
      { maxLength: MAX_CONTENT_LENGTH },
    ),
    observations: validateText(
      request.data?.observations ?? '',
      'observations',
      { maxLength: MAX_CONTENT_LENGTH },
    ),
    nextSteps: validateText(
      request.data?.nextSteps ?? '',
      'nextSteps',
      { maxLength: MAX_CONTENT_LENGTH },
    ),
  };
  const { workshopRef } = await loadWorkshopForAdmin(auth.uid, workshopId);
  const reportRef = workshopRef.collection('reports').doc(reportId);
  const commandRef = workshopRef.collection('commandKeys').doc(
    commandDocumentId(auth.uid, idempotencyKey),
  );

  return db.runTransaction(async (transaction) => {
    const [workshopSnapshot, commandSnapshot, reportSnapshot] = await Promise.all([
      transaction.get(workshopRef),
      transaction.get(commandRef),
      transaction.get(reportRef),
    ]);
    await revalidateWorkshopAdminInTransaction(
      transaction, db, auth.uid, workshopSnapshot, ADMIN_ROLES,
    );
    if (commandSnapshot.exists) {
      return commandSnapshot.data()?.result as UpdateReportEditorialOutput;
    }
    if (!reportSnapshot.exists) {
      throw new HttpsError('not-found', 'El informe no existe.');
    }
    if (reportSnapshot.data()?.status !== 'draft') {
      throw new HttpsError(
        'failed-precondition',
        'Solo se puede editar el contenido editorial de un borrador.',
      );
    }
    const existingArtifacts = reportSnapshot.data()?.artifacts;
    if (isReportArtifact(existingArtifacts?.pdf) || isReportArtifact(existingArtifacts?.pptx)) {
      throw new HttpsError(
        'failed-precondition',
        'Los archivos de esta versión ya se generaron. Crea una versión nueva para cambiar el anexo editorial.',
      );
    }

    const result: UpdateReportEditorialOutput = {
      workshopId,
      reportId,
      status: 'draft',
      updatedAt: Date.now(),
    };
    transaction.update(reportRef, {
      editorial,
      editorialUpdatedAt: FieldValue.serverTimestamp(),
      editorialUpdatedByHash: hashIdentifier(auth.uid),
    });
    transaction.create(commandRef, {
      operation: 'updateReportEditorial',
      result,
      createdAt: FieldValue.serverTimestamp(),
    });
    createAuditEvent(transaction, workshopRef, auth.uid, 'report.editorial_updated', {
      reportId,
      populatedFields: Object.values(editorial).filter((value) => value.trim()).length,
    });
    return result;
  });
});
export const publishReport = callable<PublishReportInput, PublishReportOutput>(
  'publishReport',
  async (request) => {
    const auth = requireAdminAuth(request as CallableRequest<unknown>);
    const workshopId = validateIdentifier(request.data?.workshopId, 'workshopId');
    const reportId = validateIdentifier(request.data?.reportId, 'reportId');
    const idempotencyKey = validateIdempotencyKey(request.data?.idempotencyKey);
    const { workshopRef, organizationId } = await loadWorkshopForAdmin(auth.uid, workshopId);
    const reportRef = workshopRef.collection('reports').doc(reportId);
    const commandRef = workshopRef.collection('commandKeys').doc(
      commandDocumentId(auth.uid, idempotencyKey),
    );
    const reportSnapshot = await reportRef.get();
    if (!reportSnapshot.exists) throw new HttpsError('not-found', 'El informe no existe.');
    const reportData = reportSnapshot.data() ?? {};
    if (!['draft', 'published'].includes(String(reportData.status))) {
      throw new HttpsError('failed-precondition', 'El informe todavía no está listo.');
    }
    const artifacts = reportData.artifacts as Record<string, unknown> | undefined;
    if (!isReportArtifact(artifacts?.pdf)
      || !isReportArtifact(artifacts?.pptx)
      || !isReportArtifact(artifacts?.json)) {
      throw new HttpsError(
        'failed-precondition',
        'La versión debe tener PDF, PPTX y JSON validados antes de publicarse.',
      );
    }
    const basePath = `organizations/${organizationId}/workshops/${workshopId}/reports/${reportId}`;
    const expectedArtifacts = [
      { artifact: artifacts.json, path: `${basePath}.json`, mimeType: 'application/json' },
      { artifact: artifacts.pdf, path: `${basePath}.pdf`, mimeType: 'application/pdf' },
      {
        artifact: artifacts.pptx,
        path: `${basePath}.pptx`,
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      },
    ];
    expectedArtifacts.forEach(({ artifact, path, mimeType }) => {
      if (artifact.storagePath !== path || artifact.mimeType !== mimeType) {
        throw new HttpsError('data-loss', 'La metadata privada de los artefactos no es válida.');
      }
    });

    const files = expectedArtifacts.map(({ path }) => storage.bucket().file(path));
    const metadata = await Promise.all(files.map(async (file, index) => {
      const [storedMetadata] = await file.getMetadata();
      const expected = expectedArtifacts[index].artifact;
      if (!storedMetadata.contentType?.startsWith(expected.mimeType)
        || Number(storedMetadata.size) !== expected.size
        || storedMetadata.metadata?.reportSha256 !== expected.sha256) {
        throw new HttpsError('data-loss', 'Un artefacto no coincide con su hash o tamaño registrado.');
      }
      return storedMetadata;
    }));

    const setReportStatusMetadata = async (status: 'draft' | 'published') => {
      const results = await Promise.allSettled(files.map((file, index) => file.setMetadata({
        cacheControl: 'private, no-store, max-age=0',
        metadata: {
          ...(metadata[index].metadata ?? {}),
          reportStatus: status,
        },
      })));
      const failure = results.find((result) => result.status === 'rejected');
      if (failure) throw failure.reason;
    };

    try {
      await setReportStatusMetadata('published');
    } catch (error) {
      await Promise.allSettled(files.map((file, index) => file.setMetadata({
        cacheControl: 'private, no-store, max-age=0',
        metadata: {
          ...(metadata[index].metadata ?? {}),
          reportStatus: 'draft',
        },
      })));
      logger.error('Could not publish all report artifacts.', {
        workshopIdHash: hashIdentifier(workshopId),
        reportIdHash: hashIdentifier(reportId),
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      throw new HttpsError('internal', 'No se pudieron publicar todos los archivos del informe.');
    }

    const publishedAt = Date.now();
    try {
      return await db.runTransaction(async (transaction) => {
        const [workshopSnapshot, commandSnapshot, latestReportSnapshot] = await Promise.all([
          transaction.get(workshopRef),
          transaction.get(commandRef),
          transaction.get(reportRef),
        ]);
        await revalidateWorkshopAdminInTransaction(
          transaction, db, auth.uid, workshopSnapshot, ADMIN_ROLES,
        );
        if (commandSnapshot.exists) {
          return commandSnapshot.data()?.result as PublishReportOutput;
        }
        if (!latestReportSnapshot.exists) throw new HttpsError('not-found', 'El informe no existe.');
        const latestData = latestReportSnapshot.data() ?? {};
        if (!['draft', 'published'].includes(String(latestData.status))) {
          throw new HttpsError('failed-precondition', 'El informe todavía no está listo.');
        }
        const publicationResult: PublishReportOutput = {
          workshopId,
          reportId,
          status: 'published',
          publishedAt,
        };
        transaction.update(reportRef, {
          status: 'published',
          publishedAt: FieldValue.serverTimestamp(),
          publishedByHash: hashIdentifier(auth.uid),
          updatedAt: FieldValue.serverTimestamp(),
        });
        transaction.create(commandRef, {
          operation: 'publishReport',
          result: publicationResult,
          createdAt: FieldValue.serverTimestamp(),
        });
        createAuditEvent(transaction, workshopRef, auth.uid, 'report.published', {
          reportId,
          artifactCount: 3,
        });
        return publicationResult;
      });
    } catch (error) {
      const latestReport = await reportRef.get().catch(() => null);
      if (latestReport?.data()?.status !== 'published') {
        await Promise.allSettled(files.map((file, index) => file.setMetadata({
          cacheControl: 'private, no-store, max-age=0',
          metadata: {
            ...(metadata[index].metadata ?? {}),
            reportStatus: 'draft',
          },
        })));
      }
      throw error;
    }
  },
);

export const resetWorkshop = callable<ResetWorkshopInput, WorkshopCommandOutput>(
  'resetWorkshop',
  async (request) => {
    const auth = requireAdminAuth(request as CallableRequest<unknown>);
    const workshopId = validateIdentifier(request.data?.workshopId, 'workshopId');
    const reason = validateCriticalReason(request.data?.reason);
    const idempotencyKey = validateIdempotencyKey(request.data?.idempotencyKey);
    const { workshopRef } = await loadWorkshopForAdmin(auth.uid, workshopId);
    const commandRef = workshopRef.collection('commandKeys').doc(
      commandDocumentId(auth.uid, idempotencyKey),
    );
    const commandState = await db.runTransaction(async (transaction) => {
      const [workshopSnapshot, commandSnapshot] = await Promise.all([
        transaction.get(workshopRef),
        transaction.get(commandRef),
      ]);
      await revalidateWorkshopAdminInTransaction(
        transaction, db, auth.uid, workshopSnapshot, ADMIN_ROLES,
      );
      if (commandSnapshot.exists) {
        const command = commandSnapshot.data() ?? {};
        if (command.operation !== 'resetWorkshop') {
          throw new HttpsError('failed-precondition', 'La clave de idempotencia ya est\u00e1 en uso.');
        }
        return {
          completed: command.status !== 'processing',
          reason: typeof command.reason === 'string' ? command.reason : reason,
          result: command.result as WorkshopCommandOutput,
        };
      }
      if (workshopSnapshot.data()?.status !== 'active') {
        throw new HttpsError('failed-precondition', 'Solo se puede reiniciar una partida activa.');
      }
      const result: WorkshopCommandOutput = { workshopId, updatedAt: Date.now() };
      transaction.create(commandRef, {
        operation: 'resetWorkshop',
        status: 'processing',
        reason,
        result,
        createdAt: FieldValue.serverTimestamp(),
      });
      return { completed: false, reason, result };
    });
    if (commandState.completed) return commandState.result;

    const [sessions, teams] = await Promise.all([
      workshopRef.collection('participantSessions').get(),
      workshopRef.collection('teams').get(),
    ]);
    const batches: Array<ReturnType<typeof db.batch>> = [];
    let batch = db.batch();
    let operations = 0;
    for (const session of sessions.docs) {
      if (operations === 450) {
        batches.push(batch);
        batch = db.batch();
        operations = 0;
      }
      batch.update(session.ref, {
        team: null,
        reassignedAt: FieldValue.serverTimestamp(),
      });
      operations += 1;
    }
    for (const team of teams.docs) {
      if (operations === 450) {
        batches.push(batch);
        batch = db.batch();
        operations = 0;
      }
      batch.set(team.ref, {
        activeParticipantId: FieldValue.delete(),
        activeParticipantHash: FieldValue.delete(),
        activeDeviceExpiresAt: FieldValue.delete(),
        transitionAckId: FieldValue.delete(),
        releasedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      operations += 1;
    }
    batch.update(workshopRef, {
      selectionResetAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    batches.push(batch);
    await Promise.all(batches.map((item) => item.commit()));

    await db.runTransaction(async (transaction) => {
      const commandSnapshot = await transaction.get(commandRef);
      const command = commandSnapshot.data();
      if (!commandSnapshot.exists || command?.operation !== 'resetWorkshop') {
        throw new HttpsError('data-loss', 'No se pudo completar el reinicio autorizado.');
      }
      if (command.status === 'completed') return;
      transaction.update(commandRef, {
        status: 'completed',
        completedAt: FieldValue.serverTimestamp(),
      });
      createAuditEvent(transaction, workshopRef, auth.uid, 'workshop.selectionReset', {
        reason: commandState.reason,
      });
    });
    return commandState.result;
  },
);

export const deleteWorkshop = callable<DeleteWorkshopInput, WorkshopCommandOutput>(
  'deleteWorkshop',
  async (request) => {
    const auth = requireAdminAuth(request as CallableRequest<unknown>);
    const workshopId = validateIdentifier(request.data?.workshopId, 'workshopId');
    const reason = validateCriticalReason(request.data?.reason);
    const idempotencyKey = validateIdempotencyKey(request.data?.idempotencyKey);
    const { workshopRef } = await loadWorkshopForAdmin(auth.uid, workshopId, ['owner']);
    const commandRef = workshopRef.collection('commandKeys').doc(
      commandDocumentId(auth.uid, idempotencyKey),
    );
    const now = Date.now();

    return db.runTransaction(async (transaction) => {
      const [snapshot, commandSnapshot] = await Promise.all([
        transaction.get(workshopRef),
        transaction.get(commandRef),
      ]);
      await revalidateWorkshopAdminInTransaction(
        transaction, db, auth.uid, snapshot, ['owner'],
      );
      if (commandSnapshot.exists) {
        return commandSnapshot.data()?.result as WorkshopCommandOutput;
      }
      const workshop = snapshot.data() as WorkshopRecord | undefined;
      if (!snapshot.exists) throw new HttpsError('not-found', 'La partida no existe.');
      if (workshop?.status === 'pendingDeletion') {
        throw new HttpsError('failed-precondition', 'La partida ya estÃ¡ en la papelera.');
      }
      const result: WorkshopCommandOutput = { workshopId, updatedAt: now };
      const previousStatus = typeof workshop?.status === 'string' ? workshop.status : 'archived';
      transaction.update(workshopRef, {
        status: 'pendingDeletion',
        statusBeforeDeletion: previousStatus,
        pendingDeletionAt: FieldValue.serverTimestamp(),
        hardDeleteAt: Timestamp.fromMillis(now + PENDING_DELETION_GRACE_MS),
        deletionReason: reason,
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (typeof workshop?.roomCode === 'string') {
        transaction.delete(db.doc('activeRoomCodes/' + workshop.roomCode));
      }
      createAuditEvent(transaction, workshopRef, auth.uid, 'workshop.deleted', {
        previousStatus,
        reason,
      });
      transaction.create(commandRef, {
        operation: 'deleteWorkshop',
        result,
        createdAt: FieldValue.serverTimestamp(),
      });
      return result;
    });
  },
);

export const restoreWorkshop = callable<RestoreWorkshopInput, WorkshopCommandOutput>(
  'restoreWorkshop',
  async (request) => {
    const auth = requireAdminAuth(request as CallableRequest<unknown>);
    const workshopId = validateIdentifier(request.data?.workshopId, 'workshopId');
    const reason = validateCriticalReason(request.data?.reason);
    const idempotencyKey = validateIdempotencyKey(request.data?.idempotencyKey);
    const { workshopRef } = await loadWorkshopForAdmin(auth.uid, workshopId, ['owner']);
    const commandRef = workshopRef.collection('commandKeys').doc(
      commandDocumentId(auth.uid, idempotencyKey),
    );
    const now = Date.now();
    return db.runTransaction(async (transaction) => {
      const [snapshot, commandSnapshot] = await Promise.all([
        transaction.get(workshopRef),
        transaction.get(commandRef),
      ]);
      await revalidateWorkshopAdminInTransaction(
        transaction, db, auth.uid, snapshot, ['owner'],
      );
      if (commandSnapshot.exists) {
        return commandSnapshot.data()?.result as WorkshopCommandOutput;
      }
      if (!snapshot.exists) throw new HttpsError('not-found', 'La partida no existe.');
      const workshop = snapshot.data() as WorkshopRecord & { statusBeforeDeletion?: unknown };
      if (workshop.status !== 'pendingDeletion') {
        throw new HttpsError('failed-precondition', 'La partida no estÃ¡ en la papelera.');
      }
      const requestedPrevious = typeof workshop.statusBeforeDeletion === 'string'
        ? workshop.statusBeforeDeletion
        : 'archived';
      const restoredStatus = requestedPrevious === 'completed' ? 'completed' : 'archived';
      const result: WorkshopCommandOutput = { workshopId, updatedAt: now };
      transaction.update(workshopRef, {
        status: restoredStatus,
        restoredAt: FieldValue.serverTimestamp(),
        restorationReason: reason,
        statusBeforeDeletion: FieldValue.delete(),
        pendingDeletionAt: FieldValue.delete(),
        hardDeleteAt: FieldValue.delete(),
        deletionReason: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.create(commandRef, {
        operation: 'restoreWorkshop',
        result,
        createdAt: FieldValue.serverTimestamp(),
      });
      createAuditEvent(transaction, workshopRef, auth.uid, 'workshop.restored', {
        restoredStatus,
        reason,
      });
      return result;
    });
  },
);

const updateWorkshopSummary = async (
  workshopId: string,
  eventId: string,
  field: 'attacksCount' | 'teamsCount',
  delta: 1 | -1,
) => {
  const workshopRef = db.doc('workshops/' + workshopId);
  const eventRef = workshopRef.collection('summaryEvents').doc(eventId);

  await db.runTransaction(async (transaction) => {
    const [eventSnapshot, workshopSnapshot] = await Promise.all([
      transaction.get(eventRef),
      transaction.get(workshopRef),
    ]);
    if (eventSnapshot.exists || !workshopSnapshot.exists) return;

    const summary = workshopSnapshot.data()?.summary;
    const currentValue = summary && typeof summary[field] === 'number'
      ? summary[field] as number
      : 0;
    transaction.update(workshopRef, {
      ['summary.' + field]: Math.max(0, currentValue + delta),
      'summary.updatedAt': FieldValue.serverTimestamp(),
    });
    transaction.create(eventRef, {
      field,
      delta,
      processedAt: FieldValue.serverTimestamp(),
      schemaVersion: SCHEMA_VERSION,
    });
  });
};

export const countWorkshopAttackCreated = onDocumentCreated(
  { region: REGION, document: 'workshops/{workshopId}/attacks/{attackId}' },
  (event) => updateWorkshopSummary(event.params.workshopId, event.id, 'attacksCount', 1),
);

export const countWorkshopAttackDeleted = onDocumentDeleted(
  { region: REGION, document: 'workshops/{workshopId}/attacks/{attackId}' },
  (event) => updateWorkshopSummary(event.params.workshopId, event.id, 'attacksCount', -1),
);

export const countWorkshopTeamCreated = onDocumentCreated(
  { region: REGION, document: 'workshops/{workshopId}/teams/{teamName}' },
  (event) => updateWorkshopSummary(event.params.workshopId, event.id, 'teamsCount', 1),
);

export const countWorkshopTeamDeleted = onDocumentDeleted(
  { region: REGION, document: 'workshops/{workshopId}/teams/{teamName}' },
  (event) => updateWorkshopSummary(event.params.workshopId, event.id, 'teamsCount', -1),
);
export const markExpiredWorkshopsNow = async (now = Timestamp.now()) => {
  const expired = await db.collection('workshops')
    .where('status', 'in', ['completed', 'archived'])
    .where('retentionDeleteAt', '<=', now)
    .limit(100)
    .get();

  if (expired.empty) return 0;
  const batch = db.batch();
  for (const workshop of expired.docs) {
    batch.update(workshop.ref, {
      status: 'pendingDeletion',
      pendingDeletionAt: FieldValue.serverTimestamp(),
      hardDeleteAt: Timestamp.fromMillis(now.toMillis() + PENDING_DELETION_GRACE_MS),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
  logger.info('Workshops marked for deletion.', { count: expired.size });
  return expired.size;
};

export const markExpiredWorkshops = onSchedule(
  { region: SCHEDULE_REGION, schedule: 'every day 02:00', timeZone: 'Europe/Madrid' },
  async () => {
    await markExpiredWorkshopsNow();
  },
);

export const hardDeleteExpiredWorkshopsNow = async (now = Timestamp.now()) => {
  const pending = await db.collection('workshops')
    .where('status', '==', 'pendingDeletion')
    .where('hardDeleteAt', '<=', now)
    .limit(25)
    .get();
  if (pending.empty) return 0;

  const failedWorkshopHashes: string[] = [];
  let deletedCount = 0;
  for (const workshop of pending.docs) {
    const organizationId = workshop.data().organizationId;
    const workshopHash = hashIdentifier(workshop.id);
    if (typeof organizationId !== 'string') {
      logger.error('Pending deletion workshop lacks an organization.', { workshopHash });
      failedWorkshopHashes.push(workshopHash);
      continue;
    }

    try {
      const reportPrefix = 'organizations/' + organizationId + '/workshops/'
        + workshop.id + '/reports/';
      await storage.bucket().deleteFiles({ prefix: reportPrefix });
      await db.recursiveDelete(workshop.ref);
      await db.collection('retentionDeletionEvents').add({
        organizationId,
        workshopHash,
        deletedAt: FieldValue.serverTimestamp(),
        schemaVersion: SCHEMA_VERSION,
      });
      deletedCount += 1;
      logger.info('Workshop hard-deleted after retention grace period.', {
        organizationIdHash: hashIdentifier(organizationId),
        workshopHash,
      });
    } catch (error) {
      failedWorkshopHashes.push(workshopHash);
      logger.error('Workshop hard deletion failed.', {
        organizationIdHash: hashIdentifier(organizationId),
        workshopHash,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }

  if (failedWorkshopHashes.length > 0) {
    throw new Error(
      'Hard deletion failed for ' + failedWorkshopHashes.length + ' workshop(s).',
    );
  }
  return deletedCount;
};

export const hardDeleteExpiredWorkshops = onSchedule(
  {
    schedule: 'every day 03:00',
    region: SCHEDULE_REGION,
    timeZone: 'Europe/Madrid',
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => {
    await hardDeleteExpiredWorkshopsNow();
  },
);
