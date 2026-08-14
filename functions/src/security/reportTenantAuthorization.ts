import type { OrganizationRole } from '../../../shared/contracts.js';
import { hasInternalGfsWorkshopPrivilege } from './internalGfsAccess.js';

type ReportAuthToken = {
  email?: unknown;
  email_verified?: unknown;
};

type ReportMembership = {
  role?: unknown;
  status?: unknown;
};

type ReportWorkshop = {
  facilitatorUid?: unknown;
};

const OWNER_REPORT_ROLES: readonly OrganizationRole[] = ['owner'];
const INTERNAL_GFS_REPORT_ROLES: readonly OrganizationRole[] = ['owner', 'facilitator'];

export const tenantReportRolesForToken = (
  token: ReportAuthToken,
): readonly OrganizationRole[] => hasInternalGfsWorkshopPrivilege(token)
  ? INTERNAL_GFS_REPORT_ROLES
  : OWNER_REPORT_ROLES;

export const hasTenantReportAccess = (
  uid: string,
  token: ReportAuthToken,
  membership: ReportMembership,
  workshop: ReportWorkshop,
) => {
  if (membership.status !== 'active') return false;
  if (membership.role === 'owner') return true;
  return membership.role === 'facilitator'
    && workshop.facilitatorUid === uid
    && hasInternalGfsWorkshopPrivilege(token);
};
