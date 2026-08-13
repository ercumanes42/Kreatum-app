import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PlatformActivityItem } from './platformApi';
import {
  formatPlatformActivityAction,
  formatPlatformValidity,
  groupConsecutivePlatformActivity,
} from './platformPresentation';

const activity = (
  id: string,
  action: string,
  overrides: Partial<PlatformActivityItem> = {},
): PlatformActivityItem => ({
  id,
  actorHash: '',
  targetType: 'organization',
  targetId: '',
  workshopId: null,
  reason: null,
  action,
  createdAt: Date.UTC(2026, 0, 1, 12),
  ...overrides,
});

describe('platform presentation', () => {
  it('translates known audit actions and hides unknown technical keys', () => {
    assert.equal(formatPlatformActivityAction('organization.suspended'), 'Empresa suspendida');
    assert.equal(formatPlatformActivityAction('technical.unmapped_key'), 'Actividad registrada');
  });

  it('groups only consecutive repeated reads and keeps every item', () => {
    const groups = groupConsecutivePlatformActivity([
      activity('read-1', 'organization.global_viewed', { actorHash: 'actor-a', targetId: 'org-a', reason: 'Soporte' }),
      activity('read-2', 'organization.global_viewed', { actorHash: 'actor-a', targetId: 'org-a', reason: 'Soporte' }),
      activity('read-other-actor', 'organization.global_viewed', { actorHash: 'actor-b', targetId: 'org-a', reason: 'Soporte' }),
      activity('read-other-target', 'organization.global_viewed', { actorHash: 'actor-b', targetId: 'org-b', reason: 'Soporte' }),
      activity('read-other-reason', 'organization.global_viewed', { actorHash: 'actor-b', targetId: 'org-b', reason: 'Revisión' }),
      activity('update-1', 'organization.updated'),
      activity('update-2', 'organization.updated'),
    ]);

    assert.deepEqual(groups.map((group) => group.items.map((item) => item.id)), [
      ['read-1', 'read-2'],
      ['read-other-actor'],
      ['read-other-target'],
      ['read-other-reason'],
      ['update-1'],
      ['update-2'],
    ]);
  });

  it('describes open-ended and ranged validity clearly', () => {
    const start = Date.UTC(2026, 0, 1, 12);
    const end = Date.UTC(2026, 11, 31, 12);
    assert.match(formatPlatformValidity(start, null), /^Desde .+ · Sin fecha de vencimiento$/);
    assert.match(formatPlatformValidity(start, end), /^Desde .+ · Hasta .+$/);
  });
});
