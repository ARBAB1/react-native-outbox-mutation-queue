import { computeBackoff, DEFAULT_RETRY } from './backoff';
import { createMemoryStorage } from './storage/memory';
import type { StorageAdapter } from './storage/types';
import { createId } from './utils/id';
import type {
  DedupeStrategy,
  FailureKind,
  QueueEventName,
  QueueEvents,
  RetryPolicy,
  Task,
  Unsubscribe,
} from './types';

export interface EnqueueOptions {
  /** Tasks sharing this key collapse per `dedupeStrategy`. */
  dedupeKey?: string;
  /** Overrides the queue-level strategy for this task only. */
  dedupeStrategy?: DedupeStrategy;
}

export interface QueueConfig<P = unknown> {
  /**
   * Performs the actual side effect — usually an API call. Resolving marks
   * the task done; throwing schedules a retry.
   */
  execute: (task: Task<P>) => Promise<void>;

  /** Where tasks are persisted. Defaults to in-memory (non-durable). */
  storage?: StorageAdapter;

  /** Key under which the task list is stored. */
  storageKey?: string;

  retry?: Partial<RetryPolicy>;

  /** Default collapsing behaviour for tasks carrying a `dedupeKey`. */
  dedupeStrategy?: DedupeStrategy;

  /** How many tasks may run at once. Default 1 (strict ordering). */
  concurrency?: number;

  /**
   * Classifies a thrown error. Returning `permanent` stops retrying
   * immediately — use it for 4xx responses that will never succeed.
   */
  classifyError?: (error: unknown, task: Task<P>) => FailureKind;

  /**
   * Called when a task exhausts its retries or fails permanently. This is
   * the conflict hook: reconcile server state, surface a prompt, or drop it.
   */
  onDiscard?: (task: Task<P>, error: unknown) => void | Promise<void>;

  /** Start processing as soon as the queue is constructed. Default true. */
  autoStart?: boolean;
}

type Listeners = {
  [K in QueueEventName]: Set<(...args: never[]) => void>;
};

export class OfflineQueue<P = unknown> {
  private tasks: Task<P>[] = [];
  private readonly storage: StorageAdapter;
  private readonly storageKey: string;
  private readonly retry: RetryPolicy;
  private readonly dedupeStrategy: DedupeStrategy;
  private readonly concurrency: number;
  private readonly config: QueueConfig<P>;

  private online = true;
  private running = false;
  private draining = false;
  private inFlight = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private hydrated: Promise<void>;

  private listeners: Listeners = {
    enqueued: new Set(),
    started: new Set(),
    succeeded: new Set(),
    failed: new Set(),
    discarded: new Set(),
    drained: new Set(),
    changed: new Set(),
  };

  constructor(config: QueueConfig<P>) {
    this.config = config;
    this.storage = config.storage ?? createMemoryStorage();
    this.storageKey = config.storageKey ?? 'rn-offline-queue/v1';
    this.retry = { ...DEFAULT_RETRY, ...config.retry };
    this.dedupeStrategy = config.dedupeStrategy ?? 'replace';
    this.concurrency = Math.max(1, config.concurrency ?? 1);
    this.running = config.autoStart ?? true;

    this.hydrated = this.hydrate();
  }

  // ---------------------------------------------------------------- lifecycle

  /** Resolves once persisted tasks have been loaded from storage. */
  ready(): Promise<void> {
    return this.hydrated;
  }

  /** Resume processing. */
  start(): void {
    if (this.running) return;
    this.running = true;
    void this.drain();
  }

  /** Pause processing. In-flight tasks are allowed to finish. */
  pause(): void {
    this.running = false;
    this.clearTimer();
  }

  /**
   * Report connectivity. Wire this to NetInfo — the queue holds tasks while
   * offline rather than burning retry attempts against a dead network.
   */
  setOnline(online: boolean): void {
    const wasOffline = !this.online;
    this.online = online;
    if (online && wasOffline) void this.drain();
  }

  isOnline(): boolean {
    return this.online;
  }

  // ------------------------------------------------------------------- public

  /** Add a mutation to the queue. Safe to call while offline. */
  async enqueue(
    type: string,
    payload: P,
    options: EnqueueOptions = {},
  ): Promise<Task<P>> {
    await this.hydrated;

    const now = Date.now();
    const task: Task<P> = {
      id: createId(),
      type,
      payload,
      createdAt: now,
      updatedAt: now,
      attempts: 0,
      status: 'pending',
      dedupeKey: options.dedupeKey,
    };

    const strategy = options.dedupeStrategy ?? this.dedupeStrategy;

    if (task.dedupeKey && strategy !== 'keep') {
      // Only collapse against tasks not yet in flight — replacing a running
      // task would leave its side effect half-applied.
      const existingIndex = this.tasks.findIndex(
        (t) => t.dedupeKey === task.dedupeKey && t.status === 'pending',
      );

      if (existingIndex !== -1) {
        if (strategy === 'drop') {
          return this.tasks[existingIndex];
        }
        // 'replace' — keep queue position, take the newer payload.
        const existing = this.tasks[existingIndex];
        const merged: Task<P> = {
          ...existing,
          payload: task.payload,
          type: task.type,
          updatedAt: now,
        };
        this.tasks[existingIndex] = merged;
        await this.persist();
        this.emit('enqueued', merged);
        void this.drain();
        return merged;
      }
    }

    this.tasks.push(task);
    await this.persist();
    this.emit('enqueued', task);
    void this.drain();
    return task;
  }

