import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PHASES,
  TEAMS,
  isPhaseChangeAllowed,
  isRoomCodeValid,
  normalizeRoomCode,
} from './contracts';

test('preserves the immutable game contract', () => {
  assert.deepEqual(TEAMS, ['Fuego', 'Agua', 'Aire', 'Tierra']);
  assert.deepEqual(PHASES, [
    'Selección',
    'Calcinar',
    'Diluir',
    'Conjugar',
    'Sublimar',
    'Fermentar',
    'Proyectar',
  ]);
});

test('normalizes and validates room codes without changing the access flow', () => {
  assert.equal(normalizeRoomCode('  abc123 '), 'ABC123');
  assert.equal(isRoomCodeValid('ABC123'), true);
  assert.equal(isRoomCodeValid('ABC-123'), false);
  assert.equal(isRoomCodeValid('A1'), false);
});

test('allows only the next phase or an already unlocked phase', () => {
  const unlockedThroughDiluir = PHASES.slice(0, 3);
  assert.equal(isPhaseChangeAllowed(PHASES[2], PHASES[2], unlockedThroughDiluir), true);
  assert.equal(isPhaseChangeAllowed(PHASES[2], PHASES[4], unlockedThroughDiluir), false);
  assert.equal(isPhaseChangeAllowed('Diluir', 'Conjugar', ['Selección', 'Calcinar', 'Diluir']), true);
  assert.equal(isPhaseChangeAllowed('Diluir', 'Selección', ['Selección', 'Calcinar', 'Diluir']), true);
  assert.equal(isPhaseChangeAllowed('Diluir', 'Proyectar', ['Selección', 'Calcinar', 'Diluir']), false);
});