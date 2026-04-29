import type { Context } from "grammy";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserLanguage } from "../user";
import { logChatMessage } from "../logging";
import { ChatDirection, MessageType } from "@/types/database";
import type { BotStep } from "../state";
import { clearBotState } from "../state";
import { handleQuantitySelection } from "./bulk-proxy";

/**
 * Wave 23B-bot UX — handle a number typed by the user while we are
 * in `awaiting_quick_qty` or `awaiting_custom_qty`. Validates the
 * input, clears the state, and hands off to the existing
 * bulk-proxy.handleQuantitySelection flow with the correct mode.
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
      ? "[!] Số không hợp lệ. Nhập một số nguyên dương (ví dụ: 3)."
      : "[!] Invalid number. Please enter a positive integer (e.g. 3).";
    await ctx.reply(msg);
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

  // Clear state BEFORE delegating so a slow downstream step doesn't
  // lock the user in a stale conversation.
  await clearBotState(user.id);

  const mode = step === "awaiting_quick_qty" ? "quick" : "custom";
  await handleQuantitySelection(ctx, proxyType, qty, mode);
  return true;
}
