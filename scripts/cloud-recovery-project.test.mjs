import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProjectId, assertOwnedProject, buildProjectRequest, run } from './cloud-recovery-project.mjs';

test('project request meets name and label limits', () => {
  const request = buildProjectRequest('kreatum-dr-20260912-1234abcd');
  assert.ok(request.displayName.length <= 30);
  assert.ok(request.displayName.length >= 4);
  for (const value of Object.values(request.labels)) assert.match(value, /^[a-z][-a-z0-9]*$/);
  assert.throws(() => buildProjectRequest('kreatum-dinamic'));
});

test('only accepts the temporary recovery namespace', () => {
  assert.equal(validateProjectId('kreatum-dr-20260912-1234abcd'), 'kreatum-dr-20260912-1234abcd');
  for (const value of ['kreatum-dinamic', 'kreatum-dinamic-staging', 'kreatum-dr-other', '../project']) assert.throws(() => validateProjectId(value));
});
test('requires ownership markers before reusing a cloud project', () => {
  const projectId = 'kreatum-dr-20260912-1234abcd';
  assert.doesNotThrow(() => assertOwnedProject({ projectId, labels: { purpose: 'identity-recovery-test', source: 'kreatum-dinamic' } }, projectId));
  assert.throws(() => assertOwnedProject({ projectId }, projectId));
  assert.throws(() => assertOwnedProject({ projectId: 'kreatum-dinamic' }, projectId));
});
test('unsupported operations fail before importing credentials or writing state', async () => {
  for (const args of [[], ['--delete'], ['--create-approved', 'extra']]) await assert.rejects(() => run(args));
});
