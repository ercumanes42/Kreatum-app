import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STAGING_PROJECT, STAGING_APP_ID, validateStagingSmokeOptions, assertSyntheticPath,
  verifyStagingWebConfig, sanitizedFailureCode, runStagingSecuritySmoke,
} from './staging-security-smoke.mjs';

const args = ['--project', STAGING_PROJECT, '--execute'];
const runId = 'security-stage-test-0123456789abcdef';

test('staging smoke requires exact project and explicit execution authorization', () => {
  assert.deepEqual(validateStagingSmokeOptions(args, {}), { projectId: STAGING_PROJECT, execute: true });
  for (const invalid of [
    [], ['--project', STAGING_PROJECT], ['--execute'],
    ['--project', 'kreatum-dinamic', '--execute'],
    [...args, '--project', STAGING_PROJECT], [...args, '--execute'],
    [...args, '--run-id', 'customer'], ['--project'],
  ]) assert.throws(() => validateStagingSmokeOptions(invalid, {}));
});

test('staging smoke rejects emulator and conflicting project environments', () => {
  for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FUNCTIONS_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST', 'FIREBASE_EMULATOR_HUB']) {
    assert.throws(() => validateStagingSmokeOptions(args, { [key]: '127.0.0.1:8080' }));
  }
  for (const key of ['GOOGLE_CLOUD_PROJECT', 'GCLOUD_PROJECT', 'GOOGLE_CLOUD_QUOTA_PROJECT']) {
    assert.throws(() => validateStagingSmokeOptions(args, { [key]: 'kreatum-dinamic' }));
    assert.doesNotThrow(() => validateStagingSmokeOptions(args, { [key]: STAGING_PROJECT }));
  }
  for (const config of ['file.json', '{"projectId":"kreatum-dinamic"}', '{}']) {
    assert.throws(() => validateStagingSmokeOptions(args, { FIREBASE_CONFIG: config }));
  }
  assert.doesNotThrow(() => validateStagingSmokeOptions(args, { FIREBASE_CONFIG: JSON.stringify({ projectId: STAGING_PROJECT }) }));
});

test('all writable fixture paths must belong to the current synthetic run', () => {
  for (const resource of [
    'organizations/' + runId + '-org-a',
    'organizations/' + runId + '-org-a/members/synthetic-user',
    'workshops/' + runId + '-workshop/participantDeviceSlots/3',
    'users/' + runId + '-owner/organizationMemberships/' + runId + '-org-a',
  ]) assert.equal(assertSyntheticPath(runId, resource), resource);
  for (const resource of [
    'organizations/customer', 'workshops/CAIXA1926', 'users/customer',
    'organizations/' + runId + '-org-a/../customer',
    'workshops/' + runId + '-workshop//team',
    'activeRoomCodes/CUSTOMER',
    'organizations/security-stage-other-0123456789abcdef-org-a',
  ]) assert.throws(() => assertSyntheticPath(runId, resource));
  assert.throws(() => assertSyntheticPath('customer', 'organizations/customer-org'));
});

test('web config must match the known staging Firebase project and app', () => {
  const config = { projectId: STAGING_PROJECT, appId: STAGING_APP_ID, apiKey: 'synthetic-public-key' };
  assert.deepEqual(verifyStagingWebConfig(config), config);
  for (const wrong of [{ ...config, projectId: 'kreatum-dinamic' }, { ...config, appId: 'production-app' }, { ...config, apiKey: '' }, null]) {
    assert.throws(() => verifyStagingWebConfig(wrong));
  }
});

test('error reporting never propagates arbitrary payloads or messages', () => {
  assert.equal(sanitizedFailureCode({ code: 'functions/permission-denied', message: 'private payload' }), 'functions/permission-denied');
  for (const error of [new Error('private payload'), { code: 'token=value' }, { code: 'user@example.test' }, {}]) {
    assert.equal(sanitizedFailureCode(error), 'verification-failed');
  }
});

test('invalid execution fails before imports, credentials, network or fixture creation', async () => {
  await assert.rejects(runStagingSecuritySmoke(['--project', 'kreatum-dinamic', '--execute'], {}));
  await assert.rejects(runStagingSecuritySmoke(args, { FIRESTORE_EMULATOR_HOST: 'localhost:8080' }));
});
