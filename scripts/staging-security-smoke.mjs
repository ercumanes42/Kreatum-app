#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { assertBrowserEnvironment, createStagingBrowserTransport, diagnosticStage, safeStagingDiagnostic, stagingDiagnosticError } from './lib/staging-browser-transport.mjs';

export const STAGING_PROJECT = 'kreatum-dinamic-staging';
export const STAGING_APP_ID = '1:829452780690:web:20d259ebf5defe2286124b';
const RUN_PATTERN = /^security-stage-[a-z0-9]+-[a-f0-9]{16}$/;

export function validateStagingSmokeOptions(args, env = process.env) {
  let project;
  let execute = false;
  let preflightOnly = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--project' && project === undefined) project = args[++index];
    else if (args[index] === '--execute' && !execute) execute = true;
    else if (args[index] === '--preflight-only' && !preflightOnly) preflightOnly = true;
    else throw new Error('Unknown or duplicate staging smoke argument.');
  }
  if (project !== STAGING_PROJECT || execute === preflightOnly) throw new Error('Explicit staging project and exactly one execution mode are required.');
  assertBrowserEnvironment(env);
  for (const key of Object.keys(env)) {
    if (/EMULATOR/i.test(key) && env[key]) throw new Error('Emulator environment is forbidden.');
  }
  for (const key of ['GOOGLE_CLOUD_PROJECT', 'GCLOUD_PROJECT', 'GOOGLE_CLOUD_QUOTA_PROJECT']) {
    if (env[key] && env[key] !== STAGING_PROJECT) throw new Error('Conflicting cloud project.');
  }
  if (env.FIREBASE_CONFIG) {
    let config;
    try { config = JSON.parse(env.FIREBASE_CONFIG); } catch { throw new Error('FIREBASE_CONFIG must be explicit staging JSON.'); }
    if (config.projectId !== STAGING_PROJECT) throw new Error('Conflicting Firebase project.');
  }
  return { projectId: project, execute, ...(preflightOnly ? { preflightOnly: true } : {}) };
}

export function assertSyntheticPath(runId, resourcePath) {
  if (!RUN_PATTERN.test(runId)) throw new Error('Invalid synthetic run ID.');
  const parts = resourcePath.split('/');
  if (parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) throw new Error('Unsafe synthetic path.');
  const roots = ['organizations', 'workshops', 'users'];
  if (!roots.includes(parts[0]) || !parts[1]?.startsWith(runId + '-')) throw new Error('Resource is not owned by this run.');
  return resourcePath;
}

export function verifyStagingWebConfig(config) {
  if (config?.projectId !== STAGING_PROJECT || config?.appId !== STAGING_APP_ID
    || typeof config.apiKey !== 'string' || !config.apiKey) throw new Error('Unexpected staging web configuration.');
  return { projectId: STAGING_PROJECT, appId: STAGING_APP_ID, apiKey: config.apiKey };
}

export function sanitizedFailureCode(error) {
  return typeof error?.code === 'string' && /^(functions\/|auth\/)?[a-z-]{3,60}$/.test(error.code)
    ? error.code : 'verification-failed';
}

export function stagingFailureDetails(error, { stage, fixturesMayExist = false, preflightOnly = false }) {
  return { code: sanitizedFailureCode(error), ...safeStagingDiagnostic(error, stage), retainedFixtures: !preflightOnly && fixturesMayExist };
}

export function assertTakeoverPreconditions({ workshop, session, slot, team, phase, oldUid, newUid }, now = Date.now()) {
  assert.equal(workshop?.status, 'active');
  assert.equal(workshop?.currentPhase, phase);
  assert.equal(session?.status, 'active');
  assert.equal(session?.team, 'Agua');
  assert.equal(session?.deviceSlot, 3);
  assert.equal(slot?.participantId, oldUid);
  assert.equal(team?.activeParticipantId, newUid);
  for (const expiry of [session?.expiresAt, slot?.expiresAt, team?.activeDeviceExpiresAt]) {
    assert.equal(typeof expiry?.toMillis, 'function');
    assert.ok(expiry.toMillis() > now, 'Fixture lease expired: a denial would be inconclusive.');
  }
}

