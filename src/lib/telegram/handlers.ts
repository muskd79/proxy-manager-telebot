import { bot } from "./bot";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ChatDirection, MessageType } from "@/types/database";
import type { SupportedLanguage } from "@/types/telegram";
import { captureError } from "@/lib/error-tracking";
import { BOT_COMMANDS, RECENT_MESSAGE_WINDOW_MS } from "@/lib/constants";
import { getOrCreateUser, getUserLanguage } from "./user";
import { denyIfNotApproved } from "./guards";
import {
  handleStart,
  handleHelp,
  handleGetProxy,
  handleMyProxies,
  handleStatus,
  handleLanguage,
  handleProxyTypeSelection,
  handleOrderModeSelection,
  handleLanguageSelection,
  handleUnknownCommand,
  handleCancel,
  handleCancelConfirm,
  handleRevoke,
  handleRevokeConfirm,
  handleRevokeSelection,
  handleCheckProxy,
  handleHistory,
  handleSupport,
  handleAdminRequests,
  handleAdminApproveCallback,
  handleAdminRejectCallback,
  handleAdminApproveUser,
  handleAdminBlockUser,
  handleQtyTextInput,
  handleConfirmCallback,
  handleCheckListInput,
} from "./commands";
import { getBotState, clearBotState } from "./state";
import type { BotStep, BotState } from "./state";
import type { Context } from "grammy";
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

  // Wave 23B-bot — main inline menu dispatcher. Each button calls
  // the same command handler that the slash command would, after
  // first answering the callback so Telegram clears the spinner.
  if (data.startsWith("menu:")) {
    const action = data.slice(5);
    await ctx.answerCallbackQuery();
    switch (action) {
      case "request":
        await handleGetProxy(ctx);
        return;
      case "my":
        await handleMyProxies(ctx);
        return;
      case "check":
        await handleCheckProxy(ctx);
        return;
      case "limit":
        await handleStatus(ctx);
        return;
      case "return":
        // Wave 25-pre2 (P0 1.1) — renamed from `case "warranty"`.
        // Pre-25 the label said "Bảo hành proxy" / "Warranty claim"
        // but ran the revoke flow — confusing two distinct mental
        // models. New label says "Trả proxy" / "Return proxy" so
        // behaviour matches name. Real warranty schema is tracked
        // in docs/decision-log.md#warranty-schema (Wave 26).
        await handleRevoke(ctx);
        return;
      case "history":
        await handleHistory(ctx);
        return;
      case "help":
        await handleHelp(ctx);
        return;
      case "language":
        await handleLanguage(ctx);
        return;
    }
    return;
  }

  // Wave 23C-fix — AUP callbacks removed per user request 2026-04-29
  // ("bỏ đoạn chấp nhận chính sách đi"). The aup.ts file remains in
  // the tree but no callback path can reach it; legacy users with a
  // stored aup_accepted_at column simply ignore it now.

  if (data.startsWith("proxy_type:")) {
    const proxyType = data.replace("proxy_type:", "");
    await handleProxyTypeSelection(ctx, proxyType);
    return;
  }

  // Wave 23B-bot UX — order-type chooser. Order nhanh (auto) vs
  // Order riêng (admin-approval). After selection, show the
  // matching quantity keyboard.
  if (data.startsWith("order_quick:")) {
    const proxyType = data.replace("order_quick:", "");
    await handleOrderModeSelection(ctx, proxyType, "quick");
    return;
  }
  if (data.startsWith("order_custom:")) {
    const proxyType = data.replace("order_custom:", "");
    await handleOrderModeSelection(ctx, proxyType, "custom");
    return;
  }
  if (data === "order_type:cancel") {
    await ctx.answerCallbackQuery();
    await ctx.reply("Đã hủy.");
    return;
  }

  // Wave 24-1 — confirm step after qty input. Yes = place the order,
  // No = clear state + reply cancelled.
  if (data === "confirm:yes" || data === "confirm:no") {
    await handleConfirmCallback(ctx, data === "confirm:yes");
    return;
  }

  // Wave 24-checkproxy — Hủy from the awaiting_check_list prompt.
  // Clears state + acknowledges so the user knows the bot is no
  // longer waiting for their paste.
  if (data === "check:cancel") {
    await ctx.answerCallbackQuery();
    if (ctx.from) {
      const { data: u } = await supabaseAdmin
        .from("tele_users")
        .select("id")
        .eq("telegram_id", ctx.from.id)
        .single();
      if (u) await clearBotState(u.id);
    }
    await ctx.reply("Đã hủy.");
    return;
  }

  if (data.startsWith("lang:")) {
    const lang = data.replace("lang:", "") as SupportedLanguage;
    await handleLanguageSelection(ctx, lang);
    return;
  }

  if (data.startsWith("cancel_confirm:")) {
    const confirmed = data.replace("cancel_confirm:", "") === "yes";
    await handleCancelConfirm(ctx, confirmed);
    return;
  }

  if (data.startsWith("revoke_confirm:all:")) {
    const count = data.split(":")[2];
    await handleRevokeConfirm(ctx, count);
    return;
  }

  if (data === "revoke:cancel") {
    await ctx.answerCallbackQuery();
    const { data: user } = await supabaseAdmin
      .from("tele_users")
      .select("language")
      .eq("telegram_id", ctx.from.id)
      .single();
    const lang = (user?.language === "vi") ? "vi" : "en";
    await ctx.editMessageText(lang === "vi" ? "Đã hủy." : "Cancelled.");
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

  // Wave 23B-bot UX — qty:cancel from the text-input prompt clears
  // the conversation state and replies. The qty:<mode>:<type>:<n>
  // shape is no longer produced by the bot but kept as a legacy
  // fallback for in-flight clicks from older clients.
  if (data === "qty:cancel" || data === "qty:quick:cancel" || data === "qty:custom:cancel") {
    await ctx.answerCallbackQuery();
    if (ctx.from) {
      const { data: u } = await supabaseAdmin
        .from("tele_users")
        .select("id")
        .eq("telegram_id", ctx.from.id)
        .single();
      if (u) await clearBotState(u.id);
    }
    // Wave 25-pre2 (P0 5.4) — diacritic spelling unified to "hủy"
    // (matches the rest of the codebase; was "huỷ" only here).
    await ctx.reply("Đã hủy.");
    return;
  }
  if (data.startsWith("qty:")) {
    const parts = data.split(":");
    let mode: "quick" | "custom";
    let proxyType: string;
    let quantity: number;
    if (parts[1] === "quick" || parts[1] === "custom") {
      mode = parts[1];
      proxyType = parts[2];
      quantity = parseInt(parts[3], 10);
    } else {
      mode = "quick";
      proxyType = parts[1];
      quantity = parseInt(parts[2], 10);
    }
    if (proxyType && !isNaN(quantity) && quantity > 0) {
      await handleQuantitySelection(ctx, proxyType, quantity, mode);
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
// Wave 25-pre3 (Pass 2.A) — state-handler dispatch table.
//
// Pre-fix the message:text handler had a cascade of `if (state.step
// === "X")` checks. Each new conversation state added a new branch.
// Wave 26 will introduce more states (payment_proof, renewal_choice,
// kyc_id, etc.) and the cascade would balloon.
//
// Now the dispatch table maps each BotStep to a handler that returns
// `true` if it consumed the message (caller should `return`). Adding
// a new state in pre-4 (or Wave 26) is one new entry here, not a new
// `if` branch in the message:text body.
//
// `idle` and `awaiting_confirm` return false because:
//   - idle: no state-aware action; fall through to /support / /help logic
//   - awaiting_confirm: user is supposed to click Yes/No callback, not
//     type. If they DO type, ignore + fall through.
// ---------------------------------------------------------------------------
type StateTextHandler = (
  ctx: Context,
  state: BotState,
  text: string,
) => Promise<boolean>;

const STATE_TEXT_HANDLERS: Record<BotStep, StateTextHandler> = {
  idle: async () => false,
  awaiting_quick_qty: (ctx, state, text) =>
    handleQtyTextInput(ctx, "awaiting_quick_qty", state.proxyType, text),
  awaiting_custom_qty: (ctx, state, text) =>
    handleQtyTextInput(ctx, "awaiting_custom_qty", state.proxyType, text),
  awaiting_confirm: async () => false,
  awaiting_check_list: (ctx, _state, text) => handleCheckListInput(ctx, text),
};

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

  // Wave 23D — VIA-style "every message must reply" guarantee.
  //
  // Pre-fix `if (!user) return;` left brand-new users (who type
  // text BEFORE /start) in silence. Now we use getOrCreateUser so
  // the row is created and the new-user welcome path can engage.
  // Source: docs/BOT_RESPONSE_GAP_2026-05-02.md case #12 (P0).
  const user = await getOrCreateUser(ctx);
  if (!user) return; // unreachable in practice — only fails on DB outage

  const lang = getUserLanguage(user);

  // Wave 23D — blocked / banned / pending users must NOT receive a
  // chatty reply that tells them the bot is alive and what /help
  // does. Hand off to the same denyIfNotApproved guard the proxy
  // commands use. Source: gap doc case #14 (P1).
  if (await denyIfNotApproved(ctx, user, lang)) return;

  // Wave 25-pre3 (Pass 2.A) — dispatch via STATE_TEXT_HANDLERS table.
  // Pre-fix this was a cascade of two `if` blocks; new states required
  // a new branch each. Now adding a state = adding a row to the table.
  const state = await getBotState(user.id);
  const stateHandler = STATE_TEXT_HANDLERS[state.step];
  if (stateHandler) {
    const consumed = await stateHandler(ctx, state, ctx.message.text);
    if (consumed) return;
  }

  await supabaseAdmin.from("chat_messages").insert({
    tele_user_id: user.id,
    telegram_message_id: ctx.message.message_id,
    direction: ChatDirection.Incoming,
    message_text: ctx.message.text,
    message_type: MessageType.Text,
    raw_data: null,
  });

  // Check if the user's last command was /support (within last 30 minutes)
  const { data: lastSupportCmd } = await supabaseAdmin
    .from("chat_messages")
    .select("created_at")
    .eq("tele_user_id", user.id)
    .eq("direction", ChatDirection.Incoming)
    .eq("message_text", "/support")
    .eq("message_type", MessageType.Command)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  const thirtyMinAgo = new Date(Date.now() - RECENT_MESSAGE_WINDOW_MS).toISOString();
  const isSupportMode = lastSupportCmd && lastSupportCmd.created_at > thirtyMinAgo;

  // Reply with appropriate response
  const text = isSupportMode
    ? (lang === "vi"
        ? "Tin nhắn đã nhận. Admin sẽ phản hồi sớm."
        : "Message received. Admin will respond soon.")
    : (lang === "vi"
        ? "Sử dụng /help để xem các lệnh có sẵn."
        : "Use /help to see available commands.");

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
// Wave 23D — Unsupported media handler
//
// Telegram users can send photo / video / voice / sticker / document /
// animation / location / contact / poll. Pre-fix grammy router didn't
// match any of these, so the bot was completely silent — violating the
// "every message must have a response" requirement. Port the VIA bot
// pattern: log the incoming message description, then reply with a
// "text only please" hint that respects user language + approval gate.
// Source: docs/BOT_RESPONSE_GAP_2026-05-02.md case #15, #16 (P0).
// ---------------------------------------------------------------------------

bot.on(
  [
    "message:photo",
    "message:document",
    "message:sticker",
    "message:voice",
    "message:video",
    "message:video_note",
    "message:animation",
    "message:audio",
    "message:location",
    "message:contact",
    "message:poll",
  ],
  async (ctx) => {
    if (!ctx.from) return;
    const user = await getOrCreateUser(ctx);
    if (!user) return;
    const lang = getUserLanguage(user);
    if (await denyIfNotApproved(ctx, user, lang)) return;

    // Build a short [Kind] / [File name] / [Sticker emoji] description
    // for the audit log so admins can see what the user actually sent.
    const m = ctx.message;
    const incomingDesc =
      m?.photo ? "[Photo]"
      : m?.document ? `[File] ${m.document.file_name ?? ""}`
      : m?.sticker ? `[Sticker] ${m.sticker.emoji ?? ""}`
      : m?.voice ? `[Voice] ${m.voice.duration ?? 0}s`
      : m?.video ? "[Video]"
      : m?.video_note ? "[Video note]"
      : m?.animation ? "[Animation]"
      : m?.audio ? "[Audio]"
      : m?.location ? "[Location]"
      : m?.contact ? "[Contact]"
      : m?.poll ? "[Poll]"
      : "[Unsupported]";

    await supabaseAdmin.from("chat_messages").insert({
      tele_user_id: user.id,
      telegram_message_id: m?.message_id ?? null,
      direction: ChatDirection.Incoming,
      message_text: incomingDesc,
      message_type: MessageType.Text,
      raw_data: null,
    });

    const reply = lang === "vi"
      ? "Bot chỉ hỗ trợ tin nhắn dạng văn bản. Gửi /help để xem các lệnh có sẵn."
      : "This bot only supports text messages. Send /help to see available commands.";
    await ctx.reply(reply);

    await supabaseAdmin.from("chat_messages").insert({
      tele_user_id: user.id,
      telegram_message_id: null,
      direction: ChatDirection.Outgoing,
      message_text: reply,
      message_type: MessageType.Text,
      raw_data: null,
    });
  },
);

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
