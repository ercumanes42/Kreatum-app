import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { allIntegrationTestFiles, discoverFunctionTestSuites, FUNCTIONS_DIRECTORY, integrationTestBatches } from './lib/function-test-suites.mjs';

test('emulator authorization tests remain mandatory in integration and absent from unit', () => {
  const suites = discoverFunctionTestSuites();
  for (const name of ['workshopAdminAuthorization', 'organizationOwnerAuthorization']) {
    const file = `src/security/${name}.integration.test.ts`;
    assert.ok(suites.integration.includes(file));
    assert.ok(!suites.unit.includes(file));
    assert.ok(allIntegrationTestFiles().includes(`functions/${file}`));
  }
  assert.equal(suites.unit.some((file) => suites.integration.includes(file)), false);
});

test('unit suite cannot silently contain tests conditional on an emulator', () => {
  for (const file of discoverFunctionTestSuites().unit) {
    const source = readFileSync(path.join(FUNCTIONS_DIRECTORY, file), 'utf8');
    assert.doesNotMatch(source, /skip\s*:\s*!?emulatorAvailable|Boolean\(process\.env\.FIRESTORE_EMULATOR_HOST\)/, file);
  }
});

test('every browser spec has an explicit mandatory smoke or emulator runner', () => {
  const root = path.dirname(FUNCTIONS_DIRECTORY.replace(/[\\/]$/, ''));
  const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const accessRunner = readFileSync(path.join(root, 'scripts/run-access-e2e.mjs'), 'utf8');
  const reportRunner = readFileSync(path.join(root, 'scripts/run-report-e2e.mjs'), 'utf8');
  assert.equal(packageJson.scripts['test:e2e'], 'playwright test e2e/accessibility.spec.ts');
  for (const file of readdirSync(path.join(root, 'e2e')).filter((name) => name.endsWith('.spec.ts'))) {
    assert.ok([packageJson.scripts['test:e2e'], accessRunner, reportRunner].some((runner) => runner.includes(`e2e/${file}`)), `Unassigned browser spec: ${file}`);
  }
});

test('all integration batches cover every file exactly once without filtering cases', () => {
  const root = path.dirname(FUNCTIONS_DIRECTORY.replace(/[\\/]$/, ''));
  const expected = [
    ...readdirSync(path.join(root, 'tests')).filter((file) => file.endsWith('.integration.test.ts')).map((file) => `tests/${file}`),
    ...discoverFunctionTestSuites().integration.map((file) => `functions/${file}`),
  ].sort();
  const batches = integrationTestBatches();
  assert.ok(batches.every((batch) => batch.length === 1));
  assert.deepEqual(batches.flat().sort(), expected);
  assert.equal(new Set(batches.flat()).size, expected.length);
  for (const scope of ['access', 'platform', 'resilience', 'lifecycle']) {
    assert.equal(integrationTestBatches(scope).length, 1);
  }
  for (const scope of ['missing', 'constructor', '__proto__', 'toString']) {
    assert.throws(() => integrationTestBatches(scope), /KREATUM_INTEGRATION_SCOPE/);
  }
});

// Exercise the actual runner with process doubles; do not start any emulators.
const simulateRunner = (emulatorResult = () => ({ status: 0 }), scope = 'all') => {
  const root = path.dirname(FUNCTIONS_DIRECTORY.replace(/[\\/]$/, ''));
  const source = readFileSync(path.join(root, 'scripts/run-functions-integration.mjs'), 'utf8')
    .replace(/^import .*;\r?\n/gm, '');
  const calls = [];
  const context = {
    path, integrationTestBatches, existsSync: () => true,
    process: {
      platform: 'linux', execPath: '/node', cwd: () => root,
      env: { KREATUM_INTEGRATION_SCOPE: scope },
      exit: (code) => { throw new Error(`exit:${code}`); },
    },
    spawnSync: (command, args, options) => {
      calls.push({ command, args, options });
      if (args.includes('emulators:exec')) return emulatorResult(calls.filter((call) => call.args.includes('emulators:exec')).length);
      return { status: 0, stdout: '/global' };
    },
  };
  let error;
  try { vm.runInNewContext(source, context); } catch (caught) { error = caught; }
  return { calls, error };
};

test('integration runner builds once and starts a fresh emulator invocation per mandatory file', () => {
  const { calls, error } = simulateRunner();
  assert.equal(error, undefined);
  assert.equal(calls.filter((call) => call.args.includes('build')).length, 1);
  const executions = calls.filter((call) => call.args.includes('emulators:exec'));
  assert.equal(executions.length, allIntegrationTestFiles().length);
  assert.deepEqual(executions.map((call) => call.args.at(-1)),
    allIntegrationTestFiles().map((file) => 'tsx --test --test-concurrency=1 ' + file));
  for (const call of executions) {
    assert.deepEqual(Array.from(call.args.slice(1, -1)), ['emulators:exec', '--only', 'auth,firestore,functions,storage', '--project', 'demo-kreatum']);
    assert.equal(call.options.env.FUNCTIONS_DISCOVERY_TIMEOUT, '90');
    assert.equal(call.options.env.KREATUM_EMAIL_DELIVERY_MODE, 'suppressed');
    assert.equal(call.options.shell, false);
    assert.doesNotMatch(call.args.at(-1), /--test-name-pattern|--test-timeout/);
  }
});

test('integration runner fails closed and does not execute later files after a failure', () => {
  for (const failure of [{ status: 1 }, { status: null }, { signal: 'SIGTERM' }, { error: new Error('spawn failed') }]) {
    const { calls, error } = simulateRunner((index) => index === 2 ? failure : { status: 0 });
    assert.ok(error, 'A failed, interrupted or missing process result must fail the runner');
    assert.equal(calls.filter((call) => call.args.includes('emulators:exec')).length, 2);
  }
  const invalid = simulateRunner(undefined, 'constructor');
  assert.ok(invalid.error);
  assert.equal(invalid.calls.length, 0, 'Invalid scope fails before building or starting emulators');
});
