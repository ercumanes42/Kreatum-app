import assert from 'node:assert/strict';
import test from 'node:test';
import {
  platformWorkshopSummary,
  sanitizePlatformReportDocument,
} from './platformCore.js';

test('platform report workshop allowlist excludes room and identity secrets', () => {
  const sanitized = sanitizePlatformReportDocument('workshop', 'workshop-safe', {
    client: 'Cliente permitido',
    challenge: 'Reto permitido',
    roomCode: 'ROOM-SECRET',
    invitationCode: 'INVITATION-SECRET',
    organizationId: 'tenant-secret',
    createdBy: 'identity-secret',
    status: 'completed',
  });

  assert.deepEqual(sanitized, {
    id: 'workshop-safe',
    challenge: 'Reto permitido',
    client: 'Cliente permitido',
    status: 'completed',
  });
  const serialized = JSON.stringify(sanitized);
  assert.equal(serialized.includes('ROOM-SECRET'), false);
  assert.equal(serialized.includes('INVITATION-SECRET'), false);
  assert.equal(serialized.includes('tenant-secret'), false);
  assert.equal(serialized.includes('identity-secret'), false);
});

test('platform report allowlist recursively removes unknown nested code fields', () => {
  const sanitized = sanitizePlatformReportDocument('teams', 'Agua', {
    team: 'Agua',
    pitch: 'Respuesta veraz',
    solutionVotes: [2, 1, 0],
    answers: { proyectar: 'campo legacy no permitido' },
    perspectives: [
      'Idea segura',
      {
        content: 'Contenido permitido',
        value: 'Valor permitido',
        roomCode: 'NESTED-ROOM-SECRET',
        token: 'NESTED-TOKEN-SECRET',
      },
    ],
  });

  assert.equal(sanitized.pitch, 'Respuesta veraz');
  assert.deepEqual(sanitized.solutionVotes, [2, 1, 0]);
  assert.equal('answers' in sanitized, false);
  const serialized = JSON.stringify(sanitized);
  assert.match(serialized, /Contenido permitido/);
  assert.match(serialized, /Valor permitido/);
  assert.equal(serialized.includes('NESTED-ROOM-SECRET'), false);
  assert.equal(serialized.includes('NESTED-TOKEN-SECRET'), false);
  assert.equal(serialized.includes('campo legacy no permitido'), false);
});

test('platform workshop summary does not infer canonical facilitator from createdBy', () => {
  const legacy = platformWorkshopSummary('workshop-safe', {
    organizationId: 'organization-safe',
    createdBy: 'legacy-creator',
    status: 'active',
    currentPhase: 'Selecci?n',
  }, 'Empresa segura');
  const canonical = platformWorkshopSummary('workshop-canonical', {
    organizationId: 'organization-safe',
    createdBy: 'legacy-creator',
    facilitatorUid: 'canonical-facilitator',
    status: 'active',
    currentPhase: 'Selecci?n',
  }, 'Empresa segura');

  assert.equal(legacy.facilitatorUid, '');
  assert.equal(canonical.facilitatorUid, 'canonical-facilitator');
});