export async function runStagingSecuritySmoke(args, env = process.env) {
  const options = validateStagingSmokeOptions(args, env); // Before SDK imports, credentials or network.
  const runId = 'security-stage-' + Date.now().toString(36) + '-' + randomBytes(8).toString('hex');
  const roomCode = 'Z' + randomBytes(5).toString('hex').slice(0, 9).toUpperCase();
  const outputDirectory = path.resolve('output', 'staging-security-smoke');
  mkdirSync(outputDirectory, { recursive: true });
  const manifestPath = path.join(outputDirectory, runId + '.jsonl');
  writeFileSync(manifestPath, JSON.stringify({ type: 'run.started', runId, projectId: STAGING_PROJECT, at: new Date().toISOString() }) + '\n', { flag: 'wx' });
  const record = (type, fields = {}) => appendFileSync(manifestPath, JSON.stringify({ type, at: new Date().toISOString(), ...fields }) + '\n');
  const requireFunctions = createRequire(path.resolve('functions', 'package.json'));
  const { initializeApp: initializeAdminApp, applicationDefault, deleteApp: deleteAdminApp } = requireFunctions('firebase-admin/app');
  const { getAuth: getAdminAuth } = requireFunctions('firebase-admin/auth');
  const { getFirestore: getAdminFirestore, Timestamp } = requireFunctions('firebase-admin/firestore');
  const credential = applicationDefault();
  const adminApp = initializeAdminApp({ projectId: STAGING_PROJECT, credential }, runId);
  const database = getAdminFirestore(adminApp);
  const adminAuth = getAdminAuth(adminApp);
  let browserTransport;
  let stage = 'credentials';
  let fixturesMayExist = false;
  let passedChecks = 0;
  const check = (name) => { passedChecks++; record('check.passed', { name }); };
  const adminRef = (resourcePath) => database.doc(assertSyntheticPath(runId, resourcePath));
  const create = async (resourcePath, data) => {
    await adminRef(resourcePath).create({ ...data, smokeRunId: runId });
    record('fixture.created', { path: resourcePath });
  };
  const update = async (resourcePath, data) => {
    const reference = adminRef(resourcePath);
    await database.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      // Callable-created descendants are confined to the owned workshop.
      const root = resourcePath.split('/').slice(0, 2).join('/');
      const rootSnapshot = await transaction.get(adminRef(root));
      assert.equal(rootSnapshot.data()?.smokeRunId, runId, 'Synthetic ownership missing.');
      assert.equal(snapshot.exists, true, 'Synthetic document missing.');
      transaction.update(reference, data);
    });
  };
  const denied = async (action, code) => {
    await assert.rejects(action, (error) => error?.code === code);
  };
  try {
    // Read public web config using the existing ADC identity. No Secret Manager or IAM writes.
    const token = await diagnosticStage('credentials', 'credential-access', () => credential.getAccessToken());
    stage = 'web-config-http';
    const response = await diagnosticStage(stage, 'config-http-status', () => globalThis.fetch('https://firebase.googleapis.com/v1beta1/projects/' + STAGING_PROJECT + '/webApps/' + STAGING_APP_ID + '/config', {
      headers: { Authorization: 'Bearer ' + token.access_token, 'x-goog-user-project': STAGING_PROJECT },
      signal: AbortSignal.timeout(30_000),
    }));
    if (!response.ok) throw stagingDiagnosticError(stage, 'config-http-status', { httpStatus: response.status });
    stage = 'web-config-validate';
    const config = await diagnosticStage(stage, 'configuration', async () => verifyStagingWebConfig(await response.json()));
    stage = 'browser-config';
    browserTransport = await createStagingBrowserTransport({ config, runId, roomCode, env });
    record('preflight.passed', { transport: 'browser', contexts: 5, appCheck: 'normal-enterprise' });
    if (options.preflightOnly) {
      const result = { status: 'preflight-passed', runId, contexts: 5, fixturesCreated: false, manifestPath };
      record('run.preflight-only.passed', result);
      console.log(JSON.stringify(result));
      return result;
    }
    const client = (name) => browserTransport.client(name);
    const invoke = (who, name, data) => browserTransport.invoke(who, name, {
      ...data, idempotencyKey: data.idempotencyKey || runId + '-' + randomBytes(6).toString('hex'),
    });
    const orgA = runId + '-org-a';
    const orgB = runId + '-org-b';
    const ownerUid = runId + '-owner';
    const sharedUid = runId + '-shared';
    const accounts = [];
    stage = 'fixtures';
    for (const [name, uid] of [['owner', ownerUid], ['shared', sharedUid]]) {
      const password = randomBytes(32).toString('base64url') + 'aA1!';
      const email = uid + '@example.invalid';
      fixturesMayExist = true; // A write timeout is ambiguous: retain evidence even without a successful response.
      await adminAuth.createUser({ uid, email, password, emailVerified: true, displayName: 'Synthetic security fixture' });
      record('auth.fixture.created', { uid }); // Synthetic IDs only; never email/password/token.
      const who = client(name);
      assert.equal((await browserTransport.login(who, email, password)).uid, uid);
      accounts.push({ who, email, password });
    }
    const owner = accounts[0].who;
    const shared = accounts[1].who;
    for (const id of [orgA, orgB]) {
      await create('organizations/' + id, {
        name: 'Synthetic staging security', status: 'active', schemaVersion: 3,
        allowedEmailDomains: ['example.invalid'], minimumActiveOwners: 1,
        commercial: { status: 'active', validFrom: Timestamp.fromMillis(1), validUntil: null },
      });
    }
    for (const [org, uid] of [[orgA, ownerUid], [orgA, sharedUid], [orgB, sharedUid]]) {
      await create('organizations/' + org + '/members/' + uid, { role: 'owner', status: 'active', schemaVersion: 3, firstName: 'Synthetic', lastName: 'Fixture' });
      await create('users/' + uid + '/organizationMemberships/' + org, { organizationId: org, role: 'owner', status: 'active' });
    }
    stage = 'security-checks';
    await invoke(shared, 'listTeamAccess', { organizationId: orgA });
    await invoke(shared, 'listTeamAccess', { organizationId: orgB });
    await denied(() => browserTransport.read(owner, 'organizations/' + orgB), 'permission-denied');
    check('cross-tenant-denial-and-legitimate-baseline');
    await invoke(owner, 'changeMemberStatus', { organizationId: orgA, memberId: sharedUid, status: 'disabled', reason: 'Synthetic security verification' });
    assert.equal((await adminAuth.getUser(sharedUid)).disabled, false);
    await denied(() => invoke(shared, 'listTeamAccess', { organizationId: orgA }), 'functions/permission-denied');
    await invoke(shared, 'listTeamAccess', { organizationId: orgB });
    await browserTransport.logout(shared);
    await browserTransport.login(shared, accounts[1].email, accounts[1].password);
    await invoke(shared, 'listTeamAccess', { organizationId: orgB });
    check('K01-disable-is-tenant-scoped-and-global-login-survives');
    await invoke(owner, 'changeMemberStatus', { organizationId: orgA, memberId: sharedUid, status: 'active', reason: 'Synthetic security reactivation' });
    await invoke(shared, 'listTeamAccess', { organizationId: orgA });
    assert.equal((await adminAuth.getUser(sharedUid)).disabled, false);
    check('K01-tenant-reactivation');

    const workshopId = runId + '-workshop';
    const workshopPath = 'workshops/' + workshopId;
    await create(workshopPath, {
      organizationId: orgA, facilitatorUid: ownerUid, roomCode, status: 'active',
      currentPhase: 'Sublimar', unlockedPhases: ['Sublimar'], schemaVersion: 3,
      client: 'Synthetic security fixture', createdAt: Timestamp.now(),
    });
    // create() rather than set(): a random room collision must fail, never overwrite.
    await database.doc('activeRoomCodes/' + roomCode).create({ workshopId, organizationId: orgA, smokeRunId: runId });
    record('fixture.room.created', { roomCode, workshopId });
    const players = [client('old-device'), client('new-device'), client('peer-device')];
    for (const who of players) {
      who.uid = (await browserTransport.anonymous(who)).uid;
      record('auth.anonymous.created', { uid: who.uid });
    }
    const play = (index, name, data = {}) => invoke(players[index], name, { workshopId, ...data });
    for (const [index, team] of [[0, 'Agua'], [2, 'Fuego']]) {
      await play(index, 'joinWorkshopByCode', { roomCode });
      await play(index, 'selectTeam', { team });
    }
    const original = await play(0, 'submitWorkshopAttack', { toTeam: 'Fuego', content: 'Synthetic original' });
    const incoming = await play(2, 'submitWorkshopAttack', { toTeam: 'Agua', content: 'Synthetic incoming' });
    const oldUid = players[0].uid;
    const newUid = players[1].uid;
    const sessionPath = workshopPath + '/participantSessions/' + oldUid;
    const oldSession = (await adminRef(sessionPath).get()).data();
    assert.ok(Number.isInteger(oldSession.deviceSlot) && oldSession.deviceSlot >= 0 && oldSession.deviceSlot < 4);
    await update(sessionPath, { expiresAt: Timestamp.fromMillis(1) });
    await update(workshopPath + '/participantDeviceSlots/' + oldSession.deviceSlot, { expiresAt: Timestamp.fromMillis(1) });
    await update(workshopPath + '/teams/Agua', { activeDeviceExpiresAt: Timestamp.fromMillis(1) });
    await play(1, 'joinWorkshopByCode', { roomCode });
    await play(1, 'selectTeam', { team: 'Agua' });
    assert.equal((await adminRef(workshopPath + '/teams/Agua').get()).data().activeParticipantId, newUid);

    // Isolate stale-team authorization from expiry: A owns a new valid slot but not Agua.
    const future = Timestamp.fromMillis(Date.now() + 5 * 60_000);
    await create(workshopPath + '/participantDeviceSlots/3', { participantId: oldUid, expiresAt: future });
    await update(sessionPath, { status: 'active', team: 'Agua', deviceSlot: 3, expiresAt: future });
    const assertLiveTakeover = async (phase) => {
      const snapshots = await database.getAll(
        adminRef(workshopPath), adminRef(sessionPath),
        adminRef(workshopPath + '/participantDeviceSlots/3'), adminRef(workshopPath + '/teams/Agua'),
      );
      assertTakeoverPreconditions({
        workshop: snapshots[0].data(), session: snapshots[1].data(),
        slot: snapshots[2].data(), team: snapshots[3].data(), phase, oldUid, newUid,
      });
    };
    await assertLiveTakeover('Sublimar');
    const unauthorized = [
      ['submitWorkshopAttack', { toTeam: 'Fuego', content: 'Forbidden' }, 'functions/permission-denied'],
      ['updateWorkshopAttack', { attackId: original.attackId, content: 'Forbidden' }, 'functions/permission-denied'],
      ['deleteWorkshopAttack', { attackId: original.attackId }, 'functions/permission-denied'],
      ['saveWorkshopDefense', { attackId: incoming.attackId, content: 'Forbidden' }, 'functions/permission-denied'],
      ['reconnectParticipantSession', { team: 'Agua' }, 'functions/already-exists'],
    ];
    for (const [name, data, code] of unauthorized) await denied(() => play(0, name, data), code);
    await denied(() => browserTransport.read(players[0], workshopPath + '/teams/Agua'), 'permission-denied');
    await denied(() => browserTransport.read(players[0], workshopPath + '/attacks/' + original.attackId), 'permission-denied');
    await assertLiveTakeover('Sublimar');
    assert.equal((await browserTransport.read(players[1], workshopPath + '/teams/Agua')).exists, true);
    await play(1, 'saveWorkshopDefense', { attackId: incoming.attackId, content: 'Synthetic legitimate defense' });
    assert.equal((await adminRef(workshopPath + '/attacks/' + original.attackId).get()).data().content, 'Synthetic original');
    check('K02-stale-team-denied-commands-rules-and-legitimate-owner-allowed');

    await update(workshopPath, { currentPhase: 'Conjugar', unlockedPhases: ['Conjugar', 'Sublimar'] });
    const solution = (who, content) => browserTransport.solution(who, workshopPath + '/solutions/Agua', content);
    await assertLiveTakeover('Conjugar');
    await denied(() => solution(players[0], 'Forbidden'), 'permission-denied');
    await assertLiveTakeover('Conjugar');
    await solution(players[1], 'Synthetic legitimate solution');
    assert.equal((await adminRef(workshopPath + '/solutions/Agua').get()).data().content, 'Synthetic legitimate solution');
    check('K02-solution-rules-deny-stale-device-allow-current-owner');
    await update(workshopPath, { currentPhase: 'Sublimar' });
    assert.equal((await play(0, 'joinWorkshopByCode', { roomCode })).team, null);
    await play(0, 'selectTeam', { team: 'Aire' });
    await play(0, 'submitWorkshopAttack', { toTeam: 'Fuego', content: 'Synthetic legitimate reassignment' });
    check('K02-rejoin-drops-stale-team-and-new-assignment-works');

    // Preserve fixture evidence but do not leave a synthetic workshop active.
    await update(workshopPath, { status: 'completed', completedAt: Timestamp.now() });
    record('fixture.completed', { workshopId, method: 'admin-fixture-finalization-not-functional-close-test' });
    record('run.passed', { passedChecks, retainedFixtures: true });
    console.log(JSON.stringify({ status: 'passed', runId, passedChecks, manifestPath, retainedFixtures: true }));
    return { runId, passedChecks, manifestPath };
  } catch (error) {
    const details = stagingFailureDetails(error, { stage, fixturesMayExist, preflightOnly: options.preflightOnly });
    record('run.failed', { ...details, passedChecks });
    console.error(JSON.stringify({ status: 'failed', runId, ...details, passedChecks, manifestPath }));
    throw new Error('Staging security smoke failed; inspect sanitized manifest for stage and fixture status.', { cause: error });
  } finally {
    await browserTransport?.close();
    await deleteAdminApp(adminApp);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runStagingSecuritySmoke(process.argv.slice(2)).catch(() => {
    console.error('Staging security smoke stopped; no successful validation is claimed.');
    process.exitCode = 1;
  });
}
