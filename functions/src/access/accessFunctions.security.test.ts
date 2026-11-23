import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import vm from 'node:vm';
import test from 'node:test';
import { transformSync } from 'esbuild';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import * as security from './accessSecurity.js';
import { revalidateOrganizationOwnerInTransaction } from '../security/organizationOwnerAuthorization.js';
import { assertOrganizationOperational } from '../security/organizationAccess.js';

// Execute the actual exported handlers with isolated service doubles: no emulator or cloud.
const source = readFileSync(join(__dirname, 'accessFunctions.ts'), 'utf8');
const organizationId = 'org-a';
const uid = 'owner-a';
type RecordData = Record<string, any>;
const harness = (operation: string) => {
  const records = new Map<string, RecordData>([
    ['organizations/org-a', { status: 'active', schemaVersion: 3, commercial: {
      status: 'active', validFrom: Timestamp.fromMillis(Date.now() - 1000), validUntil: null,
    } }],
    ['organizations/org-a/members/owner-a', { role: 'owner', status: 'active' }],
    ['organizations/org-a/members/shared-user', { role: 'facilitator', status: 'active' }],
    ['organizations/org-b/members/shared-user', { role: 'owner', status: 'active' }],
  ]);
  const authUser: RecordData = { uid: 'shared-user', disabled: false, email: 'shared@example.test',
    emailVerified: true, providerData: [{ providerId: 'password' }] };
  const authWrites: RecordData[] = [];
  let minted = 0;
  let beforeTransaction = () => {};
  const ref = (path: string): any => ({
    path, collection: (name: string) => ({ doc: (id: string) => ref(path + '/' + name + '/' + id) }),
    get: async () => snapshot(path),
    update: async (data: RecordData) => { records.set(path, { ...records.get(path), ...data }); },
  });
  const snapshot = (path: string): any => ({ exists: records.has(path), data: () => records.get(path),
    size: path === 'owners' ? 2 : 0, empty: !records.has(path) });
  const database = {
    doc: ref,
    collection: (path: string) => ({ where: () => ({ limit: () => ref(path + '/query') }) }),
    runTransaction: async (body: (transaction: any) => any) => {
      beforeTransaction();
      const writes: Array<() => void> = [];
      const transaction = {
        get: async (reference: any) => snapshot(reference.path),
        update: (reference: any, data: RecordData) => writes.push(() => records.set(reference.path, { ...records.get(reference.path), ...data })),
        set: (reference: any, data: RecordData) => writes.push(() => records.set(reference.path, { ...records.get(reference.path), ...data })),
        create: (reference: any, data: RecordData) => writes.push(() => records.set(reference.path, data)),
      };
      const result = await body(transaction);
      writes.forEach((write) => write());
      return result;
    },
  };
  const context: RecordData = {
    ...security, Date, Timestamp, FieldValue, HttpsError, randomUUID, randomBytes,
    callable: (_name: string, handler: unknown) => handler,
    requireAdminAuth: (request: any) => request.auth,
    validateIdentifier: (value: unknown) => value,
    validateIdempotencyKey: (value: unknown) => value,
    validateEmail: (value: unknown) => value,
    requireReason: (value: unknown) => value,
    loadOwner: async () => ({ uid }),
    loadOrganizationPolicy: async () => ({ minimumActiveOwners: 1, allowedEmailDomains: ['example.test'] }),
    getFirestore: () => database,
    getAuth: () => ({
      getUser: async () => ({ ...authUser }),
      getUserByEmail: async () => ({ ...authUser }),
      updateUser: async (_id: string, patch: RecordData) => { authWrites.push(patch); Object.assign(authUser, patch); return { ...authUser }; },
      revokeRefreshTokens: async () => { authWrites.push({ revoked: true }); },
    }),
    revalidateOrganizationOwnerInTransaction,
    assertOrganizationOperational,
    activatePendingOrganizationForAcceptedInvitation: async () => {},
    activeOwnerQuery: () => ref('owners'),
    commandDocumentId: () => 'command-test',
    writeAudit: () => {},
    getPepper: () => 'x'.repeat(32),
    invitationCode: () => '246810',
    invitationDocumentId: () => 'invite-test',
    timestampMillis: (value: unknown) => value instanceof Timestamp ? value.toMillis() : null,
    enforcePublicVerificationRateLimits: async () => {},
    createInvitationCustomToken: async () => { minted++; return 'test-token'; },
    readLegalConfiguration: () => ({}),
    assertLegalAcceptance: () => {},
    ACTIVE_INVITATION_STATUSES: ['pending', 'verified'],
    CODE_SECRET: [], SECRET_NAMES: [],
  };
  const start = source.indexOf('export const ' + operation + ' =');
  const next = source.indexOf('\nexport const ', start + 1);
  assert(start >= 0);
  const section = source.slice(start, next < 0 ? undefined : next).replace('export const ', 'const ');
  vm.runInNewContext(transformSync(section, { loader: 'ts', target: 'node22' }).code
    + '\nglobalThis.handler = ' + operation + ';', context);
  const data = { organizationId, memberId: 'shared-user', status: 'disabled', role: 'facilitator',
    invitationId: 'invite-test', email: 'shared@example.test', code: '246810',
    reason: 'Security regression', idempotencyKey: 'key-test', firstName: 'Test', lastName: 'User',
    activationToken: 'x'.repeat(40) };
  if (operation === 'acceptInvitation') {
    authUser.uid = uid;
    records.set('organizations/org-a/invitations/invite-test', {
      status: 'verified', verificationUid: uid, email: authUser.email, role: 'facilitator',
      activationExpiresAt: Timestamp.fromMillis(Date.now() + 60000),
      activationTokenHash: security.hashActivationToken(data.activationToken, 'x'.repeat(32), 'invite-test'),
    });
  }
  return {
    records, authUser, authWrites, data, minted: () => minted,
    beforeTransaction: (hook: () => void) => { beforeTransaction = hook; },
    run: () => context.handler({ auth: { uid, token: {} }, data, rawRequest: { ip: '127.0.0.1' } }, 'test-correlation'),
  };
};

