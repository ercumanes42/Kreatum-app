import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  buildGameCsvRows,
  serializeCsv,
  type GameCsvRecord,
} from './gameCsv';

const game: GameCsvRecord = {
  id: 'workshop-1',
  roomCode: 'TEST42',
  status: 'completed',
  createdAt: 1_700_000_000_000,
  client: '=HYPERLINK("https://attacker.invalid")',
  facilitator: 'Facilitador',
  globalState: {
    challenge: '+CMD',
    createdBy: 'owner-secret-id',
    organizationId: 'org-internal',
  },
  teams: {
    Agua: {
      team: 'Agua',
      playerId: 'participant-secret-id',
      memberIds: ['participant-secret-id'],
      reassignments: { 'participant-secret-id': 'Fuego' },
      selectedSolution: '@SUM(1+1)',
    },
  },
  attacks: [],
  defenses: [],
  solutions: [],
};

test('CSV output does not expose participant or owner identifiers', () => {
  const csv = serializeCsv(buildGameCsvRows(game));
  assert.equal(csv.includes('participant-secret-id'), false);
  assert.equal(csv.includes('owner-secret-id'), false);
  assert.equal(csv.includes('org-internal'), false);
});

test('CSV output neutralizes spreadsheet formulas', () => {
  const csv = serializeCsv(buildGameCsvRows(game));
  assert.match(csv, /"'=HYPERLINK/);
  assert.match(csv, /"'\+CMD"/);
  assert.match(csv, /"'@SUM\(1\+1\)"/);
});
