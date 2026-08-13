import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  createSnapshotHash,
  sanitizeExportValue,
  stableStringify,
} from './exportIntegrity';

test('removes participant identifiers recursively from exports', () => {
  const result = sanitizeExportValue({
    gameId: 'workshop',
    createdBy: 'owner-uid',
    teams: {
      Agua: {
        playerId: 'participant-uid',
        memberIds: ['participant-uid'],
        reassignments: { 'participant-uid': 'Fuego' },
        selectedSolution: 'Solución',
      },
    },
  });

  assert.deepEqual(result, {
    gameId: 'workshop',
    teams: {
      Agua: {
        selectedSolution: 'Solución',
      },
    },
  });
});

test('creates deterministic hashes regardless of object key order', async () => {
  const left = { b: ['x', 2], a: { z: true, y: null } };
  const right = { a: { y: null, z: true }, b: ['x', 2] };
  assert.equal(stableStringify(left), stableStringify(right));
  assert.equal(await createSnapshotHash(left), await createSnapshotHash(right));
});
