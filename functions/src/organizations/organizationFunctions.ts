import { createHash, randomUUID } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import {
  FieldValue,
  Timestamp,
  getFirestore,
  type Transaction,
} from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { resolvePlatformOrganizationStatus } from '../platform/platformSecurity.js';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import {
  DEFAULT_RETENTION_MONTHS,
  ORGANIZATION_PLAN_CODES,
  ORGANIZATION_SUBSCRIPTION_STATUSES,
  isOrganizationRole,
  type ListMyOrganizationsInput,
  type ListMyOrganizationsOutput,
  type OrganizationBranding,
  type OrganizationCommercialTerms,
  type OrganizationPlanCode,
  type OrganizationRole,
  type OrganizationSubscriptionStatus,
  type OrganizationSummary,
  type ProvisionOrganizationInput,
  type ProvisionOrganizationOutput,
  type UpdateOrganizationCommercialInput,
  type UpdateOrganizationCommercialOutput,
} from '../../../shared/contracts.js';
import { RUNTIME_SERVICE_ACCOUNT } from '../runtimeOptions.js';

const REGION = process.env.KREATUM_FUNCTIONS_REGION?.trim() || 'europe-west1';
const ENFORCE_APP_CHECK = process.env.KREATUM_ENFORCE_APP_CHECK === 'true';
const DEFAULT_ORGANIZATION_ID = process.env.KREATUM_DEFAULT_ORGANIZATION_ID?.trim() || '';
const firestore = () => getFirestore();

type AuthContext = NonNullable<CallableRequest<unknown>['auth']>;

type MembershipDocument = {
  uid?: unknown;
  role?: unknown;
  status?: unknown;
};

type ActiveMembershipDocument = MembershipDocument & {
  role: OrganizationRole;
  status: 'active';
};

type OrganizationDocument = {
  name?: unknown;
  allowedEmailDomains?: unknown;
  retentionMonths?: unknown;
  branding?: unknown;
  [field: string]: unknown;
  commercial?: unknown;
};

const callable = <Input, Output>(
  name: string,
  handler: (request: CallableRequest<Input>) => Promise<Output>,
) => onCall<Input>({
  region: REGION,
  serviceAccount: RUNTIME_SERVICE_ACCOUNT,
  enforceAppCheck: ENFORCE_APP_CHECK,
}, async (request) => {
  const correlationId = randomUUID();
  try {
    return await handler(request);
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    logger.error('Unhandled organization callable error.', {
      operation: name,
      correlationId,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    throw new HttpsError('internal', `No se pudo completar la operación. Referencia: ${correlationId}`);
  }
});

const requireAdminAuth = (request: CallableRequest<unknown>): AuthContext => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Debes iniciar una sesión válida.');
  const firebaseToken = request.auth.token.firebase as { sign_in_provider?: unknown } | undefined;
  if (firebaseToken?.sign_in_provider === 'anonymous') {
    throw new HttpsError('permission-denied', 'Esta operación requiere una cuenta administrativa.');
  }
  return request.auth;
};

const requirePlatformAdmin = async (request: CallableRequest<unknown>): Promise<AuthContext> => {
  const auth = requireAdminAuth(request);
  const currentUser = await getAuth().getUser(auth.uid).catch(() => null);
  if (!currentUser
    || currentUser.disabled
    || currentUser.customClaims?.platformAdmin !== true) {
    throw new HttpsError('permission-denied', 'Solo un operador autorizado de GFS puede gestionar organizaciones.');
  }
  return auth;
};

const cleanText = (value: unknown, field: string, maxLength = 240) => {
  if (typeof value !== 'string') throw new HttpsError('invalid-argument', `${field} no es válido.`);
  const cleaned = value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned || cleaned.length > maxLength) {
    throw new HttpsError('invalid-argument', `${field} no es válido.`);
  }
  return cleaned;
};

const identifier = (value: unknown, field: string) => {
  const cleaned = cleanText(value, field, 128);
  if (!/^[A-Za-z0-9_-]{3,128}$/.test(cleaned)) {
    throw new HttpsError('invalid-argument', `${field} no es válido.`);
  }
  return cleaned;
};

