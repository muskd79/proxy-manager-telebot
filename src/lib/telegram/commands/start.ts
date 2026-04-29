import type { Context } from "grammy";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { t } from "../messages";
import { getOrCreateUser, getUserLanguage } from "../user";
import { logChatMessage } from "../logging";
import { mainMenuKeyboard } from "../keyboard";
import { ChatDirection, MessageType, ProxyStatus } from "@/types/database";
import { AUP_VERSION, sendAupPrompt } from "./aup";

export async function handleStart(ctx: Context) {
  const user = await getOrCreateUser(ctx);
  if (!user) return;

  const lang = getUserLanguage(user);
  const isNew = !user.updated_at || user.created_at === user.updated_at;

  // Log incoming
  await logChatMessage(
    user.id,
    ctx.message?.message_id ?? null,
    ChatDirection.Incoming,
    "/start",
    MessageType.Command
  );

  // AUP gate: required by every proxy vendor's reseller ToS. User must
  // explicitly accept before we distribute any proxy. Re-prompt if the
  // stored acceptance is for an older AUP version than the current one.
  const aupAcceptedAt = user.aup_accepted_at;
  const aupVersion = user.aup_version;
  if (!aupAcceptedAt || aupVersion !== AUP_VERSION) {
    await sendAupPrompt(ctx, lang, user.id);
    return;
  }

  // If user is new or pending, show limited message
  if (isNew || user.status === "pending") {
    const pendingText = lang === "vi"
      ? [
          "*Proxy Manager Bot*",
          "",
          "Xin chao! Ban da dang ky thanh cong.",
          "",
          "[i] Tai khoan cua ban dang cho admin duyet. Ban se duoc thong bao khi duoc phe duyet.",
          "",
          "/support - Ho tro",
          "/language - Doi ngon ngu",
        ].join("\n")
      : [
          "*Proxy Manager Bot*",
          "",
          "Hello! You have been registered successfully.",
          "",
          "[i] Your account is pending admin approval. You will be notified when approved.",
          "",
          "/support - Contact support",
          "/language - Change language",
        ].join("\n");

    // Wave 23B-bot — drop the persistent reply Keyboard. We pass
    // remove_keyboard so any old reply keyboard from a previous build
    // is cleared on the user's client. The native bot menu (left of
    // the file-attach button) still exposes the slash commands via
    // setMyCommands.
    await ctx.reply(pendingText, {
      parse_mode: "Markdown",
      reply_markup: { remove_keyboard: true },
    });

    // Log outgoing
    await logChatMessage(
      user.id,
      null,
      ChatDirection.Outgoing,
      pendingText,
      MessageType.Text
    );

    // Admin notification is now triggered by the AUP accept callback, not
    // here, so admins don't approve users who later decline. Old behavior
    // would admin-notify on first /start regardless of AUP status.
    return;
  }

  // Wave 23B-bot — blocked users get a clear "account blocked"
  // message + only the /support button. Pre-fix the welcome was
  // identical to active users with status="blocked" buried in the
  // body, so a banned user could still see the menu and try to
  // request proxies (handlers would reject downstream, bad UX).
  if (user.status === "blocked" || user.status === "banned") {
    const blockedText = lang === "vi"
      ? [
          "*Proxy Manager Bot*",
          "",
          "Tài khoản của bạn hiện đang bị khoá / chặn.",
          "Mọi yêu cầu proxy sẽ bị từ chối.",
          "",
          "Trạng thái: *blocked*",
          "Liên hệ admin qua /support nếu cần khiếu nại.",
        ].join("\n")
      : [
          "*Proxy Manager Bot*",
          "",
          "Your account is currently blocked.",
          "All proxy requests will be rejected.",
          "",
          "Status: *blocked*",
          "Use /support to contact an admin if you want to appeal.",
        ].join("\n");
    await ctx.reply(blockedText, {
      parse_mode: "Markdown",
      reply_markup: { remove_keyboard: true },
    });
    await logChatMessage(
      user.id,
      null,
      ChatDirection.Outgoing,
      blockedText,
      MessageType.Text,
    );
    return;
  }

  // Active user: show full welcome with commands
  const { count: proxyCount } = await supabaseAdmin
    .from("proxies")
    .select("*", { count: "exact", head: true })
    .eq("assigned_to", user.id)
    .eq("status", ProxyStatus.Assigned);

  // Wave 23B-bot — short welcome card. The previous build dumped 11
  // slash-commands into the message body AND rendered a persistent
  // reply Keyboard with another 8 commands, so the same actions
  // appeared three times (text list + reply keyboard + native bot
  // menu). New layout shows 1 short status block + the inline
  // mainMenuKeyboard. Native bot menu (left of upload) still works.
  const proxyLabel = lang === "vi" ? "Proxy hien tai" : "Current proxies";
  const greeting = t("welcomeBack", lang);

  const text = [
    "*Proxy Manager Bot*",
    "",
    greeting,
    "",
    `${proxyLabel}: *${proxyCount ?? 0}*/${user.max_proxies}`,
  ].join("\n");

  // Two replies: first clears any legacy persistent reply keyboard
  // from older builds (one-shot, invisible to users on fresh installs).
  // Second carries the inline menu. Telegram doesn't allow combining
  // remove_keyboard with an InlineKeyboard in a single message.
  await ctx.reply(text, {
    parse_mode: "Markdown",
    reply_markup: { remove_keyboard: true },
  });
  await ctx.reply(lang === "vi" ? "Chon chuc nang ben duoi:" : "Pick an action:", {
    reply_markup: mainMenuKeyboard(lang),
  });

  // Log outgoing
  await logChatMessage(
    user.id,
    null,
    ChatDirection.Outgoing,
    text,
    MessageType.Text
  );

}
