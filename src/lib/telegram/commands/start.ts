import { type Context, Keyboard } from "grammy";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { t } from "../messages";
import { getOrCreateUser, logChatMessage } from "../utils";
import { ChatDirection, MessageType, ProxyStatus } from "@/types/database";
import type { SupportedLanguage } from "@/types/telegram";

export async function handleStart(ctx: Context) {
  const user = await getOrCreateUser(ctx);
  if (!user) return;

  const lang = user.language as SupportedLanguage;
  const isNew = !user.updated_at || user.created_at === user.updated_at;

  // Log incoming
  await logChatMessage(
    user.id,
    ctx.message?.message_id ?? null,
    ChatDirection.Incoming,
    "/start",
    MessageType.Command
  );

  let text: string;
  if (isNew) {
    text = t("welcome", lang);
  } else {
    const statusLabel = lang === "vi" ? "Tr\u1EA1ng th\u00E1i" : "Status";
    const proxyLabel = lang === "vi" ? "Proxy hi\u1EC7n t\u1EA1i" : "Current proxies";
    const { count: proxyCount } = await supabaseAdmin
      .from("proxies")
      .select("*", { count: "exact", head: true })
      .eq("assigned_to", user.id)
      .eq("status", ProxyStatus.Assigned);

    text = [
      t("welcomeBack", lang),
      "",
      `${statusLabel}: ${user.status}`,
      `${proxyLabel}: ${proxyCount ?? 0}/${user.max_proxies}`,
    ].join("\n");
  }
  const menuKeyboard = new Keyboard()
    .text("/getproxy").text("/myproxies").row()
    .text("/status").text("/revoke").row()
    .text("/help").text("/language")
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
