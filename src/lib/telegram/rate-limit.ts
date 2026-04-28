import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Rate-limit gate for Telegram bot proxy assignment.
 *
 * Two pieces:
 *   - checkRateLimit: pure function. Given a user row + (optional) global
 *     caps, returns whether the request is allowed and which counters
 *     should be reset before the next write. NO db access — trivially
 *     unit-testable.
 *   - loadGlobalCaps: reads the "global_max_*" setting rows and shapes
 *     them into the input `checkRateLimit` expects.
 *
 * Wave 22E-4 split: extracted from src/lib/telegram/utils.ts.
 *
 * Counter semantics:
 *   - hourly + daily counters auto-reset when their `_reset_at` timestamp
 *     has passed. Caller is responsible for persisting the reset (the
 *     pure function only reports it should happen).
 *   - total counter never resets — it's the lifetime cap.
 *   - global cap is an upper bound. If admin shrinks `global_max_total_requests`
 *     below an already-customised user limit, the global wins at runtime
 *     even if the user row still has the old (larger) limit.
 */

export interface RateLimitCheckUser {
  rate_limit_hourly: number;
  rate_limit_daily: number;
  rate_limit_total: number;
  proxies_used_hourly: number;
  proxies_used_daily: number;
  proxies_used_total: number;
  hourly_reset_at: string | null;
  daily_reset_at: string | null;
  max_proxies?: number;
}

export interface GlobalCaps {
  global_max_proxies?: number;
  global_max_total_requests?: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  resetHourly: boolean;
  resetDaily: boolean;
}

export function checkRateLimit(
  user: RateLimitCheckUser,
  globalCaps?: GlobalCaps,
): RateLimitDecision {
  const now = new Date();
  let resetHourly = false;
  let resetDaily = false;

  let usedHourly = user.proxies_used_hourly;
  let usedDaily = user.proxies_used_daily;

  if (user.hourly_reset_at && new Date(user.hourly_reset_at) <= now) {
    usedHourly = 0;
    resetHourly = true;
  }
  if (user.daily_reset_at && new Date(user.daily_reset_at) <= now) {
    usedDaily = 0;
    resetDaily = true;
  }

  // Apply per-user limits
  let effectiveTotalLimit = user.rate_limit_total;

  // Check global caps as upper bounds (override if user hasn't been customized)
  // The global caps enforce hard limits at runtime even if settings changed after user creation
  if (globalCaps) {
    if (
      globalCaps.global_max_total_requests !== undefined &&
      globalCaps.global_max_total_requests > 0
    ) {
      effectiveTotalLimit = Math.min(
        effectiveTotalLimit,
        globalCaps.global_max_total_requests,
      );
    }
  }

  const allowed =
    usedHourly < user.rate_limit_hourly &&
    usedDaily < user.rate_limit_daily &&
    user.proxies_used_total < effectiveTotalLimit;

  return { allowed, resetHourly, resetDaily };
}

/**
 * Load global cap settings from the database.
 */
export async function loadGlobalCaps(): Promise<GlobalCaps> {
  const { data: settings } = await supabaseAdmin
    .from("settings")
    .select("key, value")
    .in("key", ["global_max_proxies", "global_max_total_requests"]);

  const caps: Record<string, number> = {};
  if (settings) {
    for (const s of settings) {
      const val = s.value?.value;
      if (typeof val === "number" && val > 0) {
        caps[s.key] = val;
      }
    }
  }
  return caps;
}
