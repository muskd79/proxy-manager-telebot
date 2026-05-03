import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserLanguage } from "../user";
import { logChatMessage } from "../logging";
import { ChatDirection, MessageType } from "@/types/database";
import type { BotStep } from "../state";
import { clearBotState, setBotState } from "../state";
import { handleQuantitySelection } from "./bulk-proxy";
import { CB } from "../callbacks";
import { restartFlowKeyboard } from "../recovery-keyboard";

/**
 * Wave 23B-bot UX — handle a number typed by the user while we are
 * in `awaiting_quick_qty` or `awaiting_custom_qty`.
 *
 * Wave 24-1 — instead of placing the order immediately we now set
 * state to `awaiting_confirm` and ask the user "Xác nhận?" with a
 * Yes/No inline keyboard, mirroring VIA bot's confirm step
 * (i18n/getvia.ts confirm.title/qty/ask). The actual order
 * placement happens in `handleConfirmCallback` on yes.
 *
 * Returns true when the message was consumed (caller should stop
 * processing further), false when no state was active.
 */
const QUICK_MAX = 10;
const CUSTOM_MAX = 100;

export async function handleQtyTextInput(
  ctx: Context,
  step: BotStep,
  proxyType: string | undefined,
  text: string,
): Promise<boolean> {
  if (!ctx.from) return false;
  if (step !== "awaiting_quick_qty" && step !== "awaiting_custom_qty") return false;

  const { data: user } = await supabaseAdmin
    .from("tele_users")
    .select("id, language")
    .eq("telegram_id", ctx.from.id)
    .single();
  if (!user) return false;
  const lang = getUserLanguage(user);

  await logChatMessage(
    user.id,
    null,
    ChatDirection.Incoming,
    `qty_text:${step}:${text}`,
    MessageType.Text,
  );

  if (!proxyType) {
    // Lost context (state corruption / older row). Reset and ask user
    // to start from /getproxy.
    await clearBotState(user.id);
    const msg = lang === "vi"
      ? "Phiên đặt proxy đã hết hạn. Bấm /start để bắt đầu lại."
      : "Order session expired. Use /start to begin again.";
    await ctx.reply(msg);
    return true;
  }

  const trimmed = text.trim();
  const qty = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(qty) || qty <= 0 || !/^\d+$/.test(trimmed)) {
    const msg = lang === "vi"
      ? "[!] Vui lòng nhập một *số*. Ví dụ: `1`, `3`, `5`"
      : "[!] Please enter a *number*. Example: `1`, `3`, `5`";
    await ctx.reply(msg, { parse_mode: "Markdown" });
    return true;
  }

  const max = step === "awaiting_quick_qty" ? QUICK_MAX : CUSTOM_MAX;
  if (qty > max) {
    const msg = lang === "vi"
      ? step === "awaiting_quick_qty"
        ? `[!] Order nhanh tối đa ${QUICK_MAX}/lần. Dùng "Order riêng" cho số lớn hơn.`
        : `[!] Tối đa ${CUSTOM_MAX} proxy/yêu cầu.`
      : step === "awaiting_quick_qty"
        ? `[!] Quick order max ${QUICK_MAX} per order. Use "Custom order" for larger.`
        : `[!] Maximum ${CUSTOM_MAX} proxies per request.`;
    await ctx.reply(msg);
    return true;
  }

  // Wave 24-1 — move to confirm step. Lock proxyType + qty + mode
  // in the conversation state and ask "Xác nhận?". The order is
  // only placed when the user clicks Yes on the inline keyboard.
  const mode = step === "awaiting_quick_qty" ? "quick" : "custom";
  await setBotState(user.id, {
    step: "awaiting_confirm",
    proxyType,
    quantity: qty,
    mode,
  });

  const confirmText = lang === "vi"
    ? [
        "*Xác nhận yêu cầu*",
        "",
        `Loại: *${proxyType.toUpperCase()}*`,
        `Số lượng: *${qty}* proxy`,
        mode === "quick"
          ? "Hình thức: *Order nhanh* (tự động cấp)"
          : "Hình thức: *Order riêng* (admin duyệt)",
        "",
        "Xác nhận?",
      ].join("\n")
    : [
        "*Confirm request*",
        "",
        `Type: *${proxyType.toUpperCase()}*`,
        `Quantity: *${qty}* proxies`,
        mode === "quick"
          ? "Mode: *Quick order* (auto)"
          : "Mode: *Custom order* (admin approval)",
        "",
        "Confirm?",
      ].join("\n");

  const kb = new InlineKeyboard()
    .text(lang === "vi" ? "Xác nhận" : "Confirm", CB.confirm("yes"))
    .text(lang === "vi" ? "Hủy" : "Cancel", CB.confirm("no"));

  await ctx.reply(confirmText, { parse_mode: "Markdown", reply_markup: kb });
  await logChatMessage(
    user.id,
    null,
    ChatDirection.Outgoing,
    confirmText,
    MessageType.Text,
  );
  return true;
}

/**
 * Wave 24-1 — confirm:yes / confirm:no callback. Reads quantity +
 * mode + proxyType from state, then either places the order or
 * cancels. Always clears state at the end.
 */
export async function handleConfirmCallback(
  ctx: Context,
  confirmed: boolean,
): Promise<void> {
  if (!ctx.from) return;

  const { data: user } = await supabaseAdmin
    .from("tele_users")
    .select("id, language")
    .eq("telegram_id", ctx.from.id)
    .single();
  if (!user) return;
  const lang = getUserLanguage(user);

  await ctx.answerCallbackQuery();

  // Re-read the state. We need quantity + mode + proxyType to place.
  const { getBotState } = await import("../state");
  const state = await getBotState(user.id);

  if (state.step !== "awaiting_confirm" || !state.proxyType || !state.quantity || !state.mode) {
    // State drift: another flow / TTL expiry / older deploy.
    // Wave 25-pre3 (Pass 2.B) — pre-fix this was text-only and the
    // user had to remember /getproxy. Now: 1-tap restart button.
    await clearBotState(user.id);
    const msg = lang === "vi"
      ? "Phiên đã hết hạn. Vui lòng bấm bên dưới để bắt đầu lại."
      : "Session expired. Tap below to start again.";
    await ctx.reply(msg, { reply_markup: restartFlowKeyboard(lang, "request") });
    return;
  }

  if (!confirmed) {
    await clearBotState(user.id);
    const msg = lang === "vi" ? "Đã hủy yêu cầu." : "Request cancelled.";
    await ctx.reply(msg);
    await logChatMessage(user.id, null, ChatDirection.Outgoing, msg, MessageType.Text);
    return;
  }

  // Yes — clear state then place the order via the existing path.
  const { proxyType, quantity, mode } = state;
  await clearBotState(user.id);
  await handleQuantitySelection(ctx, proxyType, quantity, mode);
}
