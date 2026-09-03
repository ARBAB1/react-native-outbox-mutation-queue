# react-native-outbox-mutation-queue

[![npm](https://img.shields.io/npm/v/react-native-outbox-mutation-queue.svg)](https://www.npmjs.com/package/react-native-outbox-mutation-queue)
[![CI](https://github.com/ARBAB1/react-native-outbox-mutation-queue/actions/workflows/ci.yml/badge.svg)](https://github.com/ARBAB1/react-native-outbox-mutation-queue/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/react-native-outbox-mutation-queue.svg)](./LICENSE)
[![types](https://img.shields.io/npm/types/react-native-outbox-mutation-queue.svg)](./src/types.ts)
[![zero deps](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](./package.json)

**The user tapped Save on a train. Now what?**

A focused offline mutation queue for React Native. It holds writes while the
device is offline, retries them with exponential backoff when it comes back,
collapses duplicates, and survives app restarts.

It is deliberately **not** a database sync engine.

```ts
await queue.enqueue('updateProfile', { name: 'Ada' }, { dedupeKey: 'profile' });
// Offline? Queued. Online? Sent. Failed? Retried. App killed? Still there.
```

---

## The problem

Imagine your app has a "Save" button.

Normally when someone taps Save, your app sends the data to the server right
then:

```
User taps Save → app sends to server → server replies "ok" → done
```

But what if there is no internet at that moment? In a lift, on the metro, in a
basement, bad signal.

The send fails. Your app shows "Error, try again." The user has already put
their phone in their pocket. **Their data is gone.**

## What this library does

It sits in between:

```
User taps Save → library stores it on the phone → shows "Saved" instantly
                          ↓
                 (waits until internet comes back)
                          ↓
                 sends to server automatically
```

The user never sees an error. They do not have to retry. It just gets
delivered whenever the connection returns — even if they close the app
completely and open it tomorrow.

That is it. That is the whole idea.

## What it handles for you

| Situation | What happens |
|---|---|
| **No internet** | Holds the data safely on the phone |
| **Internet comes back** | Sends it automatically |
| **Server is down** | Waits and tries again — 1s, then 2s, 4s, 8s. Not hammering it |
| **Server says "invalid"** | Stops trying, tells your app |
| **User saved 10 times quickly** | Sends only the last version, not all 10 |
| **User force-closed the app** | Still there when they reopen |

---

## Why this exists

Most offline problems in a mobile app are not "replicate my database." They
are one narrow thing: **a mutation fired at a moment when the network was not
there, and it must not be lost.**

Good options already exist — they just all come with a commitment:

| Package | Weekly downloads | What it asks of you |
|---|---|---|
| [`@tanstack/react-query`](https://tanstack.com/query) | ~65M | Adopt React Query for your data layer |
| [`@redux-offline/redux-offline`](https://github.com/redux-offline/redux-offline) | ~100k | Adopt Redux |
| [`rxdb`](https://rxdb.info) | ~73k | Adopt their database |
| [`@nozbe/watermelondb`](https://watermelondb.dev) | ~61k | Adopt their database |
| [`@powersync/react-native`](https://powersync.com) | ~38k | Adopt their sync backend |
| [`react-native-offline`](https://github.com/rgommezz/react-native-offline) | ~11k | Redux-coupled; **last published Feb 2023** |
| **this package** | — | Nothing. One function |

*Figures collected September 2026.*

**Be honest with yourself before installing this:**

- Already using **React Query**? Use its
  [`persistQueryClient` with mutation resume](https://tanstack.com/query/latest/docs/framework/react/plugins/persistQueryClient).
  It is excellent and you already have it.
- Already using **Redux**? `@redux-offline/redux-offline` is mature and
  actively maintained.
- Need a **replicated local database**? WatermelonDB, RxDB or PowerSync.

**This package is for the case none of those fit:** no Redux, no React Query,
no local database — and no appetite for adopting one just so a `POST` survives
a tunnel. Zero runtime dependencies, one job.

There is a second reason it exists. `react-native-offline` still sees ~11k
downloads a week but has not shipped since **February 2023**. If you are on it
for the queue alone, this is a smaller, maintained, Redux-free replacement.

📖 **[Full guide](docs/GUIDE.md)** — how it works, platform setup, permissions, idempotency and troubleshooting.

## Install

```sh
npm install react-native-outbox-mutation-queue
```

No required runtime dependencies. Persistence and connectivity are injected,
so nothing is bundled that you might not use.

## Quick start

```ts
import { createQueue } from 'react-native-outbox-mutation-queue';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

export const queue = createQueue({
  storage: AsyncStorage,

  async execute(task) {
    const res = await fetch(`https://api.example.com/${task.type}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(task.payload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  },

  // 4xx will never succeed on retry — stop immediately.
  classifyError(error) {
    const status = Number(String(error).match(/HTTP (\d+)/)?.[1]);
    return status >= 400 && status < 500 ? 'permanent' : 'transient';
  },

  // Retries exhausted, or a permanent failure. Reconcile here.
  onDiscard(task, error) {
    console.warn('Dropped', task.type, error);
  },
});

NetInfo.addEventListener((state) => {
  queue.setOnline(Boolean(state.isConnected));
});
```

Then queue writes from anywhere:

```ts
await queue.enqueue('updateProfile', { name: 'Ada' });
```

## Showing sync state

```tsx
import { useOfflineQueue } from 'react-native-outbox-mutation-queue/react';

function SyncBadge() {
  const { pending, isOnline } = useOfflineQueue(queue);
  if (pending === 0) return null;
  return (
    <Text>
      {pending} change{pending === 1 ? '' : 's'} waiting
      {isOnline ? ' — syncing…' : ' — offline'}
    </Text>
  );
}
```

## Deduplication

A user editing a form offline generates a write per keystroke-save. You almost
never want to replay all of them.

```ts
await queue.enqueue('saveDraft', { text: 'a' },   { dedupeKey: 'draft:42' });
await queue.enqueue('saveDraft', { text: 'ab' },  { dedupeKey: 'draft:42' });
await queue.enqueue('saveDraft', { text: 'abc' }, { dedupeKey: 'draft:42' });
// One task is queued, carrying { text: 'abc' }.
```

| Strategy | Behaviour |
|---|---|
| `replace` *(default)* | Keep queue position, take the newest payload |
| `drop` | Keep the task already queued, ignore the new one |
| `keep` | Do not collapse — queue every task |

Only **pending** tasks collapse. A task already in flight is never replaced —
that would leave its side effect half-applied.

⚠️ **Deduplication throws work away.** That is the point for drafts, and a
data-loss bug for anything that must each be delivered — chat messages above
all. Two safeguards:

- The queue emits **`deduped(kept, dropped, strategy)`** so you can observe it
- It logs a **one-time warning** the first time a collapse happens; pass
  `silenceDedupeWarning: true` once you have confirmed it is intended

Tasks without a `dedupeKey` are never collapsed.

## Retries

Exponential backoff with jitter, so a fleet of devices reconnecting together
does not stampede your API.

```ts
retry: {
  maxAttempts: 5,
  baseDelayMs: 1000,
  maxDelayMs: 60_000,
  jitter: 0.3,
}
```

Delays follow `base × 2^(n-1)`, clamped to `maxDelayMs`, then randomised
within ±`jitter`. Default schedule: **1s → 2s → 4s → 8s → 16s**.

## API

### `createQueue(config)`

| Option | Default | Purpose |
|---|---|---|
| `execute` | *required* | Performs the side effect. Throw to retry |
| `storage` | in-memory | Any AsyncStorage-shaped adapter |
| `storageKey` | `rn-offline-queue/v1` | Persistence key |
| `retry` | see above | Backoff policy |
| `dedupeStrategy` | `replace` | Default collapsing behaviour |
| `concurrency` | `1` | Parallel executions; `1` preserves order |
| `classifyError` | `transient` | Return `permanent` to stop retrying |
| `onDiscard` | — | Conflict hook: retries exhausted or permanent |
| `autoStart` | `true` | Begin processing immediately |
| `silenceDedupeWarning` | `false` | Suppress the one-time dedupe warning |

### Methods

```ts
queue.ready()                       // resolves once storage is hydrated
queue.enqueue(type, payload, opts)  // add a mutation
queue.list()                        // snapshot, in execution order
queue.size()
queue.remove(id)
queue.clear()
queue.start() / queue.pause()
queue.setOnline(boolean)
queue.on(event, handler)            // returns an unsubscribe function
```

### Events

`enqueued` · `deduped` · `started` · `succeeded` · `failed` · `discarded` ·
`drained` · `changed`

`deduped(kept, dropped, strategy)` fires whenever a task is collapsed, naming
the payload that was discarded — so the discard is observable rather than
silent.

## Using it for chat

Sending messages is one of the best fits for this library — the WhatsApp
clock-icon behaviour. But chat needs different settings, and one default is
actively dangerous:

⚠️ **Never use `dedupeKey` for messages.** Dedupe collapses tasks sharing a
key, which for chat means **deleted messages** — send three, two vanish.

```ts
queue.enqueue('sendMessage', msg);   // ✅ no dedupeKey
```

Also raise `maxAttempts` (users expect messages to keep trying for hours),
keep `concurrency: 1` for ordering, and send a device-generated message id as
an idempotency key so retries do not post twice.

This only covers **sending**. Receiving still needs a WebSocket or push
notifications.

📖 [Full chat recipe](docs/GUIDE.md#recipe-using-it-for-chat)

## Behaviour worth knowing

**Ordering.** With the default `concurrency: 1`, tasks execute strictly in
enqueue order. Raise it only when your mutations are genuinely independent.

**Interrupted tasks.** If the process dies mid-flight, that task is restored
as `pending` and retried on next launch. Your `execute` should therefore be
**idempotent** — send an idempotency key if the API supports one.

**Storage failures are non-fatal.** If persistence throws, the in-memory queue
keeps working; you lose durability, not the queue.

**Corrupt state self-heals.** Unparseable stored data is discarded rather than
crashing on launch.

## Custom storage

Anything with three methods works — MMKV, SQLite, a test double:

```ts
import { MMKV } from 'react-native-mmkv';
const mmkv = new MMKV();

const storage = {
  async getItem(k)      { return mmkv.getString(k) ?? null; },
  async setItem(k, v)   { mmkv.set(k, v); },
  async removeItem(k)   { mmkv.delete(k); },
};
```

## Development

```sh
npm install
npm test
npm run typecheck
npm run build
```

## Contributing

Issues and pull requests are welcome. Run `npm test` and `npm run typecheck`
before opening a PR.

## Support this project

If this saved you an afternoon, you can say thanks:

<a href="https://www.buymeacoffee.com/arbab1" target="_blank">
  <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="46" width="163">
</a>

Starring the repo helps too — it is how other developers find it.

## License

MIT © [Syed Arbab Ali Shah](https://github.com/ARBAB1)
