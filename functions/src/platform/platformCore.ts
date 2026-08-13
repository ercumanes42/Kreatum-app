import { createHash, randomUUID } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import {
  FieldValue,
  Timestamp,
  getFirestore,
  type DocumentData,
  type DocumentReference,
  type Transaction,
} from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import {
  DEFAULT_RETENTION_MONTHS,
  PHASES,
  REPORT_TEMPLATE_VERSION,
  SCHEMA_VERSION,
  WORKSHOP_STATUSES,
  isPhase,
  type AuditTargetType,
  type PlatformDocumentCursor,
  type PlatformInvitationSummary,
  type PlatformOrganizationStatus,
  type PlatformOrganizationSummary,
  type PlatformWorkshopSummary,
  type WorkshopStatus,
} from '../../../shared/contracts.js';
import {
  hasPlatformAdminClaim,
  readPlatformAllowance,
  resolvePlatformOrganizationStatus,
  timestampMillis,
} from './platformSecurity.js';
import { RUNTIME_SERVICE_ACCOUNT } from '../runtimeOptions.js';

export const REGION = process.env.KREATUM_FUNCTIONS_REGION?.trim() || 'europe-west1';
export const ENFORCE_APP_CHECK = process.env.KREATUM_ENFORCE_APP_CHECK === 'true';
export const PLATFORM_SCHEMA_VERSION = 1;
export const LIST_SCAN_LIMIT = 250;
export const firestore = () => getFirestore();
export type AuthContext = NonNullable<CallableRequest<unknown>['auth']>;
export type UnknownRecord = Record<string, unknown>;

export const hashIdentifier = (value: string) =>
  createHash('sha256').update(value).digest('hex').slice(0, 24);

export const commandDocumentId = (uid: string, operation: string, key: string) =>
  hashIdentifier(uid + ':' + operation + ':' + key);

export const cleanText = (value: unknown, field: string, maxLength = 240) => {
  if (typeof value !== 'string') throw new HttpsError('invalid-argument', field + ' no es valido.');
  const cleaned = value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned || cleaned.length > maxLength) {
    throw new HttpsError('invalid-argument', field + ' no es valido.');
  }
  return cleaned;
};

export const identifier = (value: unknown, field: string) => {
  const cleaned = cleanText(value, field, 128);
  if (!/^[A-Za-z0-9_-]{3,128}$/.test(cleaned)) {
    throw new HttpsError('invalid-argument', field + ' no es valido.');
  }
  return cleaned;
};

export const idempotencyKey = (value: unknown) => {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) {
    throw new HttpsError('invalid-argument', 'La clave de idempotencia no es valida.');
  }
  return value;
};

export const requireReason = (value: unknown) => {
  const result = cleanText(value, 'reason', 500);
  if (result.length < 4) throw new HttpsError('invalid-argument', 'Indica un motivo de al menos 4 caracteres.');
  return result;
};

export const normalizedEmail = (value: unknown) => {
  const result = cleanText(value, 'facilitatorEmail', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(result)) {
    throw new HttpsError('invalid-argument', 'El correo del facilitador no es valido.');
  }
  return result;
};

export const allowedDomains = (value: unknown) => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
    throw new HttpsError('invalid-argument', 'Configura entre 1 y 20 dominios permitidos.');
  }
  const result = [...new Set(value.map((item) =>
    cleanText(item, 'allowedEmailDomains', 253).toLowerCase().replace(/^@/, ''),
  ))];
  if (result.some((domain) =>
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain),
  )) {
    throw new HttpsError('invalid-argument', 'Hay un dominio permitido no valido.');
  }
  return result;
};

export const validityWindow = (validFromValue: unknown, validUntilValue: unknown) => {
  const validFrom = timestampMillis(validFromValue);
  const validUntil = validUntilValue === null ? null : timestampMillis(validUntilValue);
  if (validFrom === null || (validUntil !== null && validUntil <= validFrom)) {
    throw new HttpsError('invalid-argument', 'La vigencia no es valida.');
  }
  return { validFrom, validUntil };
};

export const validatedRetentionMonths = (value: unknown) => {
  if (value === undefined) return DEFAULT_RETENTION_MONTHS;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 120) {
    throw new HttpsError('invalid-argument', 'La retencion debe estar entre 1 y 120 meses.');
  }
  return parsed;
};

