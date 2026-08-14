import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasTenantReportAccess,
  tenantReportRolesForToken,
} from './reportTenantAuthorization.js';

const verifiedGfsToken = {
  email: 'facilitator@gfs.es',
  email_verified: true,
};

test('allows an active owner independently of email domain', () => {
  assert.equal(hasTenantReportAccess(
    'owner-uid',
    { email: 'owner@external.example', email_verified: false },
    { role: 'owner', status: 'active' },
    { facilitatorUid: 'different-uid' },
  ), true);
});

test('allows a verified GFS facilitator only for the assigned workshop', () => {
  assert.equal(hasTenantReportAccess(
    'gfs-facilitator',
    verifiedGfsToken,
    { role: 'facilitator', status: 'active' },
    { facilitatorUid: 'gfs-facilitator' },
  ), true);
  assert.equal(hasTenantReportAccess(
    'gfs-facilitator',
    verifiedGfsToken,
    { role: 'facilitator', status: 'active' },
    { facilitatorUid: 'other-facilitator' },
  ), false);
});

test('rejects external and unverified GFS facilitators', () => {
  assert.equal(hasTenantReportAccess(
    'external-facilitator',
    { email: 'facilitator@external.example', email_verified: true },
    { role: 'facilitator', status: 'active' },
    { facilitatorUid: 'external-facilitator' },
  ), false);
  assert.equal(hasTenantReportAccess(
    'gfs-facilitator',
    { email: 'facilitator@gfs.es', email_verified: false },
    { role: 'facilitator', status: 'active' },
    { facilitatorUid: 'gfs-facilitator' },
  ), false);
});

test('exposes facilitator report roles only to verified GFS tokens', () => {
  assert.deepEqual(tenantReportRolesForToken(verifiedGfsToken), ['owner', 'facilitator']);
  assert.deepEqual(tenantReportRolesForToken({
    email: 'facilitator@gfs.es',
    email_verified: false,
  }), ['owner']);
  assert.deepEqual(tenantReportRolesForToken({
    email: 'facilitator@external.example',
    email_verified: true,
  }), ['owner']);
});
