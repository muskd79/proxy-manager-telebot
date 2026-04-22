/**
 * Exponential backoff with jitter for the outbox drain.
 *
 * Sequence (ms) by attempt_count:
 *   0 -> run immediately
 *   1 ->    1_000 +/- 250
 *   2 ->    4_000 +/- 1_000
 *   3 ->   16_000 +/- 4_000
 *   4 ->   64_000 +/- 16_000
 *   5 ->  256_000 +/- 64_000
 *  >5 -> dead-letter (caller should set dlq_at)
 *
 * `base` and `factor` are exposed so tests can seed deterministic values.
 */

export const MAX_ATTEMPTS_BEFORE_DLQ = 5;

export interface BackoffOptions {
  /** Base delay in ms; default 1000. */
  baseMs?: number;
  /** Exponent; default 4. */
  factor?: number;
  /** Max jitter ratio; default 0.25 (so +/-25%). */
  jitterRatio?: number;
  /** Optional RNG; default Math.random — tests override. */
  random?: () => number;
}

export function computeBackoffMs(
  attemptCount: number,
  opts: BackoffOptions = {},
): number {
  if (attemptCount <= 0) return 0;

  const base = opts.baseMs ?? 1000;
  const factor = opts.factor ?? 4;
  const jitterRatio = opts.jitterRatio ?? 0.25;
  const rand = opts.random ?? Math.random;

  const nominal = base * Math.pow(factor, attemptCount - 1);
  const jitter = nominal * jitterRatio * (rand() * 2 - 1);
  const result = Math.max(0, Math.floor(nominal + jitter));
  return result;
}

export function shouldDlq(attemptCount: number): boolean {
  return attemptCount >= MAX_ATTEMPTS_BEFORE_DLQ;
}

/** Convenience: next_attempt_at given the CURRENT attempt_count (post-increment). */
export function computeNextAttemptAt(
  attemptCount: number,
  opts: BackoffOptions = {},
  now: Date = new Date(),
): Date {
  return new Date(now.getTime() + computeBackoffMs(attemptCount, opts));
}
