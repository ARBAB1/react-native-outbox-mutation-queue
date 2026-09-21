import { describe, expect, it, vi } from 'vitest';
import { createQueue } from './queue';

const settle = (ms = 50) => new Promise((r) => setTimeout(r, ms));
async function waitDrained(queue: { size(): number }, timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (queue.size() === 0) return;
    await settle(5);
  }
}

/**
 * Regression test for strict ordering under transient failure.
 *
 * At concurrency 1 the queue promises strict submission order. Previously, a
 * task that failed transiently and was backing off would be skipped, and a
 * later task delivered ahead of it. The queue must instead WAIT for the head
 * task. This test fails on the old behaviour and passes once the head is
 * respected.
 */
describe('OfflineQueue — strict ordering under failure (regression)', () => {
  it('delivers in submission order at concurrency 1 despite transient failures', async () => {
    const delivered: number[] = [];
    const failsLeft = new Map<number, number>();

    const execute = vi.fn(async (task: { payload: { n: number } }) => {
      const n = task.payload.n;
      const left = failsLeft.get(n) ?? 0;
      if (left > 0) {
        failsLeft.set(n, left - 1);
        throw new Error('HTTP 503'); // transient
      }
      delivered.push(n);
    });

    const queue = createQueue<{ n: number }>({
      execute,
      concurrency: 1,
      classifyError: () => 'transient',
      retry: { maxAttempts: 20, baseDelayMs: 1, maxDelayMs: 4, jitter: 0 },
    });

    await queue.ready();
    queue.setOnline(false);

    const N = 12;
    for (let i = 1; i <= N; i++) {
      if (i % 3 === 0) failsLeft.set(i, 2); // every 3rd task fails twice, then succeeds
      await queue.enqueue('save', { n: i });
    }

    queue.setOnline(true);
    await waitDrained(queue);

    expect(delivered).toEqual(Array.from({ length: N }, (_, i) => i + 1));
    expect(queue.size()).toBe(0);
  });
});
