import assert from 'node:assert/strict';
import test from 'node:test';
import type { Team } from '../../shared/contracts.js';
import {
  WORKSHOP_TRANSITION_PRESENCE_WINDOW_MS,
  classifyRequestedTransition,
  selectRequiredTransitionTeams,
  type TransitionParticipantSession,
  type TransitionTeamLease,
} from './workshopTransitionSafety.js';

const NOW = 2_000_000;

const session = (
  id: string,
  team: Team,
  overrides: Partial<TransitionParticipantSession> = {},
): TransitionParticipantSession => ({
  id,
  team,
  status: 'active',
  expiresAtMs: NOW + 5 * 60_000,
  lastSeenAtMs: NOW,
  ...overrides,
});

const lease = (
  team: Team,
  activeParticipantId: string,
  overrides: Partial<TransitionTeamLease> = {},
): TransitionTeamLease => ({
  team,
  exists: true,
  activeParticipantId,
  activeDeviceExpiresAtMs: NOW + 5 * 60_000,
  ...overrides,
});

test('requires only recently present sessions that own the canonical team lease', () => {
  const requiredTeams = selectRequiredTransitionTeams({
    sessions: [
      session('agua-current', 'Agua'),
      session('aire-orphaned', 'Aire'),
    ],
    teamLeases: [
      lease('Agua', 'agua-current'),
      lease('Aire', 'aire-replaced'),
    ],
    nowMs: NOW,
    limit: 4,
  });

  assert.deepEqual(requiredTeams, ['Agua']);
});

test('excludes a closed tab with a valid reconnect lease but stale presence', () => {
  const requiredTeams = selectRequiredTransitionTeams({
    sessions: [
      session('agua-closed', 'Agua', {
        lastSeenAtMs: NOW - WORKSHOP_TRANSITION_PRESENCE_WINDOW_MS - 1,
      }),
      session('aire-current', 'Aire'),
    ],
    teamLeases: [
      lease('Agua', 'agua-closed'),
      lease('Aire', 'aire-current'),
    ],
    nowMs: NOW,
    limit: 4,
  });

  assert.deepEqual(requiredTeams, ['Aire']);
});

test('includes the exact recent-presence boundary and excludes one millisecond beyond it', () => {
  const requiredTeams = selectRequiredTransitionTeams({
    sessions: [
      session('agua-boundary', 'Agua', {
        lastSeenAtMs: NOW - WORKSHOP_TRANSITION_PRESENCE_WINDOW_MS,
      }),
      session('aire-stale', 'Aire', {
        lastSeenAtMs: NOW - WORKSHOP_TRANSITION_PRESENCE_WINDOW_MS - 1,
      }),
    ],
    teamLeases: [
      lease('Agua', 'agua-boundary'),
      lease('Aire', 'aire-stale'),
    ],
    nowMs: NOW,
    limit: 4,
  });

  assert.deepEqual(requiredTeams, ['Agua']);
});

test('returns no required teams when no canonical session is recently present', () => {
  const requiredTeams = selectRequiredTransitionTeams({
    sessions: [session('agua-expired', 'Agua', { expiresAtMs: NOW - 1 })],
    teamLeases: [lease('Agua', 'agua-expired')],
    nowMs: NOW,
    limit: 4,
  });

  assert.deepEqual(requiredTeams, []);
});

test('classifies active, expired and invalid requested-transition deadlines', () => {
  assert.deepEqual(classifyRequestedTransition({
    state: 'requested',
    transitionId: 'transition-active',
    deadlineMs: NOW + 1,
    nowMs: NOW,
  }), { state: 'active' });
  assert.deepEqual(classifyRequestedTransition({
    state: 'requested',
    transitionId: 'transition-expired',
    deadlineMs: NOW,
    nowMs: NOW,
  }), {
    state: 'stale',
    transitionId: 'transition-expired',
    reason: 'deadlineExpired',
  });
  assert.deepEqual(classifyRequestedTransition({
    state: 'requested',
    transitionId: 'transition-invalid',
    deadlineMs: null,
    nowMs: NOW,
  }), {
    state: 'stale',
    transitionId: 'transition-invalid',
    reason: 'invalidDeadline',
  });
});
