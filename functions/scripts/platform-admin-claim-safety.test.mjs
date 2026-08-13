import assert from 'node:assert/strict';
import test from 'node:test';
import { restoreCustomClaimsAfterFailedPostcondition } from './platform-admin-claim-safety.mjs';

test('restores the exact original claims and revokes refresh tokens after a failed postcondition', async () => {
  const calls = [];
  const auth = {
    setCustomUserClaims: async (uid, claims) => calls.push(['claims', uid, claims]),
    revokeRefreshTokens: async (uid) => calls.push(['revoke', uid]),
  };
  const originalClaims = { support: true, nested: { scope: 'gfs' } };

  await restoreCustomClaimsAfterFailedPostcondition(auth, 'real-ju-uid', originalClaims);

  assert.deepEqual(calls, [
    ['claims', 'real-ju-uid', originalClaims],
    ['revoke', 'real-ju-uid'],
  ]);
});

test('does not hide a rollback failure', async () => {
  const auth = {
    setCustomUserClaims: async () => { throw new Error('rollback denied'); },
    revokeRefreshTokens: async () => assert.fail('tokens must not be revoked before claims are restored'),
  };

  await assert.rejects(
    restoreCustomClaimsAfterFailedPostcondition(auth, 'real-ju-uid', {}),
    /rollback denied/,
  );
});
