import type { Context } from "grammy";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { t, fillTemplate } from "../messages";
import {
  getOrCreateUser,
  logChatMessage,
  logActivity,
  checkRateLimit,
} from "../utils";
import { proxyTypeKeyboard } from "../keyboard";
import {
  ChatDirection,
  MessageType,
  ActorType,
  ApprovalMode,
  ProxyStatus,
  RequestStatus,
  TeleUserStatus,
} from "@/types/database";
import type { SupportedLanguage } from "@/types/telegram";

export async function handleGetProxy(ctx: Context) {
  const user = await getOrCreateUser(ctx);
  if (!user) return;

  const lang = user.language as SupportedLanguage;

  await logChatMessage(
    user.id,
    ctx.message?.message_id ?? null,
    ChatDirection.Incoming,
    "/getproxy",
    MessageType.Command
  );

  // Check blocked
  if (
    user.status === TeleUserStatus.Blocked ||
    user.status === TeleUserStatus.Banned
  ) {
    const text = t("accountBlocked", lang);
    await ctx.reply(text);
    await logChatMessage(
      user.id,
      null,
      ChatDirection.Outgoing,
      text,
      MessageType.Text
    );
    return;
  }

  // Check rate limit
  const { allowed, resetHourly, resetDaily } = checkRateLimit(user);

  // Reset counters if needed
  if (resetHourly || resetDaily) {
    const updates: Record<string, unknown> = {};
    if (resetHourly) {
      updates.proxies_used_hourly = 0;
      updates.hourly_reset_at = new Date(
        Date.now() + 60 * 60 * 1000
      ).toISOString();
    }
    if (resetDaily) {
      updates.proxies_used_daily = 0;
      updates.daily_reset_at = new Date(
        Date.now() + 24 * 60 * 60 * 1000
      ).toISOString();
    }
    await supabaseAdmin.from("tele_users").update(updates).eq("id", user.id);
  }

  if (!allowed) {
    const text = t("rateLimitExceeded", lang);
    await ctx.reply(text);
    await logChatMessage(
      user.id,
      null,
      ChatDirection.Outgoing,
      text,
      MessageType.Text
    );
    return;
  }

  // Show proxy type selection
  const text = t("selectProxyType", lang);
  await ctx.reply(text, { reply_markup: proxyTypeKeyboard(lang) });
  await logChatMessage(
    user.id,
    null,
    ChatDirection.Outgoing,
    text,
    MessageType.Text
  );
}

export async function handleProxyTypeSelection(
  ctx: Context,
  proxyType: string
) {
  if (!ctx.from) return;

  const { data: user } = await supabaseAdmin
    .from("tele_users")
    .select("*")
    .eq("telegram_id", ctx.from.id)
    .single();

  if (!user) return;

  const lang = user.language as SupportedLanguage;

  await logChatMessage(
    user.id,
    null,
    ChatDirection.Incoming,
    `proxy_type:${proxyType}`,
    MessageType.Callback
  );

  // Re-check rate limit
  const { allowed } = checkRateLimit(user);
  if (!allowed) {
    const text = t("rateLimitExceeded", lang);
    await ctx.answerCallbackQuery(text);
    return;
  }

  // Check max_proxies limit
  const { count: assignedCount } = await supabaseAdmin
    .from("proxies")
    .select("*", { count: "exact", head: true })
    .eq("assigned_to", user.id)
    .eq("status", ProxyStatus.Assigned)
    .eq("is_deleted", false);

  if (assignedCount !== null && assignedCount >= user.max_proxies) {
    const text = fillTemplate(t("maxProxiesReached", lang), {
      max_proxies: String(user.max_proxies),
    });
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(text);
    await logChatMessage(
      user.id,
      null,
      ChatDirection.Outgoing,
      text,
      MessageType.Text
    );
    return;
  }

  if (user.approval_mode === ApprovalMode.Auto) {
    // Auto assign: find available proxy of selected type
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
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(text);
      await logChatMessage(
        user.id,
        null,
        ChatDirection.Outgoing,
        text,
        MessageType.Text
      );
      return;
    }

    // Assign proxy
    const expiresAt = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000
    ).toISOString();
    await supabaseAdmin
      .from("proxies")
      .update({
        status: ProxyStatus.Assigned,
        assigned_to: user.id,
        assigned_at: new Date().toISOString(),
        expires_at: expiresAt,
      })
      .eq("id", proxy.id);

    // Create request record
    await supabaseAdmin.from("proxy_requests").insert({
      tele_user_id: user.id,
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

    // Increment usage
    await supabaseAdmin
      .from("tele_users")
      .update({
        proxies_used_hourly: user.proxies_used_hourly + 1,
        proxies_used_daily: user.proxies_used_daily + 1,
        proxies_used_total: user.proxies_used_total + 1,
        hourly_reset_at:
          user.hourly_reset_at ??
          new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        daily_reset_at:
          user.daily_reset_at ??
          new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      })
      .eq("id", user.id);

    const text = fillTemplate(t("proxyAssigned", lang), {
      host: proxy.host,
      port: String(proxy.port),
      type: proxy.type.toUpperCase(),
      username: proxy.username ?? "N/A",
      password: proxy.password ?? "N/A",
      expires: new Date(expiresAt).toLocaleDateString(),
    });

    await ctx.answerCallbackQuery();
    await ctx.editMessageText(text, { parse_mode: "Markdown" });
    await logChatMessage(
      user.id,
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
      details: { tele_user_id: user.id, proxy_type: proxyType },
      ip_address: null,
      user_agent: null,
    });
  } else {
    // Manual mode: create pending request
    const { data: request } = await supabaseAdmin
      .from("proxy_requests")
      .insert({
        tele_user_id: user.id,
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

    await ctx.answerCallbackQuery();
    await ctx.editMessageText(text);
    await logChatMessage(
      user.id,
      null,
      ChatDirection.Outgoing,
      text,
      MessageType.Text
    );

    await logActivity({
      actor_type: ActorType.TeleUser,
      actor_id: user.id,
      action: "proxy_request_created",
      resource_type: "proxy_request",
      resource_id: request?.id ?? null,
      details: { proxy_type: proxyType },
      ip_address: null,
      user_agent: null,
    });
  }
}
