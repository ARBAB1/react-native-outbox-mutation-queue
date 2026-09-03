/* eslint-disable no-console */
/**
 * Runnable demonstration — no simulator required.
 *
 *   npm run build && node example/node-demo.cjs
 *
 * Simulates a flaky network to exercise the behaviour that matters:
 * offline buffering, deduplication, exponential backoff, permanent-failure
 * classification, and durability across a restart.
 */
const { createQueue, createMemoryStorage } = require('../lib');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

// Shared storage so we can simulate an app relaunch against the same data.
const storage = createMemoryStorage();

let attempts = 0;

async function main() {
  log('\n=== 1. Queue while offline ===\n');

  const queue = createQueue({
    storage,
    retry: { baseDelayMs: 120, maxDelayMs: 1000, jitter: 0, maxAttempts: 4 },

    async execute(task) {
      attempts += 1;

      if (task.type === 'chargeCard') {
        // Always rejected by the server — a 4xx that will never succeed.
        throw new Error('HTTP 422 card declined');
      }
      // Fails twice, then succeeds — shows backoff recovering.
      if (task.type === 'flaky' && attempts < 3) {
        throw new Error('HTTP 503 upstream unavailable');
      }
      log(`   ✅ sent ${task.type}`, JSON.stringify(task.payload));
    },

    classifyError(error) {
      const status = Number(String(error).match(/HTTP (\d+)/)?.[1]);
      return status >= 400 && status < 500 ? 'permanent' : 'transient';
    },

    onDiscard(task, error) {
      log(`   ⛔ discarded ${task.type} after ${task.attempts} attempt(s):`, String(error));
    },
  });

  await queue.ready();

  queue.on('failed', (task, error, willRetry) => {
    log(
      `   ↻ ${task.type} attempt ${task.attempts} failed (${String(error)})` +
        (willRetry ? ' — will retry' : ' — giving up'),
    );
  });

  queue.setOnline(false);
  log('   📴 device offline');

  await queue.enqueue('updateProfile', { name: 'A' }, { dedupeKey: 'profile' });
  await queue.enqueue('updateProfile', { name: 'Ab' }, { dedupeKey: 'profile' });
  await queue.enqueue('updateProfile', { name: 'Ada' }, { dedupeKey: 'profile' });
  log(`   3 edits enqueued → queue size is ${queue.size()} (deduped)`);

  log('\n=== 2. Reconnect and flush ===\n');
  queue.setOnline(true);
  log('   📶 device online');
  await sleep(200);
  log(`   queue size: ${queue.size()}`);

  log('\n=== 3. Transient failures back off and recover ===\n');
  attempts = 0;
  await queue.enqueue('flaky', { id: 7 });
  await sleep(2500);
  log(`   recovered after ${attempts} attempts, queue size: ${queue.size()}`);

  log('\n=== 4. Permanent failure is not retried ===\n');
  await queue.enqueue('chargeCard', { amount: 500 });
  await sleep(400);
  log(`   queue size: ${queue.size()}`);

  log('\n=== 5. Durability across a restart ===\n');
  const dead = createQueue({
    storage,
    autoStart: false,
    execute: async () => {
      throw new Error('never runs');
    },
  });
  await dead.ready();
  await dead.enqueue('syncOrder', { orderId: 99 });
  log(`   queued while "app" was closed → ${dead.size()} task persisted`);

  const revived = createQueue({
    storage,
    async execute(task) {
      log(`   ✅ replayed ${task.type}`, JSON.stringify(task.payload));
    },
  });
  await revived.ready();
  await sleep(200);
  log(`   after relaunch, queue size: ${revived.size()}`);

  log('\nDone.\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
