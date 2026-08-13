import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuditEventSummary } from './contracts.js';
import {
  auditEventMatchesFilters,
  buildOrganizationAuditOverview,
} from './audit.js';

const now = Date.UTC(2026, 7, 8, 12);

const event = (
  id: string,
  overrides: Partial<AuditEventSummary> = {},
): AuditEventSummary => ({
  id,
  action: 'invitation.created',
  actorEmail: 'owner@gfs.es',
  actorName: 'Owner Test',
  targetType: 'invitation',
  targetId: `invite-${id}`,
  previousState: null,
  newState: { status: 'pending' },
  reason: null,
  createdAt: now,
  ...overrides,
});

test('filters audit events by actor, action, target and normalized search', () => {
  const item = event('one');
  assert.equal(auditEventMatchesFilters(item, {
    actorEmail: 'owner@gfs.es',
    action: 'invitation.created',
    targetType: 'invitation',
    search: 'invitación creada',
  }), true);
  assert.equal(auditEventMatchesFilters(item, { search: 'otra persona' }), false);
  assert.equal(auditEventMatchesFilters(item, { targetType: 'workshop' }), false);
});

test('builds filtered metrics, facets and a complete daily trend', () => {
  const overview = buildOrganizationAuditOverview([
    event('invite'),
    event('workshop', {
      action: 'workshop.completed',
      targetType: 'workshop',
      targetId: 'workshop-1',
      actorEmail: 'second@gfs.es',
      actorName: 'Second Owner',
      createdAt: now - 24 * 60 * 60 * 1000,
    }),
    event('report', {
      action: 'report.generated',
      targetType: 'report',
      targetId: 'report-1',
    }),
  ], { periodDays: 7 }, now);

  assert.deepEqual(overview.metrics, {
    totalEvents: 3,
    uniqueActors: 2,
    workshopsAffected: 1,
    accessOperations: 1,
  });
  assert.equal(overview.daily.length, 7);
  assert.equal(overview.daily.reduce((total, item) => total + item.count, 0), 3);
  assert.deepEqual(overview.actors.map((actor) => actor.email), [
    'owner@gfs.es',
    'second@gfs.es',
  ]);
  assert.deepEqual(overview.actions, [
    'report.generated',
    'invitation.created',
    'workshop.completed',
  ]);
  assert.equal(overview.truncated, false);
});

test('applies filters to metrics without removing available facets', () => {
  const overview = buildOrganizationAuditOverview([
    event('invite'),
    event('workshop', {
      action: 'workshop.completed',
      targetType: 'workshop',
      targetId: 'workshop-1',
    }),
  ], { periodDays: 30, targetType: 'workshop' }, now, true);

  assert.equal(overview.metrics.totalEvents, 1);
  assert.equal(overview.metrics.workshopsAffected, 1);
  assert.equal(overview.actions.length, 2);
  assert.equal(overview.truncated, true);
});
