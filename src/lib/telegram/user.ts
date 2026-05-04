import type { Context } from "grammy";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  ActorType,
  ApprovalMode,
  TeleUserStatus,
  type TeleUser,
} from "@/types/database";
import type { SupportedLanguage } from "@/types/telegram";
import { logActivity } from "./logging";

/**
 * Telegram user identity + lookup helpers.
 *
 * Two responsibilities:
 *   1. Map a grammy Context.from to our tele_users row (creating on first sight).
 *   2. Resolve a user's preferred SupportedLanguage with a safe fallback.
 *
 * Wave 22E-4 split: extracted from src/lib/telegram/utils.ts.
 *
 * Wave 27 perf [perf #2, HIGH] — slim projection + per-ctx cache.
 *
 * Pre-fix every command/callback handler called `getOrCreateUser(ctx)`
 * which fired a `SELECT *` on tele_users (~20 columns). For a single
 * `/getproxy` flow that hops command → type-selection callback →
 * order-mode callback, this was 3 separate fetches per update.
 *
 * Now:
 *   - Slim projection: read only the columns downstream code uses.
 *   - Per-ctx cache via WeakMap keyed on `ctx` itself. The cache
 *     lifetime is one update — grammy gives a fresh ctx each time,
 *     so there's no leak. WeakMap so GC reclaims when the request
 *     ends. Multiple calls to getOrCreateUser inside the same
 *     handler chain all share one DB read.
 */

/** Columns actually consumed by handlers. Keep in sync with TeleUser shape. */
const TELE_USER_COLS =
  "id, telegram_id, username, first_name, last_name, status, language, " +
  "max_proxies, rate_limit_hourly, rate_limit_daily, rate_limit_total, " +
  "proxies_used_hourly, proxies_used_daily, proxies_used_total, " +
  "hourly_reset_at, daily_reset_at, approval_mode, created_at, " +
  "updated_at, is_deleted, first_proxy_at, first_start_notified_at";

// Per-ctx cache. WeakMap so GC reclaims the entry when ctx falls out
// of scope (one update = one ctx = one entry). No tear-down needed.
const ctxUserCache = new WeakMap<Context, TeleUser>();

/**
 * Safely extract a SupportedLanguage from a user record.
 * Centralises the fallback so every command behaves the same.
 */
export function getUserLanguage(user: {
  language?: string | null;
}): SupportedLanguage {
  const lang = user?.language;
  if (lang === "vi" || lang === "en") return lang;
  return "en"; // default fallback
}

export async function getOrCreateUser(ctx: Context) {
  const from = ctx.from;
  if (!from) return null;

  // Per-ctx cache hit → skip the DB roundtrip entirely.
  const cached = ctxUserCache.get(ctx);
  if (cached) return cached;

  const { data: existing } = await supabaseAdmin
    .from("tele_users")
    .select(TELE_USER_COLS)
    .eq("telegram_id", from.id)
    .single();

  if (existing) {
    const user = existing as unknown as TeleUser;
    ctxUserCache.set(ctx, user);
    return user;
  }

  // Read default settings from DB
  const { data: settings } = await supabaseAdmin
    .from("settings")
    .select("key, value")
    .in("key", [
      "default_rate_limit_hourly",
      "default_rate_limit_daily",
      "default_rate_limit_total",
      "default_approval_mode",
      "default_max_proxies",
    ]);

  const getSettingValue = (key: string, fallback: number | string) => {
    const setting = settings?.find((s) => s.key === key);
    return setting?.value?.value ?? fallback;
  };

  // Wave 23B-bot-fix — admin approval gate.
  //
  // Pre-fix every new /start created the user with status="active",
  // so anyone who knew the bot could request proxies immediately.
  // Admin "approve" was a no-op (already active).
  //
  // Now: when default_approval_mode='manual' (the safe default), new
  // users land in "pending". They see the "đang chờ admin duyệt"
  // welcome and every actionable command is gated downstream until
  // an admin approves them via the AUP-acceptance notification.
  // When mode='auto' (admin opted into open-signup), behavior is the
  // legacy auto-active path so existing fleets aren't broken.
  const approvalMode = String(
    getSettingValue("default_approval_mode", "manual"),
  ) as ApprovalMode;
  const initialStatus =
    approvalMode === ApprovalMode.Manual
      ? TeleUserStatus.Pending
      : TeleUserStatus.Active;

  // Create new user with settings-based defaults.
  // Use SELECT * here — we want the full new row to populate the cache
  // and to log the audit row.
  const { data: newUser, error } = await supabaseAdmin
    .from("tele_users")
    .insert({
      telegram_id: from.id,
      username: from.username ?? null,
      first_name: from.first_name ?? null,
      last_name: from.last_name ?? null,
      phone: null,
      status: initialStatus,
      approval_mode: approvalMode,
      max_proxies: Number(getSettingValue("default_max_proxies", 5)),
      rate_limit_hourly: Number(getSettingValue("default_rate_limit_hourly", 3)),
      rate_limit_daily: Number(getSettingValue("default_rate_limit_daily", 10)),
      rate_limit_total: Number(getSettingValue("default_rate_limit_total", 50)),
      proxies_used_hourly: 0,
      proxies_used_daily: 0,
      proxies_used_total: 0,
      hourly_reset_at: null,
      daily_reset_at: null,
      language: "en",
      notes: null,
      is_deleted: false,
      deleted_at: null,
    })
    .select(TELE_USER_COLS)
    .single();

  if (error) {
    console.error("Error creating tele_user:", error);
    return null;
  }

  const user = newUser as unknown as TeleUser;

  // Log activity
  await logActivity({
    actor_type: ActorType.Bot,
    actor_id: null,
    action: "user_registered",
    resource_type: "tele_user",
    resource_id: user.id,
    details: { telegram_id: from.id, username: from.username },
    ip_address: null,
    user_agent: null,
  });

  ctxUserCache.set(ctx, user);
  return user;
}
