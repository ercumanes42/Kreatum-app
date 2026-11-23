import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { getAuth, type UserRecord } from 'firebase-admin/auth';
import {
  FieldValue,
  Timestamp,
  getFirestore,
  type Query,
  type QueryDocumentSnapshot,
  type Transaction,
} from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import {
  HttpsError,
  onCall,
  type CallableRequest,
} from 'firebase-functions/v2/https';
import {
  type AcceptInvitationInput,
  type AcceptInvitationOutput,
  type AuditCursor,
  type AuditEventSummary,
  type AuditTargetType,
  type ChangeMemberRoleInput,
  type ChangeMemberStatusInput,
  type GetInvitationActivationInput,
  type GetInvitationActivationOutput,
  type GetOrganizationAuditOverviewInput,
  type GetOrganizationAuditOverviewOutput,
  type InvitationCommandInput,
  type InvitationCommandOutput,
  type InvitationStatus,
  type InviteMemberInput,
  type ListOrganizationAuditInput,
  type ListOrganizationAuditOutput,
  type ListTeamAccessInput,
  type ListTeamAccessOutput,
  type MemberCommandOutput,
  type MemberStatus,
  type OrganizationAuditFilters,
  type TeamInvitationSummary,
  type TeamMemberSummary,
  type VerifyInvitationCodeInput,
  type VerifyInvitationCodeOutput,
} from '../../../shared/contracts.js';
import {
  DEFAULT_AUDIT_PERIOD_DAYS,
  MAX_AUDIT_OVERVIEW_EVENTS,
  auditPeriodStartMillis,
  auditEventMatchesFilters,
  buildOrganizationAuditOverview,
  isAuditPeriodDays,
} from '../../../shared/audit.js';
import {
  ACCESS_SCHEMA_VERSION,
  INVITATION_ACTIVATION_TTL_MS,
  INVITATION_CODE_TTL_MS,
  INVITATION_MAX_ATTEMPTS,
  INVITATION_MAX_RESENDS_PER_HOUR,
  MINIMUM_ACTIVE_OWNERS,
  canResendInvitation,
  generateInvitationCode,
  hasAllowedEmailDomain,
  hashActivationToken,
  hashInvitationCode,
  invitationAuthErrorCode,
  invitationDocumentId,
  isInvitationTokenSigningConfigurationError,
  isInvitationExpired,
  isOrganizationRole,
  maskEmail,
  nextAttemptCount,
  normalizeEmail,
  recentResendTimestamps,
  sanitizeAuditState,
  sanitizePersonName,
  sanitizeReason,
  secureHashEquals,
  wouldRemoveLastOwner,
} from './accessSecurity.js';
import {
  brevoErrorCode,
  brevoMessageId,
  buildBrevoInvitationEmailPayload,
  parseEmailSender,
} from './brevoEmail.js';
import { assertOrganizationOperational } from '../security/organizationAccess.js';
import { revalidateOrganizationOwnerInTransaction } from '../security/organizationOwnerAuthorization.js';
import {
  activatePendingOrganizationForAcceptedInvitation,
} from '../platform/platformOrganizationCommands.js';
import { assertLegalAcceptance, readLegalConfiguration } from './legalConfiguration.js';
import { RUNTIME_SERVICE_ACCOUNT } from '../runtimeOptions.js';

const REGION = process.env.KREATUM_FUNCTIONS_REGION?.trim() || 'europe-west1';
const ENFORCE_APP_CHECK = process.env.KREATUM_ENFORCE_APP_CHECK === 'true';
const SECRET_NAMES = ['INVITATION_CODE_PEPPER', 'BREVO_API_KEY'];
const CODE_SECRET = ['INVITATION_CODE_PEPPER'];
const ACTIVE_INVITATION_STATUSES: InvitationStatus[] = [
  'pending',
  'deliveryFailed',
  'verificationInProgress',
  'verified',
];

type AuthContext = NonNullable<CallableRequest<unknown>['auth']>;
type AuditState = Record<string, string | number | boolean | null> | null;

interface Actor {
  uid: string;
  email: string;
  name: string;
}

interface OrganizationPolicy {
  name: string;
  allowedEmailDomains: string[];
  minimumActiveOwners: number;
}

const hashIdentifier = (value: string) =>
  createHash('sha256').update(value).digest('hex').slice(0, 24);

const commandDocumentId = (uid: string, idempotencyKey: string) =>
  hashIdentifier(`${uid}:${idempotencyKey}`);

const validateIdentifier = (value: unknown, field: string) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{3,128}$/.test(value)) {
    throw new HttpsError('invalid-argument', `${field} no es válido.`);
  }
  return value;
};

const validateIdempotencyKey = (value: unknown) => {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) {
    throw new HttpsError('invalid-argument', 'La clave de idempotencia no es válida.');
  }
  return value;
};

const validateEmail = (value: unknown) => {
  if (typeof value !== 'string') throw new HttpsError('invalid-argument', 'El correo no es válido.');
  const email = normalizeEmail(value);
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(email)) {
    throw new HttpsError('invalid-argument', 'El correo no es válido.');
  }
  return email;
};

const requireReason = (value: unknown) => {
  const reason = sanitizeReason(value);
  if (reason.length < 4) {
    throw new HttpsError('invalid-argument', 'Indica un motivo de al menos 4 caracteres.');
  }
  return reason;
};

const requireAdminAuth = (request: CallableRequest<unknown>): AuthContext => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Debes iniciar una sesión válida.');
  const firebaseToken = request.auth.token.firebase as { sign_in_provider?: unknown } | undefined;
  if (firebaseToken?.sign_in_provider === 'anonymous') {
    throw new HttpsError('permission-denied', 'Esta operación requiere una cuenta administrativa.');
  }
  return request.auth;
};

const getPepper = () => {
  const configured = process.env.INVITATION_CODE_PEPPER?.trim();
  if (configured && configured.length >= 32) return configured;
  if (process.env.FUNCTIONS_EMULATOR === 'true') return 'kreatum-emulator-pepper-not-for-production';
  throw new HttpsError('failed-precondition', 'El servicio de invitaciones no está configurado.');
};

const invitationCode = () => {
  const configured = process.env.KREATUM_INVITATION_TEST_CODE?.trim();
  if (process.env.FUNCTIONS_EMULATOR === 'true' && configured && /^\d{6}$/.test(configured)) {
    return configured;
  }
  return generateInvitationCode();
};

const createInvitationCustomToken = async (
  uid: string,
  organizationId: string,
  correlationId: string,
) => {
  try {
    return await getAuth().createCustomToken(uid, {
      organizationId,
      invitationActivation: true,
    });
  } catch (error) {
    const errorCode = invitationAuthErrorCode(error);
    const isSigningConfigurationError = isInvitationTokenSigningConfigurationError(error);
    logger.error('Invitation activation token creation failed.', {
      operation: 'verifyInvitationCode',
      correlationId,
      category: isSigningConfigurationError
        ? 'token-signing-configuration'
        : 'auth-token-creation',
      ...(errorCode ? { errorCode } : {}),
    });
    if (isSigningConfigurationError) {
      throw new HttpsError(
        'failed-precondition',
        'El servicio de activación no está configurado.',
        { reason: 'invitation-token-signing' },
      );
    }
    throw error;
  }
};

