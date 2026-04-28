import type { Context } from "grammy";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  ActorType,
  ApprovalMode,
  TeleUserStatus,
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
 * `getOrCreateUser` reads the `default_*` settings from the DB so admin
 * tweaks to defaults take effect without a deploy. Callers should treat
 * a `null` return as "user creation failed" — caller bails out, log
 * surfaces the error.
 */

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

  const { data: existing } = await supabaseAdmin
    .from("tele_users")
    .select("*")
    .eq("telegram_id", from.id)
    .single();

  if (existing) return existing;

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

  // Create new user with settings-based defaults
  const { data: newUser, error } = await supabaseAdmin
    .from("tele_users")
    .insert({
      telegram_id: from.id,
      username: from.username ?? null,
      first_name: from.first_name ?? null,
      last_name: from.last_name ?? null,
      phone: null,
      status: TeleUserStatus.Active,
      approval_mode: String(
        getSettingValue("default_approval_mode", "auto"),
      ) as ApprovalMode,
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
    .select()
    .single();

  if (error) {
    console.error("Error creating tele_user:", error);
    return null;
  }

  // Log activity
  await logActivity({
    actor_type: ActorType.Bot,
    actor_id: null,
    action: "user_registered",
    resource_type: "tele_user",
    resource_id: newUser.id,
    details: { telegram_id: from.id, username: from.username },
    ip_address: null,
    user_agent: null,
  });

  return newUser;
}
