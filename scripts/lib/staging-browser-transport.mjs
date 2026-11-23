import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { createRequire } from 'node:module';

export const STAGING_BROWSER_ORIGIN = 'https://kreatum-dinamic-staging.web.app';
export const BROWSER_CLIENT_NAMES = ['owner', 'shared', 'old-device', 'new-device', 'peer-device'];
const PROJECT = 'kreatum-dinamic-staging';
const APP_ID = '1:829452780690:web:20d259ebf5defe2286124b';

const DIAGNOSTIC_STAGES = new Set(['credentials', 'web-config-http', 'web-config-validate', 'browser-config', 'browser-bundle', 'browser-launch', 'browser-context', 'browser-origin', 'browser-inject', 'appcheck', 'fixtures', 'security-checks']);
const DIAGNOSTIC_CATEGORIES = new Set(['credential-access', 'config-http-status', 'configuration', 'bundle-build', 'launch', 'browser-binary-missing', 'browser-context', 'browser-origin', 'script-injection', 'appcheck-rejected', 'timeout', 'verification-failed']);

export function safeStagingDiagnostic(error, fallbackStage = 'security-checks') {
  const value = error?.diagnostic;
  const result = {
    stage: DIAGNOSTIC_STAGES.has(value?.stage) ? value.stage : (DIAGNOSTIC_STAGES.has(fallbackStage) ? fallbackStage : 'security-checks'),
    category: DIAGNOSTIC_CATEGORIES.has(value?.category) ? value.category : 'verification-failed',
  };
  if (Number.isInteger(value?.httpStatus) && value.httpStatus >= 100 && value.httpStatus <= 599) result.httpStatus = value.httpStatus;
  if (BROWSER_CLIENT_NAMES.includes(value?.contextName)) result.contextName = value.contextName;
  if (typeof value?.sdkCode === 'string' && /^(functions\/|auth\/|appCheck\/)[a-z-]{3,60}$/.test(value.sdkCode)) result.sdkCode = value.sdkCode;
  return result;
}

export function stagingDiagnosticError(stage, category, details = {}) {
  const error = new Error('Staging verification stopped; diagnostic fields are sanitized.', { cause: details.cause });
  error.diagnostic = safeStagingDiagnostic({ diagnostic: { stage, category, ...details } });
  return error;
}