const timestampMillis = (value: unknown): number | null => {
  if (value instanceof Timestamp) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
};

const AUDIT_TARGET_TYPES: AuditTargetType[] = [
  'workshop',
  'member',
  'invitation',
  'report',
  'organization',
];
const AUDIT_PAGE_BATCH_SIZE = 250;

const validateAuditFilters = (value: unknown): OrganizationAuditFilters => {
  const data = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
  const periodDays = data.periodDays === undefined
    ? DEFAULT_AUDIT_PERIOD_DAYS
    : data.periodDays;
  if (!isAuditPeriodDays(periodDays)) {
    throw new HttpsError('invalid-argument', 'El periodo de actividad no es válido.');
  }
  const actorEmail = data.actorEmail === undefined || data.actorEmail === ''
    ? undefined
    : validateEmail(data.actorEmail);
  const action = typeof data.action === 'string' ? data.action.trim() : '';
  if (action.length > 120 || (action && !/^[A-Za-z][A-Za-z0-9.]+$/.test(action))) {
    throw new HttpsError('invalid-argument', 'La acción de actividad no es válida.');
  }
  const targetType = data.targetType === undefined || data.targetType === ''
    ? undefined
    : data.targetType;
  if (targetType !== undefined && !AUDIT_TARGET_TYPES.includes(targetType as AuditTargetType)) {
    throw new HttpsError('invalid-argument', 'El tipo de objetivo no es válido.');
  }
  const search = typeof data.search === 'string'
    ? data.search.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim()
    : '';
  if (search.length > 120) {
    throw new HttpsError('invalid-argument', 'La búsqueda es demasiado larga.');
  }
  return {
    periodDays,
    ...(actorEmail ? { actorEmail } : {}),
    ...(action ? { action } : {}),
    ...(targetType ? { targetType: targetType as AuditTargetType } : {}),
    ...(search ? { search } : {}),
  };
};

const validateAuditCursor = (value: unknown): AuditCursor | null => {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object') {
    throw new HttpsError('invalid-argument', 'El cursor de actividad no es válido.');
  }
  const data = value as Record<string, unknown>;
  const createdAt = typeof data.createdAt === 'number' ? data.createdAt : Number.NaN;
  if (!Number.isFinite(createdAt) || createdAt <= 0) {
    throw new HttpsError('invalid-argument', 'El cursor de actividad no es válido.');
  }
  return {
    createdAt,
    id: validateIdentifier(data.id, 'cursor.id'),
  };
};

const auditEventFromSnapshot = (
  item: QueryDocumentSnapshot,
): AuditEventSummary => {
  const data = item.data();
  return {
    id: item.id,
    action: typeof data.action === 'string' ? data.action.slice(0, 120) : 'unknown',
    actorEmail: normalizeEmail(String(data.actorEmail ?? '')),
    actorName: sanitizePersonName(data.actorName),
    targetType: AUDIT_TARGET_TYPES.includes(data.targetType as AuditTargetType)
      ? data.targetType as AuditTargetType
      : 'organization',
    targetId: typeof data.targetId === 'string' ? data.targetId.slice(0, 128) : '',
    previousState: sanitizeAuditState(data.previousState),
    newState: sanitizeAuditState(data.newState),
    reason: sanitizeReason(data.reason) || null,
    createdAt: timestampMillis(data.createdAt),
  };
};

const auditQueryForPeriod = (
  organizationId: string,
  filters: OrganizationAuditFilters,
  now = Date.now(),
): Query => getFirestore()
  .collection(`organizations/${organizationId}/auditEvents`)
  .where(
    'createdAt',
    '>=',
    Timestamp.fromMillis(auditPeriodStartMillis(
      filters.periodDays ?? DEFAULT_AUDIT_PERIOD_DAYS,
      now,
    )),
  )
  .orderBy('createdAt', 'desc');

