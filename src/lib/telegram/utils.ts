import type { Context } from "grammy";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  ChatDirection,
  MessageType,
  ActorType,
  ApprovalMode,
  TeleUserStatus,
} from "@/types/database";
import type { ChatMessageInsert, ActivityLogInsert } from "@/types/database";
import type { SupportedLanguage } from "@/types/telegram";

// ---------------------------------------------------------------------------
// User helpers
// ---------------------------------------------------------------------------

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

/**
 * Atomically revoke a proxy from a user.
 *
 * Wave 22E-1 BUG FIX (B5 from code-reviewer audit):
 * The pre-22E-1 implementation ran two non-atomic operations:
 *   1. UPDATE proxies SET status='available', assigned_to=NULL, ...
 *   2. supabaseAdmin.rpc('decrement_usage', { user_id })
 * If the process crashed between (1) and (2), the proxy returned to
 * the pool but the user's rate-limit counter was permanently inflated.
 *
 * The fix: a single SECURITY DEFINER RPC `safe_revoke_proxy` (mig 029)
 * wraps both writes in one DB transaction. Either both succeed or both
 * roll back. The RPC also enforces "proxy must be assigned to THIS
 * user" so a malformed call cannot revoke someone else's proxy.
 *
 * Returns true on success, false when the RPC reported the proxy was
 * not assignable (already revoked, never assigned, or assigned to
 * a different user). Caller-side audit logging is preserved.
 */
export async function revokeProxy(
  proxyId: string,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc("safe_revoke_proxy", {
    p_proxy_id: proxyId,
    p_user_id: userId,
  });

  if (error) {
    console.error("safe_revoke_proxy RPC error:", error.message);
    // Audit: record the attempted revoke even on RPC error so the
    // log shows it tried. The bot caller should treat false as "no-op".
    await logActivity({
      actor_type: ActorType.Bot,
      actor_id: null,
      action: "proxy_revoke_failed",
      resource_type: "proxy",
      resource_id: proxyId,
      details: { tele_user_id: userId, error: error.message },
      ip_address: null,
      user_agent: null,
    });
    return false;
  }

  const result = data as { success: boolean; error?: string } | null;
  if (!result?.success) {
    return false;
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
  return true;
}
