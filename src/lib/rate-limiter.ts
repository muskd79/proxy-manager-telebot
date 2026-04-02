import { supabaseAdmin } from "@/lib/supabase/admin";

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
// API rate limiting (in-memory, per admin IP)
// ----------------------

interface ApiRateLimitEntry {
  count: number;
  resetAt: number;
}

const apiRateLimitMap = new Map<string, ApiRateLimitEntry>();

const API_RATE_LIMIT = 100; // requests per minute
const API_RATE_WINDOW_MS = 60 * 1000; // 1 minute

export function checkApiRateLimit(ip: string): {
  allowed: boolean;
  remaining: number;
  resetAt: number;
} {
  const now = Date.now();
  const entry = apiRateLimitMap.get(ip);

  // Clean up expired entries periodically
  if (apiRateLimitMap.size > 10000) {
    for (const [key, val] of apiRateLimitMap.entries()) {
      if (val.resetAt <= now) {
        apiRateLimitMap.delete(key);
      }
    }
  }

  if (!entry || entry.resetAt <= now) {
    // New window
    const resetAt = now + API_RATE_WINDOW_MS;
    apiRateLimitMap.set(ip, { count: 1, resetAt });
    return { allowed: true, remaining: API_RATE_LIMIT - 1, resetAt };
  }

  if (entry.count >= API_RATE_LIMIT) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count += 1;
  return {
    allowed: true,
    remaining: API_RATE_LIMIT - entry.count,
    resetAt: entry.resetAt,
  };
}
