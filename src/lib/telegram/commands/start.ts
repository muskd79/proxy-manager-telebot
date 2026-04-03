import { type Context, Keyboard } from "grammy";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { t } from "../messages";
import { getOrCreateUser, getUserLanguage, logChatMessage } from "../utils";
import { ChatDirection, MessageType, ProxyStatus } from "@/types/database";

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

    const pendingKeyboard = new Keyboard()
      .text("/support").text("/language")
      .resized()
      .persistent();

    await ctx.reply(pendingText, {
      parse_mode: "Markdown",
      reply_markup: pendingKeyboard,
    });

    // Log outgoing
    await logChatMessage(
      user.id,
      null,
      ChatDirection.Outgoing,
      pendingText,
      MessageType.Text
    );

    // Notify admins about new user registration
    if (isNew) {
      const { notifyAllAdmins } = await import("../notify-admins");
      const { InlineKeyboard } = await import("grammy");

      const username = user.username ? `@${user.username}` : user.first_name || "Unknown";
      const notifyText = `[New User] ${username} (ID: ${user.telegram_id}) registered.\n\nApprove or block?`;

      const keyboard = new InlineKeyboard()
        .text("Approve", `admin_approve_user:${user.id}`)
        .text("Block", `admin_block_user:${user.id}`);

      notifyAllAdmins(notifyText, { inlineKeyboard: keyboard }).catch(console.error);
    }
    return;
  }

  // Active user: show full welcome with commands
  const { count: proxyCount } = await supabaseAdmin
    .from("proxies")
    .select("*", { count: "exact", head: true })
    .eq("assigned_to", user.id)
    .eq("status", ProxyStatus.Assigned);

  const statusLabel = lang === "vi" ? "Trang thai" : "Status";
  const proxyLabel = lang === "vi" ? "Proxy hien tai" : "Current proxies";
  const greeting = t("welcomeBack", lang);

  const text = [
    "*Proxy Manager Bot*",
    "",
    greeting,
    "",
    `${statusLabel}: *${user.status}*`,
    `${proxyLabel}: *${proxyCount ?? 0}*/${user.max_proxies}`,
    "",
    lang === "vi" ? "*Cac lenh co san:*" : "*Available commands:*",
    "/getproxy - " + (lang === "vi" ? "Yeu cau proxy" : "Request proxy"),
    "/myproxies - " + (lang === "vi" ? "Xem proxy" : "View proxies"),
    "/checkproxy - " + (lang === "vi" ? "Kiem tra proxy" : "Check health"),
    "/status - " + (lang === "vi" ? "Trang thai" : "Status"),
    "/help - " + (lang === "vi" ? "Huong dan" : "Help"),
  ].join("\n");
  const menuKeyboard = new Keyboard()
    .text("/getproxy").text("/myproxies").row()
    .text("/checkproxy").text("/status").row()
    .text("/history").text("/revoke").row()
    .text("/support").text("/help")
    .resized()
    .persistent();

  await ctx.reply(text, {
    parse_mode: "Markdown",
    reply_markup: menuKeyboard,
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
