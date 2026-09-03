# Complete Guide

Everything you need to understand, install and ship this library — written so
you can follow it without having built an offline-first app before.

- [The problem in plain terms](#the-problem-in-plain-terms)
- [How it works](#how-it-works)
- [Installation](#installation)
- [Android setup](#android-setup)
- [iOS setup](#ios-setup)
- [Permissions and dependencies](#permissions-and-dependencies)
- [Integration walkthrough](#integration-walkthrough)
- [Making your API safe to retry](#making-your-api-safe-to-retry)
- [Testing offline behaviour](#testing-offline-behaviour)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)

---

## The problem in plain terms

Someone opens your app on the metro, edits their profile, taps **Save**, and
the screen goes into a tunnel.

What normally happens:

1. `fetch()` throws
2. You show "Something went wrong, try again"
3. The user has already locked their phone and walked away
4. **The edit is gone**

What should happen: the app accepts the edit, remembers it, and sends it the
moment there is signal again — even if the user force-quit the app in between.

That is all this library does. You hand it a mutation; it takes responsibility
for getting it delivered.

### When you need this

- Forms and drafts saved while connectivity is unreliable
- "Like", "favourite", "mark as read" — small writes that should never block UI
- Field apps: delivery, inspection, healthcare, logistics
- Analytics or audit events that must not be dropped
- Any app used on transport, in basements, or in rural coverage

### When you do **not**

- You already use React Query or Redux — see the README comparison
- You need to *read* data offline as well; you want a local database
- Real-time collaboration; you want CRDTs

---

## How it works

Five moving parts. No magic.

```
enqueue()
   │
   ▼
┌──────────────┐   persisted after every change
│  Task list   │◄──────────────────────────────── storage adapter
└──────┬───────┘                                  (AsyncStorage / MMKV)
       │
       │  is the queue running?  is the device online?
       ▼
┌──────────────┐
│   execute()  │  your API call
└──────┬───────┘
       │
   ┌───┴────┐
 success   failure
   │          │
 remove   classifyError()
              │
      ┌───────┴────────┐
  transient         permanent
      │                 │
 backoff + retry    onDiscard()
      │                 │
  (up to maxAttempts) ──┘
```

**1. Enqueue.** You call `queue.enqueue(type, payload)`. A task is created with
an id, timestamp and attempt counter, appended to the list, and written to
storage immediately. This returns fast — nothing blocks your UI.

**2. Persist.** After *every* change the whole list is serialised to your
storage adapter. If the app is killed a millisecond later, the task is safe.

**3. Drain.** A loop picks the oldest eligible task and calls your `execute`.
With the default `concurrency: 1`, tasks run strictly in order — task 2 never
overtakes task 1. It only runs while the queue is started *and* you have told
it the device is online.

**4. Retry.** If `execute` throws, `classifyError` decides what kind of failure
it was. Transient failures get an exponential backoff with jitter:

```
attempt 1 fails → wait ~1s
attempt 2 fails → wait ~2s
attempt 3 fails → wait ~4s
attempt 4 fails → wait ~8s
attempt 5 fails → give up → onDiscard()
```

The jitter matters at scale: without it, ten thousand phones reconnecting after
an outage would all retry at the same instant and knock over your API.

**5. Discard.** Permanent failures (a `422` will never become a `200`) skip
straight to `onDiscard`, so you do not waste five attempts on a doomed request.
`onDiscard` is your conflict hook — reconcile with the server, warn the user,
or drop it.

### Deduplication

A user typing in a form generates a save per keystroke. Replaying all of them
is wasteful and can even be wrong.

Give related mutations the same `dedupeKey` and only one survives:

```ts
enqueue('saveDraft', { text: 'a' },   { dedupeKey: 'draft:42' })
enqueue('saveDraft', { text: 'ab' },  { dedupeKey: 'draft:42' })
enqueue('saveDraft', { text: 'abc' }, { dedupeKey: 'draft:42' })
// → one task, payload { text: 'abc' }
```

A task **already in flight is never replaced** — swapping its payload
mid-request would leave the side effect half-applied.

### After a crash

Tasks recorded as `running` when the process died are restored as `pending`
and retried, because the app never learned whether the server processed them.
That is why [idempotency](#making-your-api-safe-to-retry) matters.

---

## Installation

```sh
npm install react-native-outbox-mutation-queue
# or
yarn add react-native-outbox-mutation-queue
```

The library itself has **no runtime dependencies** and contains **no native
code**. It is plain TypeScript.

You will almost certainly also want these two standard packages:

```sh
npm install @react-native-async-storage/async-storage @react-native-community/netinfo
```

- **AsyncStorage** — so the queue survives app restarts
- **NetInfo** — so the queue knows when the device is online

Both are optional in principle. Without AsyncStorage the queue works but
forgets everything on restart. Without NetInfo it assumes it is always online
and relies on retries.

---

## Android setup

**No configuration is required for this library.**

It ships no native module, so there is nothing to link and nothing to add to
`build.gradle`.

If you install **NetInfo**, it needs one permission — add it to
`android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
```

That is the complete Android setup. `ACCESS_NETWORK_STATE` is a
[normal permission](https://developer.android.com/guide/topics/permissions/overview#normal),
granted at install time — **no runtime permission prompt, and nothing shown to
the user**.

AsyncStorage requires no permissions.

**Autolinking** handles both packages on React Native 0.60+. If you are on
Expo, `npx expo install` does the same.

---

## iOS setup

**No configuration is required for this library.**

Again, no native code, nothing to link, no entries needed in `Info.plist`.

If you install NetInfo or AsyncStorage, install the pods:

```sh
cd ios && pod install && cd ..
```

**No permissions are needed on iOS.** Network reachability is not a
permission-gated API, so there is no prompt and no `Info.plist` key.

⚠️ One thing to know about iOS: when your app is backgrounded, execution is
suspended within seconds. The queue **pauses**, it does not fail — remaining
tasks are already persisted and resume when the app is foregrounded. If you
need delivery while the app is closed, that requires background tasks, which
this library deliberately does not attempt.

---

## Permissions and dependencies

Quick answers to the questions people actually ask:

| Question | Answer |
|---|---|
| Native code? | **No** — pure TypeScript |
| Pod install needed? | Not for this library |
| Android permissions? | **None.** NetInfo needs `ACCESS_NETWORK_STATE` (install-time, invisible) |
| iOS permissions? | **None** |
| Runtime permission prompt? | **Never** |
| Works with Expo Go? | **Yes** |
| Works with the New Architecture? | Yes — no native code to migrate |
| Bundle size | ~5 KB minified, no dependencies |
| Runtime dependencies | **Zero** |
| Peer dependencies | `react` (optional, only for the hook) |
| Minimum React Native | Any version with ES2020 support |
| TypeScript | Types included, no `@types` package needed |

**Does it store personal data?** It stores whatever *you* put in a task
payload, as plain JSON in whatever storage you pass. AsyncStorage is **not
encrypted**. If your mutations contain sensitive data, pass an encrypted
adapter — for example `react-native-mmkv` with an encryption key, or a
Keychain/Keystore-backed store.

**GDPR note:** queued tasks are user data at rest on the device. If you
implement "delete my data", remember to call `queue.clear()`.

---

## Integration walkthrough

### Step 1 — create the queue once

Put this in its own module so the whole app shares one instance.

```ts
// src/lib/queue.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createQueue } from 'react-native-outbox-mutation-queue';

type Mutation = { endpoint: string; body: unknown };

export const queue = createQueue<Mutation>({
  storage: AsyncStorage,

  async execute(task) {
    const res = await fetch(`https://api.example.com${task.payload.endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // See "Making your API safe to retry"
        'Idempotency-Key': task.id,
      },
      body: JSON.stringify(task.payload.body),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  },

  classifyError(error) {
    const status = Number(String(error).match(/HTTP (\d+)/)?.[1]);
    // 4xx will never succeed on retry. 5xx and network errors might.
    return status >= 400 && status < 500 ? 'permanent' : 'transient';
  },

  onDiscard(task, error) {
    console.warn('Could not deliver', task.type, error);
    // Tell the user, or reconcile with the server here.
  },
});
```

### Step 2 — tell it about connectivity

```ts
// src/lib/queue.ts (continued)
import NetInfo from '@react-native-community/netinfo';

NetInfo.addEventListener((state) => {
  queue.setOnline(Boolean(state.isConnected && state.isInternetReachable !== false));
});
```

`isInternetReachable` matters: airport and hotel WiFi reports "connected"
while intercepting every request at a captive portal.

### Step 3 — queue mutations instead of calling the API

Before:

```ts
async function saveProfile(name: string) {
  await fetch('/profile', { method: 'POST', body: JSON.stringify({ name }) });
}
```

After:

```ts
function saveProfile(name: string) {
  return queue.enqueue(
    'saveProfile',
    { endpoint: '/profile', body: { name } },
    { dedupeKey: 'profile' },
  );
}
```

Note it is no longer `await`ing the network — it resolves as soon as the task
is stored. Update your UI optimistically.

### Step 4 — show the user what is happening

```tsx
import { useOfflineQueue } from 'react-native-outbox-mutation-queue/react';
import { queue } from '../lib/queue';

export function SyncStatus() {
  const { pending, isOnline } = useOfflineQueue(queue);
  if (pending === 0) return null;

  return (
    <Text>
      {pending} change{pending === 1 ? '' : 's'} waiting
      {isOnline ? ' — syncing…' : ' — will send when you are back online'}
    </Text>
  );
}
```

Do not skip this. Silent queues make users repeat actions because nothing told
them the first attempt was accepted.

---

## Making your API safe to retry

**This is the one thing you must get right.** The queue may deliver the same
request twice — after a crash, or when a response is lost after the server
already committed.

If your endpoint is not safe to repeat, a retry can double-charge a card or
create two orders.

**The fix is an idempotency key.** Send the task id as a header:

```ts
headers: { 'Idempotency-Key': task.id }
```

`task.id` is stable across retries. On the server, record it and return the
original response if you see it again:

```
if seen(idempotency_key):  return stored_response
else:                      process, store response, return it
```

Stripe, PayPal and most payment APIs already support this header. If you own
the API, it is an afternoon of work and prevents an entire class of bug.

**Naturally safe:** `PUT /profile` with a full object, "mark as read", setting
a value.
**Not safe:** `POST /orders`, `POST /payments`, "increment counter".

---

## Testing offline behaviour

**Simulator/emulator**

- **iOS:** the Simulator has no airplane mode. Use the Network Link Conditioner
  (Xcode → Open Developer Tool → More Developer Tools) with a 100% Loss profile,
  or just disconnect your Mac's WiFi.
- **Android:** the emulator's extended controls have a Cellular tab where you
  can set Data status to *Denied*, or press the airplane-mode button.

**Fastest of all** — do not touch the network. Call `queue.setOnline(false)`
from a debug button. That is exactly what the example app does, and it makes
the behaviour reproducible in tests.

**Manual test checklist**

1. Go offline, make three edits to the same record → queue holds **one** task
2. Come back online → it sends, badge clears
3. Go offline, make an edit, **force-quit the app**, reopen → task still there
4. Make the server return 500 → watch attempts space out
5. Make the server return 422 → discarded immediately, no retries

---

## Troubleshooting

**Nothing sends**
Did you call `queue.setOnline(true)`? The queue starts optimistic, but a
NetInfo listener may have set it false. Check `queue.isOnline()`.

**Tasks disappear after restart**
You are on the default in-memory storage. Pass `storage: AsyncStorage`.

**The same request fires twice**
Expected after a crash — see
[Making your API safe to retry](#making-your-api-safe-to-retry).

**Retries hammer the API**
Your `classifyError` is probably returning `transient` for 4xx. Check the
status parsing.

**Queue grows and never drains**
Your `execute` is throwing every time. Add a `failed` listener and log the
error:

```ts
queue.on('failed', (task, error, willRetry) =>
  console.log(task.type, task.attempts, error, willRetry),
);
```

**`useOfflineQueue` does not re-render**
Make sure you are passing the same queue instance, not creating one inside a
component body.

---

## FAQ

**Does it work with Expo?**
Yes, including Expo Go — there is no native code.

**Does it send while the app is closed?**
No. It resumes when the app is next opened. Background delivery needs
platform background-task APIs, deliberately out of scope.

**Can I use MMKV instead of AsyncStorage?**
Yes — any object with `getItem`, `setItem` and `removeItem`:

```ts
import { MMKV } from 'react-native-mmkv';
const mmkv = new MMKV();

const storage = {
  async getItem(k) { return mmkv.getString(k) ?? null; },
  async setItem(k, v) { mmkv.set(k, v); },
  async removeItem(k) { mmkv.delete(k); },
};
```

**How many tasks can it hold?**
Bounded by your storage. AsyncStorage on Android has a ~6 MB default limit, so
keep payloads small — store an id and re-read the record rather than embedding
a large blob.

**Does order matter?**
With the default `concurrency: 1`, yes — strictly FIFO. Raise it only if your
mutations are genuinely independent.

**Can I use it outside React Native?**
Yes. The core has no React Native imports — it runs in Node and on the web.
Only the `/react` hook needs React.

**What happens to tasks that fail permanently?**
They are removed from the queue and handed to `onDiscard`. The library never
silently drops anything.
