import type { Context } from "grammy";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { t, fillTemplate } from "../messages";
import { getOrCreateUser, getUserLanguage } from "../user";
import { logChatMessage } from "../logging";
import { checkRateLimit, loadGlobalCaps } from "../rate-limit";
import { proxyTypeKeyboard, quantityKeyboard } from "../keyboard";
import {
  ChatDirection,
  MessageType,
  ProxyStatus,
  TeleUserStatus,
} from "@/types/database";

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

  // Quick read-only rate limit preview (no DB writes, no race condition).
  // This is just for UX feedback — the real counter increment happens
  // atomically inside bulk_assign_proxies RPC when a proxy is assigned.
  const globalCaps = await loadGlobalCaps();
  const { allowed } = checkRateLimit(user, globalCaps);

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

  // Show proxy type selection with descriptions
  const typeDesc = lang === "vi"
    ? [
        t("selectProxyType", lang),
        "",
        "HTTP - Duyet web thong thuong",
        "HTTPS - Duyet web ma hoa",
        "SOCKS5 - Ho tro tat ca giao thuc, linh hoat nhat",
      ].join("\n")
    : [
        t("selectProxyType", lang),
        "",
        "HTTP - Standard web browsing",
        "HTTPS - Encrypted web browsing",
        "SOCKS5 - All protocols, most flexible",
      ].join("\n");
  const text = typeDesc;
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

  // Show quantity selection keyboard with note
  const qtyNote = lang === "vi"
    ? "Luu y: Yeu cau > 5 can admin duyet"
    : "Note: Requests > 5 require admin approval";
  const qtyText = `${t("selectQuantity", lang)}\n\n${qtyNote}`;
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(qtyText, { reply_markup: quantityKeyboard(proxyType, lang) });
}
