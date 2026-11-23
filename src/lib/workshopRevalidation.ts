// Errors never imply closure. Only authenticated server reads replace state.
// Retries run only during recovery, never while the realtime feed is healthy.
export function createWorkshopRevalidator<T>(
  readServer: () => Promise<T>,
  applyServerValue: (value: T) => void,
  canRead: () => boolean,
  schedule: (callback: () => void, delay: number) => ReturnType<typeof setTimeout> = setTimeout,
  cancel: (timer: ReturnType<typeof setTimeout>) => void = clearTimeout,
) {
  let disposed = false;
  let inFlight: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let retryDelay = 1_000;
  let serverRevision = 0;
  const clearRetry = () => {
    if (timer !== null) cancel(timer);
    timer = null;
  };
  const refresh = (): Promise<void> => {
    clearRetry();
    if (disposed || !canRead()) return Promise.resolve();
    if (inFlight) return inFlight;
    const readRevision = serverRevision;
    inFlight = Promise.resolve().then(readServer).then((value) => {
      if (!disposed && readRevision === serverRevision) {
        retryDelay = 1_000;
        applyServerValue(value);
      }
    }).catch(() => {
      if (!disposed && readRevision === serverRevision && canRead()) {
        timer = schedule(() => { timer = null; void refresh(); }, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 30_000);
      }
    }).finally(() => { inFlight = null; });
    return inFlight;
  };
  return {
    refresh,
    observeServerSnapshot() {
      serverRevision++;
      retryDelay = 1_000;
      clearRetry();
    },
    dispose() { disposed = true; clearRetry(); },
  };
}
