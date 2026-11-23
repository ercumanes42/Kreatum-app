import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
  STAGING_BROWSER_ORIGIN, BROWSER_CLIENT_NAMES, validateBrowserPublicConfig,
  assertBrowserEnvironment, browserContextOptions, preflightBrowserContexts, buildBrowserTransportBundle, BROWSER_TRANSPORT_SOURCE,
  diagnosticStage, safeStagingDiagnostic, stagingDiagnosticError,
} from './lib/staging-browser-transport.mjs';
import { assertTakeoverPreconditions, validateStagingSmokeOptions, stagingFailureDetails } from './staging-security-smoke.mjs';

const publicConfig = {
  VITE_FIREBASE_PROJECT_ID: 'kreatum-dinamic-staging',
  VITE_FIREBASE_APP_ID: '1:829452780690:web:20d259ebf5defe2286124b',
  VITE_FIREBASE_USE_EMULATORS: 'false',
  VITE_FIREBASE_AUTH_DOMAIN: 'kreatum-dinamic-staging.firebaseapp.com',
  VITE_FIREBASE_FUNCTIONS_REGION: 'europe-southwest1',
  VITE_FIREBASE_APPCHECK_SITE_KEY: 'synthetic-public-site-key-not-real',
};

test('browser transport only accepts the exact normal staging configuration', () => {
  assert.deepEqual(validateBrowserPublicConfig(publicConfig), { siteKey: publicConfig.VITE_FIREBASE_APPCHECK_SITE_KEY, region: 'europe-southwest1' });
  for (const key of Object.keys(publicConfig)) {
    assert.throws(() => validateBrowserPublicConfig({ ...publicConfig, [key]: '' }));
  }
  assert.throws(() => validateBrowserPublicConfig({ ...publicConfig, VITE_FIREBASE_PROJECT_ID: 'kreatum-dinamic' }));
  assert.throws(() => validateBrowserPublicConfig({ ...publicConfig, VITE_FIREBASE_USE_EMULATORS: 'true' }));
});

test('browser rejects debugging, emulator and App Check bypass environments', () => {
  assert.doesNotThrow(() => assertBrowserEnvironment({}));
  for (const key of ['DEBUG', 'PWDEBUG', 'FIREBASE_APPCHECK_DEBUG_TOKEN', 'VITE_FIREBASE_APP_CHECK_DEBUG_TOKEN', 'FIRESTORE_EMULATOR_HOST']) {
    assert.throws(() => assertBrowserEnvironment({ [key]: 'synthetic' }));
  }
  assert.deepEqual(browserContextOptions(), { acceptDownloads: false, bypassCSP: false, ignoreHTTPSErrors: false });
});

function fakeBrowser(rejectAt = -1, result = { ok: false }, redirect = false) {
  const calls = [];
  let index = 0;
  return {
    calls,
    async newContext(options) {
      const current = index++;
      calls.push({ operation: 'context', options });
      return { async newPage() { return {
        async goto(url, options) { calls.push({ operation: 'goto', url, options }); return { ok: () => true }; },
        url: () => redirect ? 'https://example.invalid/admin' : STAGING_BROWSER_ORIGIN + '/admin',
        async evaluate(value, input) {
          if (typeof value === 'string') { calls.push({ operation: 'bundle' }); return; }
          calls.push({ operation: 'attestation', name: input.name });
          return current === rejectAt ? result : { ok: true, value: { attested: true, signedOut: true } };
        },
      }; } };
    },
  };
}

test('preflight attests all five isolated signed-out contexts on real staging admin origin', async () => {
  const browser = fakeBrowser();
  const clients = await preflightBrowserContexts(browser, 'synthetic bundle', {});
  assert.deepEqual([...clients.keys()], BROWSER_CLIENT_NAMES);
  assert.equal(browser.calls.filter(call => call.operation === 'context').length, 5);
  for (const call of browser.calls.filter(call => call.operation === 'goto')) assert.equal(call.url, STAGING_BROWSER_ORIGIN + '/admin');
  assert.deepEqual(browser.calls.filter(call => call.operation === 'attestation').map(call => call.name), BROWSER_CLIENT_NAMES);
});

test('normal attestation rejection or an authenticated context fails closed at every preflight position', async () => {
  for (let index = 0; index < 5; index++) {
    for (const result of [{ ok: false }, { ok: true, value: { attested: false, signedOut: true } }, { ok: true, value: { attested: true, signedOut: false } }]) {
      const browser = fakeBrowser(index, result);
      await assert.rejects(preflightBrowserContexts(browser, 'synthetic bundle', {}));
      assert.equal(browser.calls.filter(call => call.operation === 'context').length, index + 1);
    }
  }
  const browser = fakeBrowser(-1, undefined, true);
  await assert.rejects(preflightBrowserContexts(browser, 'synthetic bundle', {}));
  assert.equal(browser.calls.some(call => call.operation === 'attestation'), false);
});

