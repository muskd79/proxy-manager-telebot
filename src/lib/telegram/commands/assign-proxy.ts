import { supabaseAdmin } from "@/lib/supabase/admin";
import { t, fillTemplate } from "../messages";
import { sendTelegramMessage } from "../send";
import {
  checkRateLimit,
  logChatMessage,
  logActivity,
  loadGlobalCaps,
} from "../utils";
import {
  ChatDirection,
  MessageType,
  ActorType,
  ApprovalMode,
  RequestStatus,
} from "@/types/database";
import type { SupportedLanguage } from "@/types/telegram";

interface AssignResult {
  success: boolean;
  text: string;
  parseMode?: "Markdown";
}

/**
 * Auto-assign an available proxy of the given type to a user.
 * Uses bulk_assign_proxies RPC (FOR UPDATE SKIP LOCKED) to prevent
 * race conditions where two concurrent requests grab the same proxy.
 * The RPC atomically: locks a proxy, assigns it, creates the request
 * record, and increments usage counters.
 */
export async function autoAssignProxy(
  user: Record<string, unknown>,
  proxyType: string,
  lang: SupportedLanguage
): Promise<AssignResult> {
  const userId = user.id as string;

  // Read-only rate limit pre-check. The actual counter increment happens
  // inside bulk_assign_proxies RPC atomically with the proxy assignment,
  // so we avoid double-incrementing. This check uses the fresh user record
  // to gate obvious over-limit requests.
  const globalCaps = await loadGlobalCaps();
  const { data: freshUser } = await supabaseAdmin
    .from("tele_users")
    .select(
      "rate_limit_hourly, rate_limit_daily, rate_limit_total, proxies_used_hourly, proxies_used_daily, proxies_used_total, hourly_reset_at, daily_reset_at"
    )
    .eq("id", userId)
    .single();

  if (!freshUser) {
    return { success: false, text: "User not found" };
  }

  const rateLimitResult = checkRateLimit(freshUser, globalCaps);

  if (!rateLimitResult.allowed) {
    const text = t("rateLimitExceeded", lang);
    await logChatMessage(
      userId,
      null,
      ChatDirection.Outgoing,
      text,
      MessageType.Text
    );
    return { success: false, text };
  }

  // Atomically lock and assign one proxy using FOR UPDATE SKIP LOCKED.
  // This prevents race conditions where two concurrent requests could
  // SELECT the same available proxy and both try to assign it.
  const batchId = crypto.randomUUID();
  const { data: result, error: rpcError } = await supabaseAdmin.rpc(
    "bulk_assign_proxies",
    {
      p_user_id: userId,
      p_type: proxyType,
      p_quantity: 1,
      p_admin_id: null,
      p_batch_id: batchId,
    }
  );

  if (rpcError) {
    console.error("bulk_assign_proxies RPC error:", rpcError.message);
    const text = t("noProxyAvailable", lang);
    await logChatMessage(
      userId,
      null,
      ChatDirection.Outgoing,
      text,
      MessageType.Text
    );
    return { success: false, text };
  }

  const rpcResult = result as {
    success: boolean;
    assigned: number;
    requested: number;
    proxies: Array<{
      id: string;
      host: string;
      port: number;
      type: string;
      username: string | null;
      password: string | null;
    }>;
    batch_id: string | null;
  };

  if (!rpcResult.success || rpcResult.assigned === 0) {
    const text = t("noProxyAvailable", lang);
    await logChatMessage(
      userId,
      null,
      ChatDirection.Outgoing,
      text,
      MessageType.Text
    );
    return { success: false, text };
  }

  const proxy = rpcResult.proxies[0];

  // Note: The RPC already created the proxy_request record, assigned the
  // proxy, and incremented usage counters — no need to do it manually.

  const expiresAt = new Date(
    Date.now() + 30 * 24 * 60 * 60 * 1000
  ).toISOString();

  const text = fillTemplate(t("proxyAssigned", lang), {
    host: proxy.host,
    port: String(proxy.port),
    type: proxy.type.toUpperCase(),
    username: proxy.username ?? "N/A",
    password: proxy.password ?? "N/A",
    expires: new Date(expiresAt).toISOString().split("T")[0],
  });

  await logChatMessage(
    userId,
    null,
    ChatDirection.Outgoing,
    text,
    MessageType.Text
  );

  await logActivity({
    actor_type: ActorType.Bot,
    actor_id: null,
    action: "proxy_auto_assigned",
    resource_type: "proxy",
    resource_id: proxy.id,
    details: { tele_user_id: userId, proxy_type: proxyType },
    ip_address: null,
    user_agent: null,
  });

  return { success: true, text, parseMode: "Markdown" };
}

/**
 * Create a manual (pending) proxy request for the user.
 */
export async function createManualRequest(
  user: Record<string, unknown>,
  proxyType: string,
  lang: SupportedLanguage
): Promise<AssignResult> {
  const userId = user.id as string;

  const { data: request } = await supabaseAdmin
    .from("proxy_requests")
    .insert({
      tele_user_id: userId,
      proxy_id: null,
      proxy_type: proxyType as "http" | "https" | "socks5",
      status: RequestStatus.Pending,
      approval_mode: ApprovalMode.Manual,
      requested_at: new Date().toISOString(),
      is_deleted: false,
      deleted_at: null,
      country: null,
      approved_by: null,
      rejected_reason: null,
      processed_at: null,
      expires_at: null,
    })
    .select()
    .single();

  const text = fillTemplate(t("requestPending", lang), {
    id: request?.id ?? "unknown",
  });

  await logChatMessage(
    userId,
    null,
    ChatDirection.Outgoing,
    text,
    MessageType.Text
  );

  await logActivity({
    actor_type: ActorType.TeleUser,
    actor_id: userId,
    action: "proxy_request_created",
    resource_type: "proxy_request",
    resource_id: request?.id ?? null,
    details: { proxy_type: proxyType },
    ip_address: null,
    user_agent: null,
  });

  // Notify admins about the new pending request
  notifyAdminsNewRequest(user, proxyType).catch(console.error);

  return { success: true, text };
}

/**
 * Notify all admin Telegram IDs about a new pending proxy request.
 */
async function notifyAdminsNewRequest(
  user: Record<string, unknown>,
  proxyType: string
) {
  const { data: setting } = await supabaseAdmin
    .from("settings")
    .select("value")
    .eq("key", "admin_telegram_ids")
    .single();

  if (!setting?.value?.value) return;
  const adminIds: number[] = setting.value.value;

  const username = user.username
    ? "@" + user.username
    : (user.first_name as string) || "Unknown";
  const text = `[!] New proxy request\n\nUser: ${username}\nType: ${proxyType.toUpperCase()}\n\nUse /requests to approve/reject.`;

  for (const adminId of adminIds) {
    sendTelegramMessage(adminId, text).catch(console.error);
  }
}
