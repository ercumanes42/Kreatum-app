import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  appendManifestEvent,
  assertCleanupOrganizationOwnership,
  assertDedicatedSignerServiceAccount,
  assertOwnedIdentifier,
  assertSafeSmokeOptions,
  collectManifestResources,
  expectedConfirmation,
  parseSmokeArguments,
  readManifest,
  roomCodeFor,
} from './lib/production-smoke-guards.mjs';

const runId = 'smoke-prod-20260813T120000Z-deadbeef';

test('production smoke requires exact target, confirmation, run id and scoped manifest', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'kreatum-smoke-'));
  const parsed = parseSmokeArguments([
    '--execute', '--project', 'kreatum-dinamic', '--run-id', runId,
    '--confirm', expectedConfirmation(runId),
  ]);
  const safe = assertSafeSmokeOptions(parsed, cwd);
  assert.equal(safe.manifestPath, path.join(cwd, 'output', 'production-smoke', runId + '.jsonl'));
  assert.throws(() => assertSafeSmokeOptions({ ...parsed, projectId: 'another-project' }, cwd));
  assert.throws(() => assertSafeSmokeOptions({ ...parsed, confirmation: 'RUN-kreatum-dinamic' }, cwd));
  assert.throws(() => assertSafeSmokeOptions({ ...parsed, execute: false }, cwd));
  assert.throws(() => assertSafeSmokeOptions({
    ...parsed, manifestPath: path.join(cwd, 'outside.jsonl'),
  }, cwd));
  assert.equal(roomCodeFor(runId, 'A'), 'SDEADBEEFA');
});

test('cleanup only accepts resources recorded for the exact ephemeral run', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'kreatum-smoke-'));
  const manifestPath = path.join(cwd, runId + '.jsonl');
  appendManifestEvent(manifestPath, {
    type: 'manifest.created', projectId: 'kreatum-dinamic', runId,
  });
  appendManifestEvent(manifestPath, {
    type: 'resource.created', kind: 'organization', id: runId + '-org-a',
  });
  appendManifestEvent(manifestPath, {
    type: 'resource.created', kind: 'workshop', id: 'generatedWorkshopId',
    organizationId: runId + '-org-a',
  });
  appendManifestEvent(manifestPath, {
    type: 'resource.created', kind: 'user', id: 'firebase-auth-uid', role: 'facilitator',
  });
  appendManifestEvent(manifestPath, {
    type: 'resource.created',
    kind: 'platformCommand',
    id: '0123456789abcdef01234567',
    operation: 'suspendPlatformOrganization',
  });
  const events = readManifest(manifestPath, runId);
  const resources = collectManifestResources(events, runId);
  assert.deepEqual(resources.organizations, [runId + '-org-a']);
  assert.equal(resources.workshops[0].id, 'generatedWorkshopId');
  assert.deepEqual(resources.platformCommands, [{
    id: '0123456789abcdef01234567',
    operation: 'suspendPlatformOrganization',
  }]);
  assert.equal(readFileSync(manifestPath, 'utf8').split('\n').filter(Boolean).length, 5);
  assert.throws(() => assertOwnedIdentifier(runId, 'gfs', 'organization'));
  assert.throws(() => collectManifestResources([
    events[0],
    { type: 'resource.created', kind: 'organization', id: 'foreign-org' },
  ], runId));
});

test('requires the exact dedicated smoke token signer', () => {
  assert.equal(
    assertDedicatedSignerServiceAccount(
      'kreatum-smoke-token-signer@kreatum-dinamic.iam.gserviceaccount.com',
    ),
    'kreatum-smoke-token-signer@kreatum-dinamic.iam.gserviceaccount.com',
  );
  assert.throws(() => assertDedicatedSignerServiceAccount(
    'kreatum-functions-runtime@kreatum-dinamic.iam.gserviceaccount.com',
  ));
});

test('cleanup is resumable when an owned organization is already absent', () => {
  assert.equal(
    assertCleanupOrganizationOwnership(runId, runId + '-org-a', null),
    'absent',
  );
  assert.equal(
    assertCleanupOrganizationOwnership(runId, runId + '-org-a', { smokeRunId: runId }),
    'owned',
  );
  assert.throws(() => assertCleanupOrganizationOwnership(
    runId,
    runId + '-org-a',
    { smokeRunId: 'smoke-prod-20260813T120000Z-bad00000' },
  ));
  assert.throws(() => assertCleanupOrganizationOwnership(runId, 'customer-org', null));
});

test('rejects an adulterated, duplicate or displaced manifest header', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'kreatum-smoke-'));
  const manifestPath = path.join(cwd, runId + '.jsonl');
  const validHeader = {
    type: 'manifest.created', projectId: 'kreatum-dinamic', runId,
  };
  writeFileSync(manifestPath, [
    JSON.stringify({ type: 'resource.created', kind: 'organization', id: runId + '-org-a' }),
    JSON.stringify(validHeader),
  ].join('\n') + '\n');
  assert.throws(() => readManifest(manifestPath, runId));

  writeFileSync(manifestPath, [
    JSON.stringify(validHeader),
    JSON.stringify(validHeader),
  ].join('\n') + '\n');
  assert.throws(() => readManifest(manifestPath, runId));

  writeFileSync(manifestPath, JSON.stringify({
    ...validHeader,
    projectId: 'another-project',
  }) + '\n');
  assert.throws(() => readManifest(manifestPath, runId));
});
