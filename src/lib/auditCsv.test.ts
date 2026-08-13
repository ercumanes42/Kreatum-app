import { strict as assert } from 'node:assert';
import test from 'node:test';
import type { AuditEventSummary } from '../../shared/contracts';
import { buildAuditCsvRows } from './auditCsv';
import { serializeCsv } from './gameCsv';

const event: AuditEventSummary = {
  id: 'audit-1',
  action: 'workshop.created',
  actorEmail: '=formula',
  actorName: '+Administrador',
  targetType: 'workshop',
  targetId: '@room-id',
  previousState: null,
  newState: { status: '-active' },
  reason: '=reason',
  createdAt: 1_700_000_000_000,
};

test('buildAuditCsvRows includes administrative fields', () => {
  const rows = buildAuditCsvRows([event]);
  assert.equal(rows.length, 2);
  assert.equal(rows[1][3], 'Partida creada y activada');
  assert.equal(rows[1][4], 'Partida');
});

test('audit CSV neutralizes spreadsheet formulas', () => {
  const csv = serializeCsv(buildAuditCsvRows([event]));
  assert.match(csv, /'=formula/);
  assert.match(csv, /'\+Administrador/);
  assert.match(csv, /'@room-id/);
  assert.match(csv, /'=reason/);
  assert.match(csv, /status: -active/);
});
