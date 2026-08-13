import { httpsCallable } from 'firebase/functions';
import type {
  AcceptInvitationInput,
  AcceptInvitationOutput,
  AdvanceWorkshopPhaseInput,
  ArchiveOrganizationWorkshopsInput,
  ArchiveOrganizationWorkshopsOutput,
  ChangeMemberRoleInput,
  AckWorkshopTransitionInput,
  AckWorkshopTransitionOutput,
  ChangeMemberStatusInput,
  CompleteWorkshopInput,
  CreateWorkshopInput,
  CreateWorkshopOutput,
  DeleteWorkshopAttackInput,
  SaveWorkshopDefenseInput,
  SaveWorkshopDefenseOutput,
  SubmitWorkshopAttackInput,
  UpdateWorkshopAttackInput,
  WorkshopAttackCommandOutput,
  DeleteWorkshopInput,
  ExportOrganizationWorkshopHistoryInput,
  ExportOrganizationWorkshopHistoryOutput,
  CancelWorkshopTransitionInput,
  CancelWorkshopTransitionOutput,
  CommitWorkshopTransitionInput,
  CommitWorkshopTransitionOutput,
  GenerateReportSnapshotInput,
  GenerateReportSnapshotOutput,
  CreateReportDownloadInput,
  CreateReportDownloadOutput,
  GetReportJobInput,
  GetReportJobOutput,
  QueueReportGenerationInput,
  QueueReportGenerationOutput,
  GetOrganizationAuditOverviewInput,
  GetOrganizationAuditOverviewOutput,
  GetInvitationActivationInput,
  GetInvitationActivationOutput,
  InvitationCommandInput,
  InvitationCommandOutput,
  InviteMemberInput,
  JoinWorkshopInput,
  JoinWorkshopOutput,
  ListOrganizationAuditInput,
  HeartbeatParticipantSessionInput,
  HeartbeatParticipantSessionOutput,
  ListOrganizationAuditOutput,
  ListMyOrganizationsInput,
  ListMyOrganizationsOutput,
  ListTeamAccessInput,
  ListTeamAccessOutput,
  MemberCommandOutput,
  PublishReportInput,
  PublishReportOutput,
  ProvisionOrganizationInput,
  ProvisionOrganizationOutput,
  ReleaseParticipantSessionInput,
  ReassignParticipantInput,
  ResetWorkshopInput,
  RestoreWorkshopInput,
  ResumeWorkshopInput,
  ResumeWorkshopOutput,
  SelectTeamInput,
  UpdateReportEditorialInput,
  UpdateReportEditorialOutput,
  UpdateWorkshopControlInput,
  UpdateOrganizationCommercialInput,
  UpdateOrganizationCommercialOutput,
  VerifyInvitationCodeInput,
  VerifyInvitationCodeOutput,
  RequestWorkshopTransitionInput,
  RequestWorkshopTransitionOutput,
  WorkshopCommandOutput,
} from '../../shared/contracts';
import { functionsClient } from './firebase';

const CALLABLE_TIMEOUT_MS = 30_000;
const CALLABLE_MAX_ATTEMPTS = 2;
const RETRYABLE_CALLABLE_CODES = new Set([
  'client/timeout',
  'functions/unavailable',
  'functions/deadline-exceeded',
]);

const wait = (milliseconds: number) => new Promise<void>((resolve) => {
  window.setTimeout(resolve, milliseconds);
});

const callable = <Input, Output>(name: string) => {
  const invoke = httpsCallable<Input, Output>(functionsClient, name);
  return async (input: Input) => {
    let lastError: unknown;
    for (let attempt = 0; attempt < CALLABLE_MAX_ATTEMPTS; attempt += 1) {
      let timeoutId: number | undefined;
      try {
        const timeout = new Promise<never>((_, reject) => {
          timeoutId = window.setTimeout(() => {
            reject(Object.assign(
              new Error('La operación está tardando demasiado. Inténtalo de nuevo.'),
              { code: 'client/timeout' },
            ));
          }, CALLABLE_TIMEOUT_MS);
        });
        return await Promise.race([invoke(input), timeout]);
      } catch (error: unknown) {
        lastError = error;
        const code = typeof error === 'object' && error && 'code' in error
          ? String(error.code)
          : '';
        if (attempt + 1 >= CALLABLE_MAX_ATTEMPTS || !RETRYABLE_CALLABLE_CODES.has(code)) throw error;
        await wait(400 * (attempt + 1));
      } finally {
        if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      }
    }
    throw lastError;
  };
};
export const createIdempotencyKey = (operation: string) => {
  const randomPart = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return operation + ':' + randomPart;
};

