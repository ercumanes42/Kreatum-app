import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { auditBlockers, evaluateRelease, operationalBlockers, productionBuildEnvironment, releaseCheckEnvironment, REQUIRED_OPERATIONAL_CONTROLS, REQUIRED_RELEASE_CHECKS, skippedTestCount } from './lib/release-security.mjs';

const validEvidence = () => ({
  fullGate: true,
  dirty: false,
  checks: REQUIRED_RELEASE_CHECKS.map((name) => ({ name, status: 'passed', exitCode: 0, skippedTests: 0, startedAtMs: 1000, environmentVerified: true, projectId: 'kreatum-dinamic' })),
  artifacts: Object.fromEntries(['frontend', 'functions'].map((name) => [name, {
    sha256: 'a'.repeat(64), fileCount: 2, entrypointPresent: true, entrypointModifiedAtMs: 2000,
  }])),
  blockers: [],
  operationalControls: {
    schemaVersion: 1,
    projectId: 'kreatum-dinamic',
    controls: REQUIRED_OPERATIONAL_CONTROLS.map((id) => ({ id, status: 'passed', evidence: 'unit-test-fixture-only' })),
  },
});

test('operational evidence fails closed for absent, invalid, pending and incomplete controls', () => {
  for (const mutate of [
    (e) => { delete e.operationalControls; },
    (e) => { e.operationalControls = null; },
    (e) => { e.operationalControls = 'invalid-json-document'; },
    (e) => { e.operationalControls.schemaVersion = 2; },
    (e) => { e.operationalControls.projectId = 'demo-kreatum'; },
    (e) => { e.operationalControls.controls = {}; },
    (e) => { e.operationalControls.controls.push(null); },
    (e) => { e.operationalControls.controls.pop(); },
    (e) => { e.operationalControls.controls.push(e.operationalControls.controls[0]); },
    (e) => { e.operationalControls.controls[0].status = 'pending'; },
    (e) => { e.operationalControls.controls[0].evidence = null; },
    (e) => { e.operationalControls.controls[0].evidence = ''; },
    (e) => { e.operationalControls.controls[0].evidence = '   '; },
    (e) => { e.operationalControls.controls[0].evidence = {}; },
    (e) => { e.operationalControls.controls.push({ id: 'unknown', status: 'passed', evidence: 'fixture' }); },
  ]) {
    const evidence = validEvidence();
    mutate(evidence);
    assert.equal(evaluateRelease(evidence).releaseEligible, false);
    assert.ok(operationalBlockers(evidence.operationalControls).length > 0);
  }
  assert.deepEqual(operationalBlockers(validEvidence().operationalControls), []);
});

test('repository operational document is valid and retains all required controls', async () => {
  const document = JSON.parse(await readFile(new URL('../docs/SECURITY_RELEASE_BLOCKERS.json', import.meta.url), 'utf8'));
  assert.equal(document.schemaVersion, 1);
  assert.equal(document.projectId, 'kreatum-dinamic');
  assert.deepEqual(document.controls.map((control) => control.id).sort(), [...REQUIRED_OPERATIONAL_CONTROLS].sort());
  // A pending control can never be compensated by successful technical tests.
  for (const id of REQUIRED_OPERATIONAL_CONTROLS) {
    const evidence = validEvidence();
    evidence.operationalControls.controls.find((control) => control.id === id).status = 'pending';
    assert.equal(evaluateRelease(evidence).releaseEligible, false);
  }
});

test('requires full, clean, successful and complete release evidence', () => {
  assert.equal(evaluateRelease(validEvidence()).releaseEligible, true);
  for (const mutate of [
    (e) => { e.fullGate = false; },
    (e) => { e.dirty = true; },
    (e) => { e.checks.pop(); },
    (e) => { e.checks[0].exitCode = 1; },
    (e) => { e.checks[0].status = 'failed'; },
    (e) => { e.checks[0].skippedTests = 3; },
    (e) => { delete e.checks[0].skippedTests; },
    (e) => { delete e.artifacts.functions; },
    (e) => { e.artifacts.frontend.fileCount = 0; },
    (e) => { e.artifacts.functions.entrypointPresent = false; },
    (e) => { e.artifacts.functions.entrypointModifiedAtMs = 999; },
    (e) => { delete e.artifacts.frontend.entrypointModifiedAtMs; },
    (e) => { e.checks.find((c) => c.name === 'build:release:frontend').environmentVerified = false; },
    (e) => { e.checks.find((c) => c.name === 'build:release:functions').projectId = 'demo-kreatum'; },
    (e) => { e.blockers = [{ severity: 'high' }]; },
  ]) {
    const evidence = validEvidence();
    mutate(evidence);
    assert.equal(evaluateRelease(evidence).releaseEligible, false);
  }
});