const callable = <Input, Output>(
  name: string,
  handler: (request: CallableRequest<Input>, correlationId: string) => Promise<Output>,
  secrets: string[] = [],
) => onCall<Input>({
  region: REGION,
  serviceAccount: RUNTIME_SERVICE_ACCOUNT,
  enforceAppCheck: ENFORCE_APP_CHECK,
  maxInstances: 30,
  memory: '256MiB',
  timeoutSeconds: 60,
  secrets,
}, async (request): Promise<Output> => {
  const correlationId = randomUUID();
  if (!request.app) logger.warn('Access callable request without App Check token.', { operation: name, correlationId });
  try {
    return await handler(request, correlationId);
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    logger.error('Unhandled access callable error.', {
      operation: name,
      correlationId,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    throw new HttpsError('internal', `No se pudo completar la operación. Referencia: ${correlationId}`);
  }
});

const loadOrganizationPolicy = async (
  organizationId: string,
  allowPending = false,
  pendingInvitationId?: string,
): Promise<OrganizationPolicy> => {
  const snapshot = await getFirestore().doc(`organizations/${organizationId}`).get();
  if (!snapshot.exists) {
    throw new HttpsError('not-found', 'La organización no está disponible.');
  }
  assertOrganizationOperational(snapshot, { allowPending });
  const data = snapshot.data() ?? {};
  if (data.status === 'pending' && (!pendingInvitationId || data.initialFacilitatorInvitationId !== pendingInvitationId)) {
    throw new HttpsError('not-found', 'La invitacion no esta disponible.');
  }

  const domains = Array.isArray(data.allowedEmailDomains)
    ? data.allowedEmailDomains.filter((item): item is string => typeof item === 'string')
    : [];
  return {
    name: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : 'KREATUM',
    allowedEmailDomains: domains.length > 0 ? domains : ['gfs.es'],
    minimumActiveOwners: typeof data.minimumActiveOwners === 'number'
      ? Math.max(MINIMUM_ACTIVE_OWNERS, Math.floor(data.minimumActiveOwners))
      : MINIMUM_ACTIVE_OWNERS,
  };
};

const loadOwner = async (auth: AuthContext, organizationId: string): Promise<Actor> => {
  const database = getFirestore();
  const organizationRef = database.doc(`organizations/${organizationId}`);
  const membershipRef = organizationRef.collection('members').doc(auth.uid);
  const [organization, snapshot] = await database.getAll(organizationRef, membershipRef);
  const data = snapshot.data() ?? {};
  if (!snapshot.exists || data.status !== 'active' || data.role !== 'owner') {
    throw new HttpsError('permission-denied', 'Solo un Administrador puede gestionar accesos.');
  }
  assertOrganizationOperational(organization);
  const firstName = sanitizePersonName(data.firstName);
  const lastName = sanitizePersonName(data.lastName);
  return {
    uid: auth.uid,
    email: normalizeEmail(typeof auth.token.email === 'string' ? auth.token.email : String(data.email ?? '')),
    name: `${firstName} ${lastName}`.trim(),
  };
};

const writeAudit = (
  transaction: Transaction,
  organizationId: string,
  actor: Actor,
  action: string,
  targetType: AuditTargetType,
  targetId: string,
  previousState: AuditState,
  newState: AuditState,
  reason: string | null,
) => {
  const ref = getFirestore().collection(`organizations/${organizationId}/auditEvents`).doc();
  transaction.create(ref, {
    action,
    actorId: actor.uid,
    actorEmail: actor.email,
    actorName: actor.name,
    targetType,
    targetId,
    previousState: sanitizeAuditState(previousState),
    newState: sanitizeAuditState(newState),
    reason: reason ? sanitizeReason(reason) : null,
    createdAt: FieldValue.serverTimestamp(),
    schemaVersion: ACCESS_SCHEMA_VERSION,
  });
};

const activeOwnerQuery = (organizationId: string) => getFirestore()
  .collection(`organizations/${organizationId}/members`)
  .where('role', '==', 'owner')
  .where('status', '==', 'active');

const buildActivationUrl = (organizationId: string, invitationId: string) => {
  const baseUrl = process.env.KREATUM_APP_BASE_URL?.trim();
  if (!baseUrl) throw new HttpsError('failed-precondition', 'Falta configurar KREATUM_APP_BASE_URL.');
  const url = new URL('/activar', baseUrl);
  url.searchParams.set('organizationId', organizationId);
  url.searchParams.set('invitationId', invitationId);
  return url.toString();
};

const sendInvitationEmail = async (input: {
  organizationId: string;
  invitationId: string;
  organizationName: string;
  invitedBy: string;
  email: string;
  code: string;
  idempotencyKey: string;
}) => {
  if (
    process.env.FUNCTIONS_EMULATOR === 'true'
    && process.env.KREATUM_EMAIL_DELIVERY_MODE === 'suppressed'
  ) return { id: 'suppressed' };

  const apiKey = process.env.BREVO_API_KEY?.trim();
  if (!apiKey) throw new HttpsError('failed-precondition', 'Falta configurar BREVO_API_KEY.');
  const activationUrl = buildActivationUrl(input.organizationId, input.invitationId);
  const sender = parseEmailSender(process.env.KREATUM_ACCESS_EMAIL_FROM);
  if (!sender) throw new HttpsError('failed-precondition', 'KREATUM_ACCESS_EMAIL_FROM no es válido.');
  const expiryMinutes = Math.floor(INVITATION_CODE_TTL_MS / 60_000);
  const payload = buildBrevoInvitationEmailPayload({
    organizationName: input.organizationName,
    invitedBy: input.invitedBy,
    email: input.email,
    code: input.code,
    activationUrl,
    expiryMinutes,
    idempotencyKey: input.idempotencyKey,
    senderName: sender.name,
    senderEmail: sender.email,
    replyToEmail: process.env.KREATUM_ACCESS_EMAIL_REPLY_TO,
  });
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'api-key': apiKey,
      'Content-Type': 'application/json',
      'User-Agent': 'KREATUM-Access/1.0',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const providerError: unknown = await response.json().catch(() => null);
    logger.error('Brevo invitation request rejected.', {
      status: response.status,
      providerCode: brevoErrorCode(providerError) ?? 'unknown',
    });
    throw new HttpsError('unavailable', 'No se pudo entregar la invitación. Puedes reenviarla.');
  }
  const messageId = brevoMessageId(await response.json());
  if (!messageId) throw new HttpsError('unavailable', 'Brevo no confirmó la entrega.');
  return { id: messageId };
};

const updateDelivery = async (
  invitationPath: string,
  expectedRevision: string,
  status: 'sent' | 'failed',
  providerId?: string,
) => {
  await getFirestore().runTransaction(async (transaction) => {
    const ref = getFirestore().doc(invitationPath);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists || snapshot.data()?.codeRevision !== expectedRevision) return;
    transaction.update(ref, {
      deliveryStatus: status,
      status: status === 'failed' ? 'deliveryFailed' : 'pending',
      ...(providerId ? { providerMessageIdHash: hashIdentifier(providerId) } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
};

const authUsersById = async (uids: string[]) => {
  const result = new Map<string, UserRecord>();
  for (let index = 0; index < uids.length; index += 100) {
    const users = await getAuth().getUsers(uids.slice(index, index + 100).map((uid) => ({ uid })));
    for (const user of users.users) result.set(user.uid, user);
  }
  return result;
};

export const listTeamAccess = callable<ListTeamAccessInput, ListTeamAccessOutput>(
  'listTeamAccess',
  async (request) => {
    const auth = requireAdminAuth(request as CallableRequest<unknown>);
    const organizationId = validateIdentifier(request.data?.organizationId, 'organizationId');
    await loadOwner(auth, organizationId);
    const policy = await loadOrganizationPolicy(organizationId);
    const [membersSnapshot, invitationsSnapshot] = await Promise.all([
      getFirestore().collection(`organizations/${organizationId}/members`).limit(500).get(),
      getFirestore().collection(`organizations/${organizationId}/invitations`).limit(500).get(),
    ]);
    const authUsers = await authUsersById(membersSnapshot.docs.map((item) => item.id));
    const members: TeamMemberSummary[] = membersSnapshot.docs.flatMap((item) => {
      const data = item.data();
      if (!isOrganizationRole(data.role) || !['active', 'disabled'].includes(String(data.status))) return [];
      const user = authUsers.get(item.id);
      return [{
        uid: item.id,
        email: normalizeEmail(user?.email ?? String(data.email ?? '')),
        firstName: sanitizePersonName(data.firstName),
        lastName: sanitizePersonName(data.lastName),
        role: data.role,
        status: data.status as MemberStatus,
        createdAt: timestampMillis(data.createdAt) ?? (user?.metadata.creationTime ? Date.parse(user.metadata.creationTime) : null),
        updatedAt: timestampMillis(data.updatedAt),
        lastLoginAt: user?.metadata.lastSignInTime ? Date.parse(user.metadata.lastSignInTime) : null,
        currentUser: item.id === auth.uid,
      }];
    });
    members.sort((left, right) => Number(right.currentUser) - Number(left.currentUser)
      || left.email.localeCompare(right.email));
    const now = Date.now();
    const invitations: TeamInvitationSummary[] = invitationsSnapshot.docs.flatMap((item) => {
      const data = item.data();
      if (!isOrganizationRole(data.role) || !ACTIVE_INVITATION_STATUSES.includes(data.status)) return [];
      const resendValues = Array.isArray(data.resendTimestamps)
        ? data.resendTimestamps.map(timestampMillis).filter((value): value is number => value !== null)
        : [];
      return [{
        id: item.id,
        email: normalizeEmail(String(data.email ?? '')),
        role: data.role,
        status: data.status,
        invitedByEmail: normalizeEmail(String(data.invitedByEmail ?? '')),
        createdAt: timestampMillis(data.createdAt),
        expiresAt: timestampMillis(data.expiresAt),
        resendCountLastHour: recentResendTimestamps(resendValues, now).length,
      }];
    });
    return {
      organizationId,
      minimumActiveOwners: policy.minimumActiveOwners,
      activeOwnerCount: members.filter((item) => item.role === 'owner' && item.status === 'active').length,
      members,
      invitations,
    };
  },
);

export const inviteMember = callable<InviteMemberInput, InvitationCommandOutput>(
  'inviteMember',
  async (request) => {
    const auth = requireAdminAuth(request as CallableRequest<unknown>);
    const organizationId = validateIdentifier(request.data?.organizationId, 'organizationId');
    const email = validateEmail(request.data?.email);
    if (!isOrganizationRole(request.data?.role)) throw new HttpsError('invalid-argument', 'El rol no es válido.');
    const role = request.data.role;
    const idempotencyKey = validateIdempotencyKey(request.data?.idempotencyKey);
    const actor = await loadOwner(auth, organizationId);
    const policy = await loadOrganizationPolicy(organizationId);
    if (!hasAllowedEmailDomain(email, policy.allowedEmailDomains)) {
      throw new HttpsError('invalid-argument', `Solo se permiten correos de ${policy.allowedEmailDomains.join(', ')}.`);
    }
    const pepper = getPepper();
    const invitationId = invitationDocumentId(email, pepper);
    const invitationPath = `organizations/${organizationId}/invitations/${invitationId}`;
    const code = invitationCode();
    const codeRevision = randomUUID();
    const now = Date.now();
    const result: InvitationCommandOutput = { invitationId, status: 'pending', updatedAt: now };
    const commandRef = getFirestore().doc(`organizations/${organizationId}/commandKeys/${commandDocumentId(auth.uid, idempotencyKey)}`);
    const transactionResult = await getFirestore().runTransaction(async (transaction) => {
      await revalidateOrganizationOwnerInTransaction(transaction, getFirestore(), auth.uid, organizationId);
      const invitationRef = getFirestore().doc(invitationPath);
      const memberQuery = getFirestore().collection(`organizations/${organizationId}/members`).where('email', '==', email).limit(1);
      const [commandSnapshot, invitationSnapshot, memberSnapshot] = await Promise.all([
        transaction.get(commandRef),
        transaction.get(invitationRef),
        transaction.get(memberQuery),
      ]);
      if (commandSnapshot.exists) return { result: commandSnapshot.data()?.result as InvitationCommandOutput, shouldSend: false };
      if (!memberSnapshot.empty) throw new HttpsError('already-exists', 'La cuenta ya pertenece al equipo.');
      const currentStatus = invitationSnapshot.data()?.status as InvitationStatus | undefined;
      if (currentStatus && ACTIVE_INVITATION_STATUSES.includes(currentStatus)) {
        throw new HttpsError('already-exists', 'Ya existe una invitación pendiente para este correo.');
      }
      transaction.set(invitationRef, {
        email,
        normalizedEmail: email,
        role,
        status: 'pending',
        codeHash: hashInvitationCode(code, pepper, invitationId),
        codeRevision,
        attemptCount: 0,
        resendTimestamps: [],
        expiresAt: Timestamp.fromMillis(now + INVITATION_CODE_TTL_MS),
        invitedBy: actor.uid,
        invitedByEmail: actor.email,
        invitedByName: actor.name,
        deliveryStatus: 'pending',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        schemaVersion: ACCESS_SCHEMA_VERSION,
      });
      transaction.create(commandRef, { operation: 'inviteMember', result, createdAt: FieldValue.serverTimestamp() });
      writeAudit(transaction, organizationId, actor, 'invitation.created', 'invitation', invitationId, null, { role, status: 'pending' }, null);
      return { result, shouldSend: true };
    });
    if (!transactionResult.shouldSend) return transactionResult.result;
    try {
      const delivery = await sendInvitationEmail({
        organizationId,
        invitationId,
        organizationName: policy.name,
        invitedBy: actor.name || actor.email,
        email,
        code,
        idempotencyKey: codeRevision,
      });
      await updateDelivery(invitationPath, codeRevision, 'sent', delivery.id);
      return result;
    } catch (error) {
      await updateDelivery(invitationPath, codeRevision, 'failed');
      throw error;
    }
  },
  SECRET_NAMES,
);

export const resendInvitation = callable<InvitationCommandInput, InvitationCommandOutput>(
  'resendInvitation',
  async (request) => {
    const auth = requireAdminAuth(request as CallableRequest<unknown>);
    const organizationId = validateIdentifier(request.data?.organizationId, 'organizationId');
    const invitationId = validateIdentifier(request.data?.invitationId, 'invitationId');
    const idempotencyKey = validateIdempotencyKey(request.data?.idempotencyKey);
    const actor = await loadOwner(auth, organizationId);
    const policy = await loadOrganizationPolicy(organizationId);
    const pepper = getPepper();
    const code = invitationCode();
    const codeRevision = randomUUID();
    const now = Date.now();
    const invitationPath = `organizations/${organizationId}/invitations/${invitationId}`;
    const commandRef = getFirestore().doc(`organizations/${organizationId}/commandKeys/${commandDocumentId(auth.uid, idempotencyKey)}`);
    const transactionResult = await getFirestore().runTransaction(async (transaction) => {
      await revalidateOrganizationOwnerInTransaction(transaction, getFirestore(), auth.uid, organizationId);
      const invitationRef = getFirestore().doc(invitationPath);
      const [commandSnapshot, invitationSnapshot] = await Promise.all([
        transaction.get(commandRef),
        transaction.get(invitationRef),
      ]);
      if (commandSnapshot.exists) return { ...commandSnapshot.data()?.result, shouldSend: false } as InvitationCommandOutput & { shouldSend: boolean; email?: string };
      if (!invitationSnapshot.exists) throw new HttpsError('not-found', 'La invitación no existe.');
      const invitation = invitationSnapshot.data() ?? {};
      if (!['pending', 'deliveryFailed', 'expired'].includes(String(invitation.status))) {
        throw new HttpsError('failed-precondition', 'La invitación ya no se puede reenviar.');
      }
      const timestamps = Array.isArray(invitation.resendTimestamps)
        ? invitation.resendTimestamps.map(timestampMillis).filter((value): value is number => value !== null)
        : [];
      if (!canResendInvitation(timestamps, now)) {
        throw new HttpsError('resource-exhausted', `Solo se permiten ${INVITATION_MAX_RESENDS_PER_HOUR} reenvíos por hora.`);
      }
      const recent = recentResendTimestamps(timestamps, now);
      const result: InvitationCommandOutput & { shouldSend: boolean; email: string } = {
        invitationId,
        status: 'pending',
        updatedAt: now,
        shouldSend: true,
        email: validateEmail(invitation.email),
      };
      transaction.update(invitationRef, {
        status: 'pending',
        codeHash: hashInvitationCode(code, pepper, invitationId),
        codeRevision,
        attemptCount: 0,
        resendTimestamps: [...recent.map((value) => Timestamp.fromMillis(value)), Timestamp.fromMillis(now)],
        expiresAt: Timestamp.fromMillis(now + INVITATION_CODE_TTL_MS),
        deliveryStatus: 'pending',
        updatedAt: FieldValue.serverTimestamp(),
      });
      const commandResult: InvitationCommandOutput = { invitationId, status: 'pending', updatedAt: now };
      transaction.create(commandRef, { operation: 'resendInvitation', result: commandResult, createdAt: FieldValue.serverTimestamp() });
      writeAudit(transaction, organizationId, actor, 'invitation.resent', 'invitation', invitationId, { status: invitation.status }, { status: 'pending' }, null);
      return result;
    });
    if (!transactionResult.shouldSend) return transactionResult;
    try {
      const delivery = await sendInvitationEmail({
        organizationId,
        invitationId,
        organizationName: policy.name,
        invitedBy: actor.name || actor.email,
        email: transactionResult.email as string,
        code,
        idempotencyKey: codeRevision,
      });
      await updateDelivery(invitationPath, codeRevision, 'sent', delivery.id);
      return { invitationId, status: 'pending', updatedAt: now };
    } catch (error) {
      await updateDelivery(invitationPath, codeRevision, 'failed');
      throw error;
    }
  },
  SECRET_NAMES,
);

export const cancelInvitation = callable<InvitationCommandInput, InvitationCommandOutput>(
  'cancelInvitation',
  async (request) => {
    const auth = requireAdminAuth(request as CallableRequest<unknown>);
    const organizationId = validateIdentifier(request.data?.organizationId, 'organizationId');
    const invitationId = validateIdentifier(request.data?.invitationId, 'invitationId');
    const idempotencyKey = validateIdempotencyKey(request.data?.idempotencyKey);
    const actor = await loadOwner(auth, organizationId);
    const now = Date.now();
    const commandRef = getFirestore().doc(`organizations/${organizationId}/commandKeys/${commandDocumentId(auth.uid, idempotencyKey)}`);
    await getFirestore().runTransaction(async (transaction) => {
      await revalidateOrganizationOwnerInTransaction(transaction, getFirestore(), auth.uid, organizationId);
      const invitationRef = getFirestore().doc(`organizations/${organizationId}/invitations/${invitationId}`);
      const [commandSnapshot, invitationSnapshot] = await Promise.all([transaction.get(commandRef), transaction.get(invitationRef)]);
      if (commandSnapshot.exists) return null;
      if (!invitationSnapshot.exists) throw new HttpsError('not-found', 'La invitación no existe.');
      const invitation = invitationSnapshot.data() ?? {};
      if (invitation.status === 'accepted') throw new HttpsError('failed-precondition', 'La invitación ya fue aceptada.');
      const result: InvitationCommandOutput = { invitationId, status: 'cancelled', updatedAt: now };
      transaction.update(invitationRef, {
        status: 'cancelled',
        codeHash: FieldValue.delete(),
        activationTokenHash: FieldValue.delete(),
        cancelledAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.create(commandRef, { operation: 'cancelInvitation', result, createdAt: FieldValue.serverTimestamp() });
      writeAudit(transaction, organizationId, actor, 'invitation.cancelled', 'invitation', invitationId, { status: invitation.status }, { status: 'cancelled' }, null);
    });
    return { invitationId, status: 'cancelled', updatedAt: now };
  },
);

export const changeMemberRole = callable<ChangeMemberRoleInput, MemberCommandOutput>(
  'changeMemberRole',
  async (request) => {
    const auth = requireAdminAuth(request as CallableRequest<unknown>);
    const organizationId = validateIdentifier(request.data?.organizationId, 'organizationId');
    const memberId = validateIdentifier(request.data?.memberId, 'memberId');
    if (!isOrganizationRole(request.data?.role)) throw new HttpsError('invalid-argument', 'El rol no es válido.');
    const requestedRole = request.data.role;
    const idempotencyKey = validateIdempotencyKey(request.data?.idempotencyKey);
    const actor = await loadOwner(auth, organizationId);
    const policy = await loadOrganizationPolicy(organizationId);
    const now = Date.now();
    const commandRef = getFirestore().doc(`organizations/${organizationId}/commandKeys/${commandDocumentId(auth.uid, idempotencyKey)}`);
    return getFirestore().runTransaction(async (transaction) => {
      await revalidateOrganizationOwnerInTransaction(transaction, getFirestore(), auth.uid, organizationId);
      const memberRef = getFirestore().doc(`organizations/${organizationId}/members/${memberId}`);
      const membershipIndexRef = getFirestore().doc(`users/${memberId}/organizationMemberships/${organizationId}`);
      const [commandSnapshot, memberSnapshot, ownersSnapshot] = await Promise.all([
        transaction.get(commandRef),
        transaction.get(memberRef),
        transaction.get(activeOwnerQuery(organizationId)),
      ]);
      if (commandSnapshot.exists) return commandSnapshot.data()?.result as MemberCommandOutput;
      if (!memberSnapshot.exists) throw new HttpsError('not-found', 'La cuenta no existe.');
      const member = memberSnapshot.data() ?? {};
      if (!isOrganizationRole(member.role) || !['active', 'disabled'].includes(String(member.status))) {
        throw new HttpsError('failed-precondition', 'La cuenta tiene un rol histórico que requiere migración manual.');
      }
      const criticalOwnerChange = member.role === 'owner' && requestedRole !== 'owner';
      const reason = criticalOwnerChange ? requireReason(request.data?.reason) : sanitizeReason(request.data?.reason) || null;
      if (
        wouldRemoveLastOwner(ownersSnapshot.size, member.role, member.status, requestedRole, member.status)
        || (criticalOwnerChange && ownersSnapshot.size <= policy.minimumActiveOwners)
      ) throw new HttpsError('failed-precondition', 'No se puede degradar al último Administrador activo.');
      const result: MemberCommandOutput = { memberId, role: requestedRole, status: member.status, updatedAt: now };
      transaction.update(memberRef, { role: requestedRole, updatedAt: FieldValue.serverTimestamp() });
      transaction.set(membershipIndexRef, {
        organizationId,
        role: requestedRole,
        status: member.status,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      transaction.create(commandRef, { operation: 'changeMemberRole', result, createdAt: FieldValue.serverTimestamp() });
      writeAudit(transaction, organizationId, actor, 'member.roleChanged', 'member', memberId, { role: member.role, status: member.status }, { role: requestedRole, status: member.status }, reason);
      return result;
    });
  },
);

export const changeMemberStatus = callable<ChangeMemberStatusInput, MemberCommandOutput>(
  'changeMemberStatus',
  async (request) => {
    const auth = requireAdminAuth(request as CallableRequest<unknown>);
    const organizationId = validateIdentifier(request.data?.organizationId, 'organizationId');
    const memberId = validateIdentifier(request.data?.memberId, 'memberId');
    if (!['active', 'disabled'].includes(String(request.data?.status))) throw new HttpsError('invalid-argument', 'El estado no es válido.');
    const requestedStatus = request.data.status as MemberStatus;
    const reason = requireReason(request.data?.reason);
    const idempotencyKey = validateIdempotencyKey(request.data?.idempotencyKey);
    const actor = await loadOwner(auth, organizationId);
    const policy = await loadOrganizationPolicy(organizationId);
    const now = Date.now();
    const commandRef = getFirestore().doc(`organizations/${organizationId}/commandKeys/${commandDocumentId(auth.uid, idempotencyKey)}`);
    const result = await getFirestore().runTransaction(async (transaction) => {
      await revalidateOrganizationOwnerInTransaction(transaction, getFirestore(), auth.uid, organizationId);
      const memberRef = getFirestore().doc(`organizations/${organizationId}/members/${memberId}`);
      const membershipIndexRef = getFirestore().doc(`users/${memberId}/organizationMemberships/${organizationId}`);
      const [commandSnapshot, memberSnapshot, ownersSnapshot] = await Promise.all([
        transaction.get(commandRef),
        transaction.get(memberRef),
        transaction.get(activeOwnerQuery(organizationId)),
      ]);
      if (commandSnapshot.exists) return commandSnapshot.data()?.result as MemberCommandOutput;
      if (!memberSnapshot.exists) throw new HttpsError('not-found', 'La cuenta no existe.');
      const member = memberSnapshot.data() ?? {};
      if (!isOrganizationRole(member.role) || !['active', 'disabled'].includes(String(member.status))) {
        throw new HttpsError('failed-precondition', 'La cuenta tiene un estado histórico que requiere migración manual.');
      }
      if (
        wouldRemoveLastOwner(ownersSnapshot.size, member.role, member.status, member.role, requestedStatus)
        || (member.role === 'owner' && member.status === 'active' && requestedStatus === 'disabled' && ownersSnapshot.size <= policy.minimumActiveOwners)
      ) throw new HttpsError('failed-precondition', 'No se puede desactivar al último Administrador activo.');
      const output: MemberCommandOutput = { memberId, role: member.role, status: requestedStatus, updatedAt: now };
      transaction.update(memberRef, {
        status: requestedStatus,
        updatedAt: FieldValue.serverTimestamp(),
        ...(requestedStatus === 'disabled'
          ? { disabledAt: FieldValue.serverTimestamp(), disabledBy: actor.uid }
          : { activatedAt: FieldValue.serverTimestamp(), disabledAt: FieldValue.delete(), disabledBy: FieldValue.delete() }),
      });
      transaction.set(membershipIndexRef, {
        organizationId,
        role: member.role,
        status: requestedStatus,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      transaction.create(commandRef, { operation: 'changeMemberStatus', result: output, createdAt: FieldValue.serverTimestamp() });
      writeAudit(transaction, organizationId, actor, requestedStatus === 'disabled' ? 'member.disabled' : 'member.activated', 'member', memberId, { role: member.role, status: member.status }, { role: member.role, status: requestedStatus }, reason);
      return output;
    });
    return result;
  },
);

const enforcePublicVerificationRateLimits = async (email: string, ip: string, pepper: string) => {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const entries = [
    { id: `email-${hashIdentifier(hashInvitationCode(email, pepper, 'rate'))}`, limit: 15 },
    { id: `ip-${hashIdentifier(hashInvitationCode(ip, pepper, 'rate'))}`, limit: 40 },
  ];
  await getFirestore().runTransaction(async (transaction) => {
    const refs = entries.map((entry) => getFirestore().doc(`invitationRateLimits/${entry.id}`));
    const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)));
    snapshots.forEach((snapshot, index) => {
      const startedAt = timestampMillis(snapshot.data()?.windowStartedAt) ?? 0;
      const current = typeof snapshot.data()?.count === 'number' ? snapshot.data()?.count : 0;
      if (now - startedAt < windowMs && current >= entries[index].limit) {
        throw new HttpsError('resource-exhausted', 'Demasiados intentos. Espera antes de volver a probar.');
      }
      transaction.set(refs[index], {
        count: now - startedAt < windowMs ? current + 1 : 1,
        windowStartedAt: now - startedAt < windowMs ? snapshot.data()?.windowStartedAt : Timestamp.fromMillis(now),
        expiresAt: Timestamp.fromMillis(now + 2 * windowMs),
      });
    });
  });
};

export const getInvitationActivation = callable<GetInvitationActivationInput, GetInvitationActivationOutput>(
  'getInvitationActivation',
  async (request) => {
    const legalConfiguration = readLegalConfiguration();
    const organizationId = validateIdentifier(request.data?.organizationId, 'organizationId');
    const invitationId = validateIdentifier(request.data?.invitationId, 'invitationId');
    const [policy, invitationSnapshot] = await Promise.all([
      loadOrganizationPolicy(organizationId, true, invitationId),
      getFirestore().doc(`organizations/${organizationId}/invitations/${invitationId}`).get(),
    ]);
    if (!invitationSnapshot.exists) throw new HttpsError('not-found', 'La invitación no está disponible.');
    const invitation = invitationSnapshot.data() ?? {};
    const expiresAt = timestampMillis(invitation.expiresAt) ?? 0;
    if (isInvitationExpired(expiresAt) || !['pending', 'deliveryFailed'].includes(String(invitation.status))) {
      throw new HttpsError('failed-precondition', 'La invitación ya no está disponible.');
    }
    return {
      organizationName: policy.name,
      maskedEmail: maskEmail(String(invitation.email ?? '')),
      invitedBy: sanitizePersonName(invitation.invitedByName) || 'un Administrador',
      expiresAt,
      status: invitation.status,
      ...legalConfiguration,
    };
  },
);

export const verifyInvitationCode = callable<VerifyInvitationCodeInput, VerifyInvitationCodeOutput>(
  'verifyInvitationCode',
  async (request, correlationId) => {
    const organizationId = validateIdentifier(request.data?.organizationId, 'organizationId');
    const invitationId = validateIdentifier(request.data?.invitationId, 'invitationId');
    if (typeof request.data?.code !== 'string' || !/^\d{6}$/.test(request.data.code)) {
      throw new HttpsError('invalid-argument', 'El código debe tener 6 dígitos.');
    }
    await loadOrganizationPolicy(organizationId, true, invitationId);
    const code = request.data.code;
    const pepper = getPepper();
    const invitationRef = getFirestore().doc(`organizations/${organizationId}/invitations/${invitationId}`);
    const initial = await invitationRef.get();
    if (!initial.exists) throw new HttpsError('not-found', 'La invitación no está disponible.');
    const email = validateEmail(initial.data()?.email);
    const ip = request.rawRequest.ip || request.rawRequest.socket.remoteAddress || 'unavailable';
    await enforcePublicVerificationRateLimits(email, ip, pepper);
    const codeCheck = await getFirestore().runTransaction(async (transaction) => {
      const snapshot = await transaction.get(invitationRef);
      if (!snapshot.exists) throw new HttpsError('not-found', 'La invitación no está disponible.');
      const invitation = snapshot.data() ?? {};
      const expiresAt = timestampMillis(invitation.expiresAt) ?? 0;
      if (isInvitationExpired(expiresAt)) {
        transaction.update(invitationRef, { status: 'expired', updatedAt: FieldValue.serverTimestamp() });
        return { kind: 'expired' as const, attempts: null };
      }
      if (!['pending', 'deliveryFailed'].includes(String(invitation.status))) {
        throw new HttpsError('failed-precondition', 'El código ya no se puede utilizar.');
      }
      const attemptCount = typeof invitation.attemptCount === 'number' ? invitation.attemptCount : 0;
      if (attemptCount >= INVITATION_MAX_ATTEMPTS) throw new HttpsError('resource-exhausted', 'Se agotaron los intentos. Solicita un reenvío.');
      const submittedHash = hashInvitationCode(code, pepper, invitationId);
      if (typeof invitation.codeHash !== 'string' || !secureHashEquals(invitation.codeHash, submittedHash)) {
        const next = nextAttemptCount(attemptCount);
        transaction.update(invitationRef, {
          attemptCount: next,
          ...(next >= INVITATION_MAX_ATTEMPTS ? { status: 'expired' } : {}),
          updatedAt: FieldValue.serverTimestamp(),
        });
        return { kind: 'invalid' as const, attempts: next };
      }
      const previousStatus = String(invitation.status) === 'deliveryFailed' ? 'deliveryFailed' : 'pending';
      transaction.update(invitationRef, {
        status: 'verificationInProgress',
        verificationLeaseUntil: Timestamp.fromMillis(Date.now() + 60_000),
        verifiedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { kind: 'valid' as const, attempts: attemptCount, previousStatus };
    });
    if (codeCheck.kind === 'expired') {
      throw new HttpsError('deadline-exceeded', 'El código ha caducado. Solicita un reenvío.');
    }
    if (codeCheck.kind === 'invalid') {
      throw new HttpsError('permission-denied', codeCheck.attempts >= INVITATION_MAX_ATTEMPTS
        ? 'Se agotaron los intentos. Solicita un reenvío.'
        : 'El código no es correcto.');
    }
    try {
      let user: UserRecord;
      try {
        user = await getAuth().getUserByEmail(email);
        if (user.disabled) throw new HttpsError('permission-denied', 'La cuenta está bloqueada. Contacta con GFS.');
        user = await getAuth().updateUser(user.uid, { emailVerified: true });
      } catch (error) {
        if ((error as { code?: string }).code !== 'auth/user-not-found') throw error;
        user = await getAuth().createUser({ email, emailVerified: true, disabled: false });
      }
      const activationToken = randomBytes(32).toString('base64url');
      const activationExpiresAt = Date.now() + INVITATION_ACTIVATION_TTL_MS;
      if ((await getAuth().getUser(user.uid)).disabled) {
        throw new HttpsError('permission-denied', 'La cuenta está bloqueada. Contacta con GFS.');
      }
      const customToken = await createInvitationCustomToken(
        user.uid,
        organizationId,
        correlationId,
      );
      await getFirestore().runTransaction(async (transaction) => {
        const snapshot = await transaction.get(invitationRef);
        if (snapshot.data()?.status !== 'verificationInProgress') {
          throw new HttpsError('aborted', 'La verificación cambió. Vuelve a empezar.');
        }
        transaction.update(invitationRef, {
          status: 'verified',
          verificationUid: user.uid,
          activationTokenHash: hashActivationToken(activationToken, pepper, invitationId),
          activationExpiresAt: Timestamp.fromMillis(activationExpiresAt),
          codeHash: FieldValue.delete(),
          verificationLeaseUntil: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      });
      return { customToken, activationToken, email, expiresAt: activationExpiresAt };
    } catch (error) {
      await getFirestore().runTransaction(async (transaction) => {
        const snapshot = await transaction.get(invitationRef);
        if (!snapshot.exists || snapshot.data()?.status !== 'verificationInProgress') {
          return;
        }
        transaction.update(invitationRef, {
          status: codeCheck.previousStatus,
          verificationLeaseUntil: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }).catch(() => undefined);
      throw error;
    }
  },
  CODE_SECRET,
);

export const acceptInvitation = callable<AcceptInvitationInput, AcceptInvitationOutput>(
  'acceptInvitation',
  async (request) => {
    const auth = requireAdminAuth(request as CallableRequest<unknown>);
    const organizationId = validateIdentifier(request.data?.organizationId, 'organizationId');
    const invitationId = validateIdentifier(request.data?.invitationId, 'invitationId');
    const idempotencyKey = validateIdempotencyKey(request.data?.idempotencyKey);
    if (typeof request.data?.activationToken !== 'string' || request.data.activationToken.length < 32) {
      throw new HttpsError('invalid-argument', 'La activación no es válida.');
    }
    const firstName = sanitizePersonName(request.data?.firstName);
    const lastName = sanitizePersonName(request.data?.lastName);
    if (!firstName || !lastName) throw new HttpsError('invalid-argument', 'Nombre y apellidos son obligatorios.');
    const legalConfiguration = readLegalConfiguration();
    assertLegalAcceptance(request.data, legalConfiguration);
    await loadOrganizationPolicy(organizationId, true, invitationId);
    const user = await getAuth().getUser(auth.uid);
    if (user.disabled) throw new HttpsError('permission-denied', 'La cuenta está bloqueada. Contacta con GFS.');
    if (!user.email || !user.emailVerified || !user.providerData.some((item) => item.providerId === 'password')) {
      throw new HttpsError('failed-precondition', 'Debes establecer la contraseña antes de activar la cuenta.');
    }
    const email = normalizeEmail(user.email);
    const pepper = getPepper();
    const now = Date.now();
    const commandRef = getFirestore().doc(`organizations/${organizationId}/commandKeys/${commandDocumentId(auth.uid, idempotencyKey)}`);
    const result = await getFirestore().runTransaction(async (transaction) => {
      if ((await getAuth().getUser(auth.uid)).disabled) {
        throw new HttpsError('permission-denied', 'La cuenta está bloqueada. Contacta con GFS.');
      }
      const organizationRef = getFirestore().doc(`organizations/${organizationId}`);
      const invitationRef = getFirestore().doc(`organizations/${organizationId}/invitations/${invitationId}`);
      const memberRef = getFirestore().doc(`organizations/${organizationId}/members/${auth.uid}`);
      const membershipIndexRef = getFirestore().doc(`users/${auth.uid}/organizationMemberships/${organizationId}`);
      const [commandSnapshot, organizationSnapshot, invitationSnapshot, memberSnapshot] = await Promise.all([
        transaction.get(commandRef),
        transaction.get(organizationRef),
        transaction.get(invitationRef),
        transaction.get(memberRef),
      ]);
      if (commandSnapshot.exists) return commandSnapshot.data()?.result as AcceptInvitationOutput;
      const organization = assertOrganizationOperational(organizationSnapshot, { allowPending: true });
      const isInitialActivation = organization.status === 'pending'
        && organization.initialFacilitatorInvitationId === invitationId;
      if (!invitationSnapshot.exists) throw new HttpsError('not-found', 'La invitación no existe.');
      const invitation = invitationSnapshot.data() ?? {};
      if (invitation.status !== 'verified'
        || invitation.verificationUid !== auth.uid
        || normalizeEmail(String(invitation.email ?? '')) !== email
        || !isOrganizationRole(invitation.role)) {
        throw new HttpsError('permission-denied', 'La invitación no corresponde a esta cuenta.');
      }
      if (organization.status === 'pending' && (!isInitialActivation || invitation.role !== 'facilitator')) {
        throw new HttpsError('permission-denied', 'La invitacion no corresponde al alta inicial.');
      }
      const activationExpiresAt = timestampMillis(invitation.activationExpiresAt) ?? 0;
      if (isInvitationExpired(activationExpiresAt)) throw new HttpsError('deadline-exceeded', 'La activación ha caducado.');
      const submittedHash = hashActivationToken(request.data.activationToken, pepper, invitationId);
      if (typeof invitation.activationTokenHash !== 'string'
        || !secureHashEquals(invitation.activationTokenHash, submittedHash)) {
        throw new HttpsError('permission-denied', 'La activación no es válida.');
      }
      const output: AcceptInvitationOutput = {
        organizationId,
        memberId: auth.uid,
        role: invitation.role,
        status: 'active',
        acceptedAt: now,
      };
      transaction.set(memberRef, {
        uid: auth.uid,
        email,
        firstName,
        lastName,
        role: invitation.role,
        status: 'active',
        schemaVersion: ACCESS_SCHEMA_VERSION,
        privacyAcceptedAt: FieldValue.serverTimestamp(),
        privacyVersion: legalConfiguration.privacyVersion,
        termsAcceptedAt: FieldValue.serverTimestamp(),
        termsVersion: legalConfiguration.termsVersion,
        invitationId,
        updatedAt: FieldValue.serverTimestamp(),
        ...(memberSnapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
      }, { merge: true });
      transaction.set(membershipIndexRef, {
        organizationId,
        role: invitation.role,
        status: 'active',
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      transaction.update(invitationRef, {
        status: 'accepted',
        acceptedBy: auth.uid,
        acceptedAt: FieldValue.serverTimestamp(),
        activationTokenHash: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.create(commandRef, { operation: 'acceptInvitation', result: output, createdAt: FieldValue.serverTimestamp() });
      const actor: Actor = { uid: auth.uid, email, name: `${firstName} ${lastName}` };
      writeAudit(transaction, organizationId, actor, 'member.activated', 'member', auth.uid, memberSnapshot.exists ? { status: memberSnapshot.data()?.status ?? null, role: memberSnapshot.data()?.role ?? null } : null, { status: 'active', role: invitation.role }, 'Invitación aceptada');
      return output;
    });
    await getAuth().updateUser(auth.uid, { displayName: `${firstName} ${lastName}`, emailVerified: true });
    await activatePendingOrganizationForAcceptedInvitation(
      organizationId,
      invitationId,
      auth.uid,
    );
    return result;
  },
  CODE_SECRET,
);

export const listOrganizationAudit = callable<ListOrganizationAuditInput, ListOrganizationAuditOutput>(
  'listOrganizationAudit',
  async (request) => {
    const auth = requireAdminAuth(request as CallableRequest<unknown>);
    const organizationId = validateIdentifier(request.data?.organizationId, 'organizationId');
    await loadOwner(auth, organizationId);
    const filters = validateAuditFilters(request.data?.filters);
    const cursor = validateAuditCursor(request.data?.cursor);
    const rawLimit = request.data?.limit;
    if (rawLimit !== undefined && (!Number.isFinite(rawLimit) || rawLimit < 1)) {
      throw new HttpsError('invalid-argument', 'El límite de actividad no es válido.');
    }
    const requestedLimit = typeof rawLimit === 'number' ? Math.floor(rawLimit) : 50;
    const limit = Math.min(100, requestedLimit);
    let query = auditQueryForPeriod(organizationId, filters);
    if (cursor) {
      const cursorSnapshot = await getFirestore()
        .doc(`organizations/${organizationId}/auditEvents/${cursor.id}`)
        .get();
      if (!cursorSnapshot.exists || timestampMillis(cursorSnapshot.data()?.createdAt) !== cursor.createdAt) {
        throw new HttpsError('invalid-argument', 'El cursor de actividad ya no es válido.');
      }
      query = query.startAfter(cursorSnapshot);
    }

    const matches: Array<{
      event: AuditEventSummary;
      snapshot: QueryDocumentSnapshot;
    }> = [];
    let lastScanned: QueryDocumentSnapshot | null = null;
    let exhausted = false;
    let scannedCount = 0;
    while (
      matches.length <= limit
      && scannedCount < MAX_AUDIT_OVERVIEW_EVENTS
      && !exhausted
    ) {
      const batchLimit = Math.min(
        AUDIT_PAGE_BATCH_SIZE,
        MAX_AUDIT_OVERVIEW_EVENTS - scannedCount,
      );
      const snapshot = await query.limit(batchLimit).get();
      if (snapshot.empty) {
        exhausted = true;
        break;
      }
      for (const item of snapshot.docs) {
        lastScanned = item;
        scannedCount += 1;
        const event = auditEventFromSnapshot(item);
        if (auditEventMatchesFilters(event, filters)) {
          matches.push({ event, snapshot: item });
          if (matches.length > limit) break;
        }
      }
      if (matches.length > limit) break;
      if (snapshot.size < batchLimit) {
        exhausted = true;
      } else if (lastScanned) {
        query = query.startAfter(lastScanned);
      }
    }

    const page = matches.slice(0, limit);
    const hasMore = matches.length > limit || !exhausted;
    const cursorSource = matches.length > limit
      ? page.at(-1)?.snapshot ?? null
      : hasMore
        ? lastScanned
        : null;
    const nextCreatedAt = cursorSource
      ? timestampMillis(cursorSource.data().createdAt)
      : null;
    return {
      events: page.map((item) => item.event),
      hasMore: hasMore && !!cursorSource && nextCreatedAt !== null,
      nextCursor: hasMore && cursorSource && nextCreatedAt !== null
        ? { id: cursorSource.id, createdAt: nextCreatedAt }
        : null,
    };
  },
);

export const getOrganizationAuditOverview = callable<
  GetOrganizationAuditOverviewInput,
  GetOrganizationAuditOverviewOutput
>(
  'getOrganizationAuditOverview',
  async (request) => {
    const auth = requireAdminAuth(request as CallableRequest<unknown>);
    const organizationId = validateIdentifier(request.data?.organizationId, 'organizationId');
    await loadOwner(auth, organizationId);
    const filters = validateAuditFilters(request.data?.filters);
    const now = Date.now();
    const snapshot = await auditQueryForPeriod(organizationId, filters, now)
      .limit(MAX_AUDIT_OVERVIEW_EVENTS + 1)
      .get();
    const truncated = snapshot.size > MAX_AUDIT_OVERVIEW_EVENTS;
    const periodEvents = snapshot.docs
      .slice(0, MAX_AUDIT_OVERVIEW_EVENTS)
      .map(auditEventFromSnapshot);
    return buildOrganizationAuditOverview(periodEvents, filters, now, truncated);
  },
);
