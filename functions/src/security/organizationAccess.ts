import { Timestamp, type DocumentData, type DocumentSnapshot } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

export type OrganizationAccessBlock = 'pending' | 'suspended' | 'expired';

const toMillis = (value: unknown): number | null => {
  if (value instanceof Timestamp) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
};

export const organizationAccessBlock = (
  organization: DocumentData | undefined,
  now = Date.now(),
): OrganizationAccessBlock | null => {
  if (!organization) return 'suspended';
  const status = organization.status;
  if (typeof status !== 'string') return 'suspended';
  if (status === 'pending') return 'pending';
  if (status === 'suspended') return 'suspended';
  if (status === 'expired') return 'expired';
  if (status !== 'active') return 'suspended';

  const commercial = organization.commercial;
  const schemaVersion = Number(organization.schemaVersion);
  if (commercial === null || commercial === undefined) {
    const explicitLegacy = schemaVersion <= 2 && organization.legacyCommercialAccess === true;
    return explicitLegacy ? null : 'suspended';
  }
  if (typeof commercial !== 'object') return 'suspended';
  const commercialStatus = typeof commercial.status === 'string'
    ? commercial.status
    : 'invalid';
  if (commercialStatus === 'suspended') return 'suspended';
  if (commercialStatus === 'expired') return 'expired';
  if (!['trial', 'active'].includes(commercialStatus)) return 'suspended';

  const validFrom = toMillis(commercial.validFrom);
  const validUntil = toMillis(commercial.validUntil);
  if (validFrom === null) return 'suspended';
  if (validFrom !== null && validFrom > now) return 'pending';
  if (commercial.validUntil !== null && commercial.validUntil !== undefined
    && (validUntil === null || validUntil <= now)) return 'expired';
  return null;
};

export const organizationBlockMessage = (block: OrganizationAccessBlock) => {
  if (block === 'pending') {
    return 'La empresa todavía no está activa. El facilitador inicial debe aceptar la invitación.';
  }
  if (block === 'expired') {
    return 'La vigencia de la empresa ha caducado. Contacta con GFS para reactivarla.';
  }
  return 'La empresa está suspendida. Contacta con GFS para reactivarla.';
};

export const assertOrganizationOperational = (
  snapshot: DocumentSnapshot,
  options: { allowPending?: boolean; now?: number } = {},
) => {
  if (!snapshot.exists) {
    throw new HttpsError('not-found', 'La empresa no está disponible.');
  }
  const block = organizationAccessBlock(snapshot.data(), options.now);
  if (block && !(block === 'pending' && options.allowPending)) {
    throw new HttpsError('failed-precondition', organizationBlockMessage(block), {
      reason: `organization-${block}`,
    });
  }
  return snapshot.data() ?? {};
};
