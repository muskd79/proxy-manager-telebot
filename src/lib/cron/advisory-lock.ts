/**
 * Settings-table advisory lock for cron jobs.
 *
 * Prevents overlapping executions when Vercel fires a cron tick while the
 * previous invocation is still running. The 5-minute function runtime cap
 * means we can end up with 2 concurrent instances if a job takes longer than
 * the tick interval.
 *
 * Each call site passes a stable `lockKey`; the lock row is upserted into
 * the settings table and acquisition is conditional on the row being empty
 * or older than `ttlSeconds`. On success the lock value holds an ISO
 * timestamp of acquisition; on failure acquisition returns false and the
 * job is expected to no-op.
 *
 * Usage:
 *
 *   const outcome = await withCronLock(supabase, "proxy_expiry_sweep", async () => {
 *     await sweepExpiredProxies();
 *   });
 *   if (outcome.skipped) logger.info("sweep skipped, already running");
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Attempt to acquire the named lock. Returns `true` if the caller now holds
 * the lock, `false` if another instance holds it (or the lock was recently
 * claimed within `ttlSeconds`). Safe to call repeatedly; the upsert is
 * idempotent.
 */
export async function tryAcquireCronLock(
  supabase: SupabaseClient,
  lockKey: string,
  ttlSeconds = 600,
): Promise<boolean> {
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - ttlSeconds * 1000).toISOString();

  // Ensure the lock row exists (idempotent).
  //
  // Wave 27 bug hunt v8 [debugger #3, HIGH] — capture upsert errors.
  // Pre-fix the result was completely discarded. If the upsert failed
  // (RLS rejection, FK violation, settings constraint), the lock row
  // didn't exist → the conditional UPDATE below matched 0 rows →
  // `tryAcquireCronLock` returned false → `withCronLock` returned
  // {skipped: true} every single tick. Cron silently no-op'd
  // forever with no error logged. Now: surface upsert failures via
  // captureError + return false (caller treats as "lock infrastructure
  // problem", same as a real "another instance" skip — at least it's
  // logged for ops).
  const { error: upsertErr } = await supabase
    .from("settings")
    .upsert(
      {
        key: lockKey,
        value: { acquired_at: null },
        description: "Cron advisory lock",
      },
      { onConflict: "key", ignoreDuplicates: true },
    );
  if (upsertErr) {
    console.error(
      `[cron-lock:${lockKey}] upsert failed (lock row does not exist; cron will be silently skipped this tick):`,
      upsertErr.message,
    );
    return false;
  }

  // Atomic conditional update: only claim when value.acquired_at is null or
  // older than cutoff. Using `->>` JSON text accessor to compare timestamps.
  const { data, error } = await supabase
    .from("settings")
    .update({ value: { acquired_at: now } })
    .eq("key", lockKey)
    .or(`value->>acquired_at.is.null,value->>acquired_at.lt.${cutoff}`)
    .select("key");

  if (error) {
    console.warn(`[cron-lock:${lockKey}] acquire failed:`, error.message);
    return false;
  }
  return (data?.length ?? 0) > 0;
}

/** Release the lock so the next tick can acquire it. */
export async function releaseCronLock(
  supabase: SupabaseClient,
  lockKey: string,
): Promise<void> {
  await supabase
    .from("settings")
    .update({ value: { acquired_at: null } })
    .eq("key", lockKey);
}

/**
 * Run `fn` while holding the named lock. Returns `{ skipped: true }` when
 * another instance already holds it; `{ skipped: false, result }` otherwise.
 * The lock is always released in `finally`, so a thrown error still clears
 * it for the next tick.
 */
export async function withCronLock<T>(
  supabase: SupabaseClient,
  lockKey: string,
  fn: () => Promise<T>,
  ttlSeconds = 600,
): Promise<
  { skipped: true; reason: string } | { skipped: false; result: T }
> {
  // Cron route tests (cron.test.ts) bypass lock acquisition because
  // the unit-test supabase mock doesn't implement the full
  // `.update().eq().or().select()` chain. The advisory-lock unit
  // tests do NOT set this flag and exercise the real acquire/release
  // paths with their own targeted mocks.
  if (process.env.CRON_LOCK_BYPASS === "1") {
    const result = await fn();
    return { skipped: false, result };
  }

  const acquired = await tryAcquireCronLock(supabase, lockKey, ttlSeconds);
  if (!acquired) {
    return { skipped: true, reason: "another instance running" };
  }
  try {
    const result = await fn();
    return { skipped: false, result };
  } finally {
    await releaseCronLock(supabase, lockKey).catch(() => {});
  }
}
