import { bot } from "./bot";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ChatDirection, MessageType } from "@/types/database";
import type { SupportedLanguage } from "@/types/telegram";
import {
  handleStart,
  handleHelp,
  handleGetProxy,
  handleMyProxies,
  handleStatus,
  handleLanguage,
  handleProxyTypeSelection,
  handleLanguageSelection,
  handleUnknownCommand,
  handleCancel,
  handleRevoke,
  handleRevokeSelection,
} from "./commands";

// ---------------------------------------------------------------------------
// Register command handlers
// ---------------------------------------------------------------------------

bot.command("start", handleStart);
bot.command("help", handleHelp);
bot.command("getproxy", handleGetProxy);
bot.command("myproxies", handleMyProxies);
bot.command("status", handleStatus);
bot.command("language", handleLanguage);
bot.command("cancel", handleCancel);
bot.command("revoke", handleRevoke);

// ---------------------------------------------------------------------------
// Callback query handler
// ---------------------------------------------------------------------------

bot.on("callback_query:data", async (ctx) => {
  const data = ctx.callbackQuery.data;

  if (data.startsWith("proxy_type:")) {
    const proxyType = data.replace("proxy_type:", "");
    await handleProxyTypeSelection(ctx, proxyType);
    return;
  }

  if (data.startsWith("lang:")) {
    const lang = data.replace("lang:", "") as SupportedLanguage;
    await handleLanguageSelection(ctx, lang);
    return;
  }

  if (data.startsWith("revoke:")) {
    const proxyId = data.replace("revoke:", "");
    await handleRevokeSelection(ctx, proxyId);
    return;
  }

  // Unknown callback
  await ctx.answerCallbackQuery("Unknown action");
});

// ---------------------------------------------------------------------------
// Text message handler (non-command messages)
// ---------------------------------------------------------------------------

bot.on("message:text", async (ctx) => {
  const from = ctx.from;
  if (!from) return;

  // If it starts with "/" it's an unrecognized command
  if (ctx.message.text.startsWith("/")) {
    await handleUnknownCommand(ctx);
    return;
  }

  // Log plain text messages
  const { data: user } = await supabaseAdmin
    .from("tele_users")
    .select("id, language")
    .eq("telegram_id", from.id)
    .single();

  if (!user) return;

  await supabaseAdmin.from("chat_messages").insert({
    tele_user_id: user.id,
    telegram_message_id: ctx.message.message_id,
    direction: ChatDirection.Incoming,
    message_text: ctx.message.text,
    message_type: MessageType.Text,
    raw_data: null,
  });

  // Reply with guidance
  const lang = (user.language as SupportedLanguage) || "en";
  const text =
    lang === "vi"
      ? "Su dung /help de xem cac lenh co san."
      : "Use /help to see available commands.";

  await ctx.reply(text);

  await supabaseAdmin.from("chat_messages").insert({
    tele_user_id: user.id,
    telegram_message_id: null,
    direction: ChatDirection.Outgoing,
    message_text: text,
    message_type: MessageType.Text,
    raw_data: null,
  });
});

// ---------------------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------------------

bot.catch((err) => {
  console.error("Bot error:", err.message);
  console.error("Context:", err.ctx?.update);
});

export { bot };
