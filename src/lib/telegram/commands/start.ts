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

  // Always show full welcome with commands
  const { count: proxyCount } = await supabaseAdmin
    .from("proxies")
    .select("*", { count: "exact", head: true })
    .eq("assigned_to", user.id)
    .eq("status", ProxyStatus.Assigned);

  const statusLabel = lang === "vi" ? "Trang thai" : "Status";
  const proxyLabel = lang === "vi" ? "Proxy hien tai" : "Current proxies";
  const greeting = isNew
    ? (lang === "vi" ? "Xin chao! Ban da dang ky thanh cong." : "Hello! You have been registered successfully.")
    : t("welcomeBack", lang);

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
