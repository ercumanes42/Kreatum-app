import { TEAMS, isTeam, type Team } from '../../shared/contracts.js';

export const WORKSHOP_TRANSITION_PRESENCE_WINDOW_MS = 60_000;

export interface TransitionParticipantSession {
  id: string;
  status: unknown;
  team: unknown;
  expiresAtMs: number | null;
  lastSeenAtMs: number | null;
}

export interface TransitionTeamLease {
  team: Team;
  exists: boolean;
  activeParticipantId: string | null;
  activeDeviceExpiresAtMs: number | null;
}

interface SelectRequiredTransitionTeamsInput {
  sessions: readonly TransitionParticipantSession[];
  teamLeases: readonly TransitionTeamLease[];
  nowMs: number;
  limit: number;
}

export const selectRequiredTransitionTeams = ({
  sessions,
  teamLeases,
  nowMs,
  limit,
}: SelectRequiredTransitionTeamsInput): Team[] => {
  const presenceCutoffMs = nowMs - WORKSHOP_TRANSITION_PRESENCE_WINDOW_MS;
  const recentlyPresentSessions = sessions.filter((session) => (
    session.status === 'active'
    && isTeam(session.team)
    && typeof session.expiresAtMs === 'number'
    && session.expiresAtMs > nowMs
    && typeof session.lastSeenAtMs === 'number'
    && session.lastSeenAtMs >= presenceCutoffMs
  ));

  return TEAMS.filter((team) => {
    const lease = teamLeases.find((candidate) => candidate.team === team);
    if (!lease?.exists
      || typeof lease.activeParticipantId !== 'string'
      || typeof lease.activeDeviceExpiresAtMs !== 'number'
      || lease.activeDeviceExpiresAtMs <= nowMs) {
      return false;
    }
    return recentlyPresentSessions.some((session) => (
      session.id === lease.activeParticipantId && session.team === team
    ));
  }).slice(0, Math.max(0, limit));
};

export type StaleRequestedTransitionReason = 'deadlineExpired' | 'invalidDeadline';

export type RequestedTransitionClassification =
  | { state: 'none' }
  | { state: 'active' }
  | {
    state: 'stale';
    transitionId: string | null;
    reason: StaleRequestedTransitionReason;
  };

interface ClassifyRequestedTransitionInput {
  state: unknown;
  transitionId: unknown;
  deadlineMs: number | null;
  nowMs: number;
}

export const classifyRequestedTransition = ({
  state,
  transitionId,
  deadlineMs,
  nowMs,
}: ClassifyRequestedTransitionInput): RequestedTransitionClassification => {
  if (state !== 'requested') return { state: 'none' };
  if (typeof deadlineMs !== 'number' || !Number.isFinite(deadlineMs)) {
    return {
      state: 'stale',
      transitionId: typeof transitionId === 'string' ? transitionId : null,
      reason: 'invalidDeadline',
    };
  }
  if (deadlineMs > nowMs) return { state: 'active' };
  return {
    state: 'stale',
    transitionId: typeof transitionId === 'string' ? transitionId : null,
    reason: 'deadlineExpired',
  };
};
