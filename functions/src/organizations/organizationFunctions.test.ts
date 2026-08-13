import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpsError } from 'firebase-functions/v2/https';
import type { OrganizationCommercialTerms } from '../../../shared/contracts.js';
import { preserveCommercialUsage } from './organizationFunctions.js';

const terms = (overrides: Partial<OrganizationCommercialTerms> = {}): OrganizationCommercialTerms => ({
  plan: 'growth',
  status: 'active',
  validFrom: 1,
  validUntil: null,
  includedWorkshops: 10,
  additionalWorkshops: 5,
  consumedWorkshops: 0,
  ...overrides,
});

test('commercial updates preserve persisted usage instead of client usage', () => {
  const requested = terms({
    includedWorkshops: 20,
    additionalWorkshops: 3,
    consumedWorkshops: 0,
  });
  const current = terms({ consumedWorkshops: 7 });

  const result = preserveCommercialUsage(requested, current);

  assert.equal(result.consumedWorkshops, 7);
  assert.equal(result.includedWorkshops, 20);
  assert.equal(result.additionalWorkshops, 3);
});

test('commercial updates initialize usage at zero for a legacy pilot', () => {
  const result = preserveCommercialUsage(terms({ consumedWorkshops: 999 }), null);
  assert.equal(result.consumedWorkshops, 0);
});

test('commercial updates reject totals below persisted usage', () => {
  assert.throws(
    () => preserveCommercialUsage(
      terms({ includedWorkshops: 2, additionalWorkshops: 1 }),
      terms({ consumedWorkshops: 4 }),
    ),
    (error: unknown) => {
      assert.ok(error instanceof HttpsError);
      assert.equal(error.code, 'invalid-argument');
      return true;
    },
  );
});