export const pageLimit = (value: unknown, fallback = 50) => {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new HttpsError('invalid-argument', 'El limite no es valido.');
  }
  return Math.min(100, parsed);
};

export const platformCursor = (value: unknown): PlatformDocumentCursor | null => {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== 'object') {
    throw new HttpsError('invalid-argument', 'El cursor no es valido.');
  }
  return { documentId: identifier((value as UnknownRecord).documentId, 'cursor.documentId') };
};

export const callable = <Input, Output>(
  operation: string,
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
  if (!request.app) {
    logger.warn('Platform callable request without App Check token.', { operation, correlationId });
  }
  try {
    return await handler(request, correlationId);
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    logger.error('Unhandled platform callable error.', {
      operation,
      correlationId,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    throw new HttpsError('internal', 'No se pudo completar la operacion. Referencia: ' + correlationId);
  }
});

const requirePlatformAdmin = async (
  request: CallableRequest<unknown>,
): Promise<AuthContext> => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Debes iniciar una sesion valida.');
  const firebaseToken = request.auth.token.firebase as { sign_in_provider?: unknown } | undefined;
  if (firebaseToken?.sign_in_provider === 'anonymous' || !hasPlatformAdminClaim(request.auth.token)) {
    throw new HttpsError('permission-denied', 'Solo un operador autorizado de GFS puede usar esta funcion.');
  }
  const currentUser = await getAuth().getUser(request.auth.uid).catch(() => null);
  if (!currentUser || currentUser.disabled || currentUser.customClaims?.platformAdmin !== true) {
    throw new HttpsError(
      'permission-denied',
      'La autorizacion actual de Plataforma GFS no esta vigente.',
    );
  }
  return request.auth;
};

