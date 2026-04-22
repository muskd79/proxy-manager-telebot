/**
 * API Rate Limiting
 *
 * Uses in-memory Map for fast, zero-latency rate limiting.
 * On Vercel Pro, functions stay warm for up to 15 minutes,
 * so rate limits persist across requests within that window.
 *
 * For stricter persistence, use the Supabase RPC check_api_rate_limit()
 * which survives cold starts but adds ~50ms latency per request.
 *
 * Telegram user rate limiting uses Supabase DB directly (see checkRateLimit).
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { API_RATE_LIMIT_PER_MINUTE, API_RATE_LIMIT_WINDOW_MS } from "./constants";

// ----------------------
// Telegram user rate limiting (DB-backed)
// ----------------------

interface RateLimitResult {
  allowed: boolean;
  reason?: string;
  remaining?: {
    hourly: number;
    daily: number;
    total: number;
  };
}

/**
 * @deprecated Use checkAndIncrementUsage() for atomic check + increment.
 * This function has a race condition: two concurrent requests can both pass
 * the check, then both increment, exceeding the limit.
 * Kept only for backward compatibility with read-only checks in utils.ts.
 */
export async function checkRateLimit(
  userId: string
): Promise<RateLimitResult> {
  const { data: user, error } = await supabaseAdmin
    .from("tele_users")
    .select(
      "rate_limit_hourly, rate_limit_daily, rate_limit_total, proxies_used_hourly, proxies_used_daily, proxies_used_total, hourly_reset_at, daily_reset_at"
    )
    .eq("id", userId)
    .single();

  if (error || !user) {
    return { allowed: false, reason: "User not found" };
  }

  const now = new Date();

  // Reset hourly counter if needed
  let usedHourly = user.proxies_used_hourly;
  if (
    !user.hourly_reset_at ||
    new Date(user.hourly_reset_at).getTime() <= now.getTime()
  ) {
    usedHourly = 0;
    const nextHourReset = new Date(now.getTime() + 60 * 60 * 1000);
    await supabaseAdmin
      .from("tele_users")
      .update({
        proxies_used_hourly: 0,
        hourly_reset_at: nextHourReset.toISOString(),
      })
      .eq("id", userId);
  }

  // Reset daily counter if needed
  let usedDaily = user.proxies_used_daily;
  if (
    !user.daily_reset_at ||
    new Date(user.daily_reset_at).getTime() <= now.getTime()
  ) {
    usedDaily = 0;
    const nextDayReset = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    await supabaseAdmin
      .from("tele_users")
      .update({
        proxies_used_daily: 0,
        daily_reset_at: nextDayReset.toISOString(),
      })
      .eq("id", userId);
  }

  const usedTotal = user.proxies_used_total;

  if (usedHourly >= user.rate_limit_hourly) {
    return { allowed: false, reason: "Hourly rate limit exceeded" };
  }
  if (usedDaily >= user.rate_limit_daily) {
    return { allowed: false, reason: "Daily rate limit exceeded" };
  }
  if (usedTotal >= user.rate_limit_total) {
    return { allowed: false, reason: "Total rate limit exceeded" };
  }

  return {
    allowed: true,
    remaining: {
      hourly: user.rate_limit_hourly - usedHourly,
      daily: user.rate_limit_daily - usedDaily,
      total: user.rate_limit_total - usedTotal,
    },
  };
}

/**
 * Atomic rate limit check + increment.
 * Uses database-level row locking (FOR UPDATE) to prevent race conditions.
 * Replaces the old checkRateLimit() + incrementUsage() pattern.
 *
 * Call this right before actually assigning a proxy. If it returns
 * allowed: false, the proxy should NOT be assigned.
 */
export async function checkAndIncrementUsage(
  userId: string,
  globalMaxTotal?: number
): Promise<{
  allowed: boolean;
  reason?: string;
  remaining?: { hourly: number; daily: number; total: number };
}> {
  const { data, error } = await supabaseAdmin.rpc("check_and_increment_usage", {
    p_user_id: userId,
    p_global_max_total: globalMaxTotal ?? null,
  });

  if (error) {
    console.error("Rate limit check error:", error.message);
    // Fail-closed for rate limiting (safer than fail-open)
    return { allowed: false, reason: "Rate limit check failed" };
  }

  return data as {
    allowed: boolean;
    reason?: string;
    remaining?: { hourly: number; daily: number; total: number };
  };
}

// ----------------------
// API rate limiting (DB-backed via Supabase RPC, persists across cold starts)
// ----------------------

const API_RATE_LIMIT = API_RATE_LIMIT_PER_MINUTE;
const API_RATE_WINDOW_SECONDS = Math.ceil(API_RATE_LIMIT_WINDOW_MS / 1000);

/**
 * API rate limiter.
 *
 * Fail policy: FAIL-CLOSED. If the DB is unreachable (connection pool
 * exhaustion during a DoS is exactly when this matters), return `allowed=false`
 * so the attacker cannot amplify damage by spamming unlimited vendor API calls
 * on our dime. Legitimate users see brief 429s during incidents — preferable
 * to a runaway bill.
 *
 * `fail-open` was the previous behaviour and is the wrong default for a
 * billed-side-effect reseller platform.
 */
export async function checkApiRateLimit(ip: string): Promise<{
  allowed: boolean;
  remaining: number;
  resetAt: number;
  /** True when the check itself failed (not a legitimate rate-limit hit). */
  checkFailed?: boolean;
}> {
  try {
    const { data, error } = await supabaseAdmin.rpc("check_api_rate_limit", {
      p_ip: ip,
      p_max_requests: API_RATE_LIMIT,
      p_window_seconds: API_RATE_WINDOW_SECONDS,
    });

    if (error) {
      console.error("Rate limit check error:", error.message);
      return {
        allowed: false,
        remaining: 0,
        resetAt: Date.now() + API_RATE_LIMIT_WINDOW_MS,
        checkFailed: true,
      };
    }

    const result = data as { allowed: boolean; remaining: number };
    return {
      allowed: result.allowed,
      remaining: result.remaining,
      resetAt: Date.now() + API_RATE_LIMIT_WINDOW_MS,
    };
  } catch (err) {
    console.error(
      "Rate limit unexpected error:",
      err instanceof Error ? err.message : String(err),
    );
    return {
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + API_RATE_LIMIT_WINDOW_MS,
      checkFailed: true,
    };
  }
}
