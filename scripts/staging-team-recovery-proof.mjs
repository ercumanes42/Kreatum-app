import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { pathToFileURL } from 'node:url';
import { BROWSER_TRANSPORT_SOURCE, browserContextOptions, validateBrowserPublicConfig } from './lib/staging-browser-transport.mjs';
import { assertSyntheticPath, assertTakeoverPreconditions, validateStagingSmokeOptions, verifyStagingWebConfig } from './staging-security-smoke.mjs';

export const APP_RESOURCE = 'projects/829452780690/apps/1:829452780690:web:20d259ebf5defe2286124b';
const PROJECT = 'kreatum-dinamic-staging';
const ORIGIN = 'https://kreatum-dinamic-staging.web.app';
const BASE = 'https://firebaseappcheck.googleapis.com/v1/';

export function validateProofOptions(args, env = process.env) {
  assert.deepEqual(args, ['--project', PROJECT, '--execute', '--temporary-debug-approved']);
  validateStagingSmokeOptions(args.slice(0, 3), env);
}

// Only this explicitly approved, staging-only runner accepts its in-memory credential.
// The ordinary staging runner and application source remain unchanged.
export function authorizedBrowserSource(source = BROWSER_TRANSPORT_SOURCE) {
  const original = '|| runtime || globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN)';
  assert.equal(source.split(original).length, 2, 'Normal transport changed; review before use.');
  return source.replace(original, '|| runtime || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN))');
}

export function ownedDebugResources(tokens, label) {
  assert.match(label, /^team-proof-[a-f0-9]{32}$/);
  return tokens.filter(item => item.displayName === label).map(item => {
    assert.ok(item.name.startsWith(APP_RESOURCE + '/debugTokens/'));
    assert.match(item.name.slice((APP_RESOURCE + '/debugTokens/').length), /^[A-Za-z0-9_-]+$/);
    return item.name;
  });
}

export async function withTemporaryCredential(api, label, operation, record) {
  const existing = await api('GET', APP_RESOURCE + '/debugTokens');
  assert.equal(existing.nextPageToken, undefined, 'Unexpected token pagination.');
  assert.deepEqual(ownedDebugResources(existing.debugTokens || [], label), []);
  assert.ok((existing.debugTokens || []).length < 20, 'No debug token capacity.');
  const secret = randomUUID(); // Never printed, written to disk or passed as a shell argument.
  let attempted = false;
  try {
    attempted = true;
    const created = await api('POST', APP_RESOURCE + '/debugTokens', { displayName: label, token: secret });
    const names = ownedDebugResources([created], label);
    assert.equal(names.length, 1);
    record('credential.created', { resource: names[0] });
    return await operation(secret);
  } finally {
    // Also discover an ambiguous create by its collision-resistant label. Never retry creation.
    if (attempted) {
      const current = await api('GET', APP_RESOURCE + '/debugTokens');
      assert.equal(current.nextPageToken, undefined);
      const owned = ownedDebugResources(current.debugTokens || [], label);
      for (const name of owned) {
        await api('DELETE', name);
        await assert.rejects(() => api('GET', name), error => error?.response?.status === 404);
      }
      const after = await api('GET', APP_RESOURCE + '/debugTokens');
      assert.equal(after.nextPageToken, undefined);
      assert.deepEqual(ownedDebugResources(after.debugTokens || [], label), []);
      record('credential.revoked', { removed: owned.length, absentOnReadback: true });
    }
  }
}

