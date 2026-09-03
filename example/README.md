# Examples

Two ways to see the queue work.

## 1. Node demo — no simulator needed

Runs in a terminal in about five seconds and exercises every behaviour:
offline buffering, deduplication, backoff recovery, permanent-failure
classification, and durability across a restart.

```sh
npm install
npm run build
node example/node-demo.cjs
```

Expected output:

```
=== 1. Queue while offline ===
   📴 device offline
   3 edits enqueued → queue size is 1 (deduped)

=== 2. Reconnect and flush ===
   📶 device online
   ✅ sent updateProfile {"name":"Ada"}
   queue size: 0

=== 3. Transient failures back off and recover ===
   ↻ flaky attempt 1 failed (HTTP 503) — will retry
   ↻ flaky attempt 2 failed (HTTP 503) — will retry
   ✅ sent flaky {"id":7}
   recovered after 3 attempts, queue size: 0

=== 4. Permanent failure is not retried ===
   ↻ chargeCard attempt 1 failed (HTTP 422) — giving up
   ⛔ discarded chargeCard after 1 attempt(s)

=== 5. Durability across a restart ===
   queued while "app" was closed → 1 task persisted
   ✅ replayed syncOrder {"orderId":99}
```

## 2. React Native app

`App.tsx` is a note editor that keeps working with the network off. Flip the
**Simulate offline** switch, keep typing and saving, then switch back — edits
collapse into one queued task and flush on reconnect. The activity log shows
retries as they happen.

To run it, create an Expo app and drop the file in:

```sh
npx create-expo-app offline-queue-example
cd offline-queue-example
npm install @react-native-async-storage/async-storage react-native-outbox-mutation-queue
# replace App.tsx with the one from this folder
npx expo start
```

The fake API fails about 30% of the time on purpose, so you can watch the
backoff behave without unplugging anything.
