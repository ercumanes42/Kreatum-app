import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const SMOKE_TOKEN_SIGNER_SERVICE_ACCOUNT = 'kreatum-smoke-token-signer@kreatum-dinamic.iam.gserviceaccount.com';

export const PRODUCTION_PROJECT = 'kreatum-dinamic';
export const RUN_ID_PATTERN = /^smoke-prod-\d{8}T\d{6}Z-[a-f0-9]{8}$/;

const valueAfter = (values, index, flag) => {
  const value = values[index + 1];
  if (!value || value.startsWith('--')) throw new Error(flag + ' requires a value.');
  return value;
};

export const parseSmokeArguments = (values) => {
  const options = {
    cleanupOnly: false,
    execute: false,
    manifestPath: '',
    projectId: '',
    confirmation: '',
    runId: '',
  };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--execute') options.execute = true;
    else if (value === '--cleanup-only') options.cleanupOnly = true;
    else if (value === '--project') options.projectId = valueAfter(values, index++, value);
    else if (value === '--confirm') options.confirmation = valueAfter(values, index++, value);
    else if (value === '--run-id') options.runId = valueAfter(values, index++, value);
    else if (value === '--manifest') options.manifestPath = valueAfter(values, index++, value);
    else throw new Error('Unknown argument: ' + value);
  }
  return options;
};

export const expectedConfirmation = (runId) =>
  'RUN-' + PRODUCTION_PROJECT + '-' + runId;

export const assertSafeSmokeOptions = (options, cwd = process.cwd()) => {
  if (options.projectId !== PRODUCTION_PROJECT) {
    throw new Error(
      'Refusing project ' + (options.projectId || '<missing>') + '; expected ' + PRODUCTION_PROJECT + '.',
    );
  }
  if (!RUN_ID_PATTERN.test(options.runId)) throw new Error('Invalid production smoke run id.');
  if (options.confirmation !== expectedConfirmation(options.runId)) {
    throw new Error('Production smoke confirmation does not match the exact run id.');
  }
  if (!options.execute) throw new Error('Refusing mutation without --execute.');
  const expectedDirectory = path.resolve(cwd, 'output', 'production-smoke');
  const manifestPath = path.resolve(options.manifestPath || path.join(
    expectedDirectory,
    options.runId + '.jsonl',
  ));
  const relative = path.relative(expectedDirectory, manifestPath);
  if (relative.startsWith('..') || path.isAbsolute(relative) || path.extname(manifestPath) !== '.jsonl') {
    throw new Error('Manifest must be a .jsonl file under output/production-smoke.');
  }
  if (path.basename(manifestPath) !== options.runId + '.jsonl') {
    throw new Error('Manifest filename must exactly match the run id.');
  }
  return { ...options, manifestPath };
};

export const assertOwnedIdentifier = (runId, identifier, kind) => {
  if (!RUN_ID_PATTERN.test(runId)
    || typeof identifier !== 'string'
    || !identifier.startsWith(runId + '-')
    || !/^[A-Za-z0-9_-]{3,128}$/.test(identifier)) {
    throw new Error('Unsafe ' + kind + ' identifier: ' + String(identifier));
  }
  return identifier;
};

export const assertDedicatedSignerServiceAccount = (value) => {
  if (value !== SMOKE_TOKEN_SIGNER_SERVICE_ACCOUNT) {
    throw new Error('Unexpected production smoke token signer service account.');
  }
  return value;
};

export const assertCleanupOrganizationOwnership = (runId, organizationId, data) => {
  assertOwnedIdentifier(runId, organizationId, 'organization');
  if (data === null || data === undefined) return 'absent';
  if (typeof data !== 'object' || data.smokeRunId !== runId) {
    throw new Error('Refusing cleanup without exact organization ownership.');
  }
  return 'owned';
};

export const roomCodeFor = (runId, suffix) => {
  if (!RUN_ID_PATTERN.test(runId) || (suffix !== 'A' && suffix !== 'B')) {
    throw new Error('Cannot derive room code for an unsafe run.');
  }
  return ('S' + runId.slice(-8).toUpperCase()).slice(0, 9) + suffix;
};

export const assertOwnedRoomCode = (runId, roomCode) => {
  if (roomCode !== roomCodeFor(runId, 'A') && roomCode !== roomCodeFor(runId, 'B')) {
    throw new Error('Unsafe room code: ' + String(roomCode));
  }
  return roomCode;
};

export const appendManifestEvent = (manifestPath, event) => {
  mkdirSync(path.dirname(manifestPath), { recursive: true });
  appendFileSync(manifestPath, JSON.stringify({
    at: new Date().toISOString(),
    ...event,
  }) + '\n', { encoding: 'utf8', flag: 'a' });
};

export const readManifest = (manifestPath, expectedRunId) => {
  const lines = readFileSync(manifestPath, 'utf8').split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) throw new Error('Smoke manifest is empty.');
  const events = lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error('Invalid JSONL event at line ' + (index + 1) + '.');
    }
  });
  const headers = events.filter((event) => event.type === 'manifest.created');
  const header = headers[0];
  if (headers.length !== 1
    || events[0] !== header
    || header.projectId !== PRODUCTION_PROJECT
    || header.runId !== expectedRunId) {
    throw new Error('Manifest header does not match the exact production smoke run.');
  }
  return events;
};

export const collectManifestResources = (events, runId) => {
  const resources = {
    organizations: [],
    workshops: [],
    roomCodes: [],
    users: [],
    platformCommands: [],
  };
  for (const event of events) {
    if (event.type !== 'resource.created') continue;
    if (event.kind === 'organization') {
      assertOwnedIdentifier(runId, event.id, event.kind);
      resources.organizations.push(event.id);
    } else if (event.kind === 'workshop') {
      if (typeof event.id !== 'string' || !/^[A-Za-z0-9_-]{3,128}$/.test(event.id)) {
        throw new Error('Unsafe workshop identifier: ' + String(event.id));
      }
      assertOwnedIdentifier(runId, event.organizationId, 'workshop organization');
      resources.workshops.push({ id: event.id, organizationId: event.organizationId });
    } else if (event.kind === 'roomCode') {
      assertOwnedRoomCode(runId, event.id);
      resources.roomCodes.push(event.id);
    } else if (event.kind === 'user') {
      if (typeof event.id !== 'string'
        || !event.id
        || !['facilitator', 'participant'].includes(event.role)) {
        throw new Error('Unsafe user manifest entry.');
      }
      resources.users.push({ id: event.id, role: event.role });
    } else if (event.kind === 'platformCommand') {
      if (typeof event.id !== 'string'
        || !/^[a-f0-9]{24}$/.test(event.id)
        || !['suspendPlatformOrganization', 'reactivatePlatformOrganization'].includes(
          event.operation,
        )) {
        throw new Error('Unsafe platform command manifest entry.');
      }
      resources.platformCommands.push({ id: event.id, operation: event.operation });
    } else {
      throw new Error('Unknown manifest resource kind: ' + String(event.kind));
    }
  }
  return resources;
};