const idempotencyKey = (value: unknown) => {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) {
    throw new HttpsError('invalid-argument', 'La clave de idempotencia no es válida.');
  }
  return value;
};

const commandId = (uid: string, key: string) => createHash('sha256')
  .update(`${uid}:${key}`)
  .digest('hex')
  .slice(0, 40);

const normalizedEmail = (value: unknown) => {
  const email = cleanText(value, 'ownerEmail', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) {
    throw new HttpsError('invalid-argument', 'ownerEmail no es válido.');
  }
  return email;
};

const domains = (value: unknown) => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
    throw new HttpsError('invalid-argument', 'Configura entre 1 y 20 dominios permitidos.');
  }
  const normalized = [...new Set(value.map((item) => cleanText(item, 'allowedEmailDomains', 253)
    .toLowerCase()
    .replace(/^@/, '')))];
  if (normalized.some((domain) => !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain))) {
    throw new HttpsError('invalid-argument', 'Hay un dominio permitido no válido.');
  }
  return normalized;
};

const retentionMonths = (value: unknown) => {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 120) {
    throw new HttpsError('invalid-argument', 'La retención debe estar entre 1 y 120 meses.');
  }
  return Number(value);
};

const millis = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof (value as { toMillis?: unknown })?.toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis();
  }
  return null;
};

const commercialTerms = (value: unknown, allowConsumed: boolean): OrganizationCommercialTerms => {
  const data = (value ?? {}) as Record<string, unknown>;
  if (!ORGANIZATION_PLAN_CODES.includes(data.plan as OrganizationPlanCode)) {
    throw new HttpsError('invalid-argument', 'El plan no es válido.');
  }
  if (!ORGANIZATION_SUBSCRIPTION_STATUSES.includes(data.status as OrganizationSubscriptionStatus)) {
    throw new HttpsError('invalid-argument', 'El estado de suscripción no es válido.');
  }
  const validFrom = millis(data.validFrom);
  const validUntil = millis(data.validUntil);
  const includedWorkshops = Number(data.includedWorkshops);
  const additionalWorkshops = Number(data.additionalWorkshops);
  const consumedWorkshops = allowConsumed ? Number(data.consumedWorkshops) : 0;
  if (
    validFrom === null
    || (validUntil !== null && validUntil <= validFrom)
    || !Number.isInteger(includedWorkshops) || includedWorkshops < 0 || includedWorkshops > 1_000_000
    || !Number.isInteger(additionalWorkshops) || additionalWorkshops < 0 || additionalWorkshops > 1_000_000
    || !Number.isInteger(consumedWorkshops) || consumedWorkshops < 0
    || consumedWorkshops > includedWorkshops + additionalWorkshops
  ) {
    throw new HttpsError('invalid-argument', 'La vigencia o los créditos contratados no son válidos.');
  }
  return {
    plan: data.plan as OrganizationPlanCode,
    status: data.status as OrganizationSubscriptionStatus,
    validFrom,
    validUntil,
    includedWorkshops,
    additionalWorkshops,
    consumedWorkshops,
  };
};

