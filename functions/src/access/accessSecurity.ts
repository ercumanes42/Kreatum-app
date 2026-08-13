import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import {
  ORGANIZATION_ROLES,
  type OrganizationRole,
} from '../../../shared/contracts.js';

export const ACCESS_SCHEMA_VERSION = 3 as const;
export const INVITATION_CODE_TTL_MS = 10 * 60 * 1000;
export const INVITATION_ACTIVATION_TTL_MS = 15 * 60 * 1000;
export const INVITATION_MAX_ATTEMPTS = 5;
export const INVITATION_MAX_RESENDS_PER_HOUR = 3;
export const INVITATION_RESEND_WINDOW_MS = 60 * 60 * 1000;
export const MINIMUM_ACTIVE_OWNERS = 1;
export const RECOMMENDED_ACTIVE_OWNERS = 2;

export const normalizeEmail = (value: string) => value.trim().toLowerCase();

export const emailDomain = (value: string) => {
  const normalized = normalizeEmail(value);
  const separator = normalized.lastIndexOf('@');
  return separator > 0 ? normalized.slice(separator + 1) : '';
};

export const hasAllowedEmailDomain = (
  email: string,
  allowedDomains: readonly string[],
) => {
  const domain = emailDomain(email);
  return domain.length > 0 && allowedDomains
    .map((item) => item.trim().toLowerCase())
    .includes(domain);
};

export const isOrganizationRole = (value: unknown): value is OrganizationRole =>
  typeof value === 'string'
  && (ORGANIZATION_ROLES as readonly string[]).includes(value);

export const generateInvitationCode = () => randomInt(0, 1_000_000)
  .toString()
  .padStart(6, '0');

const hmac = (value: string, pepper: string) =>
  createHmac('sha256', pepper).update(value).digest('hex');

export const hashInvitationCode = (
  code: string,
  pepper: string,
  invitationId: string,
) => hmac(`code:${invitationId}:${code}`, pepper);

export const hashActivationToken = (
  token: string,
  pepper: string,
  invitationId: string,
) => hmac(`activation:${invitationId}:${token}`, pepper);

export const secureHashEquals = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === rightBuffer.length
    && leftBuffer.length > 0
    && timingSafeEqual(leftBuffer, rightBuffer);
};

export const invitationAuthErrorCode = (error: unknown) => {
  if (!error || typeof error !== 'object') return '';
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : '';
};

export const isInvitationTokenSigningConfigurationError = (error: unknown) => {
  const code = invitationAuthErrorCode(error);
  if (code === 'auth/insufficient-permission' || code === 'app/invalid-credential') return true;
  if (!(error instanceof Error)) return false;
  return error.message.includes('iam.serviceAccounts.signBlob')
    || error.message.includes('Service Account Token Creator');
};

export const isInvitationExpired = (expiresAtMs: number, nowMs = Date.now()) =>
  !Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs;

export const nextAttemptCount = (current: number) => Math.max(0, current) + 1;

export const hasAttemptsRemaining = (attemptCount: number) =>
  attemptCount < INVITATION_MAX_ATTEMPTS;

export const recentResendTimestamps = (
  timestamps: readonly number[],
  nowMs = Date.now(),
) => timestamps.filter((value) => (
  Number.isFinite(value)
  && value > nowMs - INVITATION_RESEND_WINDOW_MS
  && value <= nowMs
));

export const canResendInvitation = (
  timestamps: readonly number[],
  nowMs = Date.now(),
) => recentResendTimestamps(timestamps, nowMs).length
  < INVITATION_MAX_RESENDS_PER_HOUR;

export const wouldRemoveLastOwner = (
  activeOwnerCount: number,
  currentRole: OrganizationRole,
  currentStatus: 'active' | 'disabled',
  requestedRole: OrganizationRole,
  requestedStatus: 'active' | 'disabled',
) => currentRole === 'owner'
  && currentStatus === 'active'
  && (requestedRole !== 'owner' || requestedStatus !== 'active')
  && activeOwnerCount <= MINIMUM_ACTIVE_OWNERS;

export const sanitizeReason = (value: unknown) => {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);
};

export const sanitizePersonName = (value: unknown) => {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001F\u007F<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
};

export const maskEmail = (email: string) => {
  const normalized = normalizeEmail(email);
  const [localPart, domain = ''] = normalized.split('@');
  if (!localPart || !domain) return 'correo no disponible';
  const visible = localPart.slice(0, Math.min(2, localPart.length));
  return `${visible}${'*'.repeat(Math.max(3, localPart.length - visible.length))}@${domain}`;
};

export const invitationDocumentId = (email: string, pepper: string) =>
  hmac(`invitation:${normalizeEmail(email)}`, pepper).slice(0, 40);

export const sanitizeAuditState = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const allowed = new Set([
    'role', 'status', 'phase', 'reportStatus', 'ownerCount', 'bulk',
  ]);
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (!allowed.has(key)) continue;
    if (
      typeof nested === 'string'
      || typeof nested === 'number'
      || typeof nested === 'boolean'
      || nested === null
    ) result[key] = nested;
  }
  return Object.keys(result).length > 0 ? result : null;
};