test('tenant disable and re-enable preserve global identity and another tenant', async () => {
  const h = harness('changeMemberStatus');
  await h.run();
  assert.equal(h.records.get('organizations/org-a/members/shared-user')?.status, 'disabled');
  assert.equal(h.records.get('organizations/org-b/members/shared-user')?.status, 'active');
  assert.deepEqual(h.authWrites, []);
  assert.equal(h.authUser.disabled, false);
  h.records.delete('organizations/org-a/commandKeys/command-test');
  h.data.status = 'active';
  h.authUser.disabled = true;
  await h.run();
  assert.equal(h.records.get('organizations/org-a/members/shared-user')?.status, 'active');
  assert.equal(h.records.get('organizations/org-b/members/shared-user')?.status, 'active');
  assert.equal(h.authUser.disabled, true);
  assert.deepEqual(h.authWrites, []);
});

for (const operation of ['inviteMember', 'resendInvitation', 'cancelInvitation', 'changeMemberRole', 'changeMemberStatus']) {
  test(operation + ' rejects an owner revoked after preflight, including cached commands', async () => {
    const h = harness(operation);
    h.records.set('organizations/org-a/commandKeys/command-test', { result: { status: 'active' } });
    h.beforeTransaction(() => h.records.set('organizations/org-a/members/owner-a', { role: 'owner', status: 'disabled' }));
    await assert.rejects(h.run(), (error: any) => error.code === 'not-found');
    assert.equal(h.records.get('organizations/org-a/members/shared-user')?.status, 'active');
    assert.deepEqual(h.authWrites, []);
  });
}

test('cancelling an invitation does not revoke sessions in another tenant', async () => {
  const h = harness('cancelInvitation');
  h.records.set('organizations/org-a/invitations/invite-test', { status: 'verified', verificationUid: 'shared-user' });
  await h.run();
  assert.equal(h.records.get('organizations/org-a/invitations/invite-test')?.status, 'cancelled');
  assert.deepEqual(h.authWrites, []);
});

test('a correct invitation code cannot reactivate a globally blocked account or mint a token', async () => {
  const h = harness('verifyInvitationCode');
  h.authUser.disabled = true;
  h.records.set('organizations/org-a/invitations/invite-test', {
    email: 'shared@example.test', status: 'pending', expiresAt: Timestamp.fromMillis(Date.now() + 60000),
    codeHash: security.hashInvitationCode('246810', 'x'.repeat(32), 'invite-test'), attemptCount: 0,
  });
  await assert.rejects(h.run(), (error: any) => error.code === 'permission-denied');
  assert.equal(h.minted(), 0);
  assert.equal(h.authUser.disabled, true);
  assert.deepEqual(h.authWrites, []);
  assert.equal(h.records.get('organizations/org-a/invitations/invite-test')?.status, 'pending');
});

test('verifyInvitationCode does not overwrite a concurrently cancelled invitation back to pending', async () => {
  const h = harness('verifyInvitationCode');
  h.records.set('organizations/org-a/invitations/invite-test', {
    email: 'shared@example.test', status: 'pending', expiresAt: Timestamp.fromMillis(Date.now() + 60000),
    codeHash: security.hashInvitationCode('246810', 'x'.repeat(32), 'invite-test'), attemptCount: 0,
  });
  let transactionCalls = 0;
  h.beforeTransaction(() => {
    transactionCalls += 1;
    if (transactionCalls === 2) {
      h.records.set('organizations/org-a/invitations/invite-test', {
        email: 'shared@example.test',
        status: 'cancelled',
      });
    }
  });
  await assert.rejects(h.run(), (error: any) => error.code === 'aborted');
  assert.equal(h.records.get('organizations/org-a/invitations/invite-test')?.status, 'cancelled');
});

test('verifyInvitationCode restores deliveryFailed status when verification fails before completion', async () => {
  const h = harness('verifyInvitationCode');
  h.authUser.disabled = true;
  h.records.set('organizations/org-a/invitations/invite-test', {
    email: 'shared@example.test', status: 'deliveryFailed', expiresAt: Timestamp.fromMillis(Date.now() + 60000),
    codeHash: security.hashInvitationCode('246810', 'x'.repeat(32), 'invite-test'), attemptCount: 0,
  });
  await assert.rejects(h.run(), (error: any) => error.code === 'permission-denied');
  assert.equal(h.records.get('organizations/org-a/invitations/invite-test')?.status, 'deliveryFailed');
});

test('acceptInvitation rejects a globally blocked identity before membership writes', async () => {
  const h = harness('acceptInvitation');
  h.authUser.disabled = true;
  await assert.rejects(h.run(), (error: any) => error.code === 'permission-denied');
  assert.deepEqual(h.authWrites, []);
});

test('acceptInvitation rechecks a global block applied after preflight', async () => {
  const h = harness('acceptInvitation');
  h.beforeTransaction(() => { h.authUser.disabled = true; });
  await assert.rejects(h.run(), (error: any) => error.code === 'permission-denied');
  assert.equal(h.records.has('organizations/org-a/members/owner-a'), true);
  assert.deepEqual(h.authWrites, []);
});
