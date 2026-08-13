import assert from 'node:assert/strict';
import test from 'node:test';
import { getUserFacingError } from './errors';

test('shows the invitation token-signing message without exposing backend details', () => {
  assert.equal(getUserFacingError({
    code: 'functions/failed-precondition',
    details: { reason: 'invitation-token-signing' },
    message: 'sensitive backend detail',
  }), 'La activación está temporalmente indisponible. Contacta con el Administrador.');
});
