import type { Context } from "grammy";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  ChatDirection,
  MessageType,
  ActorType,
  ApprovalMode,
  ProxyStatus,
  TeleUserStatus,
} from "@/types/database";
import type { ChatMessageInsert, ActivityLogInsert } from "@/types/database";
import type { SupportedLanguage } from "@/types/telegram";

// ---------------------------------------------------------------------------
// User helpers
// ---------------------------------------------------------------------------

export async function getUserLang(
  telegramId: number
): Promise<SupportedLanguage> {
  const { data } = await supabaseAdmin
    .from("tele_users")
    .select("language")
    .eq("telegram_id", telegramId)
    .single();
  return (data?.language as SupportedLanguage) || "en";
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
    .in("key", ["default_rate_limit_hourly", "default_rate_limit_daily", "default_rate_limit_total", "default_approval_mode", "default_max_proxies"]);

  const getSettingValue = (key: string, fallback: number | string) => {
    const setting = settings?.find(s => s.key === key);
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
      approval_mode: String(getSettingValue("default_approval_mode", "auto")) as ApprovalMode,
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

// ---------------------------------------------------------------------------
// Chat & activity logging
// ---------------------------------------------------------------------------

export async function logChatMessage(
  teleUserId: string,
  messageId: number | null,
  direction: ChatDirection,
  text: string | null,
  messageType: MessageType,
  rawData?: Record<string, unknown> | null
) {
  const insert: ChatMessageInsert = {
    tele_user_id: teleUserId,
    telegram_message_id: messageId,
    direction,
    message_text: text,
    message_type: messageType,
    raw_data: rawData ?? null,
  };
  await supabaseAdmin.from("chat_messages").insert(insert);
}

export async function logActivity(log: ActivityLogInsert) {
  await supabaseAdmin.from("activity_logs").insert(log);
}

// ---------------------------------------------------------------------------
// Rate-limit check
// ---------------------------------------------------------------------------

export function checkRateLimit(
  user: {
    rate_limit_hourly: number;
    rate_limit_daily: number;
    rate_limit_total: number;
    proxies_used_hourly: number;
    proxies_used_daily: number;
    proxies_used_total: number;
    hourly_reset_at: string | null;
    daily_reset_at: string | null;
    max_proxies?: number;
  },
  globalCaps?: {
    global_max_proxies?: number;
    global_max_total_requests?: number;
  }
): { allowed: boolean; resetHourly: boolean; resetDaily: boolean } {
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
        globalCaps.global_max_total_requests
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
export async function loadGlobalCaps(): Promise<{
  global_max_proxies?: number;
  global_max_total_requests?: number;
}> {
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

// ---------------------------------------------------------------------------
// Revoke proxy helper
// ---------------------------------------------------------------------------

export async function revokeProxy(proxyId: string, userId: string) {
  await supabaseAdmin
    .from("proxies")
    .update({
      status: ProxyStatus.Available,
      assigned_to: null,
      assigned_at: null,
    })
    .eq("id", proxyId);

  // Decrement usage counters
  try {
    await supabaseAdmin.rpc("decrement_usage", { p_user_id: userId });
  } catch (err) {
    console.error("Failed to decrement usage:", err);
  }

  await logActivity({
    actor_type: ActorType.Bot,
    actor_id: null,
    action: "proxy_revoked",
    resource_type: "proxy",
    resource_id: proxyId,
    details: { tele_user_id: userId },
    ip_address: null,
    user_agent: null,
  });
}
