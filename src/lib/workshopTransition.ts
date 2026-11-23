import type {
  CancelWorkshopTransitionInput,
  CancelWorkshopTransitionOutput,
  RequestWorkshopTransitionInput,
  RequestWorkshopTransitionOutput,
} from '../../shared/contracts';
import type { WorkshopTransition } from '../hooks/useRealtime';

type TransitionCommandClient = {
  cancelWorkshopTransition: (
    input: CancelWorkshopTransitionInput,
  ) => Promise<CancelWorkshopTransitionOutput>;
  requestWorkshopTransition: (
    input: RequestWorkshopTransitionInput,
  ) => Promise<RequestWorkshopTransitionOutput>;
};

type IdempotencyKeyFactory = (operation: string) => string;

const acknowledgementCount = (value: string[] | number) => (
  typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : Array.isArray(value)
      ? value.length
      : 0
);

export const getWorkshopTransitionProgress = (
  transition: WorkshopTransition | null,
  now: number,
) => {
  if (!transition || transition.state !== 'requested') {
    return {
      required: 0,
      received: 0,
      pending: 0,
      expired: false,
    };
  }

  const required = acknowledgementCount(transition.requiredAcks);
  const received = acknowledgementCount(transition.receivedAcks);

  return {
    required,
    received,
    pending: Math.max(0, required - received),
    expired: !Number.isFinite(transition.expiresAt)
      || transition.expiresAt <= 0
      || transition.expiresAt <= now,
  };
};

const isSettledTransitionError = (error: unknown) => {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  const code = String(error.code);
  return code === 'failed-precondition' || code === 'functions/failed-precondition';
};

export const requestWorkshopFinalization = async (
  workshopId: string,
  activeTransition: WorkshopTransition | null,
  commands: TransitionCommandClient,
  createKey: IdempotencyKeyFactory,
  now = Date.now(),
) => {
  const activeTransitionExpired = getWorkshopTransitionProgress(activeTransition, now).expired;

  if (
    activeTransition?.state === 'requested'
    && activeTransition.complete
    && !activeTransitionExpired
  ) {
    return { state: 'already-requested' as const };
  }

  if (activeTransition?.state === 'requested') {
    try {
      await commands.cancelWorkshopTransition({
        workshopId,
        transitionId: activeTransition.id,
        reason: 'Cambio de fase cancelado para finalizar el workshop',
        idempotencyKey: createKey('cancelWorkshopTransition'),
      });
    } catch (error: unknown) {
      // The transition may have committed between the realtime snapshot and
      // this command. Requesting completion from the new canonical state is safe.
      if (!isSettledTransitionError(error)) throw error;
    }
  }

  const result = await commands.requestWorkshopTransition({
    workshopId,
    complete: true,
    idempotencyKey: createKey('requestWorkshopTransition'),
  });

  return { state: 'requested' as const, result };
};
