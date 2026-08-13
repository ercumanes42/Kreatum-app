import assert from 'node:assert/strict';
import test from 'node:test';
import {
  historyExportRowMatches,
  serializeHistoryExportCsv,
  type HistoryExportRow,
} from './historyExport';

const row: HistoryExportRow = {
  id: 'workshop-1',
  roomCode: 'ABC123',
  status: 'completed',
  createdAt: 1_700_000_000_000,
  completedAt: null,
  client: '=HYPERLINK("https://attacker.invalid")',
  facilitator: '+CMD',
  currentPhase: '@SUM(1+1)',
};

test('history export neutralizes spreadsheet formulas', () => {
  const csv = serializeHistoryExportCsv([row]);
  assert.match(csv, /"'=HYPERLINK/);
  assert.match(csv, /"'\+CMD"/);
  assert.match(csv, /"'@SUM\(1\+1\)"/);
});

test('history export filters by all searchable summary fields and status', () => {
  assert.equal(historyExportRowMatches(row, 'abc123', 'all'), true);
  assert.equal(historyExportRowMatches(row, 'workshop-1', 'completed'), true);
  assert.equal(historyExportRowMatches(row, 'attacker', 'completed'), true);
  assert.equal(historyExportRowMatches(row, 'cmd', 'completed'), true);
  assert.equal(historyExportRowMatches(row, '', 'active'), false);
});
