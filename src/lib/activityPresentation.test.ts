import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AuditEventSummary } from '../../shared/contracts';
import {
  auditActorLabel,
  auditTargetContextLabel,
  formatAdminActivityAction,
  formatAuditState,
  groupConsecutiveAdminActivity,
  isAuditStateNoOp,
  maskAuditEmail,
  visibleAuditActors,
} from './activityPresentation';

const activity = (
  id: string,
  action: string,
  overrides: Partial<AuditEventSummary> = {},
): AuditEventSummary => ({
  id,
  action,
  actorEmail: 'admin@gfs.es',
  actorName: 'Admin GFS',
  targetType: 'organization',
  targetId: 'gfs',
  previousState: null,
  newState: null,
  reason: null,
  createdAt: Date.UTC(2026, 7, 10, 12),
  ...overrides,
});

describe('admin activity presentation', () => {
  it('translates technical actions and hides unknown keys', () => {
    assert.equal(formatAdminActivityAction('organization.global_viewed'), 'Consulta global de empresa');
    assert.equal(formatAdminActivityAction('organization.global__viewed'), 'Consulta global de empresa');
    assert.equal(formatAdminActivityAction('report.global_regeneration_queued'), 'Regeneración global de informe solicitada');
    assert.equal(formatAdminActivityAction('technical.unmapped'), 'Actividad registrada');
  });

  it('labels technical actors as system and excludes them from people', () => {
    assert.equal(auditActorLabel(activity('system', 'organization.accessMigration', {
      actorName: 'Migration script',
      actorEmail: 'migration-script',
    })), 'Sistema');
    assert.deepEqual(visibleAuditActors([
      { name: 'Juan', email: 'juan@gfs.es' },
      { name: 'Staging release', email: 'release-system' },
    ]), [{ name: 'Juan', email: 'juan@gfs.es' }]);
  });

  it('masks email addresses and replaces internal ids with context labels', () => {
    assert.equal(maskAuditEmail('JuanMartinez@gfs.es'), 'ju**********@gfs.es');
    assert.equal(auditTargetContextLabel('workshop'), 'Partida registrada');
  });

  it('groups only consecutive global reads and keeps all audit events', () => {
    const grouped = groupConsecutiveAdminActivity([
      activity('read-1', 'organization.global_viewed'),
      activity('read-2', 'organization.global_viewed'),
      activity('other', 'workshop.global_listed', { targetType: 'workshop', targetId: 'workshop-1' }),
      activity('read-3', 'organization.global_viewed'),
    ]);
    assert.deepEqual(grouped.map((group) => group.items.map((item) => item.id)), [
      ['read-1', 'read-2'],
      ['other'],
      ['read-3'],
    ]);
  });

  it('translates common state keys and values', () => {
    assert.equal(
      formatAuditState({ status: 'pending', role: 'facilitator' }),
      'Estado: Pendiente · Rol: Facilitador',
    );
  });

  it('detects equivalent state transitions regardless of key order', () => {
    assert.equal(isAuditStateNoOp(activity('noop', 'workshop.resumed', {
      previousState: { status: 'active', role: 'facilitator' },
      newState: { role: 'facilitator', status: 'active' },
    })), true);
    assert.equal(isAuditStateNoOp(activity('change', 'workshop.archived', {
      previousState: { status: 'active' },
      newState: { status: 'archived' },
    })), false);
  });
});
