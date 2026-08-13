import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AuditEventSummary } from '../../shared/contracts';
import {
  formatAdminActivityAction,
  groupConsecutiveAdminActivity,
} from './activityPresentation';

const platformActions = [
  'invitation.initial_facilitator_cancelled',
  'invitation.initial_facilitator_created',
  'invitation.initial_facilitator_resent',
  'organization.commercialUpdated',
  'organization.global_viewed',
  'organization.initial_facilitator_activated',
  'organization.provisioned',
  'organization.provisioned_pending',
  'organization.reactivated',
  'organization.suspended',
  'organization.updated',
  'organization.workshop_allowance_adjusted',
  'report.artifacts_generated',
  'report.downloaded',
  'report.editorial_updated',
  'report.global_downloaded',
  'report.global_generation_queued',
  'report.global_regeneration_queued',
  'report.global_snapshot_generated',
  'report.jobQueued',
  'workshop.controlUpdated',
  'workshop.facilitator_assignment_confirmed',
  'workshop.facilitator_reassigned',
  'workshop.facilitator_reassigned_by_platform',
  'workshop.facilitatorMigrated',
  'workshop.global_data_viewed',
  'workshop.global_listed',
  'workshop.migrated',
  'workshop.transitionCancelled',
  'workshop.transitionCommitted',
  'workshop.transitionRequested',
] as const;

const activity = (id: string, action: string): AuditEventSummary => ({
  id,
  action,
  actorEmail: '',
  actorName: 'Operador GFS',
  targetType: 'organization',
  targetId: 'gfs',
  previousState: null,
  newState: null,
  reason: null,
  createdAt: Date.UTC(2026, 7, 10, 12),
});

describe('admin activity action coverage', () => {
  it('provides a user-facing label for every platform action', () => {
    for (const action of platformActions) {
      assert.notEqual(formatAdminActivityAction(action), 'Actividad registrada', action);
      assert.doesNotMatch(formatAdminActivityAction(action), /[._]/, action);
    }
  });

  it('normalizes legacy repeated underscores when grouping global reads', () => {
    const groups = groupConsecutiveAdminActivity([
      activity('legacy', 'organization.global__viewed'),
      activity('current', 'organization.global_viewed'),
    ]);
    assert.deepEqual(groups.map((group) => group.items.map((item) => item.id)), [
      ['legacy', 'current'],
    ]);
  });
});
