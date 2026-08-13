import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpsError } from 'firebase-functions/v2/https';
import {
  applyWorkshopAllowanceAdjustment,
  assertWorkshopTenant,
  hasPlatformAdminClaim,
  maskPlatformEmail,
  readPlatformAllowance,
  resolvePlatformOrganizationStatus,
} from './platformSecurity.js';

test('platform claim requires the exact boolean true value', () => {
  assert.equal(hasPlatformAdminClaim({ platformAdmin: true }), true);
  assert.equal(hasPlatformAdminClaim({ platformAdmin: 'true' }), false);
  assert.equal(hasPlatformAdminClaim({}), false);
});

test('commercial allowance has priority and keeps consumed workshops', () => {
  assert.deepEqual(readPlatformAllowance({
    commercial: {
      includedWorkshops: 10,
      additionalWorkshops: 3,
      consumedWorkshops: 7,
    },
    commercialPlan: { credits: 999, creditsUsed: 0 },
  }), {
    contracted: 13,
    used: 7,
    available: 6,
    source: 'commercial',
  });
});

test('invalid canonical commercial data never falls back to a lower-priority balance', () => {
  assert.throws(
    () => readPlatformAllowance({
      commercial: {
        includedWorkshops: 2,
        additionalWorkshops: 0,
        consumedWorkshops: 4,
      },
      commercialPlan: { credits: 999, creditsUsed: 0 },
    }),
    (error: unknown) => error instanceof HttpsError
      && error.code === 'failed-precondition',
  );
});

test('commercialPlan credits are read without changing their meaning', () => {
  assert.deepEqual(readPlatformAllowance({
    commercialPlan: {
      credits: 12,
      creditsUsed: 5,
    },
  }), {
    contracted: 12,
    used: 5,
    available: 7,
    source: 'commercialPlan',
  });
});

test('invalid commercialPlan data is rejected instead of reset to zero', () => {
  assert.throws(
    () => readPlatformAllowance({
      commercialPlan: {
        credits: 3,
        creditsUsed: 5,
      },
    }),
    (error: unknown) => error instanceof HttpsError
      && error.code === 'failed-precondition',
  );
});

test('allowance adjustments distinguish contracted units and used refunds', () => {
  const current = {
    contracted: 10,
    used: 8,
    available: 2,
    source: 'commercial' as const,
  };
  assert.deepEqual(applyWorkshopAllowanceAdjustment(current, 2, -1), {
    contracted: 12,
    used: 7,
    available: 5,
    source: 'commercial',
  });
  assert.throws(
    () => applyWorkshopAllowanceAdjustment(current, -3, 0),
    (error: unknown) => error instanceof HttpsError
      && error.code === 'failed-precondition',
  );
});

test('tenant assertion rejects a workshop from another organization without disclosure', () => {
  assert.doesNotThrow(() => assertWorkshopTenant('org-a', 'org-a'));
  assert.throws(
    () => assertWorkshopTenant('org-b', 'org-a'),
    (error: unknown) => error instanceof HttpsError
      && error.code === 'not-found',
  );
});

test('organization state honors commercial suspension and expiry', () => {
  assert.equal(resolvePlatformOrganizationStatus({
    status: 'active',
    commercial: { status: 'suspended', validUntil: null },
  }, 100), 'suspended');
  assert.equal(resolvePlatformOrganizationStatus({
    status: 'active',
    commercial: { status: 'active', validUntil: 99 },
  }, 100), 'expired');
  assert.equal(resolvePlatformOrganizationStatus({
    commercialPlan: { status: 'suspended', credits: 2 },
  }, 100), 'suspended');
});

test('invalid stored organization states fail closed', () => {
  assert.throws(
    () => resolvePlatformOrganizationStatus({ status: 'enabled' }),
    (error: unknown) => error instanceof HttpsError
      && error.code === 'failed-precondition',
  );
});

test('missing state is active only for an explicit legacy commercial model', () => {
  assert.throws(
    () => resolvePlatformOrganizationStatus({ name: 'Unmigrated' }),
    (error: unknown) => error instanceof HttpsError
      && error.code === 'failed-precondition',
  );
  assert.equal(resolvePlatformOrganizationStatus({
    credits: 3,
    creditsUsed: 1,
  }), 'active');
});
test('platform summaries never expose a complete email address', () => {
  const masked = maskPlatformEmail('facilitator@example.com');
  assert.equal(masked.includes('facilitator'), false);
  assert.equal(masked, 'fa******@e***.com');
});
