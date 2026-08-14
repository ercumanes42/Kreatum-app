import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasInternalGfsWorkshopPrivilege,
  visibleWorkshopCredits,
} from './internalGfsAccess.js';

test('allows only verified identities from the exact gfs.es domain', () => {
  assert.equal(hasInternalGfsWorkshopPrivilege(
    { email: 'facilitator@gfs.es', email_verified: true },
  ), true);
  assert.equal(hasInternalGfsWorkshopPrivilege(
    { email: 'facilitator@gfs.es', email_verified: false },
  ), false);
});

test('rejects spoofed, external and missing identities', () => {
  for (const email of [
    'facilitator@sub.gfs.es',
    'facilitator@gfs.es.example',
    'facilitator@external.example',
  ]) {
    assert.equal(hasInternalGfsWorkshopPrivilege(
      { email, email_verified: true },
    ), false);
  }
  assert.equal(hasInternalGfsWorkshopPrivilege(
    { email_verified: true },
  ), false);
});

test('hides metered credits only for an authorized internal GFS member', () => {
  assert.equal(visibleWorkshopCredits(0, true), null);
  assert.equal(visibleWorkshopCredits(0, false), 0);
  assert.equal(visibleWorkshopCredits(3, false), 3);
});
