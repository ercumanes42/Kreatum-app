import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkshopRevalidator } from './workshopRevalidation';

function harness(read: () => Promise<string>) {
  const applied: string[] = [];
  const timers = new Map<number, { callback: () => void; delay: number }>();
  let sequence = 0;
  let online = true;
  const recovery = createWorkshopRevalidator(read, value => applied.push(value), () => online,
    (callback, delay) => {
      timers.set(++sequence, { callback, delay });
      return sequence as unknown as ReturnType<typeof setTimeout>;
    }, timer => { timers.delete(timer as unknown as number); });
  return { recovery, applied, timers, setOnline: (value: boolean) => { online = value; } };
}

test('no polling on a healthy feed; only verified server values are applied', async () => {
  let reads = 0;
  const h = harness(async () => { reads++; return 'completed'; });
  assert.equal(reads, 0);
  assert.equal(h.timers.size, 0);
  await h.recovery.refresh();
  assert.deepEqual(h.applied, ['completed']);
  assert.equal(h.timers.size, 0);
});

test('permission and precondition errors never signal closure; later terminal read recovers', async () => {
  let attempt = 0;
  const h = harness(async () => {
    if (++attempt <= 2) throw Object.assign(new Error('Rejected'), { code: attempt === 1 ? 'permission-denied' : 'failed-precondition' });
    return 'archived';
  });
  await h.recovery.refresh();
  assert.deepEqual(h.applied, []);
  assert.equal([...h.timers.values()][0].delay, 1_000);
  await h.recovery.refresh();
  assert.deepEqual(h.applied, []);
  assert.equal([...h.timers.values()][0].delay, 2_000);
  await h.recovery.refresh();
  assert.deepEqual(h.applied, ['archived']);
  assert.equal(h.timers.size, 0);
});

test('offline or hidden checks do not read; resume is independent of expired session TTL', async () => {
  let reads = 0;
  const h = harness(async () => { reads++; return 'completed'; });
  h.setOnline(false);
  await h.recovery.refresh();
  assert.equal(reads, 0);
  h.setOnline(true);
  await h.recovery.refresh();
  assert.deepEqual(h.applied, ['completed']);
});

test('single flight and disposal prevent late responses affecting another workshop', async () => {
  let resolve!: (value: string) => void;
  const h = harness(() => new Promise<string>(done => { resolve = done; }));
  const first = h.recovery.refresh();
  assert.equal(h.recovery.refresh(), first);
  await Promise.resolve();
  h.recovery.dispose();
  resolve('completed');
  await first;
  assert.deepEqual(h.applied, []);
  assert.equal(h.timers.size, 0);
});

test('recovery delay is capped; disposal cancels pending work', async () => {
  const h = harness(async () => { throw new Error('Offline'); });
  for (let attempt = 0; attempt < 10; attempt++) await h.recovery.refresh();
  assert.equal([...h.timers.values()][0].delay, 30_000);
  h.recovery.dispose();
  assert.equal(h.timers.size, 0);
  await h.recovery.refresh();
  assert.equal(h.timers.size, 0);
});

test('scheduled retry recovers automatically without another online event', async () => {
  let attempts = 0;
  const h = harness(async () => {
    if (++attempts === 1) throw new Error('Listener permission denied before closure');
    return 'completed';
  });
  await h.recovery.refresh();
  const [id, timer] = [...h.timers.entries()][0];
  h.timers.delete(id);
  timer.callback();
  await h.recovery.refresh();
  assert.equal(attempts, 2);
  assert.deepEqual(h.applied, ['completed']);
  assert.equal(h.timers.size, 0);
});

test('late recovery cannot overwrite a newer authoritative terminal snapshot', async () => {
  let resolve!: (value: string) => void;
  const h = harness(() => new Promise<string>(done => { resolve = done; }));
  const pending = h.recovery.refresh();
  await Promise.resolve();
  h.recovery.observeServerSnapshot();
  h.applied.push('completed');
  resolve('active');
  await pending;
  assert.deepEqual(h.applied, ['completed']);
  assert.equal(h.timers.size, 0);
});

test('a newer server snapshot cancels obsolete failed-read retries', async () => {
  const h = harness(async () => { throw new Error('Old listener failure'); });
  await h.recovery.refresh();
  assert.equal(h.timers.size, 1);
  h.recovery.observeServerSnapshot();
  assert.equal(h.timers.size, 0);
});