const branding = (value: unknown, fallbackName: string): OrganizationBranding => {
  const data = (value ?? {}) as Record<string, unknown>;
  const displayName = typeof data.displayName === 'string'
    ? cleanText(data.displayName, 'branding.displayName', 120)
    : fallbackName;
  const primaryColor = typeof data.primaryColor === 'string' ? data.primaryColor.trim() : '';
  const logoUrl = typeof data.logoUrl === 'string' ? data.logoUrl.trim() : '';
  if (primaryColor && !/^#[0-9a-fA-F]{6}$/.test(primaryColor)) {
    throw new HttpsError('invalid-argument', 'El color de marca debe usar formato hexadecimal.');
  }
  if (logoUrl && (!/^https:\/\//i.test(logoUrl) || logoUrl.length > 2048)) {
    throw new HttpsError('invalid-argument', 'La URL del logotipo debe ser HTTPS.');
  }
  return {
    displayName,
    ...(primaryColor ? { primaryColor } : {}),
    ...(logoUrl ? { logoUrl } : {}),
  };
};

const storedCommercial = (terms: OrganizationCommercialTerms) => ({
  ...terms,
  validFrom: Timestamp.fromMillis(terms.validFrom),
  validUntil: terms.validUntil === null ? null : Timestamp.fromMillis(terms.validUntil),
});

const readCommercial = (value: unknown): OrganizationCommercialTerms | null => {
  if (!value || typeof value !== 'object') return null;
  try {
    return commercialTerms(value, true);
  } catch {
    return null;
  }
};

export const preserveCommercialUsage = (
  requestedTerms: OrganizationCommercialTerms,
  currentTerms: OrganizationCommercialTerms | null,
): OrganizationCommercialTerms => {
  const consumedWorkshops = currentTerms?.consumedWorkshops ?? 0;
  if (consumedWorkshops > requestedTerms.includedWorkshops + requestedTerms.additionalWorkshops) {
    throw new HttpsError(
      'invalid-argument',
      'Los créditos contratados no pueden quedar por debajo de los ya consumidos.',
    );
  }
  return {
    ...requestedTerms,
    consumedWorkshops,
  };
};

const summaryFromDocuments = (
  organizationId: string,
  organization: OrganizationDocument,
  role: OrganizationRole,
): OrganizationSummary => {
  const name = typeof organization.name === 'string' && organization.name.trim()
    ? organization.name.trim().slice(0, 120)
    : organizationId;
  const terms = readCommercial(organization.commercial);
  const allowedEmailDomains = Array.isArray(organization.allowedEmailDomains)
    ? organization.allowedEmailDomains.filter((item): item is string => typeof item === 'string').slice(0, 20)
    : [];
  const configuredRetention = Number(organization.retentionMonths);
  return {
    id: organizationId,
    name,
    role,
    operationalStatus: resolvePlatformOrganizationStatus(organization),
    branding: branding(organization.branding, name),
    allowedEmailDomains,
    retentionMonths: Number.isInteger(configuredRetention) ? configuredRetention : DEFAULT_RETENTION_MONTHS,
    commercial: terms,
    creditsRemaining: terms === null
      ? null
      : Math.max(0, terms.includedWorkshops + terms.additionalWorkshops - terms.consumedWorkshops),
  };
};

const activeMembership = (
  data: MembershipDocument | undefined,
): data is ActiveMembershipDocument => {
  return data?.status === 'active' && isOrganizationRole(data.role);
};

export const listMyOrganizations = callable<ListMyOrganizationsInput, ListMyOrganizationsOutput>(
  'listMyOrganizations',
  async (request) => {
    const auth = requireAdminAuth(request as CallableRequest<unknown>);
    const membershipIndexSnapshots = await firestore()
      .collection(`users/${auth.uid}/organizationMemberships`)
      .limit(50)
      .get();
    const memberships = new Map<string, OrganizationRole>();
    const indexedOrganizationIds = membershipIndexSnapshots.docs.flatMap((snapshot) => {
      const data = snapshot.data() as MembershipDocument & { organizationId?: unknown };
      const organizationId = typeof data.organizationId === 'string' ? data.organizationId : snapshot.id;
      return activeMembership(data) && /^[A-Za-z0-9_-]{3,128}$/.test(organizationId)
        ? [organizationId]
        : [];
    });
    if (indexedOrganizationIds.length > 0) {
      const authoritativeMemberships = await firestore().getAll(
        ...indexedOrganizationIds.map((organizationId) => (
          firestore().doc(`organizations/${organizationId}/members/${auth.uid}`)
        )),
      );
      for (const snapshot of authoritativeMemberships) {
        const data = snapshot.data() as MembershipDocument | undefined;
        const organizationId = snapshot.ref.parent.parent?.id;
        if (snapshot.exists && organizationId && activeMembership(data)) {
          memberships.set(organizationId, data.role as OrganizationRole);
        }
      }
    }

    let legacyFallbackUsed = false;
    const requestedFallback = typeof request.data?.fallbackOrganizationId === 'string'
      && /^[A-Za-z0-9_-]{3,128}$/.test(request.data.fallbackOrganizationId)
      ? request.data.fallbackOrganizationId
      : DEFAULT_ORGANIZATION_ID;
    if (requestedFallback && !memberships.has(requestedFallback)) {
      const fallback = await firestore().doc(`organizations/${requestedFallback}/members/${auth.uid}`).get();
      const data = fallback.data() as MembershipDocument | undefined;
      if (fallback.exists && activeMembership(data)) {
        memberships.set(requestedFallback, data.role);
        legacyFallbackUsed = true;
      }
    }
    if (memberships.size === 0) return { organizations: [], legacyFallbackUsed };

    const organizationIds = [...memberships.keys()];
    const organizationSnapshots = await firestore().getAll(
      ...organizationIds.map((organizationId) => firestore().doc(`organizations/${organizationId}`)),
    );
    const organizations = organizationSnapshots.flatMap((snapshot) => {
      const role = memberships.get(snapshot.id);
      if (!snapshot.exists || !role) return [];
      return [summaryFromDocuments(snapshot.id, snapshot.data() as OrganizationDocument, role)];
    }).sort((left, right) => left.name.localeCompare(right.name));
    return { organizations, legacyFallbackUsed };
  },
);

const writePlatformAudit = (
  transaction: Transaction,
  organizationId: string,
  actorId: string,
  action: string,
  reason: string,
) => {
  const ref = firestore().collection(`organizations/${organizationId}/auditEvents`).doc();
  transaction.create(ref, {
    action,
    actorId,
    actorHash: createHash('sha256').update(actorId).digest('hex').slice(0, 24),
    actorEmail: '',
    actorName: 'Operador GFS',
    targetType: 'organization',
    targetId: organizationId,
    previousState: null,
    newState: null,
    reason,
    createdAt: FieldValue.serverTimestamp(),
    schemaVersion: 3,
  });
};

export const provisionOrganization = callable<ProvisionOrganizationInput, ProvisionOrganizationOutput>(
  'provisionOrganization',
  async (request) => {
    const auth = await requirePlatformAdmin(request as CallableRequest<unknown>);
    const input = request.data as ProvisionOrganizationInput;
    const organizationId = identifier(input?.organizationId, 'organizationId');
    const name = cleanText(input?.name, 'name', 120);
    const ownerUid = identifier(input?.ownerUid, 'ownerUid');
    const ownerEmail = normalizedEmail(input?.ownerEmail);
    const allowedEmailDomains = domains(input?.allowedEmailDomains);
    const retention = retentionMonths(input?.retentionMonths);
    const terms = commercialTerms(input?.commercial, false);
    const brand = branding(input?.branding, name);
    const key = idempotencyKey(input?.idempotencyKey);
    if (!allowedEmailDomains.includes(ownerEmail.split('@')[1])) {
      throw new HttpsError('invalid-argument', 'El dominio del propietario debe estar permitido.');
    }
    const owner = await getAuth().getUser(ownerUid);
    if (owner.disabled || owner.email?.trim().toLowerCase() !== ownerEmail) {
      throw new HttpsError('failed-precondition', 'La cuenta del propietario no coincide o está deshabilitada.');
    }

    const organizationRef = firestore().doc(`organizations/${organizationId}`);
    const memberRef = organizationRef.collection('members').doc(ownerUid);
    const indexRef = firestore().doc(`users/${ownerUid}/organizationMemberships/${organizationId}`);
    const commandRef = firestore().doc(`platformCommandKeys/${commandId(auth.uid, key)}`);
    const createdAt = Date.now();
    return firestore().runTransaction(async (transaction) => {
      const [commandSnapshot, organizationSnapshot] = await Promise.all([
        transaction.get(commandRef),
        transaction.get(organizationRef),
      ]);
      if (commandSnapshot.exists) return commandSnapshot.data()?.result as ProvisionOrganizationOutput;
      if (organizationSnapshot.exists) {
        throw new HttpsError('already-exists', 'La organización ya existe.');
      }
      const organization: OrganizationDocument = {
        name,
        allowedEmailDomains,
        retentionMonths: retention,
        branding: brand,
        commercial: storedCommercial(terms),
      };
      transaction.create(organizationRef, {
        ...organization,
        status: 'active',
        minimumActiveOwners: 1,
        schemaVersion: 3,
        createdBy: auth.uid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.create(memberRef, {
        uid: ownerUid,
        email: ownerEmail,
        firstName: '',
        lastName: '',
        role: 'owner',
        status: 'active',
        schemaVersion: 3,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.set(indexRef, {
        organizationId,
        role: 'owner',
        status: 'active',
        updatedAt: FieldValue.serverTimestamp(),
      });
      const result: ProvisionOrganizationOutput = {
        organization: summaryFromDocuments(organizationId, organization, 'owner'),
        ownerUid,
        createdAt,
      };
      transaction.create(commandRef, {
        operation: 'provisionOrganization',
        result,
        createdAt: FieldValue.serverTimestamp(),
      });
      writePlatformAudit(transaction, organizationId, auth.uid, 'organization.provisioned', 'Alta manual por GFS');
      return result;
    });
  },
);

export const updateOrganizationCommercial = callable<UpdateOrganizationCommercialInput, UpdateOrganizationCommercialOutput>(
  'updateOrganizationCommercial',
  async (request) => {
    const auth = await requirePlatformAdmin(request as CallableRequest<unknown>);
    const input = request.data as UpdateOrganizationCommercialInput;
    const organizationId = identifier(input?.organizationId, 'organizationId');
    const allowedEmailDomains = domains(input?.allowedEmailDomains);
    const retention = retentionMonths(input?.retentionMonths);
    const requestedTerms = commercialTerms(input?.commercial, false);
    const reason = cleanText(input?.reason, 'reason', 500);
    if (reason.length < 4) throw new HttpsError('invalid-argument', 'Indica un motivo de al menos 4 caracteres.');
    const key = idempotencyKey(input?.idempotencyKey);
    const organizationRef = firestore().doc(`organizations/${organizationId}`);
    const commandRef = firestore().doc(`platformCommandKeys/${commandId(auth.uid, key)}`);
    const updatedAt = Date.now();
    return firestore().runTransaction(async (transaction) => {
      const [commandSnapshot, organizationSnapshot] = await Promise.all([
        transaction.get(commandRef),
        transaction.get(organizationRef),
      ]);
      if (commandSnapshot.exists) return commandSnapshot.data()?.result as UpdateOrganizationCommercialOutput;
      if (!organizationSnapshot.exists) throw new HttpsError('not-found', 'La organización no existe.');
      const current = organizationSnapshot.data() as OrganizationDocument;
      const name = typeof current.name === 'string' ? current.name : organizationId;
      const currentTerms = readCommercial(current.commercial);
      if (current.commercial && !currentTerms) {
        throw new HttpsError('failed-precondition', 'La configuración comercial actual requiere revisión manual.');
      }
      const terms = preserveCommercialUsage(requestedTerms, currentTerms);
      const brand = branding(input?.branding ?? current.branding, name);
      const patch: OrganizationDocument = {
        ...current,
        allowedEmailDomains,
        retentionMonths: retention,
        branding: brand,
        commercial: storedCommercial(terms),
      };
      transaction.update(organizationRef, {
        allowedEmailDomains,
        retentionMonths: retention,
        branding: brand,
        commercial: storedCommercial(terms),
        updatedAt: FieldValue.serverTimestamp(),
      });
      const result: UpdateOrganizationCommercialOutput = {
        organization: summaryFromDocuments(organizationId, patch, 'owner'),
        updatedAt,
      };
      transaction.create(commandRef, {
        operation: 'updateOrganizationCommercial',
        result,
        createdAt: FieldValue.serverTimestamp(),
      });
      writePlatformAudit(transaction, organizationId, auth.uid, 'organization.commercialUpdated', reason);
      return result;
    });
  },
);
