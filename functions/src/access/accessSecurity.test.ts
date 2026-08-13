import assert from 'node:assert/strict';
import test from 'node:test';
import {
  INVITATION_CODE_TTL_MS,
  canResendInvitation,
  generateInvitationCode,
  hasAllowedEmailDomain,
  hasAttemptsRemaining,
  hashActivationToken,
  hashInvitationCode,
  invitationAuthErrorCode,
  invitationDocumentId,
  isInvitationTokenSigningConfigurationError,
  isInvitationExpired,
  isOrganizationRole,
  maskEmail,
  nextAttemptCount,
  sanitizeAuditState,
  sanitizePersonName,
  sanitizeReason,
  secureHashEquals,
  wouldRemoveLastOwner,
} from './accessSecurity.js';

test('accepts only the exact normalized gfs.es domain', () => {
  assert.equal(hasAllowedEmailDomain(' User@GFS.ES ', ['gfs.es']), true);
  assert.equal(hasAllowedEmailDomain('user@sub.gfs.es', ['gfs.es']), false);
  assert.equal(hasAllowedEmailDomain('user@gfs.es.example', ['gfs.es']), false);
  assert.equal(hasAllowedEmailDomain('usergfs.es', ['gfs.es']), false);
});

test('generates a six digit cryptographic code and verifies keyed hashes', () => {
  const code = generateInvitationCode();
  assert.match(code, /^\d{6}$/);
  const hash = hashInvitationCode(code, 'pepper-for-tests', 'invitation-one');
  assert.equal(secureHashEquals(hash, hashInvitationCode(code, 'pepper-for-tests', 'invitation-one')), true);
  assert.equal(secureHashEquals(hash, hashInvitationCode('000000', 'pepper-for-tests', 'invitation-one')), false);
  assert.notEqual(hash, hashActivationToken(code, 'pepper-for-tests', 'invitation-one'));
});

test('enforces expiration, attempts and resend windows', () => {
  const now = 1_000_000;
  assert.equal(isInvitationExpired(now + INVITATION_CODE_TTL_MS, now), false);
  assert.equal(isInvitationExpired(now, now), true);
  assert.equal(nextAttemptCount(4), 5);
  assert.equal(hasAttemptsRemaining(4), true);
  assert.equal(hasAttemptsRemaining(5), false);
  assert.equal(canResendInvitation([now - 1, now - 2, now - 3], now), false);
  assert.equal(canResendInvitation([now - 3_600_001, now - 2, now - 3], now), true);
});

test('supports only owner and facilitator roles', () => {
  assert.equal(isOrganizationRole('owner'), true);
  assert.equal(isOrganizationRole('facilitator'), true);
  assert.equal(isOrganizationRole('analyst'), false);
});

test('protects the last active owner', () => {
  assert.equal(wouldRemoveLastOwner(1, 'owner', 'active', 'facilitator', 'active'), true);
  assert.equal(wouldRemoveLastOwner(1, 'owner', 'active', 'owner', 'disabled'), true);
  assert.equal(wouldRemoveLastOwner(2, 'owner', 'active', 'facilitator', 'active'), false);
  assert.equal(wouldRemoveLastOwner(1, 'facilitator', 'active', 'facilitator', 'disabled'), false);
});

test('sanitizes names, reasons and audit states without retaining content', () => {
  assert.equal(sanitizePersonName('  Ana <script>\n'), 'Ana script');
  assert.equal(sanitizeReason('  Necesidad\noperativa  '), 'Necesidad operativa');
  assert.deepEqual(sanitizeAuditState({
    status: 'disabled',
    role: 'owner',
    responseContent: 'private',
  }), { status: 'disabled', role: 'owner' });
});

test('creates deterministic invitation ids and masks emails', () => {
  assert.equal(
    invitationDocumentId(' USER@GFS.ES ', 'pepper'),
    invitationDocumentId('user@gfs.es', 'pepper'),
  );
  assert.equal(maskEmail('juanmartinez@gfs.es'), 'ju**********@gfs.es');
});

test('classifies custom-token signing configuration errors without exposing details', () => {
  const codedError = Object.assign(new Error('redacted'), {
    code: 'auth/insufficient-permission',
  });
  assert.equal(invitationAuthErrorCode(codedError), 'auth/insufficient-permission');
  assert.equal(isInvitationTokenSigningConfigurationError(codedError), true);
  assert.equal(isInvitationTokenSigningConfigurationError(
    new Error('Permission iam.serviceAccounts.signBlob is required.'),
  ), true);
  assert.equal(isInvitationTokenSigningConfigurationError(new Error('Network timeout')), false);
});