const enforceRateLimit = async (
  auth: AuthContext,
  operation: string,
  maximum: number,
  windowMs: number,
) => {
  const ref = firestore().doc('platformRateLimits/' + hashIdentifier(auth.uid + ':' + operation));
  const now = Date.now();
  await firestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.data() ?? {};
    const windowStartedAt = timestampMillis(data.windowStartedAt) ?? 0;
    const currentCount = Number(data.count);
    if (windowStartedAt > now - windowMs && Number.isInteger(currentCount) && currentCount >= maximum) {
      throw new HttpsError('resource-exhausted', 'Se ha superado temporalmente el limite de operaciones.');
    }
    const reset = windowStartedAt <= now - windowMs || !Number.isInteger(currentCount);
    transaction.set(ref, {
      operation,
      actorHash: hashIdentifier(auth.uid),
      windowStartedAt: Timestamp.fromMillis(reset ? now : windowStartedAt),
      count: reset ? 1 : currentCount + 1,
      expiresAt: Timestamp.fromMillis(now + Math.max(windowMs * 2, 60 * 60 * 1000)),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
};

export const authorizePlatformAdmin = async (
  request: CallableRequest<unknown>,
  operation: string,
  write = false,
) => {
  const auth = await requirePlatformAdmin(request);
  await enforceRateLimit(auth, operation, write ? 30 : 120, 60_000);
  return auth;
};

const safeAuditMetadata = (value: UnknownRecord) => Object.fromEntries(
  Object.entries(value)
    .filter(([key, item]) =>
      !/(code|secret|token|email|response|answer|content)/i.test(key)
      && ['string', 'number', 'boolean'].includes(typeof item)
      && (typeof item !== 'string' || item.length <= 160),
    )
    .slice(0, 20),
);

export const writePlatformAudit = (
  transaction: Transaction,
  organizationId: string,
  actorUid: string,
  action: string,
  targetType: AuditTargetType,
  targetId: string,
  workshopId: string | null,
  auditReason: string | null,
  metadata: UnknownRecord = {},
) => {
  const ref = firestore().collection('organizations/' + organizationId + '/auditEvents').doc();
  transaction.create(ref, {
    organizationId,
    workshopId,
    action,
    actorId: actorUid,
    actorHash: hashIdentifier(actorUid),
    actorEmail: '',
    actorName: 'Operador GFS',
    targetType,
    targetId,
    previousState: null,
    newState: safeAuditMetadata(metadata),
    reason: auditReason,
    createdAt: FieldValue.serverTimestamp(),
    schemaVersion: 3,
    platformAccess: true,
  });
};

export const platformOrganizationSummary = (
  id: string,
  data: UnknownRecord,
  initialInvitation: PlatformInvitationSummary | null,
): PlatformOrganizationSummary => {
  const hasCommercial = data.commercial !== null && typeof data.commercial === 'object';
  const hasCommercialPlan = data.commercialPlan !== null && typeof data.commercialPlan === 'object';
  const commercial = hasCommercial
    ? data.commercial as UnknownRecord
    : hasCommercialPlan
      ? data.commercialPlan as UnknownRecord
      : {};
  return {
    id,
    name: typeof data.name === 'string' && data.name.trim() ? data.name.trim().slice(0, 120) : id,
    status: resolvePlatformOrganizationStatus(data),
    allowedEmailDomains: Array.isArray(data.allowedEmailDomains)
      ? data.allowedEmailDomains.filter((item): item is string => typeof item === 'string').slice(0, 20)
      : [],
    validFrom: hasCommercial || hasCommercialPlan
      ? timestampMillis(commercial.validFrom) ?? 0
      : timestampMillis(data.validFrom) ?? 0,
    validUntil: hasCommercial || hasCommercialPlan
      ? timestampMillis(commercial.validUntil)
      : timestampMillis(data.validUntil),
    allowance: readPlatformAllowance(data),
    initialFacilitatorInvitation: initialInvitation,
    createdAt: timestampMillis(data.createdAt),
    updatedAt: timestampMillis(data.updatedAt),
    suspendedAt: timestampMillis(data.suspendedAt),
  };
};

export const canonicalCommercial = (
  data: UnknownRecord,
  status: PlatformOrganizationStatus,
  validFrom: number,
  validUntil: number | null,
  contracted: number,
  used: number,
) => {
  const current = data.commercial && typeof data.commercial === 'object'
    ? data.commercial as UnknownRecord
    : {};
  return {
    plan: typeof current.plan === 'string' ? current.plan : 'enterprise',
    status: status === 'suspended' || status === 'expired'
      ? status
      : status === 'pending' ? 'trial' : 'active',
    validFrom: Timestamp.fromMillis(validFrom),
    validUntil: validUntil === null ? null : Timestamp.fromMillis(validUntil),
    includedWorkshops: contracted,
    additionalWorkshops: 0,
    consumedWorkshops: used,
  };
};

export const platformWorkshopSummary = (
  id: string,
  data: UnknownRecord,
  organizationName: string,
): PlatformWorkshopSummary => ({
  id,
  organizationId: typeof data.organizationId === 'string' ? data.organizationId : '',
  organizationName,
  client: typeof data.client === 'string' ? data.client.slice(0, 240) : '',
  facilitator: typeof data.facilitator === 'string' ? data.facilitator.slice(0, 240) : '',
  facilitatorUid: typeof data.facilitatorUid === 'string'
    ? data.facilitatorUid
    : '',
  status: WORKSHOP_STATUSES.includes(data.status as WorkshopStatus)
    ? data.status as WorkshopStatus
    : 'active',
  currentPhase: isPhase(data.currentPhase) ? data.currentPhase : PHASES[0],
  createdAt: timestampMillis(data.createdAt),
  updatedAt: timestampMillis(data.updatedAt),
});

const WORKSHOP_REPORT_FIELDS = new Set([
  'challenge', 'client', 'completedAt', 'createdAt', 'currentPhase', 'facilitator',
  'schemaVersion', 'status', 'sublimarDefenseUnlocked', 'sublimarDefenseUnlockedAt',
  'unlockedPhases',
]);

const TEAM_REPORT_FIELDS = new Set([
  'audience', 'attacksOnOthers', 'challenge', 'createdAt', 'currentPhase', 'defenses',
  'expectedResults', 'isFinished', 'lastSavedAt', 'perspectiveVotes', 'perspectives',
  'pilot', 'pitch', 'pitchAction', 'pitchProblem', 'pitchSolution', 'pitchStart',
  'receivedAttacks', 'receivedSolutionToAttack', 'reformulatedSolution', 'resources',
  'schemaVersion', 'selectedPerspective', 'selectedSolution', 'solutionVotes', 'solutions', 'strengths',
  'sublimarDefenseCompleted', 'sublimarView', 'team', 'top3Perspectives',
  'top3Solutions', 'updatedAt', 'weaknesses',
]);

const ATTACK_REPORT_FIELDS = new Set([
  'content', 'editedAt', 'fromTeam', 'schemaVersion', 'timestamp', 'toTeam',
]);

const DEFENSE_REPORT_FIELDS = new Set([
  'attackId', 'content', 'editedAt', 'schemaVersion', 'team', 'timestamp',
]);

const SOLUTION_REPORT_FIELDS = new Set([
  'content', 'schemaVersion', 'team', 'timestamp',
]);

const NESTED_REPORT_FIELDS = new Set([
  'attack', 'attackId', 'content', 'defense', 'field', 'fromTeam', 'index', 'label',
  'option', 'team', 'timestamp', 'toTeam', 'value', 'votes',
]);

type PlatformReportCollection = 'workshop' | 'teams' | 'attacks' | 'defenses' | 'solutions';

const REPORT_FIELDS_BY_COLLECTION: Record<PlatformReportCollection, ReadonlySet<string>> = {
  workshop: WORKSHOP_REPORT_FIELDS,
  teams: TEAM_REPORT_FIELDS,
  attacks: ATTACK_REPORT_FIELDS,
  defenses: DEFENSE_REPORT_FIELDS,
  solutions: SOLUTION_REPORT_FIELDS,
};

export const normalizePlatformReportValue = (value: unknown): unknown => {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizePlatformReportValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as UnknownRecord)
        .filter(([key, nested]) => NESTED_REPORT_FIELDS.has(key) && nested !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normalizePlatformReportValue(nested)]),
    );
  }
  return value;
};

