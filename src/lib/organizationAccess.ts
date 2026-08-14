import type {
  OrganizationRole,
  OrganizationSummary,
  PlatformOrganizationStatus,
} from '../../shared/contracts';

export const ADMIN_ACCESS_LOADING_TIMEOUT_MS = 12_000;

export const ORGANIZATION_STATUS_LABELS: Record<PlatformOrganizationStatus, string> = {
  active: 'Activa',
  pending: 'Pendiente',
  suspended: 'Suspendida',
  expired: 'Vigencia finalizada',
};

type AdminAuthToken = Record<string, unknown>;

export const hasVerifiedGfsIdentity = (token: AdminAuthToken): boolean => {
  if (token.email_verified !== true || typeof token.email !== 'string') return false;
  const normalizedEmail = token.email.trim().toLowerCase();
  const separator = normalizedEmail.indexOf('@');
  return separator > 0
    && separator === normalizedEmail.lastIndexOf('@')
    && normalizedEmail.slice(separator + 1) === 'gfs.es';
};

export const canAccessTenantReports = (
  role: OrganizationRole | null | undefined,
  verifiedGfsIdentity: boolean,
): boolean => role === 'owner' || (role === 'facilitator' && verifiedGfsIdentity);

export const organizationAccessMessage = (status: PlatformOrganizationStatus) => {
  if (status === 'pending') {
    return 'La empresa está pendiente de activación. La operativa seguirá bloqueada hasta que GFS complete el alta.';
  }
  if (status === 'suspended') {
    return 'El acceso de la empresa está suspendido. Sus datos permanecen protegidos, pero no se pueden consultar ni modificar partidas.';
  }
  if (status === 'expired') {
    return 'La vigencia comercial de la empresa ha finalizado. Contacta con GFS para renovar el acceso.';
  }
  return '';
};

export const selectOrganizationForAdmin = (
  organizations: OrganizationSummary[],
  preferredOrganizationId: string | null,
) => organizations.find((organization) => organization.id === preferredOrganizationId)
  ?? organizations.find((organization) => organization.operationalStatus === 'active')
  ?? organizations[0]
  ?? null;

export const withAdminAccessDeadline = async <Result>(
  request: Promise<Result>,
  timeoutMs = ADMIN_ACCESS_LOADING_TIMEOUT_MS,
): Promise<Result> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(Object.assign(
            new Error('La validaci\u00f3n del acceso est\u00e1 tardando demasiado. Int\u00e9ntalo de nuevo.'),
            { code: 'client/access-timeout' },
          ));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
};
