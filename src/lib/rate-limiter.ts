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

export async function incrementUsage(userId: string): Promise<void> {
  const { data: user } = await supabaseAdmin
    .from("tele_users")
    .select("proxies_used_hourly, proxies_used_daily, proxies_used_total")
    .eq("id", userId)
    .single();

  if (!user) return;

  await supabaseAdmin
    .from("tele_users")
    .update({
      proxies_used_hourly: user.proxies_used_hourly + 1,
      proxies_used_daily: user.proxies_used_daily + 1,
      proxies_used_total: user.proxies_used_total + 1,
    })
    .eq("id", userId);
}

// ----------------------
// API rate limiting (DB-backed via Supabase RPC, persists across cold starts)
// ----------------------

const API_RATE_LIMIT = API_RATE_LIMIT_PER_MINUTE;
const API_RATE_WINDOW_SECONDS = Math.ceil(API_RATE_LIMIT_WINDOW_MS / 1000);

export async function checkApiRateLimit(ip: string): Promise<{
  allowed: boolean;
  remaining: number;
  resetAt: number;
}> {
  try {
    const { data, error } = await supabaseAdmin.rpc("check_api_rate_limit", {
      p_ip: ip,
      p_max_requests: API_RATE_LIMIT,
      p_window_seconds: API_RATE_WINDOW_SECONDS,
    });

    if (error) {
      // On DB error, allow request (fail-open to avoid blocking all traffic)
      console.error("Rate limit check error:", error.message);
      return { allowed: true, remaining: API_RATE_LIMIT, resetAt: Date.now() + API_RATE_LIMIT_WINDOW_MS };
    }

    const result = data as { allowed: boolean; remaining: number };
    return {
      allowed: result.allowed,
      remaining: result.remaining,
      resetAt: Date.now() + API_RATE_LIMIT_WINDOW_MS,
    };
  } catch {
    // Fail-open on unexpected errors
    return { allowed: true, remaining: API_RATE_LIMIT, resetAt: Date.now() + API_RATE_LIMIT_WINDOW_MS };
  }
}
