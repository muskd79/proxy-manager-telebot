import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ChatDirection, MessageType } from "@/types/database";
import type { SupportedLanguage } from "@/types/telegram";
import { logChatMessage } from "../utils";

/**
 * Current AUP version. Bump when the policy text changes — users with an
 * older version in `tele_users.aup_version` will be prompted to re-accept.
 */
export const AUP_VERSION = "v1.0";

/**
 * AUP text (vi/en). Keep short enough to fit a single Telegram message
 * and readable on mobile. Long-form policy lives on a web page; this is
 * the in-bot summary the user must accept.
 */
const AUP_TEXT: Record<SupportedLanguage, string> = {
  vi: [
    "*Điều khoản sử dụng dịch vụ proxy*",
    "",
    "Trước khi dùng bot, vui lòng chấp nhận các cam kết sau:",
    "",
    "1. Không dùng proxy cho spam, lừa đảo, tấn công DDoS, truy cập trái phép.",
    "2. Không dùng proxy để gửi nội dung phi pháp (khiêu dâm trẻ em, khủng bố, v.v.).",
    "3. Không chia sẻ thông tin đăng nhập proxy cho bên thứ ba.",
    "4. Mọi lưu lượng đi qua proxy được log bởi nhà cung cấp upstream và có thể được chia sẻ khi có yêu cầu pháp lý.",
    "5. Vi phạm dẫn đến khoá tài khoản vĩnh viễn và không hoàn tiền.",
    "",
    `Phiên bản: ${AUP_VERSION}`,
  ].join("\n"),
  en: [
    "*Proxy service terms of use*",
    "",
    "Before using this bot, please accept the following commitments:",
    "",
    "1. No spam, fraud, DDoS, or unauthorized access through the proxies.",
    "2. No illegal content (CSAM, terrorism, etc.) transiting the proxies.",
    "3. No sharing of proxy credentials with third parties.",
    "4. All proxy traffic is logged by the upstream provider and may be disclosed on valid legal request.",
    "5. Violations result in permanent account ban with no refund.",
    "",
    `Version: ${AUP_VERSION}`,
  ].join("\n"),
};

/**
 * Send the AUP prompt with Accept/Decline inline buttons. Called from
 * handleStart when the user has not yet accepted the current version.
 */
export async function sendAupPrompt(ctx: Context, lang: SupportedLanguage, userId: string) {
  const text = AUP_TEXT[lang];
  const keyboard = new InlineKeyboard()
    .text(lang === "vi" ? "Chấp nhận" : "Accept", "aup_accept")
    .text(lang === "vi" ? "Từ chối" : "Decline", "aup_decline");

  await ctx.reply(text, { parse_mode: "Markdown", reply_markup: keyboard });
  await logChatMessage(userId, null, ChatDirection.Outgoing, text, MessageType.Text);
}

export async function handleAupAcceptCallback(ctx: Context) {
  await ctx.answerCallbackQuery();
  const from = ctx.from;
  if (!from) return;

  const { data: user } = await supabaseAdmin
    .from("tele_users")
    .select("id, language, aup_accepted_at")
    .eq("telegram_id", from.id)
    .single();
  if (!user) return;

  const lang = (user.language === "vi" ? "vi" : "en") as SupportedLanguage;

  // Idempotent: if already accepted at this version, just move on.
  if (!user.aup_accepted_at) {
    await supabaseAdmin
      .from("tele_users")
      .update({
        aup_accepted_at: new Date().toISOString(),
        aup_version: AUP_VERSION,
      })
      .eq("id", user.id);
  }

  const confirmText = lang === "vi"
    ? "Cảm ơn bạn đã chấp nhận. Tài khoản của bạn đang chờ admin duyệt."
    : "Thanks for accepting. Your account is pending admin approval.";

  await ctx.editMessageText(confirmText);
  await logChatMessage(user.id, null, ChatDirection.Outgoing, confirmText, MessageType.Text);

  // Notify admins now that AUP is accepted (so they don't approve a user
  // who may still decline later).
  const { notifyAllAdmins } = await import("../notify-admins");
  const username = from.username ? `@${from.username}` : from.first_name || "Unknown";
  const notifyText = `[New User] ${username} (ID: ${from.id}) accepted AUP ${AUP_VERSION} and is pending approval.\n\nApprove or block?`;
  const adminKeyboard = new InlineKeyboard()
    .text("Approve", `admin_approve_user:${user.id}`)
    .text("Block", `admin_block_user:${user.id}`);
  notifyAllAdmins(notifyText, { inlineKeyboard: adminKeyboard }).catch(console.error);
}

export async function handleAupDeclineCallback(ctx: Context) {
  await ctx.answerCallbackQuery();
  const from = ctx.from;
  if (!from) return;

  const { data: user } = await supabaseAdmin
    .from("tele_users")
    .select("id, language")
    .eq("telegram_id", from.id)
    .single();
  const lang = (user?.language === "vi" ? "vi" : "en") as SupportedLanguage;

  const declineText = lang === "vi"
    ? "Bạn đã từ chối điều khoản. Bot không thể cấp proxy nếu bạn chưa chấp nhận. Gõ /start để xem lại điều khoản."
    : "You declined the terms. The bot cannot distribute proxies without your acceptance. Send /start to see the terms again.";

  await ctx.editMessageText(declineText);
  if (user) {
    await logChatMessage(user.id, null, ChatDirection.Outgoing, declineText, MessageType.Text);
  }
}
