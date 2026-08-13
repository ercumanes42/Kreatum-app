export const SCHEMA_VERSION = 2 as const;
export const EXPORT_VERSION = '2.0.0' as const;
export const REPORT_TEMPLATE_VERSION = '2.1.1' as const;

export const TEAMS = ['Fuego', 'Agua', 'Aire', 'Tierra'] as const;
export type Team = (typeof TEAMS)[number];

export const PHASES = [
  'Selección',
  'Calcinar',
  'Diluir',
  'Conjugar',
  'Sublimar',
  'Fermentar',
  'Proyectar',
] as const;
export type Phase = (typeof PHASES)[number];

export const ORGANIZATION_ROLES = ['owner', 'facilitator'] as const;
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

export const ORGANIZATION_PLAN_CODES = ['pilot', 'starter', 'growth', 'enterprise'] as const;
export type OrganizationPlanCode = (typeof ORGANIZATION_PLAN_CODES)[number];

export const ORGANIZATION_SUBSCRIPTION_STATUSES = ['trial', 'active', 'suspended', 'expired'] as const;
export type OrganizationSubscriptionStatus = (typeof ORGANIZATION_SUBSCRIPTION_STATUSES)[number];

export interface OrganizationBranding {
  displayName: string;
  primaryColor?: string;
  logoUrl?: string;
}

export interface OrganizationCommercialTerms {
  plan: OrganizationPlanCode;
  status: OrganizationSubscriptionStatus;
  validFrom: number;
  validUntil: number | null;
  includedWorkshops: number;
  additionalWorkshops: number;
  consumedWorkshops: number;
}

export interface OrganizationSummary {
  id: string;
  name: string;
  role: OrganizationRole;
  operationalStatus: PlatformOrganizationStatus;
  branding: OrganizationBranding;
  allowedEmailDomains: string[];
  retentionMonths: number;
  commercial: OrganizationCommercialTerms | null;
  creditsRemaining: number | null;
}

export interface ListMyOrganizationsInput {
  fallbackOrganizationId?: string;
}

export interface ListMyOrganizationsOutput {
  organizations: OrganizationSummary[];
  legacyFallbackUsed: boolean;
}

export interface ProvisionOrganizationInput {
  organizationId: string;
  name: string;
  ownerUid: string;
  ownerEmail: string;
  allowedEmailDomains: string[];
  retentionMonths: number;
  branding?: Partial<OrganizationBranding>;
  commercial: Omit<OrganizationCommercialTerms, 'consumedWorkshops'>;
  idempotencyKey: string;
}

export interface ProvisionOrganizationOutput {
  organization: OrganizationSummary;
  ownerUid: string;
  createdAt: number;
}

export interface UpdateOrganizationCommercialInput {
  organizationId: string;
  commercial: OrganizationCommercialTerms;
  retentionMonths: number;
  allowedEmailDomains: string[];
  branding?: Partial<OrganizationBranding>;
  reason: string;
  idempotencyKey: string;
}

export interface UpdateOrganizationCommercialOutput {
  organization: OrganizationSummary;
  updatedAt: number;
}

export const MEMBER_STATUSES = ['active', 'disabled'] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export const INVITATION_STATUSES = [
  'pending',
  'deliveryFailed',
  'verificationInProgress',
  'verified',
  'accepted',
  'cancelled',
  'expired',
] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

export const WORKSHOP_STATUSES = ['active', 'completed', 'archived', 'pendingDeletion'] as const;
export type WorkshopStatus = (typeof WORKSHOP_STATUSES)[number];

