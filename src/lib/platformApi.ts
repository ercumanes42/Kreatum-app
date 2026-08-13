import { httpsCallable } from 'firebase/functions';
import type { Phase } from '../types';
import { functionsClient } from './firebase';

export type PlatformOrganizationStatus = 'pending' | 'active' | 'suspended' | 'expired';
export type PlatformMemberStatus = 'active' | 'disabled';
export type PlatformTimestamp = number | string | { seconds?: number; _seconds?: number } | null | undefined;

export interface PlatformWorkshopAllowance {
  contracted: number;
  used: number;
  available: number;
  source?: string;
}

export interface PlatformInvitationSummary {
  id: string;
  status: string;
  maskedEmail?: string;
  expiresAt?: PlatformTimestamp;
  deliveryStatus?: string;
}

export interface PlatformOrganization {
  id: string;
  name: string;
  status: PlatformOrganizationStatus;
  allowedEmailDomains: string[];
  validFrom: PlatformTimestamp;
  validUntil: PlatformTimestamp;
  allowance: PlatformWorkshopAllowance;
  initialFacilitatorInvitation?: PlatformInvitationSummary | null;
  createdAt?: PlatformTimestamp;
  updatedAt?: PlatformTimestamp;
}

export interface PlatformDocumentCursor {
  documentId: string;
}

export interface PlatformFacilitator {
  uid: string;
  displayName?: string;
  maskedEmail?: string;
  status: PlatformMemberStatus;
  assignedWorkshops: number;
}

export interface PlatformActivityItem {
  id: string;
  action: string;
  actorHash: string;
  targetType: 'workshop' | 'member' | 'invitation' | 'report' | 'organization';
  targetId: string;
  workshopId: string | null;
  reason: string | null;
  createdAt: PlatformTimestamp;
}

export interface PlatformWorkshop {
  id: string;
  organizationId: string;
  organizationName?: string;
  client?: string;
  facilitator?: string;
  facilitatorUid?: string | null;
  status: string;
  currentPhase?: Phase;
  createdAt?: PlatformTimestamp;
  updatedAt?: PlatformTimestamp;
  activeReportJobId?: string | null;
}

export interface PlatformReportRecord {
  id: string;
  status: string;
  version?: number;
  generatedAt?: PlatformTimestamp;
  publishedAt?: PlatformTimestamp;
}

export interface PlatformOrganizationDetail {
  organization: PlatformOrganization;
  facilitators: PlatformFacilitator[];
  recentActivity: PlatformActivityItem[];
}

export interface PlatformWorkshopData {
  workshop: PlatformWorkshop;
  dataset: Record<string, unknown>;
  reports: PlatformReportRecord[];
}

interface CursorPage {
  hasMore: boolean;
  nextCursor: PlatformDocumentCursor | null;
}

export interface PlatformOrganizationPage extends CursorPage {
  organizations: PlatformOrganization[];
}

export interface PlatformWorkshopPage extends CursorPage {
  workshops: PlatformWorkshop[];
}

export interface PlatformReportJob {
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  error?: string | null;
}

export interface PlatformProvisionOutput {
  organization: PlatformOrganization;
  invitation: PlatformInvitationSummary;
  createdAt: number;
}

export interface ReconnectParticipantSessionOutput {
  workshopId: string;
  roomCode: string;
  team: 'Agua' | 'Aire' | 'Fuego' | 'Tierra';
  expiresAt: number;
  currentPhase: Phase;
  unlockedPhases: Phase[];
}

const CALLABLE_TIMEOUT_MS = 30_000;
const RETRYABLE_CODES = new Set([
  'client/timeout',
  'functions/unavailable',
  'functions/deadline-exceeded',
]);

const wait = (milliseconds: number) => new Promise<void>((resolve) => {
  window.setTimeout(resolve, milliseconds);
});

const callable = <Input, Output>(name: string) => {
  const invoke = httpsCallable<Input, Output>(functionsClient, name);
  return async (input: Input): Promise<Output> => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let timeoutId: number | undefined;
      try {
        const timeout = new Promise<never>((_, reject) => {
          timeoutId = window.setTimeout(() => reject(Object.assign(
            new Error('La operación está tardando demasiado.'),
            { code: 'client/timeout' },
          )), CALLABLE_TIMEOUT_MS);
        });
        const result = await Promise.race([invoke(input), timeout]);
        return result.data;
      } catch (error: unknown) {
        lastError = error;
        const code = error && typeof error === 'object' && 'code' in error
          ? String(error.code)
          : '';
        if (attempt === 1 || !RETRYABLE_CODES.has(code)) throw error;
        await wait(400);
      } finally {
        if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      }
    }
    throw lastError;
  };
};

