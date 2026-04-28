import { type Context, Keyboard } from "grammy";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { t } from "../messages";
import { getOrCreateUser, getUserLanguage } from "../user";
import { logChatMessage } from "../logging";
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
  const aupAcceptedAt = (user as unknown as { aup_accepted_at: string | null }).aup_accepted_at;
  const aupVersion = (user as unknown as { aup_version: string | null }).aup_version;
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

    // Admin notification is now triggered by the AUP accept callback, not
    // here, so admins don't approve users who later decline. Old behavior
    // would admin-notify on first /start regardless of AUP status.
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
