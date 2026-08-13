import { HttpsError } from 'firebase-functions/v2/https';
import {
  PLATFORM_ORGANIZATION_STATUSES,
  type PlatformOrganizationStatus,
  type PlatformWorkshopAllowance,
} from '../../../shared/contracts.js';

type UnknownRecord = Record<string, unknown>;

const integer = (value: unknown): number | null => {
  const parsed = value;
  return typeof parsed === 'number' && Number.isInteger(parsed) && parsed >= 0 && parsed <= 1_000_000
    ? parsed
    : null;
};

export const timestampMillis = (value: unknown): number | null => {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value === 'object' && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis();
  }
  return null;
};

export const hasPlatformAdminClaim = (token: UnknownRecord | undefined) =>
  token?.platformAdmin === true;

export const maskPlatformEmail = (value: string) => {
  const [local = '', domain = ''] = value.trim().toLowerCase().split('@');
  if (!local || !domain) return '';
  const localHint = local.length <= 2
    ? '*'.repeat(local.length)
    : local.slice(0, 2) + '*'.repeat(Math.min(6, local.length - 2));
  const domainParts = domain.split('.');
  const domainName = domainParts.shift() ?? '';
  const suffix = domainParts.length > 0 ? '.' + domainParts.join('.') : '';
  return localHint + '@' + (domainName.slice(0, 1) || '*') + '***' + suffix;
};

const allowanceFrom = (
  contracted: unknown,
  used: unknown,
  source: PlatformWorkshopAllowance['source'],
): PlatformWorkshopAllowance | null => {
  const parsedContracted = integer(contracted);
  const parsedUsed = integer(used);
  if (parsedContracted === null || parsedUsed === null || parsedUsed > parsedContracted) return null;
  return {
    contracted: parsedContracted,
    used: parsedUsed,
    available: parsedContracted - parsedUsed,
    source,
  };
};

export const readPlatformAllowance = (organization: UnknownRecord): PlatformWorkshopAllowance => {
  const commercial = organization.commercial;
  if (commercial !== undefined && commercial !== null) {
    if (typeof commercial !== 'object') {
      throw new HttpsError('failed-precondition', 'La configuracion comercial requiere revision.');
    }
    const value = commercial as UnknownRecord;
    const included = integer(value.includedWorkshops);
    const additional = integer(value.additionalWorkshops);
    if (included !== null && additional !== null) {
      const result = allowanceFrom(included + additional, value.consumedWorkshops, 'commercial');
      if (result) return result;
    }
    throw new HttpsError('failed-precondition', 'La configuracion comercial requiere revision.');
  }

  const commercialPlan = organization.commercialPlan;
  if (commercialPlan !== undefined && commercialPlan !== null) {
    if (typeof commercialPlan !== 'object') {
      throw new HttpsError('failed-precondition', 'El plan comercial requiere revision.');
    }
    const value = commercialPlan as UnknownRecord;
    const contracted = value.workshopsContracted
      ?? value.contractedWorkshops
      ?? value.totalWorkshops
      ?? value.creditsTotal
      ?? value.credits;
    const used = value.workshopsUsed
      ?? value.usedWorkshops
      ?? value.consumedWorkshops
      ?? value.creditsUsed
      ?? 0;
    const result = allowanceFrom(contracted, used, 'commercialPlan');
    if (result) return result;
    throw new HttpsError('failed-precondition', 'El plan comercial requiere revision.');
  }

  const hasLegacyAllowance = ['workshopsContracted', 'credits', 'workshopsUsed', 'creditsUsed']
    .some((field) => organization[field] !== undefined);
  if (!hasLegacyAllowance) {
    return { contracted: 0, used: 0, available: 0, source: 'legacy' };
  }
  const legacy = allowanceFrom(
    organization.workshopsContracted ?? organization.credits ?? 0,
    organization.workshopsUsed ?? organization.creditsUsed ?? 0,
    'legacy',
  );
  if (!legacy) {
    throw new HttpsError('failed-precondition', 'Los datos comerciales legacy requieren revision.');
  }
  return legacy;
};

export const applyWorkshopAllowanceAdjustment = (
  current: PlatformWorkshopAllowance,
  contractedDelta: number,
  usedDelta: number,
): PlatformWorkshopAllowance => {
  if (!Number.isInteger(contractedDelta) || !Number.isInteger(usedDelta)
    || contractedDelta < -1_000_000 || contractedDelta > 1_000_000
    || usedDelta < -1_000_000 || usedDelta > 1_000_000
    || (contractedDelta === 0 && usedDelta === 0)) {
    throw new HttpsError('invalid-argument', 'El ajuste de partidas no es valido.');
  }
  const contracted = current.contracted + contractedDelta;
  const used = current.used + usedDelta;
  if (contracted < 0 || used < 0 || used > contracted || contracted > 1_000_000) {
    throw new HttpsError(
      'failed-precondition',
      'El ajuste dejaria un numero de partidas no valido.',
    );
  }
  return { contracted, used, available: contracted - used, source: 'commercial' };
};

export const resolvePlatformOrganizationStatus = (
  organization: UnknownRecord,
  now = Date.now(),
): PlatformOrganizationStatus => {
  const rawStored = organization.status;
  if (rawStored !== undefined
    && (typeof rawStored !== 'string'
      || !PLATFORM_ORGANIZATION_STATUSES.includes(rawStored as PlatformOrganizationStatus))) {
    throw new HttpsError('failed-precondition', 'El estado de la empresa requiere revision.');
  }
  const stored = rawStored as PlatformOrganizationStatus | undefined;
  if (stored === 'pending' || stored === 'suspended' || stored === 'expired') return stored;
  const commercial = organization.commercial;
  const commercialData = commercial && typeof commercial === 'object'
    ? commercial as UnknownRecord
    : null;
  const commercialPlanData = organization.commercialPlan
    && typeof organization.commercialPlan === 'object'
    ? organization.commercialPlan as UnknownRecord
    : null;
  const commercialStatus = commercialData?.status ?? commercialPlanData?.status;
  const explicitLegacy = organization.legacyOrganization === true
    || commercialPlanData !== null
    || ['workshopsContracted', 'credits', 'workshopsUsed', 'creditsUsed']
      .some((field) => organization[field] !== undefined);
  if (stored === undefined && commercialData === null && !explicitLegacy) {
    throw new HttpsError('failed-precondition', 'El estado de la empresa requiere revision.');
  }
  if (commercialStatus !== undefined
    && !['trial', 'active', 'suspended', 'expired'].includes(String(commercialStatus))) {
    throw new HttpsError('failed-precondition', 'El estado comercial requiere revision.');
  }
  if (commercialStatus === 'suspended' || commercialStatus === 'expired') {
    return commercialStatus;
  }
  const validUntil = commercialData
    ? timestampMillis(commercialData.validUntil)
    : commercialPlanData
      ? timestampMillis(commercialPlanData.validUntil)
      : timestampMillis(organization.validUntil);
  if (validUntil !== null && validUntil <= now) return 'expired';
  return stored ?? 'active';
};

export const assertWorkshopTenant = (
  workshopOrganizationId: unknown,
  requestedOrganizationId: string,
) => {
  if (workshopOrganizationId !== requestedOrganizationId) {
    throw new HttpsError('not-found', 'La partida no esta disponible.');
  }
};

export const normalizePlatformSearch = (value: unknown) => {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') throw new HttpsError('invalid-argument', 'La busqueda no es valida.');
  const normalized = value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  if (normalized.length > 120) throw new HttpsError('invalid-argument', 'La busqueda es demasiado larga.');
  return normalized;
};