export const platformApi = {
  listOrganizations: (input: { search?: string; status?: string; limit: number; cursor?: PlatformDocumentCursor }) =>
    callable<typeof input, PlatformOrganizationPage>('listPlatformOrganizations')(input),
  getOrganization: (input: { organizationId: string; activityLimit?: number }) =>
    callable<typeof input, PlatformOrganizationDetail>('getPlatformOrganization')(input),
  provisionOrganization: (input: {
    organizationId: string;
    name: string;
    allowedEmailDomains: string[];
    validFrom: number;
    validUntil: number | null;
    contractedWorkshops: number;
    facilitatorEmail: string;
    idempotencyKey: string;
  }) => callable<typeof input, PlatformProvisionOutput>(
    'provisionOrganizationAndInviteFacilitator',
  )(input),
  updateOrganization: (input: {
    organizationId: string;
    name: string;
    allowedEmailDomains: string[];
    validFrom: number;
    validUntil: number | null;
    reason: string;
    idempotencyKey: string;
  }) => callable<typeof input, { organization: PlatformOrganization; updatedAt: number }>('updatePlatformOrganization')(input),
  suspendOrganization: (input: { organizationId: string; reason: string; idempotencyKey: string }) =>
    callable<typeof input, { organization: PlatformOrganization; updatedAt: number }>('suspendPlatformOrganization')(input),
  reactivateOrganization: (input: { organizationId: string; reason: string; idempotencyKey: string }) =>
    callable<typeof input, { organization: PlatformOrganization; updatedAt: number }>('reactivatePlatformOrganization')(input),
  resendInvitation: (input: { organizationId: string; invitationId: string; reason: string; idempotencyKey: string }) =>
    callable<typeof input, unknown>('resendPlatformFacilitatorInvitation')(input),
  cancelInvitation: (input: { organizationId: string; invitationId: string; reason: string; idempotencyKey: string }) =>
    callable<typeof input, unknown>('cancelPlatformFacilitatorInvitation')(input),
  adjustWorkshopAllowance: (input: {
    organizationId: string;
    contractedDelta: number;
    usedDelta: number;
    reason: string;
    idempotencyKey: string;
  }) => callable<typeof input, { organizationId: string; allowance: PlatformWorkshopAllowance }>('adjustWorkshopAllowance')(input),
  assignWorkshopFacilitator: (input: {
    organizationId: string;
    workshopId: string;
    facilitatorUid: string;
    reason: string;
    idempotencyKey: string;
  }) => callable<typeof input, { organizationId: string; workshopId: string; facilitatorUid: string }>('assignWorkshopFacilitator')(input),
  changeFacilitatorStatus: (input: {
    organizationId: string;
    memberId: string;
    status: PlatformMemberStatus;
    reason: string;
    idempotencyKey: string;
  }) => callable<typeof input, {
    memberId: string;
    role: 'facilitator';
    status: PlatformMemberStatus;
    updatedAt: number;
  }>('changePlatformFacilitatorStatus')(input),
  listWorkshops: (input: {
    organizationId?: string;
    search?: string;
    status?: string;
    limit: number;
    cursor?: PlatformDocumentCursor;
  }) => callable<typeof input, PlatformWorkshopPage>('listPlatformWorkshops')(input),
  getWorkshopData: (input: { organizationId: string; workshopId: string; reason: string }) =>
    callable<typeof input, PlatformWorkshopData>('getPlatformWorkshopData')(input),
  generateReportSnapshot: (input: { organizationId: string; workshopId: string; reason: string; idempotencyKey: string }) =>
    callable<typeof input, { reportId: string; snapshotId?: string; sourceSnapshotHash?: string }>(
      'generatePlatformReportSnapshot',
    )(input),
  queueReportGeneration: (input: { organizationId: string; workshopId: string; reportId: string; reason: string; idempotencyKey: string }) =>
    callable<typeof input, PlatformReportJob>('queuePlatformReportGeneration')(input),
  getReportJob: (input: { organizationId: string; workshopId: string; jobId: string }) =>
    callable<typeof input, PlatformReportJob>('getPlatformReportJob')(input),
  createReportDownload: (input: {
    organizationId: string;
    workshopId: string;
    reportId: string;
    format: 'pdf' | 'pptx' | 'json';
    reason: string;
    idempotencyKey: string;
  }) => callable<typeof input, { url: string; expiresAt: number }>('createPlatformReportDownload')(input),
};

export const participantRecoveryApi = {
  reconnect: (input: {
    workshopId: string;
    team: 'Agua' | 'Aire' | 'Fuego' | 'Tierra';
    idempotencyKey: string;
  }) => callable<typeof input, ReconnectParticipantSessionOutput>('reconnectParticipantSession')(input),
};