export async function runProof(args, env = process.env) {
  validateProofOptions(args, env); // Before credentials, network or writes.
  const req = createRequire(path.resolve('functions/package.json'));
  const { GoogleAuth } = req('google-auth-library');
  const { initializeApp, applicationDefault, deleteApp } = req('firebase-admin/app');
  const { getFirestore, Timestamp } = req('firebase-admin/firestore');
  const started = new Date().toISOString();
  const runId = 'security-stage-' + Date.now().toString(36) + '-' + randomBytes(8).toString('hex');
  const label = 'team-proof-' + randomBytes(16).toString('hex');
  const roomCode = 'Z' + randomBytes(5).toString('hex').slice(0, 9).toUpperCase();
  const directory = path.resolve('output/staging-team-recovery-proof');
  mkdirSync(directory, { recursive: true });
  const evidence = path.join(directory, runId + '.jsonl');
  const record = (type, fields = {}) => appendFileSync(evidence, JSON.stringify({ type, at: new Date().toISOString(), ...fields }) + '\n');
  record('run.started', { runId, project: PROJECT, started, credentialLabel: label, attestation: 'user-approved-temporary-debug', productionChanged: false });
  const client = await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getClient();
  const api = async (method, resource, data) => {
    assert.ok(resource === APP_RESOURCE + '/debugTokens' || resource.startsWith(APP_RESOURCE + '/debugTokens/'));
    return (await client.request({ url: BASE + resource, method, ...(data ? { data } : {}), timeout: 30000, retry: false,
      headers: { 'x-goog-user-project': PROJECT } })).data;
  };
  const admin = initializeApp({ projectId: PROJECT, credential: applicationDefault() }, runId);
  const db = getFirestore(admin);
  const ref = value => db.doc(assertSyntheticPath(runId, value));
  const org = 'organizations/' + runId + '-org-a';
  const workshopId = runId + '-workshop';
  const workshop = 'workshops/' + workshopId;
  let fixtureCreated = false;
  let browser;
  let passed = 0;
  let stage = 'preflight';
  const check = name => { passed++; record('check.passed', { name }); };
  const update = async (resource, data) => db.runTransaction(async tx => {
    const root = resource.split('/').slice(0, 2).join('/');
    assert.equal((await tx.get(ref(root))).data()?.smokeRunId, runId);
    assert.equal((await tx.get(ref(resource))).exists, true);
    tx.update(ref(resource), data);
  });
  const create = async (resource, data) => ref(resource).create({ ...data, smokeRunId: runId });
  try {
    const { data: rawConfig } = await client.request({ url: 'https://firebase.googleapis.com/v1beta1/projects/' + PROJECT + '/webApps/1:829452780690:web:20d259ebf5defe2286124b/config', headers: { 'x-goog-user-project': PROJECT } });
    const config = verifyStagingWebConfig(rawConfig);
    const publicConfig = validateBrowserPublicConfig(parseEnv(readFileSync('.env.staging.local', 'utf8')));
    const bundle = (await req('esbuild').build({ stdin: { contents: authorizedBrowserSource(), resolveDir: process.cwd(), sourcefile: 'authorized-staging-proof.js' }, bundle: true, write: false, platform: 'browser', format: 'iife', logLevel: 'silent' })).outputFiles[0].text;
    stage = 'credential';
    await withTemporaryCredential(api, label, async secret => {
      const { chromium } = await import('@playwright/test');
      browser = await chromium.launch({ headless: true });
      const pages = [];
      stage = 'browser-preflight';
      for (const name of ['old-device', 'new-device', 'peer-device']) {
        const context = await browser.newContext(browserContextOptions());
        await context.addInitScript(value => { globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN = value; }, secret);
        const page = await context.newPage();
        // No console, request, response, trace or storage-state capture: tokens stay private.
        const response = await page.goto(ORIGIN + '/admin', { waitUntil: 'domcontentloaded', timeout: 30000 });
        assert.ok(response.ok());
        assert.equal(new URL(page.url()).origin, ORIGIN);
        await page.evaluate(bundle);
        const result = await page.evaluate(input => globalThis.__kreatumSecurityQA.initialize(input), { config, ...publicConfig, name, runId, roomCode });
        assert.equal(result.ok, true, 'Temporary debug preflight rejected.');
        assert.equal(result.value.attested, true);
        pages.push(page);
      }
      record('preflight.passed', { contexts: 3, appCheck: 'temporary-debug-exception-not-normal-attestation' });
      const execute = async (index, operation, input = {}) => {
        const result = await pages[index].evaluate(payload => globalThis.__kreatumSecurityQA.execute(payload), { operation, input });
        if (!result.ok) { const error = new Error('Browser operation rejected.'); error.code = result.code; throw error; }
        return result.value;
      };
      const call = (index, name, data = {}, key = randomBytes(8).toString('hex')) => execute(index, 'call', { name, data: { workshopId, ...data, idempotencyKey: runId + '-' + key } });
      const deny = async (name, action, code = 'functions/permission-denied') => {
        await assert.rejects(action, error => error?.code === code);
        check(name);
      };
      stage = 'fixtures';
      await create(org, { name: 'Synthetic team recovery proof', status: 'active', schemaVersion: 3,
        commercial: { status: 'active', validFrom: Timestamp.fromMillis(1), validUntil: null } });
      await create(workshop, { organizationId: org.split('/')[1], facilitatorUid: runId + '-synthetic-owner', roomCode,
        status: 'active', currentPhase: 'Sublimar', unlockedPhases: ['Sublimar'], schemaVersion: 3, client: 'Synthetic team recovery proof', createdAt: Timestamp.now() });
      fixtureCreated = true;
      await db.doc('activeRoomCodes/' + roomCode).create({ workshopId, organizationId: org.split('/')[1], smokeRunId: runId });
      record('fixture.created', { workshopId, organizationId: org.split('/')[1] });
      const uids = [];
      for (let index = 0; index < 3; index++) uids.push((await execute(index, 'anonymous')).uid);
      record('players.created', { count: 3 });
      stage = 'legitimate-baseline';
      for (const [index, team] of [[0, 'Agua'], [2, 'Fuego']]) {
        await call(index, 'joinWorkshopByCode', { roomCode });
        await call(index, 'selectTeam', { team });
      }
      const original = await call(0, 'submitWorkshopAttack', { toTeam: 'Fuego', content: 'Synthetic original' }, 'original-attack');
      const incoming = await call(2, 'submitWorkshopAttack', { toTeam: 'Agua', content: 'Synthetic incoming' });
      check('legitimate-original-and-peer-attacks');
      stage = 'takeover';
      const session = workshop + '/participantSessions/' + uids[0];
      const slot = (await ref(session).get()).data().deviceSlot;
      assert.ok(Number.isInteger(slot) && slot >= 0 && slot < 4);
      await update(session, { expiresAt: Timestamp.fromMillis(1) });
      await update(workshop + '/participantDeviceSlots/' + slot, { expiresAt: Timestamp.fromMillis(1) });
      await update(workshop + '/teams/Agua', { activeDeviceExpiresAt: Timestamp.fromMillis(1) });
      await call(1, 'joinWorkshopByCode', { roomCode });
      await call(1, 'selectTeam', { team: 'Agua' });
      assert.equal((await ref(workshop + '/teams/Agua').get()).data().activeParticipantId, uids[1]);
      check('expired-owner-replaced-by-new-player');
      const future = Timestamp.fromMillis(Date.now() + 5 * 60000);
      await create(workshop + '/participantDeviceSlots/3', { participantId: uids[0], expiresAt: future });
      await update(session, { status: 'active', team: 'Agua', deviceSlot: 3, expiresAt: future });
      const assertLive = async phase => {
        const snaps = await db.getAll(ref(workshop), ref(session), ref(workshop + '/participantDeviceSlots/3'), ref(workshop + '/teams/Agua'));
        assertTakeoverPreconditions({ workshop: snaps[0].data(), session: snaps[1].data(), slot: snaps[2].data(), team: snaps[3].data(), phase, oldUid: uids[0], newUid: uids[1] });
      };
      stage = 'stale-owner-denials';
      await assertLive('Sublimar');
      for (const [name, data, code] of [
        ['submitWorkshopAttack', { toTeam: 'Fuego', content: 'Forbidden' }, 'functions/permission-denied'],
        ['updateWorkshopAttack', { attackId: original.attackId, content: 'Forbidden' }, 'functions/permission-denied'],
        ['deleteWorkshopAttack', { attackId: original.attackId }, 'functions/permission-denied'],
        ['saveWorkshopDefense', { attackId: incoming.attackId, content: 'Forbidden' }, 'functions/permission-denied'],
        ['reconnectParticipantSession', { team: 'Agua' }, 'functions/already-exists'],
      ]) { await assertLive('Sublimar'); await deny('stale-' + name, () => call(0, name, data), code); }
      await deny('stale-idempotent-replay', () => call(0, 'submitWorkshopAttack', { toTeam: 'Fuego', content: 'Synthetic original' }, 'original-attack'));
      for (const suffix of ['/teams/Agua', '/attacks/' + original.attackId]) await deny('stale-private-read-' + suffix.split('/')[1], () => execute(0, 'read', { path: workshop + suffix }), 'permission-denied');
      await assertLive('Sublimar');
      assert.equal((await execute(1, 'read', { path: workshop + '/teams/Agua' })).exists, true);
      await call(1, 'saveWorkshopDefense', { attackId: incoming.attackId, content: 'Synthetic legitimate defense' });
      assert.equal((await ref(workshop + '/attacks/' + original.attackId).get()).data().content, 'Synthetic original');
      check('current-owner-private-read-and-defense-with-original-preserved');
      stage = 'solution-rules';
      await update(workshop, { currentPhase: 'Conjugar', unlockedPhases: ['Conjugar', 'Sublimar'] });
      await assertLive('Conjugar');
      await deny('stale-solution-write', () => execute(0, 'solution', { path: workshop + '/solutions/Agua', content: 'Forbidden' }), 'permission-denied');
      await assertLive('Conjugar');
      await execute(1, 'solution', { path: workshop + '/solutions/Agua', content: 'Synthetic legitimate solution' });
      assert.equal((await ref(workshop + '/solutions/Agua').get()).data().content, 'Synthetic legitimate solution');
      check('current-owner-solution-saved');
      stage = 'legitimate-rejoin';
      await update(workshop, { currentPhase: 'Sublimar' });
      assert.equal((await call(0, 'joinWorkshopByCode', { roomCode })).team, null);
      check('rejoin-returns-team-null');
      await deny('rejoin-cannot-take-occupied-team', () => call(0, 'selectTeam', { team: 'Agua' }), 'functions/already-exists');
      await call(0, 'selectTeam', { team: 'Aire' });
      await call(0, 'submitWorkshopAttack', { toTeam: 'Fuego', content: 'Synthetic reassigned attack' });
      check('rejoined-player-can-use-free-team');
      await call(1, 'reconnectParticipantSession', { team: 'Agua' });
      check('legitimate-current-owner-reconnection');
    }, record);
    stage = 'completed';
  } catch (error) {
    record('run.failed', { stage, passedChecks: passed, code: typeof error.code === 'string' && /^[a-z/-]+$/i.test(error.code) ? error.code : 'verification-failed', httpStatus: error.response?.status || null });
    throw new Error('Staging proof incomplete; see sanitized evidence.', { cause: error });
  } finally {
    try {
      await browser?.close();
      if (fixtureCreated) {
        await db.runTransaction(async tx => {
          const roomRef = db.doc('activeRoomCodes/' + roomCode);
          const w = await tx.get(ref(workshop));
          const room = await tx.get(roomRef);
          assert.equal(w.data()?.smokeRunId, runId);
          if (room.exists) { assert.equal(room.data()?.smokeRunId, runId); assert.equal(room.data()?.workshopId, workshopId); }
          tx.update(ref(workshop), { status: 'completed', completedAt: Timestamp.now() });
          if (room.exists) tx.delete(roomRef);
        });
        record('fixture.closed', { workshopId, retainedForEvidence: true });
      }
    } finally { await deleteApp(admin); }
    record('run.finished', { status: stage === 'completed' ? 'passed' : 'incomplete', passedChecks: passed, evidence });
  }
  console.log(JSON.stringify({ status: 'passed', passedChecks: passed, evidence }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runProof(process.argv.slice(2)).catch(() => { console.error('Staging proof stopped; inspect sanitized evidence.'); process.exitCode = 1; });
}