export async function diagnosticStage(stage, category, action, details = {}) {
  try { return await action(); } catch (error) {
    if (error?.diagnostic) throw error;
    let classification = category;
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') classification = 'timeout';
    // Classify a known local installation error without copying its path or full message.
    else if (stage === 'browser-launch' && /Executable doesn't exist/i.test(String(error?.message))) classification = 'browser-binary-missing';
    throw stagingDiagnosticError(stage, classification, { ...details, cause: error });
  }
}

export function validateBrowserPublicConfig(values) {
  if (values.VITE_FIREBASE_PROJECT_ID !== PROJECT || values.VITE_FIREBASE_APP_ID !== APP_ID
    || values.VITE_FIREBASE_USE_EMULATORS !== 'false'
    || values.VITE_FIREBASE_AUTH_DOMAIN !== PROJECT + '.firebaseapp.com'
    || values.VITE_FIREBASE_FUNCTIONS_REGION !== 'europe-southwest1'
    || !/^[A-Za-z0-9_-]{20,}$/.test(values.VITE_FIREBASE_APPCHECK_SITE_KEY || '')) {
    throw new Error('Unexpected staging browser public configuration.');
  }
  return { siteKey: values.VITE_FIREBASE_APPCHECK_SITE_KEY, region: values.VITE_FIREBASE_FUNCTIONS_REGION };
}

export function assertBrowserEnvironment(env) {
  for (const key of Object.keys(env)) {
    if (env[key] && (/EMULATOR|APPCHECK_DEBUG|APP_CHECK_DEBUG/i.test(key)
      || ['DEBUG', 'PWDEBUG', 'PW_TEST_HTML_REPORT_OPEN'].includes(key))) {
      throw new Error('Debug, token bypass and emulator environments are forbidden.');
    }
  }
}

export const browserContextOptions = () => ({ acceptDownloads: false, bypassCSP: false, ignoreHTTPSErrors: false });

// Bundled locally, never published. User credentials and all client tokens remain in this browser closure.
export const BROWSER_TRANSPORT_SOURCE = String.raw`
import { initializeApp } from 'firebase/app';
import { initializeAuth, inMemoryPersistence, signInWithEmailAndPassword, signInAnonymously, signOut } from 'firebase/auth';
import { initializeAppCheck, ReCaptchaEnterpriseProvider, getToken } from 'firebase/app-check';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getFirestore, doc, getDocFromServer, setDoc, serverTimestamp } from 'firebase/firestore';
let runtime;
const safeCode = error => typeof error?.code === 'string' && /^(functions\/|auth\/|appCheck\/)?[a-z-]{3,60}$/.test(error.code) ? error.code : 'verification-failed';
const ownedPath = value => {
  const parts = String(value).split('/');
  if (!['organizations', 'workshops', 'users'].includes(parts[0]) || !parts[1]?.startsWith(runtime.runId + '-')
    || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) throw new Error('Synthetic scope violation.');
  return value;
};
const allowedCalls = new Set(['listTeamAccess', 'changeMemberStatus', 'joinWorkshopByCode', 'selectTeam', 'submitWorkshopAttack', 'updateWorkshopAttack', 'deleteWorkshopAttack', 'saveWorkshopDefense', 'reconnectParticipantSession']);
globalThis.__kreatumSecurityQA = {
  async initialize({ config, siteKey, region, name, runId, roomCode }) {
    try {
      if (location.origin !== 'https://kreatum-dinamic-staging.web.app' || config.projectId !== 'kreatum-dinamic-staging'
        || config.appId !== '1:829452780690:web:20d259ebf5defe2286124b' || !/^Z[A-F0-9]{9}$/.test(roomCode)
        || runtime || globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN) throw new Error('Preflight guard.');
      const app = initializeApp(config, 'security-qa-' + name);
      const auth = initializeAuth(app, { persistence: inMemoryPersistence });
      const appCheck = initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(siteKey), isTokenAutoRefreshEnabled: true });
      runtime = { auth, appCheck, functions: getFunctions(app, region), firestore: getFirestore(app), runId, roomCode };
      const result = await getToken(appCheck, false);
      if (!result.token || auth.currentUser) throw new Error('Unattested or authenticated preflight.');
      return { ok: true, value: { attested: true, signedOut: true } };
    } catch (error) {
      const httpStatus = error?.customData?.httpStatus;
      return { ok: false, code: safeCode(error), ...(Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599 ? { httpStatus } : {}) };
    }
  },
  async execute({ operation, input }) {
    try {
      if (!runtime || location.origin !== 'https://kreatum-dinamic-staging.web.app') throw new Error('Browser scope changed.');
      let value = {};
      if (operation === 'login') {
        if (!input.email.startsWith(runtime.runId + '-') || !input.email.endsWith('@example.invalid')) throw new Error('Synthetic account required.');
        value = { uid: (await signInWithEmailAndPassword(runtime.auth, input.email, input.password)).user.uid };
      } else if (operation === 'anonymous') value = { uid: (await signInAnonymously(runtime.auth)).user.uid };
      else if (operation === 'logout') await signOut(runtime.auth);
      else if (operation === 'read') value = { exists: (await getDocFromServer(doc(runtime.firestore, ownedPath(input.path)))).exists() };
      else if (operation === 'solution') {
        if (input.path !== 'workshops/' + runtime.runId + '-workshop/solutions/Agua') throw new Error('Synthetic solution path required.');
        await setDoc(doc(runtime.firestore, ownedPath(input.path)), { team: 'Agua', content: input.content, timestamp: serverTimestamp(), schemaVersion: 2 });
      }
      else if (operation === 'call') {
        if (!allowedCalls.has(input.name)) throw new Error('Unapproved callable.');
        for (const [key, root] of [['workshopId', 'workshops'], ['organizationId', 'organizations'], ['memberId', 'users']]) {
          if (input.data[key]) ownedPath(root + '/' + input.data[key]);
        }
        if (input.name === 'joinWorkshopByCode' && input.data.roomCode !== runtime.roomCode) throw new Error('Current run room required.');
        const result = (await httpsCallable(runtime.functions, input.name)(input.data)).data;
        for (const key of ['team', 'attackId']) if (typeof result?.[key] === 'string' || result?.[key] === null) value[key] = result[key];
      } else throw new Error('Unapproved operation.');
      return { ok: true, value };
    } catch (error) { return { ok: false, code: safeCode(error) }; }
  }
};
`;

export async function buildBrowserTransportBundle() {
  const requireFunctions = createRequire(path.resolve('functions', 'package.json'));
  const result = await requireFunctions('esbuild').build({
    stdin: { contents: BROWSER_TRANSPORT_SOURCE, resolveDir: process.cwd(), sourcefile: 'staging-security-browser.js' },
    bundle: true, write: false, platform: 'browser', format: 'iife', target: ['chrome120'], logLevel: 'silent',
  });
  return result.outputFiles[0].text;
}

// All five contexts must attest before the caller creates any Auth or Firestore fixtures.
export async function preflightBrowserContexts(browser, bundle, parameters) {
  const clients = new Map();
  for (const name of BROWSER_CLIENT_NAMES) {
    const context = await diagnosticStage('browser-context', 'browser-context', () => browser.newContext(browserContextOptions()), { contextName: name });
    const page = await diagnosticStage('browser-context', 'browser-context', () => context.newPage(), { contextName: name });
    // /admin does not trigger the product's automatic anonymous sign-in.
    const response = await diagnosticStage('browser-origin', 'browser-origin', () => page.goto(STAGING_BROWSER_ORIGIN + '/admin', { waitUntil: 'domcontentloaded', timeout: 30_000 }), { contextName: name });
    if (!response?.ok() || new URL(page.url()).origin !== STAGING_BROWSER_ORIGIN) throw stagingDiagnosticError('browser-origin', 'browser-origin', { contextName: name, httpStatus: response?.status?.() });
    await diagnosticStage('browser-inject', 'script-injection', () => page.evaluate(bundle), { contextName: name });
    let timer;
    let result;
    try {
      result = await diagnosticStage('appcheck', 'appcheck-rejected', () => Promise.race([
        page.evaluate(input => globalThis.__kreatumSecurityQA.initialize(input), { ...parameters, name }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(stagingDiagnosticError('appcheck', 'timeout', { contextName: name })), 30_000); }),
      ]), { contextName: name });
    } finally { clearTimeout(timer); }
    if (!result?.ok || result.value?.attested !== true || result.value?.signedOut !== true) throw stagingDiagnosticError('appcheck', 'appcheck-rejected', { contextName: name, sdkCode: result?.code, httpStatus: result?.httpStatus });
    clients.set(name, { page });
  }
  return clients;
}