export const REPORT_STATUSES = ['queued', 'generating', 'draft', 'published', 'failed'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const ROOM_CODE_MIN_LENGTH = 4;
export const ROOM_CODE_MAX_LENGTH = 10;
export const DEFAULT_RETENTION_MONTHS = 24;
export const PARTICIPANT_SESSION_TTL_MS = 5 * 60 * 1000;
export const PARTICIPANT_HEARTBEAT_INTERVAL_MS = 30 * 1000;
export const MAX_PARTICIPANT_DEVICES = 4;
export const MAX_ATTACKS_PER_TEAM = 10;
export const MAX_SHORT_TEXT_LENGTH = 240;
export const MAX_CONTENT_LENGTH = 20_000;

export const normalizeRoomCode = (value: string) => value.trim().toUpperCase();

export const isRoomCodeValid = (value: string) => {
  const code = normalizeRoomCode(value);
  return code.length >= ROOM_CODE_MIN_LENGTH
    && code.length <= ROOM_CODE_MAX_LENGTH
    && /^[A-Z0-9]+$/.test(code);
};

export const isTeam = (value: unknown): value is Team =>
  typeof value === 'string' && (TEAMS as readonly string[]).includes(value);

export const isPhase = (value: unknown): value is Phase =>
  typeof value === 'string' && (PHASES as readonly string[]).includes(value);

export const isOrganizationRole = (value: unknown): value is OrganizationRole =>
  typeof value === 'string' && (ORGANIZATION_ROLES as readonly string[]).includes(value);

export const isPhaseChangeAllowed = (
  currentPhase: Phase,
  requestedPhase: Phase,
  unlockedPhases: readonly Phase[],
) => {
  if (requestedPhase === currentPhase || unlockedPhases.includes(requestedPhase)) return true;
  const currentIndex = PHASES.indexOf(currentPhase);
  return currentIndex >= 0 && PHASES[currentIndex + 1] === requestedPhase;
};

export interface CreateWorkshopInput {
  organizationId: string;
  client: string;
  facilitator: string;
  challenge: string;
  customCode?: string;
  idempotencyKey: string;
}

export interface CreateWorkshopOutput {
  workshopId: string;
  roomCode: string;
  schemaVersion: typeof SCHEMA_VERSION;
  creditsRemaining?: number | null;
}

export interface JoinWorkshopInput {
  roomCode: string;
  idempotencyKey: string;
}

export interface JoinWorkshopOutput {
  workshopId: string;
  roomCode: string;
  status: 'active';
  team: Team | null;
  expiresAt: number;
}

export interface ResumeWorkshopInput {
  roomCode: string;
  idempotencyKey: string;
}

export interface ResumeWorkshopOutput {
  workshopId: string;
  roomCode: string;
  status: 'active';
}

export interface SelectTeamInput {
  workshopId: string;
  team: Team;
  idempotencyKey: string;
}

export interface SelectTeamOutput extends WorkshopCommandOutput {
  team: Team;
  expiresAt: number;
}

export interface HeartbeatParticipantSessionInput {
  workshopId: string;
}

export interface HeartbeatParticipantSessionOutput {
  workshopId: string;
  team: Team | null;
  expiresAt: number;
}

export interface ReleaseParticipantSessionInput {
  workshopId: string;
  participantId: string;
  reason: string;
  idempotencyKey: string;
}

export interface AdvanceWorkshopPhaseInput {
  workshopId: string;
  phase: Phase;
  idempotencyKey: string;
}

export interface CompleteWorkshopInput {
  workshopId: string;
  idempotencyKey: string;
}

export interface UpdateWorkshopControlInput {
  workshopId: string;
  sublimarDefenseUnlocked: boolean;
  idempotencyKey: string;
}

export const WORKSHOP_TRANSITION_STATES = ['requested', 'committed', 'cancelled'] as const;
export type WorkshopTransitionState = (typeof WORKSHOP_TRANSITION_STATES)[number];
export type WorkshopTransitionKind = 'phase' | 'complete';

export interface RequestWorkshopTransitionInput {
  workshopId: string;
  targetPhase?: Phase;
  complete?: boolean;
  idempotencyKey: string;
}

export interface RequestWorkshopTransitionOutput {
  workshopId: string;
  transitionId: string;
  kind: WorkshopTransitionKind;
  targetPhase: Phase | null;
  state: 'requested';
  requiredAcks: number;
  receivedAcks: number;
  expiresAt: number;
}

export interface AckWorkshopTransitionInput {
  workshopId: string;
  transitionId: string;
  idempotencyKey: string;
}

export interface AckWorkshopTransitionOutput {
  workshopId: string;
  transitionId: string;
  state: 'requested' | 'committed';
  requiredAcks: number;
  receivedAcks: number;
}

export interface CommitWorkshopTransitionInput {
  workshopId: string;
  transitionId: string;
  overrideReason?: string;
  idempotencyKey: string;
}

export interface CommitWorkshopTransitionOutput extends WorkshopCommandOutput {
  transitionId: string;
  state: 'committed';
}

export interface CancelWorkshopTransitionInput {
  workshopId: string;
  transitionId: string;
  reason: string;
  idempotencyKey: string;
}

export interface CancelWorkshopTransitionOutput extends WorkshopCommandOutput {
  transitionId: string;
  state: 'cancelled';
}

export interface SubmitWorkshopAttackInput {
  workshopId: string;
  toTeam: Team;
  content: string;
  idempotencyKey: string;
}

export interface WorkshopAttackCommandOutput extends WorkshopCommandOutput {
  attackId: string;
  attackCount: number;
}

export interface UpdateWorkshopAttackInput {
  workshopId: string;
  attackId: string;
  content: string;
  idempotencyKey: string;
}

export interface DeleteWorkshopAttackInput {
  workshopId: string;
  attackId: string;
  idempotencyKey: string;
}

export interface SaveWorkshopDefenseInput {
  workshopId: string;
  attackId: string;
  content: string;
  idempotencyKey: string;
}

export interface SaveWorkshopDefenseOutput extends WorkshopCommandOutput {
  defenseId: string;
  defenseCount: number;
}

export interface ReassignParticipantInput {
  workshopId: string;
  participantId: string;
  destinationTeam: Team | null;
  idempotencyKey: string;
}

export interface ResetWorkshopInput {
  workshopId: string;
  reason: string;
  idempotencyKey: string;
}

export interface DeleteWorkshopInput {
  workshopId: string;
  reason: string;
  idempotencyKey: string;
}

export interface RestoreWorkshopInput {
  workshopId: string;
  reason: string;
  idempotencyKey: string;
}

export interface ArchiveOrganizationWorkshopsInput {
  organizationId: string;
  reason: string;
  idempotencyKey: string;
}

export interface ArchiveOrganizationWorkshopsOutput {
  organizationId: string;
  archivedCount: number;
  updatedAt: number;
}

export interface GenerateReportSnapshotInput {
  workshopId: string;
  idempotencyKey: string;
}

export interface GenerateReportSnapshotOutput {
  workshopId: string;
  reportId: string;
  status: 'draft';
  storagePath: string;
  sourceSnapshotHash: string;
  generatedAt: number;
}

export interface GenerateReportArtifactsInput {
  workshopId: string;
  reportId: string;
  idempotencyKey: string;
}

export interface ReportArtifact {
  storagePath: string;
  sha256: string;
  size: number;
  mimeType: string;
  generatedAt: number;
  templateVersion: string;
}

export interface GenerateReportArtifactsOutput {
  workshopId: string;
  reportId: string;
  status: 'draft';
  pageCount: number;
  artifacts: {
    pdf: ReportArtifact;
    pptx: ReportArtifact;
    json: ReportArtifact;
  };
  generatedAt: number;
}

export const REPORT_JOB_STATUSES = ['queued', 'processing', 'completed', 'failed'] as const;
export type ReportJobStatus = (typeof REPORT_JOB_STATUSES)[number];

export interface QueueReportGenerationInput {
  workshopId: string;
  reportId: string;
  idempotencyKey: string;
}

export interface QueueReportGenerationOutput {
  workshopId: string;
  reportId: string;
  jobId: string;
  status: ReportJobStatus;
  createdAt: number;
}

export interface GetReportJobInput {
  workshopId: string;
  jobId: string;
}

export interface GetReportJobOutput {
  workshopId: string;
  reportId: string;
  jobId: string;
  status: ReportJobStatus;
  attempts: number;
  progress: number;
  errorCode: string | null;
  createdAt: number | null;
  updatedAt: number | null;
  completedAt: number | null;
  result: GenerateReportArtifactsOutput | null;
}

export interface ReportEditorial {
  executiveSummary: string;
  observations: string;
  nextSteps: string;
}

export interface UpdateReportEditorialInput extends ReportEditorial {
  workshopId: string;
  reportId: string;
  idempotencyKey: string;
}

export interface UpdateReportEditorialOutput {
  workshopId: string;
  reportId: string;
  status: 'draft';
  updatedAt: number;
}
export interface PublishReportInput {
  workshopId: string;
  reportId: string;
  idempotencyKey: string;
}

export interface PublishReportOutput {
  workshopId: string;
  reportId: string;
  status: 'published';
  publishedAt: number;
}
export interface WorkshopCommandOutput {
  workshopId: string;
  updatedAt: number;
}

export interface ReportRecord {
  id: string;
  workshopId: string;
  organizationId: string;
  templateVersion: string;
  sourceSchemaVersion: number;
  sourceSnapshotHash: string;
  storagePath: string;
  pageCount?: number;
  artifacts?: {
    pdf?: ReportArtifact;
    pptx?: ReportArtifact;
    json?: ReportArtifact;
  };
  status: ReportStatus;
  generatedAt?: number;
  publishedAt?: number;
  editorial?: ReportEditorial;
}
export interface TeamMemberSummary {
  uid: string;
  email: string;
  firstName: string;
  lastName: string;
  role: OrganizationRole;
  status: MemberStatus;
  createdAt: number | null;
  updatedAt: number | null;
  lastLoginAt: number | null;
  currentUser: boolean;
}

export interface TeamInvitationSummary {
  id: string;
  email: string;
  role: OrganizationRole;
  status: InvitationStatus;
  invitedByEmail: string;
  createdAt: number | null;
  expiresAt: number | null;
  resendCountLastHour: number;
}

export interface ListTeamAccessInput {
  organizationId: string;
}

export interface ListTeamAccessOutput {
  organizationId: string;
  minimumActiveOwners: number;
  activeOwnerCount: number;
  members: TeamMemberSummary[];
  invitations: TeamInvitationSummary[];
}

export interface InviteMemberInput {
  organizationId: string;
  email: string;
  role: OrganizationRole;
  idempotencyKey: string;
}

export interface InvitationCommandInput {
  organizationId: string;
  invitationId: string;
  idempotencyKey: string;
}

export interface InvitationCommandOutput {
  invitationId: string;
  status: InvitationStatus;
  updatedAt: number;
}

export interface ChangeMemberRoleInput {
  organizationId: string;
  memberId: string;
  role: OrganizationRole;
  reason?: string;
  idempotencyKey: string;
}

export interface ChangeMemberStatusInput {
  organizationId: string;
  memberId: string;
  status: MemberStatus;
  reason: string;
  idempotencyKey: string;
}

export interface MemberCommandOutput {
  memberId: string;
  role: OrganizationRole;
  status: MemberStatus;
  updatedAt: number;
}

export interface ChangePlatformFacilitatorStatusInput {
  organizationId: string;
  memberId: string;
  status: MemberStatus;
  reason: string;
  idempotencyKey: string;
}

export interface ChangePlatformFacilitatorStatusOutput {
  memberId: string;
  role: 'facilitator';
  status: MemberStatus;
  updatedAt: number;
}

export interface GetInvitationActivationInput {
  organizationId: string;
  invitationId: string;
}

export interface GetInvitationActivationOutput {
  organizationName: string;
  maskedEmail: string;
  invitedBy: string;
  expiresAt: number;
  status: 'pending' | 'deliveryFailed';
  privacyPolicyUrl: string;
  privacyVersion: string;
  termsUrl: string;
  termsVersion: string;
}

export interface VerifyInvitationCodeInput {
  organizationId: string;
  invitationId: string;
  code: string;
}

export interface VerifyInvitationCodeOutput {
  customToken: string;
  activationToken: string;
  email: string;
  expiresAt: number;
}

export interface AcceptInvitationInput {
  organizationId: string;
  invitationId: string;
  activationToken: string;
  firstName: string;
  lastName: string;
  acceptsPrivacy: boolean;
  acceptsTerms: boolean;
  privacyVersion: string;
  termsVersion: string;
  idempotencyKey: string;
}

export interface AcceptInvitationOutput {
  organizationId: string;
  memberId: string;
  role: OrganizationRole;
  status: 'active';
  acceptedAt: number;
}

export type AuditTargetType =
  | 'workshop'
  | 'member'
  | 'invitation'
  | 'report'
  | 'organization';

export interface AuditEventSummary {
  id: string;
  action: string;
  actorEmail: string;
  actorName: string;
  targetType: AuditTargetType;
  targetId: string;
  previousState: Record<string, string | number | boolean | null> | null;
  newState: Record<string, string | number | boolean | null> | null;
  reason: string | null;
  createdAt: number | null;
}

export const AUDIT_PERIOD_DAYS = [7, 30, 90] as const;
export type AuditPeriodDays = (typeof AUDIT_PERIOD_DAYS)[number];

export interface OrganizationAuditFilters {
  periodDays?: AuditPeriodDays;
  actorEmail?: string;
  action?: string;
  targetType?: AuditTargetType;
  search?: string;
}

export interface AuditCursor {
  createdAt: number;
  id: string;
}

export interface ListOrganizationAuditInput {
  organizationId: string;
  limit?: number;
  cursor?: AuditCursor | null;
  filters?: OrganizationAuditFilters;
}

export interface ListOrganizationAuditOutput {
  events: AuditEventSummary[];
  hasMore: boolean;
  nextCursor: AuditCursor | null;
}

export interface AuditActorOption {
  email: string;
  name: string;
}

export interface AuditDailyCount {
  date: string;
  count: number;
}

export interface OrganizationAuditMetrics {
  totalEvents: number;
  uniqueActors: number;
  workshopsAffected: number;
  accessOperations: number;
}

export interface GetOrganizationAuditOverviewInput {
  organizationId: string;
  filters?: OrganizationAuditFilters;
}

export interface GetOrganizationAuditOverviewOutput {
  metrics: OrganizationAuditMetrics;
  daily: AuditDailyCount[];
  actors: AuditActorOption[];
  actions: string[];
  scannedCount: number;
  truncated: boolean;
}

export type WorkshopHistoryLifecycleStatus =
  | 'active'
  | 'completed'
  | 'archived'
  | 'pendingDeletion';

export interface ExportOrganizationWorkshopHistoryInput {
  organizationId: string;
  filters?: {
    search?: string;
    status?: 'all' | WorkshopHistoryLifecycleStatus;
  };
}

export interface ExportOrganizationWorkshopHistoryOutput {
  csv: string;
  fileName: string;
  rowCount: number;
}

export const PLATFORM_ORGANIZATION_STATUSES = [
  'pending',
  'active',
  'suspended',
  'expired',
] as const;
export type PlatformOrganizationStatus = (typeof PLATFORM_ORGANIZATION_STATUSES)[number];

export interface PlatformWorkshopAllowance {
  contracted: number;
  used: number;
  available: number;
  source: 'commercial' | 'commercialPlan' | 'legacy';
}

export interface PlatformInvitationSummary {
  id: string;
  maskedEmail: string;
  role: 'facilitator';
  status: InvitationStatus;
  createdAt: number | null;
  expiresAt: number | null;
}

export interface PlatformOrganizationSummary {
  id: string;
  name: string;
  status: PlatformOrganizationStatus;
  allowedEmailDomains: string[];
  validFrom: number;
  validUntil: number | null;
  allowance: PlatformWorkshopAllowance;
  initialFacilitatorInvitation: PlatformInvitationSummary | null;
  createdAt: number | null;
  updatedAt: number | null;
  suspendedAt: number | null;
}

export interface PlatformDocumentCursor {
  documentId: string;
}

export interface ListPlatformOrganizationsInput {
  search?: string;
  status?: PlatformOrganizationStatus | 'all';
  limit?: number;
  cursor?: PlatformDocumentCursor | null;
}

export interface ListPlatformOrganizationsOutput {
  organizations: PlatformOrganizationSummary[];
  hasMore: boolean;
  nextCursor: PlatformDocumentCursor | null;
}

export interface GetPlatformOrganizationInput {
  organizationId: string;
  activityLimit?: number;
}

export interface PlatformFacilitatorSummary {
  uid: string;
  maskedEmail: string;
  displayName: string;
  status: MemberStatus;
  assignedWorkshops: number;
}

export interface PlatformActivitySummary {
  id: string;
  action: string;
  actorHash: string;
  targetType: AuditTargetType;
  targetId: string;
  workshopId: string | null;
  reason: string | null;
  createdAt: number | null;
}

export interface GetPlatformOrganizationOutput {
  organization: PlatformOrganizationSummary;
  facilitators: PlatformFacilitatorSummary[];
  recentActivity: PlatformActivitySummary[];
}

export interface ProvisionOrganizationAndInviteFacilitatorInput {
  organizationId: string;
  name: string;
  facilitatorEmail: string;
  allowedEmailDomains: string[];
  validFrom: number;
  validUntil: number | null;
  contractedWorkshops: number;
  retentionMonths?: number;
  idempotencyKey: string;
}

export interface ProvisionOrganizationAndInviteFacilitatorOutput {
  organization: PlatformOrganizationSummary;
  invitation: PlatformInvitationSummary;
  createdAt: number;
}

export interface UpdatePlatformOrganizationInput {
  organizationId: string;
  name: string;
  allowedEmailDomains: string[];
  validFrom: number;
  validUntil: number | null;
  retentionMonths?: number;
  reason: string;
  idempotencyKey: string;
}

export interface PlatformOrganizationCommandInput {
  organizationId: string;
  reason: string;
  idempotencyKey: string;
}

export interface PlatformOrganizationCommandOutput {
  organization: PlatformOrganizationSummary;
  updatedAt: number;
}

export interface PlatformInvitationCommandInput {
  organizationId: string;
  invitationId: string;
  reason: string;
  idempotencyKey: string;
}

export interface AdjustWorkshopAllowanceInput {
  organizationId: string;
  contractedDelta: number;
  usedDelta: number;
  reason: string;
  idempotencyKey: string;
}

export interface AdjustWorkshopAllowanceOutput {
  organizationId: string;
  allowance: PlatformWorkshopAllowance;
  adjustmentId: string;
  updatedAt: number;
}

export interface AssignWorkshopFacilitatorInput {
  organizationId: string;
  workshopId: string;
  facilitatorUid: string;
  reason: string;
  idempotencyKey: string;
}

export interface AssignWorkshopFacilitatorOutput {
  organizationId: string;
  workshopId: string;
  facilitatorUid: string;
  updatedAt: number;
}

export interface PlatformWorkshopSummary {
  id: string;
  organizationId: string;
  organizationName: string;
  client: string;
  facilitator: string;
  facilitatorUid: string;
  status: WorkshopStatus;
  currentPhase: Phase;
  createdAt: number | null;
  updatedAt: number | null;
}

export interface ListPlatformWorkshopsInput {
  organizationId?: string;
  facilitatorUid?: string;
  status?: WorkshopStatus | 'all';
  search?: string;
  limit?: number;
  cursor?: PlatformDocumentCursor | null;
}

export interface ListPlatformWorkshopsOutput {
  workshops: PlatformWorkshopSummary[];
  hasMore: boolean;
  nextCursor: PlatformDocumentCursor | null;
}

export interface GetPlatformWorkshopDataInput {
  organizationId: string;
  workshopId: string;
  reason?: string;
}

export interface PlatformReportSummary {
  id: string;
  status: ReportStatus;
  generatedAt: number | null;
  publishedAt: number | null;
  artifacts: Partial<Record<'json' | 'pdf' | 'pptx', ReportArtifact>>;
}

export interface GetPlatformWorkshopDataOutput {
  workshop: PlatformWorkshopSummary;
  dataset: Record<string, unknown>;
  reports: PlatformReportSummary[];
}

export interface GeneratePlatformReportSnapshotInput {
  organizationId: string;
  workshopId: string;
  reason: string;
  idempotencyKey: string;
}

export interface QueuePlatformReportGenerationInput {
  organizationId: string;
  workshopId: string;
  reportId: string;
  reason: string;
  idempotencyKey: string;
}

export interface GetPlatformReportJobInput {
  organizationId: string;
  workshopId: string;
  jobId: string;
}

export type PlatformReportFormat = 'json' | 'pdf' | 'pptx';

export interface CreatePlatformReportDownloadInput {
  organizationId: string;
  workshopId: string;
  reportId: string;
  format: PlatformReportFormat;
  reason: string;
  idempotencyKey: string;
}

export interface CreatePlatformReportDownloadOutput {
  organizationId: string;
  workshopId: string;
  reportId: string;
  format: PlatformReportFormat;
  url: string;
  expiresAt: number;
}

export interface ReconnectParticipantSessionInput {
  workshopId: string;
  team: Team;
  idempotencyKey: string;
}

export interface ReconnectParticipantSessionOutput {
  workshopId: string;
  roomCode: string;
  team: Team;
  expiresAt: number;
  currentPhase: Phase;
  unlockedPhases: Phase[];

}
export interface CreateReportDownloadInput {
  workshopId: string;
  reportId: string;
  format: PlatformReportFormat;
  idempotencyKey: string;
}

export interface CreateReportDownloadOutput {
  workshopId: string;
  reportId: string;
  format: PlatformReportFormat;
  url: string;
  expiresAt: number;
}