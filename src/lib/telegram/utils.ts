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

  // Create new user
  const { data: newUser, error } = await supabaseAdmin
    .from("tele_users")
    .insert({
      telegram_id: from.id,
      username: from.username ?? null,
      first_name: from.first_name ?? null,
      last_name: from.last_name ?? null,
      phone: null,
      status: TeleUserStatus.Active,
      approval_mode: ApprovalMode.Auto,
      max_proxies: 5,
      rate_limit_hourly: 3,
      rate_limit_daily: 10,
      rate_limit_total: 50,
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

export function checkRateLimit(user: {
  rate_limit_hourly: number;
  rate_limit_daily: number;
  rate_limit_total: number;
  proxies_used_hourly: number;
  proxies_used_daily: number;
  proxies_used_total: number;
  hourly_reset_at: string | null;
  daily_reset_at: string | null;
}): { allowed: boolean; resetHourly: boolean; resetDaily: boolean } {
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

  const allowed =
    usedHourly < user.rate_limit_hourly &&
    usedDaily < user.rate_limit_daily &&
    user.proxies_used_total < user.rate_limit_total;

  return { allowed, resetHourly, resetDaily };
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

  // Decrement usage counters (RPC may not exist, just skip on error)
  try {
    await supabaseAdmin.rpc("decrement_usage", { p_user_id: userId });
  } catch {
    // RPC may not exist - ignore
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