export async function createStagingBrowserTransport({ config, runId, roomCode, env = process.env }) {
  assertBrowserEnvironment(env);
  assert.equal(config.projectId, PROJECT);
  assert.equal(config.appId, APP_ID);
  assert.match(runId, /^security-stage-[a-z0-9]+-[a-f0-9]{16}$/);
  assert.match(roomCode, /^Z[A-F0-9]{9}$/);
  const publicConfig = await diagnosticStage('browser-config', 'configuration', () => validateBrowserPublicConfig(parseEnv(readFileSync(path.resolve('.env.staging.local'), 'utf8'))));
  const bundle = await diagnosticStage('browser-bundle', 'bundle-build', () => buildBrowserTransportBundle());
  const browser = await diagnosticStage('browser-launch', 'launch', async () => {
    const { chromium } = await import('@playwright/test');
    return chromium.launch({ headless: true });
  });
  try {
    const clients = await preflightBrowserContexts(browser, bundle, { config, ...publicConfig, runId, roomCode });
    const execute = async (who, operation, input = {}) => {
      assert.ok([...clients.values()].includes(who), 'Unowned browser context.');
      const result = await who.page.evaluate(payload => globalThis.__kreatumSecurityQA.execute(payload), { operation, input });
      if (!result?.ok) {
        const error = new Error('Browser security verification rejected.');
        error.code = result?.code;
        throw error;
      }
      return result.value;
    };
    return {
      client: name => { assert.ok(clients.has(name)); return clients.get(name); },
      login: (who, email, password) => execute(who, 'login', { email, password }),
      anonymous: who => execute(who, 'anonymous'),
      logout: who => execute(who, 'logout'),
      invoke: (who, name, data) => execute(who, 'call', { name, data }),
      read: (who, resourcePath) => execute(who, 'read', { path: resourcePath }),
      solution: (who, resourcePath, content) => execute(who, 'solution', { path: resourcePath, content }),
      close: () => browser.close(),
    };
  } catch (error) {
    try { await browser.close(); } catch { /* Keep the original sanitized failure, not a cleanup error. */ }
    throw error;
  }
}
