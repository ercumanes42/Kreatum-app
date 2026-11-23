import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const PREFIX = 'kreatum-dr-20260912-';
export function validateProjectId(value) {
  assert.match(value, /^kreatum-dr-20260912-[a-f0-9]{8}$/);
  return value;
}
export function buildProjectRequest(projectId) {
  const request = {
    projectId: validateProjectId(projectId),
    displayName: 'KREATUM identity recovery',
    labels: { purpose: 'identity-recovery-test', source: 'kreatum-dinamic', expires: 'd2026-09-13' },
  };
  assert.ok(request.displayName.length >= 4 && request.displayName.length <= 30);
  for (const value of Object.values(request.labels)) assert.match(value, /^[a-z][-a-z0-9]*$/);
  return request;
}
export function assertOwnedProject(project, expected) {
  assert.equal(project.projectId, validateProjectId(expected));
  assert.equal(project.labels?.purpose, 'identity-recovery-test');
  assert.equal(project.labels?.source, 'kreatum-dinamic');
}

export async function run(args) {
  assert.ok(args.length === 1 && ['--create-approved', '--status'].includes(args[0]));
  for (const [name, value] of Object.entries(process.env)) {
    assert.ok(!value || !/EMULATOR|GOOGLE_APPLICATION_CREDENTIALS|CLOUDSDK_AUTH_ACCESS_TOKEN|CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT/.test(name), 'Unexpected credential or emulator override.');
  }
  const req = createRequire(path.resolve('functions/package.json'));
  const { GoogleAuth } = req('google-auth-library');
  const client = await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getClient();
  const dir = path.resolve('output/cloud-identity-recovery');
  mkdirSync(dir, { recursive: true });
  const statePath = path.join(dir, 'project.json');
  const record = event => appendFileSync(path.join(dir, 'events.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n');
  let state;
  try {
    if (args[0] === '--create-approved') {
      state = { projectId: PREFIX + randomBytes(4).toString('hex'), sourceProject: 'kreatum-dinamic', createdAt: new Date().toISOString(), status: 'creation-request-pending' };
      validateProjectId(state.projectId);
      writeFileSync(statePath, JSON.stringify(state, null, 2), { flag: 'wx' });
      // No parent inferred: the existing KREATUM projects have no organization parent.
      const { data } = await client.request({ url: 'https://cloudresourcemanager.googleapis.com/v3/projects', method: 'POST', retry: false, timeout: 30000,
        data: buildProjectRequest(state.projectId) });
      state.operation = data.name;
      state.status = data.done ? 'operation-finished' : 'creating';
      writeFileSync(statePath, JSON.stringify(state, null, 2));
      record({ type: 'project.creation-requested', projectId: state.projectId, operation: state.operation });
    } else {
      state = JSON.parse(readFileSync(statePath, 'utf8'));
      validateProjectId(state.projectId);
      const { data } = await client.request({ url: 'https://cloudresourcemanager.googleapis.com/v3/projects/' + state.projectId });
      assertOwnedProject(data, state.projectId);
      state.projectNumber = data.name.split('/')[1];
      state.status = data.state;
      writeFileSync(statePath, JSON.stringify(state, null, 2));
      record({ type: 'project.status', projectId: state.projectId, projectNumber: state.projectNumber, status: state.status });
    }
    console.log(JSON.stringify(state));
  } catch (error) {
    const info = error.response?.data?.error?.details?.find(item => item['@type']?.endsWith('ErrorInfo'));
    record({ type: 'project.operation-failed', projectId: state?.projectId, httpStatus: error.response?.status || null, reason: info?.reason || null, service: info?.metadata?.service || null });
    throw new Error('Temporary recovery project operation failed; see sanitized evidence.', { cause: error });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  run(process.argv.slice(2)).catch(() => { console.error('Recovery project operation stopped; no completion is claimed.'); process.exitCode = 1; });
}
