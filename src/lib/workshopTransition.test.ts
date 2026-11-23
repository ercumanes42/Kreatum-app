import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  CancelWorkshopTransitionInput,
  RequestWorkshopTransitionInput,
} from '../../shared/contracts';
import type { WorkshopTransition } from '../hooks/useRealtime';
import {
  getWorkshopTransitionProgress,
  requestWorkshopFinalization,
} from './workshopTransition';

const transition = (overrides: Partial<WorkshopTransition> = {}): WorkshopTransition => ({
  id: 'transition-1',
  state: 'requested',
  targetPhase: 'Proyectar',
  complete: false,
  requiredAcks: 2,
  receivedAcks: 0,
  requestedAt: 1_000,
  expiresAt: 121_000,
  ...overrides,
});

const commandHarness = () => {
  const calls: string[] = [];
  const cancelled: CancelWorkshopTransitionInput[] = [];
  const requested: RequestWorkshopTransitionInput[] = [];
  return {
    calls,
    cancelled,
    requested,
    commands: {
      cancelWorkshopTransition: async (input: CancelWorkshopTransitionInput) => {
        calls.push('cancel');
        cancelled.push(input);
        return {
          workshopId: input.workshopId,
          transitionId: input.transitionId,
          state: 'cancelled' as const,
          updatedAt: 1,
        };
      },
      requestWorkshopTransition: async (input: RequestWorkshopTransitionInput) => {
        calls.push('request');
        requested.push(input);
        return {
          workshopId: input.workshopId,
          transitionId: 'transition-finalize',
          kind: 'complete' as const,
          targetPhase: null,
          state: 'requested' as const,
          requiredAcks: 2,
          receivedAcks: 0,
          expiresAt: 300_000,
        };
      },
    },
  };
};

const keyFactory = (operation: string) => operation + ':test-key';

test('marks a transition as expired without losing its pending acknowledgement count', () => {
  assert.deepEqual(getWorkshopTransitionProgress(transition(), 121_001), {
    required: 2,
    received: 0,
    pending: 2,
    expired: true,
  });
});

test('treats missing legacy deadlines as expired instead of locking the interface forever', () => {
  for (const expiresAt of [0, Number.NaN]) {
    assert.equal(getWorkshopTransitionProgress(transition({ expiresAt }), 120_000).expired, true);
  }
});

test('normalizes legacy acknowledgement arrays and clamps pending teams', () => {
  assert.deepEqual(getWorkshopTransitionProgress(transition({
    requiredAcks: ['Agua', 'Aire'],
    receivedAcks: ['Agua', 'Aire', 'Fuego'],
  }), 120_000), {
    required: 2,
    received: 3,
    pending: 0,
    expired: false,
  });
});

test('starts a secure finalization directly when there is no pending transition', async () => {
  const harness = commandHarness();
  const result = await requestWorkshopFinalization(
    'workshop-1',
    null,
    harness.commands,
    keyFactory,
  );

  assert.equal(result.state, 'requested');
  assert.deepEqual(harness.calls, ['request']);
  assert.equal(harness.requested[0]?.complete, true);
});

test('an owner can cancel a stuck phase transition before requesting finalization', async () => {
  const harness = commandHarness();
  await requestWorkshopFinalization(
    'workshop-1',
    transition({ expiresAt: 2_000 }),
    harness.commands,
    keyFactory,
  );

  assert.deepEqual(harness.calls, ['cancel', 'request']);
  assert.equal(harness.cancelled[0]?.transitionId, 'transition-1');
  assert.match(harness.cancelled[0]?.reason || '', /finalizar el workshop/);
  assert.equal(harness.requested[0]?.complete, true);
});

test('continues after the previous transition settles during the cancellation race', async () => {
  const harness = commandHarness();
  harness.commands.cancelWorkshopTransition = async () => {
    harness.calls.push('cancel');
    throw Object.assign(new Error('already committed'), {
      code: 'functions/failed-precondition',
    });
  };

  await requestWorkshopFinalization(
    'workshop-1',
    transition(),
    harness.commands,
    keyFactory,
  );

  assert.deepEqual(harness.calls, ['cancel', 'request']);
});

test('does not request finalization when cancellation fails for authorization or connectivity', async () => {
  const harness = commandHarness();
  harness.commands.cancelWorkshopTransition = async () => {
    harness.calls.push('cancel');
    throw Object.assign(new Error('permission denied'), {
      code: 'functions/permission-denied',
    });
  };

  await assert.rejects(() => requestWorkshopFinalization(
    'workshop-1',
    transition(),
    harness.commands,
    keyFactory,
  ));
  assert.deepEqual(harness.calls, ['cancel']);
});

test('does not duplicate an existing completion transition', async () => {
  const harness = commandHarness();
  const result = await requestWorkshopFinalization(
    'workshop-1',
    transition({ complete: true }),
    harness.commands,
    keyFactory,
    120_000,
  );

  assert.equal(result.state, 'already-requested');
  assert.deepEqual(harness.calls, []);
});

test('replaces an expired completion request instead of leaving finalization blocked', async () => {
  const harness = commandHarness();
  const result = await requestWorkshopFinalization(
    'workshop-1',
    transition({ complete: true, expiresAt: 119_000 }),
    harness.commands,
    keyFactory,
    120_000,
  );

  assert.equal(result.state, 'requested');
  assert.deepEqual(harness.calls, ['cancel', 'request']);
  assert.equal(harness.requested[0]?.complete, true);
});
