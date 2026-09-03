import { describe, expect, it, vi } from 'vitest';
import { computeBackoff } from './backoff';
import { createQueue } from './queue';
import { createMemoryStorage } from './storage/memory';
import type { StorageAdapter } from './storage/types';

const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = (ms = 50) => new Promise((r) => setTimeout(r, ms));

describe('computeBackoff', () => {
  it('grows exponentially from the base delay', () => {
    const policy = {
      maxAttempts: 5,
      baseDelayMs: 1000,
      maxDelayMs: 60_000,
      jitter: 0,
    };
    expect(computeBackoff(1, policy)).toBe(1000);
    expect(computeBackoff(2, policy)).toBe(2000);
    expect(computeBackoff(3, policy)).toBe(4000);
  });

  it('clamps to maxDelayMs', () => {
    const policy = {
      maxAttempts: 20,
      baseDelayMs: 1000,
      maxDelayMs: 5000,
      jitter: 0,
    };
    expect(computeBackoff(10, policy)).toBe(5000);
  });

  it('never returns a negative delay even at full jitter', () => {
    const policy = {
      maxAttempts: 5,
      baseDelayMs: 1000,
      maxDelayMs: 60_000,
      jitter: 1,
    };
    expect(computeBackoff(1, policy, () => 0)).toBeGreaterThanOrEqual(0);
  });
});

describe('OfflineQueue', () => {
  it('executes a queued task', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const queue = createQueue({ execute });
    await queue.ready();

    await queue.enqueue('save', { a: 1 });
    await settle();

    expect(execute).toHaveBeenCalledTimes(1);
    expect(queue.size()).toBe(0);
  });

  it('holds tasks while offline and flushes on reconnect', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const queue = createQueue({ execute });
    await queue.ready();

    queue.setOnline(false);
    await queue.enqueue('save', { a: 1 });
    await settle();

    expect(execute).not.toHaveBeenCalled();
    expect(queue.size()).toBe(1);

    queue.setOnline(true);
    await settle();

    expect(execute).toHaveBeenCalledTimes(1);
    expect(queue.size()).toBe(0);
  });

  it('retries transient failures then succeeds', async () => {
    let calls = 0;
    const execute = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new Error('network down');
    });

    const queue = createQueue({
      execute,
      retry: { baseDelayMs: 1, maxDelayMs: 2, jitter: 0, maxAttempts: 5 },
    });
    await queue.ready();

    await queue.enqueue('save', { a: 1 });
    await settle(200);

    expect(calls).toBe(3);
    expect(queue.size()).toBe(0);
  });

  it('discards after maxAttempts and calls onDiscard', async () => {
    const onDiscard = vi.fn();
    const queue = createQueue({
      execute: async () => {
        throw new Error('always fails');
      },
      retry: { baseDelayMs: 1, maxDelayMs: 2, jitter: 0, maxAttempts: 3 },
      onDiscard,
    });
    await queue.ready();

    await queue.enqueue('save', { a: 1 });
    await settle(300);

    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(queue.size()).toBe(0);
  });

  it('stops retrying when the error is classified permanent', async () => {
    const execute = vi.fn(async () => {
      throw new Error('422 unprocessable');
    });
    const onDiscard = vi.fn();

    const queue = createQueue({
      execute,
      classifyError: () => 'permanent',
      retry: { baseDelayMs: 1, maxDelayMs: 2, jitter: 0, maxAttempts: 5 },
      onDiscard,
    });
    await queue.ready();

    await queue.enqueue('save', { a: 1 });
    await settle(100);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('collapses pending tasks sharing a dedupeKey, keeping the newest payload', async () => {
    const seen: unknown[] = [];
    const queue = createQueue<{ n: number }>({
      execute: async (task) => {
        seen.push(task.payload);
      },
      autoStart: false,
    });
    await queue.ready();

    await queue.enqueue('save', { n: 1 }, { dedupeKey: 'profile' });
    await queue.enqueue('save', { n: 2 }, { dedupeKey: 'profile' });
    await queue.enqueue('save', { n: 3 }, { dedupeKey: 'profile' });

    expect(queue.size()).toBe(1);

    queue.start();
    await settle();

    expect(seen).toEqual([{ n: 3 }]);
  });

  it('keeps the first task when strategy is drop', async () => {
    const queue = createQueue<{ n: number }>({
      execute: async () => {},
      dedupeStrategy: 'drop',
      autoStart: false,
    });
    await queue.ready();

    await queue.enqueue('save', { n: 1 }, { dedupeKey: 'k' });
    await queue.enqueue('save', { n: 2 }, { dedupeKey: 'k' });

    expect(queue.size()).toBe(1);
    expect(queue.list()[0].payload).toEqual({ n: 1 });
  });

  it('persists across restarts and resets interrupted tasks', async () => {
    const storage: StorageAdapter = createMemoryStorage();

    const first = createQueue({
      execute: async () => {
        throw new Error('offline');
      },
      storage,
      autoStart: false,
    });
    await first.ready();
    await first.enqueue('save', { a: 1 });
    expect(first.size()).toBe(1);

    // Simulate app restart against the same storage.
    const execute = vi.fn().mockResolvedValue(undefined);
    const second = createQueue({ execute, storage });
    await second.ready();
    await settle();

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('emits changed when the queue mutates', async () => {
    const queue = createQueue({ execute: async () => {}, autoStart: false });
    await queue.ready();

    const onChanged = vi.fn();
    queue.on('changed', onChanged);

    await queue.enqueue('save', { a: 1 });
    await flush();

    expect(onChanged).toHaveBeenCalled();
  });
});
