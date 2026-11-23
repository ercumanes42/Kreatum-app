import assert from 'node:assert/strict';
import test from 'node:test';
import { isPlayerRoute, PLAYER_FIREBASE_APP_NAME } from './firebaseRuntime.js';

test('uses an isolated named Firebase app only for the public player route', () => {
  assert.equal(PLAYER_FIREBASE_APP_NAME, 'kreatum-player');
  assert.equal(isPlayerRoute('/'), true);
  assert.equal(isPlayerRoute('///'), true);

  for (const pathname of ['/admin', '/alquimista', '/activar', '/platform', '/unknown']) {
    assert.equal(isPlayerRoute(pathname), false, pathname);
  }
});
