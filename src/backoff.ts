import type { RetryPolicy } from './types';

export const DEFAULT_RETRY: RetryPolicy = {
  maxAttempts: 5,
  baseDelayMs: 1000,
  maxDelayMs: 60_000,
  jitter: 0.3,
};

/**
 * Exponential backoff with full-width jitter.
 *
 * Delay grows as base * 2^(attempt-1), clamped to maxDelayMs, then has a
 * random factor applied so a fleet of devices coming back online together
 * does not retry in lockstep and stampede the API.
 *
 * @param attempt 1-based attempt number that just failed.
 */
export function computeBackoff(
  attempt: number,
  policy: RetryPolicy = DEFAULT_RETRY,
  random: () => number = Math.random,
): number {
  const exponent = Math.max(0, attempt - 1);
  const raw = policy.baseDelayMs * 2 ** exponent;
  const clamped = Math.min(raw, policy.maxDelayMs);

  if (policy.jitter <= 0) return Math.round(clamped);

  // Spread within ±jitter of the clamped delay, never below zero.
  const spread = clamped * policy.jitter;
  const offset = (random() * 2 - 1) * spread;
  return Math.max(0, Math.round(clamped + offset));
}
