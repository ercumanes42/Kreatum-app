import assert from 'node:assert/strict';
import test from 'node:test';
import {
  brevoErrorCode,
  brevoMessageId,
  buildBrevoInvitationEmailPayload,
  parseEmailSender,
} from './brevoEmail.js';

test('parses a configured sender without accepting malformed values', () => {
  assert.deepEqual(parseEmailSender('KREATUM | GFS <accesos@GFS.ES>'), {
    name: 'KREATUM | GFS',
    email: 'accesos@gfs.es',
  });
  assert.deepEqual(parseEmailSender('accesos@gfs.es'), {
    name: 'KREATUM | GFS Consulting Group',
    email: 'accesos@gfs.es',
  });
  assert.equal(parseEmailSender('invalid sender'), null);
});

test('builds a Brevo invitation payload with escaped content and idempotency', () => {
  const payload = buildBrevoInvitationEmailPayload({
    organizationName: 'GFS <script>',
    invitedBy: 'Ana & Luis',
    email: 'persona@gfs.es',
    code: '123456',
    activationUrl: 'https://staging.example.com/activar?a=1&b=2',
    expiryMinutes: 10,
    idempotencyKey: '44a7cf6b-83c1-4a0c-9ddb-3b3bb86d32de',
    senderName: 'KREATUM | GFS Consulting Group',
    senderEmail: 'accesos@gfs.es',
    replyToEmail: 'administracion@gfs.es',
  });
  assert.deepEqual(payload.sender, {
    name: 'KREATUM | GFS Consulting Group',
    email: 'accesos@gfs.es',
  });
  assert.deepEqual(payload.replyTo, { email: 'administracion@gfs.es' });
  assert.deepEqual(payload.headers, {
    'Idempotency-Key': '44a7cf6b-83c1-4a0c-9ddb-3b3bb86d32de',
  });
  assert.deepEqual(payload.tags, ['access_invitation']);
  assert.match(payload.textContent, /Código: 123456/);
  assert.doesNotMatch(payload.htmlContent, /<script>/);
  assert.match(payload.htmlContent, /GFS &lt;script&gt;/);
  assert.match(payload.htmlContent, /a=1&amp;b=2/);
});

test('sanitizes Brevo error codes without exposing provider messages', () => {
  assert.equal(brevoErrorCode({ code: 'invalid_parameter' }), 'invalid_parameter');
  assert.equal(brevoErrorCode({ code: 'bad code<script>' }), 'badcodescript');
  assert.equal(brevoErrorCode({ message: 'sensitive provider detail' }), null);
});

test('accepts only a non-empty Brevo message id', () => {
  assert.equal(brevoMessageId({ messageId: '<message@brevo>' }), '<message@brevo>');
  assert.equal(brevoMessageId({ messageId: '' }), null);
  assert.equal(brevoMessageId({ id: 'resend-shape' }), null);
});