test('App Check rejection preserves HTTP status without exposing provider payloads', async () => {
  const browser = fakeBrowser(0, { ok: false, code: 'appCheck/initial-throttle', httpStatus: 403, message: 'private provider payload', token: 'never report' });
  await assert.rejects(preflightBrowserContexts(browser, 'synthetic bundle', {}), error => {
    assert.deepEqual(safeStagingDiagnostic(error), { stage: 'appcheck', category: 'appcheck-rejected', contextName: 'owner', sdkCode: 'appCheck/initial-throttle', httpStatus: 403 });
    assert.doesNotMatch(JSON.stringify(safeStagingDiagnostic(error)), /private|never report/);
    return true;
  });
  assert.equal(browser.calls.filter(call => call.operation === 'attestation').length, 1);
});

test('runner waits for normal browser preflight before creating Auth fixtures and has no Node client fallback', () => {
  const source = readFileSync(new URL('./staging-security-smoke.mjs', import.meta.url), 'utf8');
  const preflight = source.indexOf('browserTransport = await createStagingBrowserTransport');
  assert.ok(preflight > 0 && preflight < source.indexOf('await adminAuth.createUser'));
  const stop = source.indexOf('if (options.preflightOnly)', preflight);
  assert.ok(stop > preflight && source.indexOf('return result;', stop) < source.indexOf('await adminAuth.createUser'));
  assert.equal(/import\(['"]firebase\//.test(source), false);
  assert.match(source, /finally\s*\{\s*await browserTransport\?\.close\(\)/);
});

test('preflight-only is an explicit non-mutating mode and cannot be combined with execute', () => {
  const args = ['--project', 'kreatum-dinamic-staging', '--preflight-only'];
  assert.deepEqual(validateStagingSmokeOptions(args, {}), { projectId: 'kreatum-dinamic-staging', execute: false, preflightOnly: true });
  assert.throws(() => validateStagingSmokeOptions([...args, '--execute'], {}));
  assert.throws(() => validateStagingSmokeOptions([...args, '--preflight-only'], {}));
  assert.throws(() => validateStagingSmokeOptions(['--project', 'kreatum-dinamic', '--preflight-only'], {}));
  assert.throws(() => validateStagingSmokeOptions(args, { FIREBASE_APPCHECK_DEBUG_TOKEN: 'synthetic' }));
});

test('diagnostics preserve safe stage and status without messages, secrets, arbitrary codes or context names', () => {
  const failure = stagingDiagnosticError('web-config-http', 'config-http-status', { httpStatus: 403, cause: new Error('private token or email'), token: 'private' });
  assert.deepEqual(safeStagingDiagnostic(failure), { stage: 'web-config-http', category: 'config-http-status', httpStatus: 403 });
  const sanitized = safeStagingDiagnostic({ diagnostic: { stage: 'private', category: 'private', httpStatus: 999, contextName: 'user@example.invalid', sdkCode: 'secret=value', message: 'private' } });
  assert.deepEqual(sanitized, { stage: 'security-checks', category: 'verification-failed' });
  const appCheck = stagingDiagnosticError('appcheck', 'appcheck-rejected', { contextName: 'owner', sdkCode: 'appCheck/recaptcha-error' });
  assert.equal(safeStagingDiagnostic(appCheck).sdkCode, 'appCheck/recaptcha-error');
});

test('local stage classifiers distinguish credentials, launch, missing browser, timeout and injection failure', async () => {
  for (const [stage, category, cause, expected] of [
    ['credentials', 'credential-access', new Error('private'), 'credential-access'],
    ['browser-launch', 'launch', new Error('private'), 'launch'],
    ['browser-launch', 'launch', new Error("Executable doesn't exist at private-path"), 'browser-binary-missing'],
    ['browser-origin', 'browser-origin', Object.assign(new Error('private'), { name: 'TimeoutError' }), 'timeout'],
    ['browser-inject', 'script-injection', new Error('private'), 'script-injection'],
  ]) {
    await assert.rejects(diagnosticStage(stage, category, async () => { throw cause; }), error => {
      assert.deepEqual(safeStagingDiagnostic(error), { stage, category: expected });
      assert.equal(error.cause, cause);
      assert.equal(error.message.includes('private'), false);
      return true;
    });
  }
});

test('preflight rejection reports App Check code and origin failures report their own stage', async () => {
  await assert.rejects(preflightBrowserContexts(fakeBrowser(2, { ok: false, code: 'appCheck/recaptcha-error' }), 'synthetic', {}), error => {
    assert.deepEqual(safeStagingDiagnostic(error), { stage: 'appcheck', category: 'appcheck-rejected', contextName: 'old-device', sdkCode: 'appCheck/recaptcha-error' });
    return true;
  });
  await assert.rejects(preflightBrowserContexts(fakeBrowser(-1, undefined, true), 'synthetic', {}), error => {
    assert.equal(safeStagingDiagnostic(error).stage, 'browser-origin');
    return true;
  });
});

test('failed preflight has no retained fixtures; an attempted fixture write is conservatively retained', () => {
  const error = stagingDiagnosticError('appcheck', 'appcheck-rejected');
  assert.equal(stagingFailureDetails(error, { preflightOnly: true, fixturesMayExist: false }).retainedFixtures, false);
  assert.equal(stagingFailureDetails(error, { preflightOnly: true, fixturesMayExist: true }).retainedFixtures, false);
  assert.equal(stagingFailureDetails(error, { fixturesMayExist: false }).retainedFixtures, false);
  assert.equal(stagingFailureDetails(error, { fixturesMayExist: true }).retainedFixtures, true);
});

test('browser SDK bundle compiles locally without a browser or cloud execution', async () => {
  const bundle = await buildBrowserTransportBundle();
  assert.ok(bundle.length > 1000);
  assert.match(bundle, /__kreatumSecurityQA/);
});

test('browser operations reject another syntactically valid room and any other solution path', async () => {
  const calls = [];
  const scope = {
    location: { origin: STAGING_BROWSER_ORIGIN },
    initializeApp: () => ({}), initializeAuth: () => ({ currentUser: null }), inMemoryPersistence: {},
    initializeAppCheck: () => ({}), ReCaptchaEnterpriseProvider: class {},
    getToken: async () => ({ token: 'synthetic-unit-token' }),
    getFunctions: () => ({}), getFirestore: () => ({}),
    httpsCallable: (_, name) => async data => { calls.push({ name, data }); return { data: {} }; },
    doc: (_, resourcePath) => resourcePath,
    setDoc: async resourcePath => { calls.push({ resourcePath }); }, serverTimestamp: () => 'synthetic',
  };
  vm.createContext(scope);
  vm.runInContext(BROWSER_TRANSPORT_SOURCE.replace(/^import .*;$/gm, ''), scope);
  const runId = 'security-stage-test-0123456789abcdef';
  const roomCode = 'Z012345678';
  assert.equal((await scope.__kreatumSecurityQA.initialize({
    config: { projectId: publicConfig.VITE_FIREBASE_PROJECT_ID, appId: publicConfig.VITE_FIREBASE_APP_ID },
    siteKey: publicConfig.VITE_FIREBASE_APPCHECK_SITE_KEY, region: 'europe-southwest1', name: 'old-device', runId, roomCode,
  })).ok, true);
  const invoke = data => scope.__kreatumSecurityQA.execute({ operation: 'call', input: { name: 'joinWorkshopByCode', data } });
  assert.equal((await invoke({ roomCode: 'Z999999999' })).ok, false);
  assert.equal(calls.length, 0);
  assert.equal((await invoke({ roomCode })).ok, true);
  assert.equal(calls.length, 1);
  const solution = resourcePath => scope.__kreatumSecurityQA.execute({ operation: 'solution', input: { path: resourcePath, content: 'Synthetic' } });
  for (const resourcePath of ['organizations/' + runId + '-org-a', 'workshops/' + runId + '-workshop/teams/Agua', 'workshops/' + runId + '-workshop/solutions/Fuego']) {
    assert.equal((await solution(resourcePath)).ok, false);
    assert.equal(calls.length, 1);
  }
  assert.equal((await solution('workshops/' + runId + '-workshop/solutions/Agua')).ok, true);
  assert.equal(calls.length, 2);
});

test('takeover denial is inconclusive if any lease, identity, active state or phase is wrong', () => {
  const now = 1000;
  const future = { toMillis: () => now + 1 };
  const valid = phase => ({
    workshop: { status: 'active', currentPhase: phase }, phase, oldUid: 'old', newUid: 'new',
    session: { status: 'active', team: 'Agua', deviceSlot: 3, expiresAt: future },
    slot: { participantId: 'old', expiresAt: future },
    team: { activeParticipantId: 'new', activeDeviceExpiresAt: future },
  });
  for (const phase of ['Sublimar', 'Conjugar']) {
    assert.doesNotThrow(() => assertTakeoverPreconditions(valid(phase), now));
    for (const [object, key, value] of [
      ['workshop', 'status', 'completed'], ['workshop', 'currentPhase', 'other'],
      ['session', 'status', 'expired'], ['session', 'team', 'Aire'], ['session', 'deviceSlot', 2],
      ['slot', 'participantId', 'other'], ['team', 'activeParticipantId', 'old'],
      ['session', 'expiresAt', { toMillis: () => now }], ['slot', 'expiresAt', { toMillis: () => now - 1 }],
      ['team', 'activeDeviceExpiresAt', undefined],
    ]) {
      const fixture = valid(phase);
      fixture[object][key] = value;
      assert.throws(() => assertTakeoverPreconditions(fixture, now));
    }
  }
});
