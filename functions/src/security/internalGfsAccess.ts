import { hasAllowedEmailDomain } from '../access/accessSecurity.js';

export const INTERNAL_GFS_EMAIL_DOMAIN = 'gfs.es';

type InternalGfsAuthToken = {
  email?: unknown;
  email_verified?: unknown;
};

export const hasInternalGfsWorkshopPrivilege = (
  token: InternalGfsAuthToken,
) => {
  if (token.email_verified !== true
    || typeof token.email !== 'string') {
    return false;
  }
  return hasAllowedEmailDomain(token.email, [INTERNAL_GFS_EMAIL_DOMAIN]);
};

export const visibleWorkshopCredits = (
  creditsRemaining: number | null,
  hasInternalPrivilege: boolean,
) => hasInternalPrivilege ? null : creditsRemaining;
