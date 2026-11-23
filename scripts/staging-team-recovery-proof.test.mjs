import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { BROWSER_TRANSPORT_SOURCE } from './lib/staging-browser-transport.mjs';
import { APP_RESOURCE, authorizedBrowserSource, ownedDebugResources, validateProofOptions, withTemporaryCredential } from './staging-team-recovery-proof.mjs';

const label = 'team-proof-' + 'a'.repeat(32);
const name = APP_RESOURCE + '/debugTokens/synthetic-id';
const args = ['--project', 'kreatum-dinamic-staging', '--execute', '--temporary-debug-approved'];

test('requires exact staging and a separate explicit debug approval', () => {
  assert.doesNotThrow(() => validateProofOptions(args, {}));
  for (const bad of [[], args.slice(0, 3), [...args, '--extra'], args.map(a => a === 'kreatum-dinamic-staging' ? 'kreatum-dinamic' : a)]) assert.throws(() => validateProofOptions(bad, {}));
  for (const env of [{ FIREBASE_APPCHECK_DEBUG_TOKEN: 'external' }, { FIRESTORE_EMULATOR_HOST: 'localhost:8080' }, { GCLOUD_PROJECT: 'kreatum-dinamic' }]) assert.throws(() => validateProofOptions(args, env));
});

test('normal transport stays fail-closed and authorized bundle compiles separately', async () => {
  const originalGuard = '|| runtime || globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN)';
  assert.ok(BROWSER_TRANSPORT_SOURCE.includes(originalGuard));
  const source = authorizedBrowserSource();
  assert.ok(!source.includes(originalGuard));
  assert.ok(source.includes("location.origin !== 'https://kreatum-dinamic-staging.web.app'"));
  assert.throws(() => authorizedBrowserSource('changed upstream'));
  const req = createRequire(path.resolve('functions/package.json'));
  const result = await req('esbuild').build({ stdin: { contents: source, resolveDir: process.cwd() }, bundle: true, write: false, platform: 'browser', logLevel: 'silent' });
  assert.ok(result.outputFiles[0].text.length > 0);
});

test('cleanup selects only its exact label and staging app', () => {
  assert.deepEqual(ownedDebugResources([{ displayName: label, name }, { displayName: 'unrelated', name: 'unrelated' }], label), [name]);
  assert.throws(() => ownedDebugResources([{ displayName: label, name: name.replace('829452780690', '997151085311') }], label));
  assert.throws(() => ownedDebugResources([], 'broad-label'));
});

function fakeApi({ ambiguousCreate = false, deleteFails = false } = {}) {
  const state = { items: [], calls: [], secret: undefined };
  const api = async (method, resource, data) => {
    state.calls.push([method, resource]);
    if (method === 'GET' && resource.endsWith('/debugTokens')) return { debugTokens: [...state.items] };
    if (method === 'POST') {
      state.secret = data.token;
      const item = { displayName: data.displayName, name };
      state.items.push(item);
      if (ambiguousCreate) throw new Error('Simulated ambiguous timeout');
      return item;
    }
    if (method === 'DELETE') {
      if (deleteFails) throw new Error('Simulated permission failure');
      state.items = state.items.filter(item => item.name !== resource);
      return {};
    }
    if (method === 'GET') {
      const result = state.items.find(item => item.name === resource);
      if (!result) throw Object.assign(new Error('Absent'), { response: { status: 404 } });
      return result;
    }
    throw new Error('Unexpected request');
  };
  return { api, state };
}

for (const failure of [false, true]) test('revocation and absence checked after operation ' + (failure ? 'failure' : 'success'), async () => {
  const { api, state } = fakeApi();
  const events = [];
  const promise = withTemporaryCredential(api, label, async secret => {
    assert.match(secret, /^[a-f0-9-]{36}$/);
    if (failure) throw new Error('Synthetic operation failed');
    return 'passed';
  }, (type, fields) => events.push({ type, ...fields }));
  if (failure) await assert.rejects(promise); else assert.equal(await promise, 'passed');
  assert.deepEqual(state.items, []);
  assert.equal(events.at(-1).type, 'credential.revoked');
  assert.equal(events.at(-1).absentOnReadback, true);
  assert.ok(!JSON.stringify(events).includes(state.secret));
});

test('ambiguous create is discovered and revoked without retrying creation', async () => {
  const { api, state } = fakeApi({ ambiguousCreate: true });
  await assert.rejects(() => withTemporaryCredential(api, label, async () => assert.fail('Must not execute'), () => {}));
  assert.deepEqual(state.items, []);
  assert.equal(state.calls.filter(([method]) => method === 'POST').length, 1);
});

test('revocation failure cannot be reported as success', async () => {
  const { api } = fakeApi({ deleteFails: true });
  const events = [];
  await assert.rejects(() => withTemporaryCredential(api, label, async () => 'passed', type => events.push(type)));
  assert.ok(!events.includes('credential.revoked'));
});

test('existing token collision fails before creating or deleting', async () => {
  const { api, state } = fakeApi();
  state.items.push({ displayName: label, name });
  await assert.rejects(() => withTemporaryCredential(api, label, async () => {}, () => {}));
  assert.equal(state.calls.length, 1);
});
