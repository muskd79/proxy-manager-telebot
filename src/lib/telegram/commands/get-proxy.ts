import type { Context } from "grammy";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { t, fillTemplate } from "../messages";
import { getOrCreateUser, getUserLanguage } from "../user";
import { logChatMessage } from "../logging";
import { checkRateLimit, loadGlobalCaps } from "../rate-limit";
import { proxyTypeKeyboard, quantityKeyboard } from "../keyboard";
import { denyIfNotApproved } from "../guards";
import {
  ChatDirection,
  MessageType,
  ProxyStatus,
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

  // Wave 23B-bot-fix — single guard. Rejects blocked/banned (clear
  // message) AND pending (admin still reviewing). Pre-fix pending
  // users slipped through and could spam /getproxy before approval.
  if (await denyIfNotApproved(ctx, user, lang)) return;

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

  // Wave 23B-bot UX (per user spec 2026-04-29) — concise format:
  //   "Yêu cầu Proxy" title
  //   "Hiện có N proxy sẵn sàng."
  //   "Chọn loại proxy:"
  // + HTTP/HTTPS/SOCKS5/Hủy buttons. New message (not edit), so the
  // user can scroll back through the conversation.
  const { count: availableProxies } = await supabaseAdmin
    .from("proxies")
    .select("*", { count: "exact", head: true })
    .eq("status", ProxyStatus.Available)
    .eq("is_deleted", false);

  const text = lang === "vi"
    ? [
        "*Yêu cầu Proxy*",
        "",
        `Hiện có *${availableProxies ?? 0}* proxy sẵn sàng.`,
        "",
        "Chọn loại proxy:",
      ].join("\n")
    : [
        "*Request Proxy*",
        "",
        `*${availableProxies ?? 0}* proxies available.`,
        "",
        "Pick a proxy type:",
      ].join("\n");
  await ctx.reply(text, {
    parse_mode: "Markdown",
    reply_markup: proxyTypeKeyboard(lang),
  });
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

  // Wave 23B-bot UX — Hủy / Cancel button on the type-selection
  // keyboard. Sends a fresh confirmation message so the user can
  // see they did cancel.
  if (proxyType === "cancel") {
    await ctx.answerCallbackQuery();
    const text = lang === "vi" ? "Đã huỷ." : "Cancelled.";
    await ctx.reply(text);
    await logChatMessage(user.id, null, ChatDirection.Outgoing, text, MessageType.Text);
    return;
  }

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
    // Wave 23B-bot UX — new message, not edit. User wanted each
    // step to leave a trail in the chat history.
    await ctx.answerCallbackQuery();
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

  // Wave 23B-bot UX — quantity selection as a NEW message, not edit.
  // User feedback: "mỗi lần là 1 tin nhắn chứ không phải bấm xong
  // tin nhắn ý bị thay thành tin nhắn khác".
  const qtyNote = lang === "vi"
    ? "Lưu ý: Yêu cầu > 5 cần admin duyệt"
    : "Note: Requests > 5 require admin approval";
  const qtyText = lang === "vi"
    ? [
        `*${proxyType.toUpperCase()}*`,
        "",
        t("selectQuantity", lang),
        "",
        qtyNote,
      ].join("\n")
    : [
        `*${proxyType.toUpperCase()}*`,
        "",
        t("selectQuantity", lang),
        "",
        qtyNote,
      ].join("\n");
  await ctx.answerCallbackQuery();
  await ctx.reply(qtyText, {
    parse_mode: "Markdown",
    reply_markup: quantityKeyboard(proxyType, lang),
  });
}
