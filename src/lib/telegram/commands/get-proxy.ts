import type { Context } from "grammy";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { t, fillTemplate } from "../messages";
import { getOrCreateUser, getUserLanguage } from "../user";
import { logChatMessage } from "../logging";
import { checkRateLimit, loadGlobalCaps } from "../rate-limit";
import {
  proxyTypeKeyboard,
  orderTypeKeyboard,
  type OrderMode,
} from "../keyboard";
import { denyIfNotApproved } from "../guards";
import { setBotState } from "../state";
import { InlineKeyboard } from "grammy";
import { CB } from "../callbacks";
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

  // Wave 24-2 — pending.exists guard (port từ VIA i18n/common.ts).
  // Nếu user đã có yêu cầu pending chưa được duyệt → từ chối tạo
  // thêm. Pre-fix user spam /getproxy 10 lần thì admin queue ngập
  // 10 row pending cùng 1 user.
  const { count: pendingCount } = await supabaseAdmin
    .from("proxy_requests")
    .select("*", { count: "exact", head: true })
    .eq("tele_user_id", user.id)
    .eq("status", "pending")
    .eq("is_deleted", false);

  if (pendingCount !== null && pendingCount > 0) {
    // Wave 25-pre2 (Pass 2.5) — append recovery hint. Pre-fix the
    // pending message was a dead-end: user knows they're waiting,
    // doesn't know they can /history view or /cancel back out.
    const pendingText = lang === "vi"
      ? "Bạn đã có yêu cầu đang chờ xử lý.\nVui lòng đợi admin duyệt.\n\nDùng /history để xem yêu cầu hoặc /cancel để hủy."
      : "You already have a pending request.\nPlease wait for admin approval.\n\nUse /history to view it or /cancel to cancel.";
    await ctx.reply(pendingText);
    await logChatMessage(
      user.id,
      null,
      ChatDirection.Outgoing,
      pendingText,
      MessageType.Text,
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
    // Wave 25-pre2 (P0 5.4) — diacritic unified: "huỷ" → "hủy".
    const text = lang === "vi" ? "Đã hủy." : "Cancelled.";
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

  // Wave 23B-bot UX (per VIA pattern) — after type selection we
  // show the Order nhanh / Order riêng chooser instead of jumping
  // straight to quantity. User feedback: "sau khi chọn loại proxy
  // thì cần có tin nhắn với 2 lựa chọn như bên bot via chứ".
  //
  // Quick = auto-assign, per-user limit (1/2/5/10).
  // Custom = admin-approval queue, higher quantity options.
  const { count: availableProxies } = await supabaseAdmin
    .from("proxies")
    .select("*", { count: "exact", head: true })
    .eq("type", proxyType)
    .eq("status", ProxyStatus.Available)
    .eq("is_deleted", false);

  const text = lang === "vi"
    ? [
        `*Yêu cầu Proxy — ${proxyType.toUpperCase()}*`,
        "",
        `Có *${availableProxies ?? 0}* proxy ${proxyType.toUpperCase()} sẵn sàng (tối đa *${effectiveMaxProxies}*/lần)`,
        "",
        t("chooseOrderType", lang),
      ].join("\n")
    : [
        `*Request Proxy — ${proxyType.toUpperCase()}*`,
        "",
        `*${availableProxies ?? 0}* ${proxyType.toUpperCase()} proxies available (max *${effectiveMaxProxies}*/order)`,
        "",
        t("chooseOrderType", lang),
      ].join("\n");

  await ctx.answerCallbackQuery();
  await ctx.reply(text, {
    parse_mode: "Markdown",
    reply_markup: orderTypeKeyboard(proxyType, lang),
  });
}

/**
 * Wave 23B-bot UX (per VIA pattern) — order_quick / order_custom
 * callback. Sets a conversation state and prompts the user to type
 * the quantity. No preset keyboard — VIA-style free-form text input
 * so user can ask for 3, 7, 13… any positive integer.
 *
 * The text-input is consumed by handleQtyTextInput (handlers.ts
 * message:text handler) which checks getBotState() and dispatches.
 */
export async function handleOrderModeSelection(
  ctx: Context,
  proxyType: string,
  mode: OrderMode,
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
    `order_${mode}:${proxyType}`,
    MessageType.Callback,
  );

  const stepKey = mode === "quick" ? "awaiting_quick_qty" : "awaiting_custom_qty";
  await setBotState(user.id, { step: stepKey, proxyType });

  // Wave 23E — port chính xác format VIA bot. User feedback
  // 2026-05-02: muốn "Yêu cầu Proxy — TYPE / Có N proxy sẵn sàng
  // (tối đa M/lần) / Nhập số lượng proxy bạn cần:" như VIA.
  // VIA composes 3 keys: getvia.title + getvia.available + getvia.enter_qty
  // (handlers/callbacks/getvia.ts:115-199). Ghép tương tự, gắn
  // type vào title.
  const globalCaps = await loadGlobalCaps();
  const effectiveMaxProxies =
    globalCaps.global_max_proxies && globalCaps.global_max_proxies > 0
      ? Math.min(user.max_proxies, globalCaps.global_max_proxies)
      : user.max_proxies;

  const { count: availableProxies } = await supabaseAdmin
    .from("proxies")
    .select("*", { count: "exact", head: true })
    .eq("type", proxyType)
    .eq("status", ProxyStatus.Available)
    .eq("is_deleted", false);

  const totalCount = availableProxies ?? 0;
  const maxLabel = mode === "quick"
    ? String(Math.min(effectiveMaxProxies, 10))
    : (lang === "vi" ? "không giới hạn" : "no limit");

  const text = lang === "vi"
    ? [
        `*Yêu cầu Proxy — ${proxyType.toUpperCase()}*`,
        "",
        `Có *${totalCount}* proxy sẵn sàng (tối đa *${maxLabel}*/lần)`,
        "",
        "Nhập số lượng proxy bạn cần:",
      ].join("\n")
    : [
        `*Request Proxy — ${proxyType.toUpperCase()}*`,
        "",
        `*${totalCount}* proxies available (max *${maxLabel}*/request)`,
        "",
        "Enter the number of proxies you need:",
      ].join("\n");

  const cancelKb = new InlineKeyboard()
    .text(lang === "vi" ? "Hủy" : "Cancel", CB.qtyCancel());

  await ctx.answerCallbackQuery();
  await ctx.reply(text, { parse_mode: "Markdown", reply_markup: cancelKb });
}
