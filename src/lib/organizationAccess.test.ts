import assert from 'node:assert/strict';
import test from 'node:test';
import type { OrganizationSummary, PlatformOrganizationStatus } from '../../shared/contracts.js';
import {
  ADMIN_ACCESS_LOADING_TIMEOUT_MS,
  ORGANIZATION_STATUS_LABELS,
  organizationAccessMessage,
  selectOrganizationForAdmin,
  withAdminAccessDeadline,
} from './organizationAccess.js';

const organization = (
  id: string,
  operationalStatus: PlatformOrganizationStatus,
): OrganizationSummary => ({
  id,
  name: id,
  role: 'owner',
  operationalStatus,
  branding: { displayName: id },
  allowedEmailDomains: ['example.test'],
  retentionMonths: 24,
  commercial: null,
  creditsRemaining: null,
});

test('renders explicit operational copy for every organization status', () => {
  assert.equal(ORGANIZATION_STATUS_LABELS.active, 'Activa');
  assert.equal(organizationAccessMessage('active'), '');
  for (const status of ['pending', 'suspended', 'expired'] as const) {
    assert.ok(ORGANIZATION_STATUS_LABELS[status].length > 0);
    assert.ok(organizationAccessMessage(status).length > 0);
  }
});

test('preserves an explicit selection and otherwise prefers an active organization', () => {
  const organizations = [
    organization('suspended-org', 'suspended'),
    organization('active-org', 'active'),
  ];
  assert.equal(selectOrganizationForAdmin(organizations, 'suspended-org')?.id, 'suspended-org');
  assert.equal(selectOrganizationForAdmin(organizations, null)?.id, 'active-org');
  assert.equal(selectOrganizationForAdmin([], null), null);
});

test('membership loading has a finite UI deadline below the callable timeout', () => {
  assert.equal(ADMIN_ACCESS_LOADING_TIMEOUT_MS, 12_000);
  assert.ok(ADMIN_ACCESS_LOADING_TIMEOUT_MS < 30_000);
});

test('membership deadline resolves normally and exposes a recoverable timeout', async () => {
  assert.equal(await withAdminAccessDeadline(Promise.resolve('ready'), 50), 'ready');
  await assert.rejects(
    withAdminAccessDeadline(new Promise<never>(() => undefined), 5),
    (error: { code?: string }) => error.code === 'client/access-timeout',
  );
});
