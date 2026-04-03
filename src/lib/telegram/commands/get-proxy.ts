import type { Context } from "grammy";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { t, fillTemplate } from "../messages";
import {
  getOrCreateUser,
  getUserLanguage,
  logChatMessage,
  checkRateLimit,
  loadGlobalCaps,
} from "../utils";
import { proxyTypeKeyboard, quantityKeyboard } from "../keyboard";
import {
  ChatDirection,
  MessageType,
  ApprovalMode,
  ProxyStatus,
  TeleUserStatus,
} from "@/types/database";
import { autoAssignProxy, createManualRequest } from "./assign-proxy";

export async function handleGetProxy(ctx: Context) {
  const user = await getOrCreateUser(ctx);
  if (!user) return;

  const lang = getUserLanguage(user);

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

  // Check rate limit (with global caps)
  const globalCaps = await loadGlobalCaps();
  const { allowed, resetHourly, resetDaily } = checkRateLimit(user, globalCaps);

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

  const lang = getUserLanguage(user);

  await logChatMessage(
    user.id,
    null,
    ChatDirection.Incoming,
    `proxy_type:${proxyType}`,
    MessageType.Callback
  );

  // Re-check rate limit (with global caps)
  const globalCaps = await loadGlobalCaps();
  const { allowed } = checkRateLimit(user, globalCaps);
  if (!allowed) {
    const text = t("rateLimitExceeded", lang);
    await ctx.answerCallbackQuery(text);
    return;
  }

  // Check max_proxies limit (enforce global cap as upper bound)
  const effectiveMaxProxies =
    globalCaps.global_max_proxies && globalCaps.global_max_proxies > 0
      ? Math.min(user.max_proxies, globalCaps.global_max_proxies)
      : user.max_proxies;

  const { count: assignedCount } = await supabaseAdmin
    .from("proxies")
    .select("*", { count: "exact", head: true })
    .eq("assigned_to", user.id)
    .eq("status", ProxyStatus.Assigned)
    .eq("is_deleted", false);

  if (assignedCount !== null && assignedCount >= effectiveMaxProxies) {
    const text = fillTemplate(t("maxProxiesReached", lang), {
      max_proxies: String(effectiveMaxProxies),
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

  // Show quantity selection keyboard
  const qtyText = t("selectQuantity", lang);
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(qtyText, { reply_markup: quantityKeyboard(proxyType, lang) });
}
