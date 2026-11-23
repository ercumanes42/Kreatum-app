import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { transformSync } from 'esbuild';
import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { isTeam, MAX_PARTICIPANT_DEVICES } from '../../../shared/contracts.js';
import { assertOrganizationOperational } from './organizationAccess.js';

// Execute the production guard, not a duplicated authorization implementation.
const source = readFileSync(join(__dirname, '..', 'index.ts'), 'utf8');
const guardSource = source.slice(
  source.indexOf('const requireParticipantSlot ='),
  source.indexOf('export const submitWorkshopAttack'),
);
const identifierSource = source.slice(
  source.indexOf('const validateIdentifier ='),
  source.indexOf('const validateIdempotencyKey ='),
);
type Data = Record<string, unknown>;

const authorize = async (pendingTransitionId?: string | null, transitionAckId?: string) => {
  const future = Timestamp.fromMillis(Date.now() + 60_000);
  const records = new Map<string, Data>([
    ['workshops/workshop-test', {
      organizationId: 'org-test', status: 'active', currentPhase: 'Sublimar',
      ...(pendingTransitionId !== undefined ? { pendingTransitionId } : {}),
    }],
    ['workshops/workshop-test/participantSessions/participant-test', {
      status: 'active', team: 'Agua', deviceSlot: 0, expiresAt: future,
      ...(transitionAckId !== undefined ? { transitionAckId } : {}),
    }],
    ['workshops/workshop-test/participantDeviceSlots/0', {
      participantId: 'participant-test', expiresAt: future,
    }],
    ['workshops/workshop-test/teams/Agua', {
      activeParticipantId: 'participant-test', activeDeviceExpiresAt: future,
    }],
    ['organizations/org-test', {
      status: 'active', schemaVersion: 3,
      commercial: { status: 'active', validFrom: Timestamp.fromMillis(0), validUntil: null },
    }],
  ]);
  type Reference = {
    id: string; path: string; collection: (name: string) => { doc: (id: string) => Reference };
  };
  const ref = (path: string): Reference => ({
    id: path.split('/').at(-1)!, path,
    collection: (name: string) => ({ doc: (id: string) => ref(path + '/' + name + '/' + id) }),
  });
  const transaction = {
    get: async (reference: Reference) => ({
      exists: records.has(reference.path), data: () => records.get(reference.path),
    }),
  };
  const context = vm.createContext({
    Date, Timestamp, HttpsError, isTeam, MAX_PARTICIPANT_DEVICES,
    assertOrganizationOperational, db: { doc: ref },
  });
  const executable = transformSync(
    identifierSource + guardSource + '\nglobalThis.authorize = loadActiveParticipantForCommand;',
    { loader: 'ts', target: 'node22' },
  ).code;
  vm.runInContext(executable, context);
  return context.authorize(
    transaction, ref('workshops/workshop-test'),
    ref('workshops/workshop-test/participantSessions/participant-test'),
  );
};

test('participant can write before acknowledging the pending transition', async () => {
  assert.equal((await authorize('transition-current')).team, 'Agua');
});

test('an acknowledgement for an older transition does not freeze current writes', async () => {
  assert.equal((await authorize('transition-current', 'transition-old')).team, 'Agua');
});

test('cancelling a transition permits writes despite its previous acknowledgement', async () => {
  assert.equal((await authorize(undefined, 'transition-cancelled')).team, 'Agua');
  assert.equal((await authorize(null, 'transition-cancelled')).team, 'Agua');
});

test('current transition acknowledgement freezes participant commands while peers are pending', async () => {
  await assert.rejects(
    authorize('transition-current', 'transition-current'),
    (error: unknown) => error instanceof HttpsError && error.code === 'failed-precondition',
  );
});
