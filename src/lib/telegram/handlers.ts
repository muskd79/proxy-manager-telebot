import { bot } from "./bot";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ChatDirection, MessageType } from "@/types/database";
import type { SupportedLanguage } from "@/types/telegram";
import { captureError } from "@/lib/error-tracking";
import { BOT_COMMANDS } from "@/lib/constants";
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
  handleCheckProxy,
  handleHistory,
  handleSupport,
  handleAdminRequests,
  handleAdminApproveCallback,
  handleAdminRejectCallback,
  handleAdminApproveUser,
  handleAdminBlockUser,
} from "./commands";
import {
  handleQuantitySelection,
  handleAdminBulkApproveCallback,
  handleAdminBulkRejectCallback,
} from "./commands/bulk-proxy";

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
bot.command("checkproxy", handleCheckProxy);
bot.command("history", handleHistory);
bot.command("support", handleSupport);
bot.command("requests", handleAdminRequests);

// ---------------------------------------------------------------------------
// Set bot commands menu (visible in Telegram UI)
// Uses BOT_COMMANDS from constants and registers per-language menus so
// Telegram shows the right descriptions based on the user's app language.
// ---------------------------------------------------------------------------

// Default command list (English) – shown when Telegram language is not Vietnamese
bot.api
  .setMyCommands(
    BOT_COMMANDS.map((c) => ({ command: c.command, description: c.description_en }))
  )
  .catch((err) => captureError(err, { source: "bot.setMyCommands(default)" }));

// Vietnamese-specific command list
bot.api
  .setMyCommands(
    BOT_COMMANDS.map((c) => ({ command: c.command, description: c.description_vi })),
    { language_code: "vi" }
  )
  .catch((err) => captureError(err, { source: "bot.setMyCommands(vi)" }));

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

  if (data.startsWith("admin_approve:")) {
    const requestId = data.replace("admin_approve:", "");
    await handleAdminApproveCallback(ctx, requestId);
    return;
  }

  if (data.startsWith("admin_reject:")) {
    const requestId = data.replace("admin_reject:", "");
    await handleAdminRejectCallback(ctx, requestId);
    return;
  }

  if (data.startsWith("admin_approve_user:")) {
    const userId = data.replace("admin_approve_user:", "");
    await handleAdminApproveUser(ctx, userId);
    return;
  }

  if (data.startsWith("admin_block_user:")) {
    const userId = data.replace("admin_block_user:", "");
    await handleAdminBlockUser(ctx, userId);
    return;
  }

  if (data.startsWith("qty:")) {
    const parts = data.split(":");
    const proxyType = parts[1];
    const quantity = parseInt(parts[2], 10);
    if (proxyType && !isNaN(quantity) && quantity > 0) {
      await handleQuantitySelection(ctx, proxyType, quantity);
    }
    return;
  }

  if (data.startsWith("admin_bulk_approve:")) {
    const requestId = data.replace("admin_bulk_approve:", "");
    await handleAdminBulkApproveCallback(ctx, requestId);
    return;
  }

  if (data.startsWith("admin_bulk_reject:")) {
    const requestId = data.replace("admin_bulk_reject:", "");
    await handleAdminBulkRejectCallback(ctx, requestId);
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
      ? "Sử dụng /help để xem các lệnh có sẵn."
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
  captureError(err, {
    source: "bot.handler",
    extra: { update: err.ctx?.update },
  });
});

export { bot };