  /** Snapshot of queued tasks, in execution order. */
  list(): Task<P>[] {
    return [...this.tasks];
  }

  size(): number {
    return this.tasks.length;
  }

  /** Remove a single task without executing it. */
  async remove(id: string): Promise<boolean> {
    const before = this.tasks.length;
    this.tasks = this.tasks.filter((t) => t.id !== id);
    if (this.tasks.length === before) return false;
    await this.persist();
    return true;
  }

  /** Drop every queued task. */
  async clear(): Promise<void> {
    this.tasks = [];
    await this.persist();
  }

  on<K extends QueueEventName>(
    event: K,
    handler: QueueEvents<P>[K],
  ): Unsubscribe {
    const set = this.listeners[event] as Set<unknown>;
    set.add(handler);
    return () => {
      set.delete(handler);
    };
  }

  // ------------------------------------------------------------------ internal

  private async hydrate(): Promise<void> {
    try {
      const raw = await this.storage.getItem(this.storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Task<P>[];
        // Anything left mid-flight from a previous session is retried; the
        // process died before we learned the outcome.
        this.tasks = parsed.map((t) =>
          t.status === 'running' ? { ...t, status: 'pending' } : t,
        );
      }
    } catch {
      // Corrupt payload should not brick the app — start clean.
      this.tasks = [];
    }
    this.emit('changed', this.list());
    void this.drain();
  }

  private async persist(): Promise<void> {
    this.emit('changed', this.list());
    try {
      await this.storage.setItem(this.storageKey, JSON.stringify(this.tasks));
    } catch {
      // Storage failure must not lose the in-memory queue.
    }
  }

  private nextRunnable(now: number): Task<P> | undefined {
    return this.tasks.find(
      (t) =>
        t.status === 'pending' && (!t.nextAttemptAt || t.nextAttemptAt <= now),
    );
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    if (!this.running || !this.online) return;

    this.draining = true;
    try {
      while (this.running && this.online && this.inFlight < this.concurrency) {
        const now = Date.now();
        const task = this.nextRunnable(now);
        if (!task) break;
        void this.run(task);
      }
    } finally {
      this.draining = false;
    }

    this.scheduleNext();
  }

  /** Wake up when the earliest backed-off task becomes eligible. */
  private scheduleNext(): void {
    this.clearTimer();
    if (!this.running || !this.online) return;

    const waiting = this.tasks
      .filter((t) => t.status === 'pending' && t.nextAttemptAt)
      .map((t) => t.nextAttemptAt as number);

    if (waiting.length === 0) {
      if (this.tasks.length === 0 && this.inFlight === 0) this.emit('drained');
      return;
    }

    const delay = Math.max(0, Math.min(...waiting) - Date.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.drain();
    }, delay);
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async run(task: Task<P>): Promise<void> {
    task.status = 'running';
    task.attempts += 1;
    task.updatedAt = Date.now();
    this.inFlight += 1;
    this.emit('started', task);
    await this.persist();

    try {
      await this.config.execute(task);
      this.tasks = this.tasks.filter((t) => t.id !== task.id);
      await this.persist();
      this.emit('succeeded', task);
    } catch (error) {
      await this.handleFailure(task, error);
    } finally {
      this.inFlight -= 1;
      void this.drain();
    }
  }

  private async handleFailure(task: Task<P>, error: unknown): Promise<void> {
    const kind: FailureKind =
      this.config.classifyError?.(error, task) ?? 'transient';

    const exhausted = task.attempts >= this.retry.maxAttempts;
    const willRetry = kind === 'transient' && !exhausted;

    task.lastError = error instanceof Error ? error.message : String(error);
    task.updatedAt = Date.now();

    if (willRetry) {
      task.status = 'pending';
      task.nextAttemptAt = Date.now() + computeBackoff(task.attempts, this.retry);
      await this.persist();
      this.emit('failed', task, error, true);
      return;
    }

    task.status = 'discarded';
    this.tasks = this.tasks.filter((t) => t.id !== task.id);
    await this.persist();
    this.emit('failed', task, error, false);
    this.emit('discarded', task, error);

    try {
      await this.config.onDiscard?.(task, error);
    } catch {
      // A throwing conflict handler must not stall the queue.
    }
  }

  private emit<K extends QueueEventName>(
    event: K,
    ...args: Parameters<QueueEvents<P>[K]>
  ): void {
    for (const handler of this.listeners[event]) {
      try {
        (handler as (...a: unknown[]) => void)(...(args as unknown[]));
      } catch {
        // Listener errors are contained.
      }
    }
  }
}

export function createQueue<P = unknown>(
  config: QueueConfig<P>,
): OfflineQueue<P> {
  return new OfflineQueue<P>(config);
}