export const workshopApi = {
  listMyOrganizations: (input: ListMyOrganizationsInput = {}) =>
    callable<ListMyOrganizationsInput, ListMyOrganizationsOutput>(
      'listMyOrganizations',
    )(input).then((result) => result.data),

  provisionOrganization: (input: ProvisionOrganizationInput) =>
    callable<ProvisionOrganizationInput, ProvisionOrganizationOutput>(
      'provisionOrganization',
    )(input).then((result) => result.data),

  updateOrganizationCommercial: (input: UpdateOrganizationCommercialInput) =>
    callable<UpdateOrganizationCommercialInput, UpdateOrganizationCommercialOutput>(
      'updateOrganizationCommercial',
    )(input).then((result) => result.data),
  createWorkshop: (input: CreateWorkshopInput) =>
    callable<CreateWorkshopInput, CreateWorkshopOutput>('createWorkshop')(input)
      .then((result) => result.data),

  joinWorkshopByCode: (input: JoinWorkshopInput) =>
    callable<JoinWorkshopInput, JoinWorkshopOutput>('joinWorkshopByCode')(input)
      .then((result) => result.data),

  resumeWorkshopByCode: (input: ResumeWorkshopInput) =>
    callable<ResumeWorkshopInput, ResumeWorkshopOutput>(
      'resumeWorkshopByCode',
    )(input).then((result) => result.data),

  selectTeam: (input: SelectTeamInput) =>
    callable<SelectTeamInput, WorkshopCommandOutput>('selectTeam')(input)
      .then((result) => result.data),

  advanceWorkshopPhase: (input: AdvanceWorkshopPhaseInput) =>
    callable<AdvanceWorkshopPhaseInput, WorkshopCommandOutput>(
      'advanceWorkshopPhase',
    )(input).then((result) => result.data),

  completeWorkshop: (input: CompleteWorkshopInput) =>
    callable<CompleteWorkshopInput, WorkshopCommandOutput>('completeWorkshop')(input)
      .then((result) => result.data),

  updateWorkshopControl: (input: UpdateWorkshopControlInput) =>
    callable<UpdateWorkshopControlInput, WorkshopCommandOutput>(
      'updateWorkshopControl',
    )(input).then((result) => result.data),

  reassignParticipant: (input: ReassignParticipantInput) =>
    callable<ReassignParticipantInput, WorkshopCommandOutput>(
      'reassignParticipant',
    )(input).then((result) => result.data),

  releaseParticipantSession: (input: ReleaseParticipantSessionInput) =>
    callable<ReleaseParticipantSessionInput, WorkshopCommandOutput>(
      'releaseParticipantSession',
    )(input).then((result) => result.data),

  resetWorkshop: (input: ResetWorkshopInput) =>
    callable<ResetWorkshopInput, WorkshopCommandOutput>('resetWorkshop')(input)
      .then((result) => result.data),

  heartbeatParticipantSession: (input: HeartbeatParticipantSessionInput) =>
    callable<HeartbeatParticipantSessionInput, HeartbeatParticipantSessionOutput>(
      'heartbeatParticipantSession',
    )(input).then((result) => result.data),

  requestWorkshopTransition: (input: RequestWorkshopTransitionInput) =>
    callable<RequestWorkshopTransitionInput, RequestWorkshopTransitionOutput>(
      'requestWorkshopTransition',
    )(input).then((result) => result.data),

  acknowledgeWorkshopTransition: (input: AckWorkshopTransitionInput) =>
    callable<AckWorkshopTransitionInput, AckWorkshopTransitionOutput>(
      'acknowledgeWorkshopTransition',
    )(input).then((result) => result.data),

  commitWorkshopTransition: (input: CommitWorkshopTransitionInput) =>
    callable<CommitWorkshopTransitionInput, CommitWorkshopTransitionOutput>(
      'commitWorkshopTransition',
    )(input).then((result) => result.data),

  cancelWorkshopTransition: (input: CancelWorkshopTransitionInput) =>
    callable<CancelWorkshopTransitionInput, CancelWorkshopTransitionOutput>(
      'cancelWorkshopTransition',
    )(input).then((result) => result.data),

  submitWorkshopAttack: (input: SubmitWorkshopAttackInput) =>
    callable<SubmitWorkshopAttackInput, WorkshopAttackCommandOutput>(
      'submitWorkshopAttack',
    )(input).then((result) => result.data),

  updateWorkshopAttack: (input: UpdateWorkshopAttackInput) =>
    callable<UpdateWorkshopAttackInput, WorkshopCommandOutput>(
      'updateWorkshopAttack',
    )(input).then((result) => result.data),

  deleteWorkshopAttack: (input: DeleteWorkshopAttackInput) =>
    callable<DeleteWorkshopAttackInput, WorkshopCommandOutput>(
      'deleteWorkshopAttack',
    )(input).then((result) => result.data),

  saveWorkshopDefense: (input: SaveWorkshopDefenseInput) =>
    callable<SaveWorkshopDefenseInput, SaveWorkshopDefenseOutput>(
      'saveWorkshopDefense',
    )(input).then((result) => result.data),
  deleteWorkshop: (input: DeleteWorkshopInput) =>
    callable<DeleteWorkshopInput, WorkshopCommandOutput>('deleteWorkshop')(input)
      .then((result) => result.data),

  restoreWorkshop: (input: RestoreWorkshopInput) =>
    callable<RestoreWorkshopInput, WorkshopCommandOutput>('restoreWorkshop')(input)
      .then((result) => result.data),

  archiveOrganizationWorkshops: (input: ArchiveOrganizationWorkshopsInput) =>
    callable<ArchiveOrganizationWorkshopsInput, ArchiveOrganizationWorkshopsOutput>(
      'archiveOrganizationWorkshops',
    )(input).then((result) => result.data),

  generateReportSnapshot: (input: GenerateReportSnapshotInput) =>
    callable<GenerateReportSnapshotInput, GenerateReportSnapshotOutput>(
      'generateReportSnapshot',
    )(input).then((result) => result.data),

  queueReportGeneration: (input: QueueReportGenerationInput) =>
    callable<QueueReportGenerationInput, QueueReportGenerationOutput>(
      'queueReportGeneration',
    )(input).then((result) => result.data),

  getReportJob: (input: GetReportJobInput) =>
    callable<GetReportJobInput, GetReportJobOutput>(
      'getReportJob',
    )(input).then((result) => result.data),

  updateReportEditorial: (input: UpdateReportEditorialInput) =>
    callable<UpdateReportEditorialInput, UpdateReportEditorialOutput>(
      'updateReportEditorial',
    )(input).then((result) => result.data),

  createReportDownload: (input: CreateReportDownloadInput) =>
    callable<CreateReportDownloadInput, CreateReportDownloadOutput>(
      'createReportDownload',
    )(input).then((result) => result.data),

  publishReport: (input: PublishReportInput) =>
    callable<PublishReportInput, PublishReportOutput>('publishReport')(input)
      .then((result) => result.data),

  listTeamAccess: (input: ListTeamAccessInput) =>
    callable<ListTeamAccessInput, ListTeamAccessOutput>('listTeamAccess')(input)
      .then((result) => result.data),

  inviteMember: (input: InviteMemberInput) =>
    callable<InviteMemberInput, InvitationCommandOutput>('inviteMember')(input)
      .then((result) => result.data),

  resendInvitation: (input: InvitationCommandInput) =>
    callable<InvitationCommandInput, InvitationCommandOutput>('resendInvitation')(input)
      .then((result) => result.data),

  cancelInvitation: (input: InvitationCommandInput) =>
    callable<InvitationCommandInput, InvitationCommandOutput>('cancelInvitation')(input)
      .then((result) => result.data),

  changeMemberRole: (input: ChangeMemberRoleInput) =>
    callable<ChangeMemberRoleInput, MemberCommandOutput>('changeMemberRole')(input)
      .then((result) => result.data),

  changeMemberStatus: (input: ChangeMemberStatusInput) =>
    callable<ChangeMemberStatusInput, MemberCommandOutput>('changeMemberStatus')(input)
      .then((result) => result.data),

  getInvitationActivation: (input: GetInvitationActivationInput) =>
    callable<GetInvitationActivationInput, GetInvitationActivationOutput>(
      'getInvitationActivation',
    )(input).then((result) => result.data),

  verifyInvitationCode: (input: VerifyInvitationCodeInput) =>
    callable<VerifyInvitationCodeInput, VerifyInvitationCodeOutput>(
      'verifyInvitationCode',
    )(input).then((result) => result.data),

  acceptInvitation: (input: AcceptInvitationInput) =>
    callable<AcceptInvitationInput, AcceptInvitationOutput>('acceptInvitation')(input)
      .then((result) => result.data),

  listOrganizationAudit: (input: ListOrganizationAuditInput) =>
    callable<ListOrganizationAuditInput, ListOrganizationAuditOutput>(
      'listOrganizationAudit',
    )(input).then((result) => result.data),

  getOrganizationAuditOverview: (input: GetOrganizationAuditOverviewInput) =>
    callable<GetOrganizationAuditOverviewInput, GetOrganizationAuditOverviewOutput>(
      'getOrganizationAuditOverview',
    )(input).then((result) => result.data),

  exportOrganizationWorkshopHistory: (input: ExportOrganizationWorkshopHistoryInput) =>
    callable<ExportOrganizationWorkshopHistoryInput, ExportOrganizationWorkshopHistoryOutput>(
      'exportOrganizationWorkshopHistory',
    )(input).then((result) => result.data),
};