test('final build uses verified production values instead of inherited demo settings', () => {
  const production = { VITE_FIREBASE_PROJECT_ID: 'kreatum-dinamic', VITE_FIREBASE_AUTH_DOMAIN: 'kreatum-dinamic.firebaseapp.com', VITE_FIREBASE_STORAGE_BUCKET: 'kreatum-dinamic.firebasestorage.app', VITE_FIREBASE_USE_EMULATORS: 'false', VITE_KREATUM_DATA_MODEL: 'v2' };
  const inherited = { VITE_FIREBASE_PROJECT_ID: 'demo-kreatum', VITE_FIREBASE_USE_EMULATORS: 'true', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', KREATUM_E2E_PREBUILT: 'true', PATH: 'kept' };
  const result = productionBuildEnvironment(inherited, production);
  assert.equal(result.VITE_FIREBASE_PROJECT_ID, 'kreatum-dinamic');
  assert.equal(result.FIRESTORE_EMULATOR_HOST, undefined);
  assert.equal(result.KREATUM_E2E_PREBUILT, undefined);
  assert.equal(result.PATH, 'kept');
  assert.throws(() => productionBuildEnvironment(inherited, {}));
  assert.throws(() => productionBuildEnvironment({}, { ...production, VITE_FIREBASE_USE_EMULATORS: 'true' }));
});

test('high image-size advisories are blockers without package exceptions', () => {
  const report = { auditReportVersion: 2, vulnerabilities: {
    'image-size': { severity: 'high' }, pptxgenjs: { severity: 'high' },
    other: { severity: 'critical' }, moderate: { severity: 'moderate' },
  } };
  assert.deepEqual(auditBlockers(report).map((v) => v.name), ['image-size', 'pptxgenjs', 'other']);
  assert.deepEqual(auditBlockers({ auditReportVersion: 2, vulnerabilities: {} }), []);
  for (const invalid of [{}, { error: {} }, { auditReportVersion: 2, vulnerabilities: [] }]) {
    assert.throws(() => auditBlockers(invalid));
  }
});

test('detects omitted tests from Node and Playwright without confusing zero skips', () => {
  assert.equal(skippedTestCount('# tests 10\n# skipped 0\n'), 0);
  assert.equal(skippedTestCount('# skipped 3\n'), 3);
  assert.equal(skippedTestCount('  2 skipped\n  10 passed (2s)\n'), 2);
  assert.equal(skippedTestCount('ok 4 - revoked membership # SKIP\n'), 1);
});

test('full release removes inherited E2E filters and stale prebuilt bypasses', () => {
  const source = { KREATUM_ACCESS_E2E_SCOPE: 'access', KREATUM_GAMEPLAY_VIEWPORT: '390x844', KREATUM_E2E_PREBUILT: 'true', KREATUM_INTEGRATION_SCOPE: 'access' };
  for (const name of ['test:e2e', 'test:e2e:access', 'test:e2e:report']) {
    const environment = releaseCheckEnvironment(name, true, source);
    assert.equal(environment.KREATUM_ACCESS_E2E_SCOPE, 'all');
    assert.equal(environment.CI, 'true');
    assert.equal(environment.KREATUM_GAMEPLAY_VIEWPORT, undefined);
    assert.equal(environment.KREATUM_E2E_PREBUILT, undefined);
  }
  assert.equal(source.KREATUM_GAMEPLAY_VIEWPORT, '390x844');
  assert.equal(releaseCheckEnvironment('test:integration', true, source).KREATUM_INTEGRATION_SCOPE, 'all');
  assert.deepEqual(releaseCheckEnvironment('test:e2e:access', false, source), source);
});
