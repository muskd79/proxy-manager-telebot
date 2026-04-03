import { supabaseAdmin } from "@/lib/supabase/admin";
import { t, fillTemplate } from "../messages";
import { sendTelegramMessage } from "../send";
import { logChatMessage, logActivity, loadGlobalCaps } from "../utils";
import { checkAndIncrementUsage } from "@/lib/rate-limiter";
import {
  ChatDirection,
  MessageType,
  ActorType,
  ApprovalMode,
  ProxyStatus,
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
 * Creates a request record, updates the proxy status, and increments usage counters.
 */
export async function autoAssignProxy(
  user: Record<string, unknown>,
  proxyType: string,
  lang: SupportedLanguage
): Promise<AssignResult> {
  const userId = user.id as string;

  // Atomic rate limit check + increment (uses DB row lock to prevent races)
  const globalCaps = await loadGlobalCaps();
  const rateLimitResult = await checkAndIncrementUsage(
    userId,
    globalCaps.global_max_total_requests
  );

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

  // Find available proxy of selected type
  const { data: proxy } = await supabaseAdmin
    .from("proxies")
    .select("*")
    .eq("type", proxyType)
    .eq("status", ProxyStatus.Available)
    .eq("is_deleted", false)
    .limit(1)
    .single();

  if (!proxy) {
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

  // Assign proxy
  const expiresAt = new Date(
    Date.now() + 30 * 24 * 60 * 60 * 1000
  ).toISOString();
  await supabaseAdmin
    .from("proxies")
    .update({
      status: ProxyStatus.Assigned,
      assigned_to: userId,
      assigned_at: new Date().toISOString(),
      expires_at: expiresAt,
    })
    .eq("id", proxy.id);

  // Create request record
  await supabaseAdmin.from("proxy_requests").insert({
    tele_user_id: userId,
    proxy_id: proxy.id,
    proxy_type: proxyType as "http" | "https" | "socks5",
    status: RequestStatus.AutoApproved,
    approval_mode: ApprovalMode.Auto,
    requested_at: new Date().toISOString(),
    processed_at: new Date().toISOString(),
    expires_at: expiresAt,
    is_deleted: false,
    deleted_at: null,
    country: null,
    approved_by: null,
    rejected_reason: null,
  });

  // Usage counters already incremented atomically by checkAndIncrementUsage()

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
