/**
 * Core types for the offline mutation queue.
 */

export type TaskStatus = 'pending' | 'running' | 'failed' | 'discarded';

export interface Task<P = unknown> {
  /** Stable unique id, generated on enqueue. */
  id: string;
  /** Caller-defined operation name, e.g. `updateProfile`. */
  type: string;
  payload: P;
  createdAt: number;
  updatedAt: number;
  /** Number of execution attempts made so far. */
  attempts: number;
  status: TaskStatus;
  /** Tasks sharing a key collapse according to the dedupe strategy. */
  dedupeKey?: string;
  /** Message from the most recent failure, kept for debugging. */
  lastError?: string;
  /** Epoch ms before which the task must not be retried. */
  nextAttemptAt?: number;
}

/**
 * What to do when a newly enqueued task shares a `dedupeKey` with one
 * already waiting.
 *
 * - `replace` keeps the newest payload (last write wins) — the right default
 *   for "save this form" style mutations.
 * - `drop`    keeps the task already queued and ignores the new one.
 * - `keep`    disables collapsing and queues both.
 */
export type DedupeStrategy = 'replace' | 'drop' | 'keep';

export interface RetryPolicy {
  /** Attempts before a task is handed to `onDiscard`. Default 5. */
  maxAttempts: number;
  /** First backoff delay in ms. Default 1000. */
  baseDelayMs: number;
  /** Upper bound for a single backoff delay in ms. Default 60_000. */
  maxDelayMs: number;
  /** Randomisation applied to each delay, 0–1. Default 0.3. */
  jitter: number;
}

/**
 * Thrown-error classification. Returning `permanent` skips remaining
 * retries — use it for 4xx responses that will never succeed.
 */
export type FailureKind = 'transient' | 'permanent';

export interface QueueEvents<P = unknown> {
  enqueued: (task: Task<P>) => void;
  /**
   * A task was collapsed into another because they shared a `dedupeKey`.
   * `kept` remains queued; `dropped` was discarded.
   *
   * Deduplication is intentional, but it does throw work away. Listen here to
   * log or reconcile — and to catch the classic mistake of giving a dedupeKey
   * to things that must each be delivered, such as chat messages.
   */
  deduped: (kept: Task<P>, dropped: Task<P>, strategy: DedupeStrategy) => void;
  started: (task: Task<P>) => void;
  succeeded: (task: Task<P>) => void;
  failed: (task: Task<P>, error: unknown, willRetry: boolean) => void;
  discarded: (task: Task<P>, error: unknown) => void;
  drained: () => void;
  /** Fired whenever the persisted task list changes. */
  changed: (tasks: Task<P>[]) => void;
}

export type QueueEventName = keyof QueueEvents;

export type Unsubscribe = () => void;