export const sanitizePlatformReportDocument = (
  collection: PlatformReportCollection,
  id: string,
  data: UnknownRecord,
): UnknownRecord => ({
  id,
  ...Object.fromEntries(
    Object.entries(data)
      .filter(([key, value]) => REPORT_FIELDS_BY_COLLECTION[collection].has(key)
        && value !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, normalizePlatformReportValue(value)]),
  ),
});

export const buildPlatformDataset = async (
  workshopRef: DocumentReference<DocumentData>,
) => {
  const workshopSnapshot = await workshopRef.get();
  if (!workshopSnapshot.exists) throw new HttpsError('not-found', 'La partida no esta disponible.');
  const data = workshopSnapshot.data() ?? {};
  const collectionNames = ['teams', 'attacks', 'defenses', 'solutions'] as const;
  const snapshots = await Promise.all(collectionNames.map((name) => workshopRef.collection(name).get()));
  const collections = Object.fromEntries(snapshots.map((snapshot, index) => [
    collectionNames[index],
    snapshot.docs
      .slice()
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((document) => sanitizePlatformReportDocument(
        collectionNames[index],
        document.id,
        document.data(),
      )),
  ]));
  return {
    schemaVersion: SCHEMA_VERSION,
    reportTemplateVersion: REPORT_TEMPLATE_VERSION,
    workshop: sanitizePlatformReportDocument('workshop', workshopRef.id, data),
    ...collections,
  } as UnknownRecord;
};

export const loadPlatformWorkshop = async (organizationId: string, workshopId: string) => {
  const workshopRef = firestore().doc('workshops/' + workshopId);
  const workshopSnapshot = await workshopRef.get();
  if (!workshopSnapshot.exists) throw new HttpsError('not-found', 'La partida no esta disponible.');
  const workshop = workshopSnapshot.data() ?? {};
  if (workshop.organizationId !== organizationId) {
    throw new HttpsError('not-found', 'La partida no esta disponible.');
  }
  const organizationSnapshot = await firestore().doc('organizations/' + organizationId).get();
  if (!organizationSnapshot.exists) throw new HttpsError('not-found', 'La partida no esta disponible.');
  return { workshopRef, workshop, organization: organizationSnapshot.data() ?? {} };
};
