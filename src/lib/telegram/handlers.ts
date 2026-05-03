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
import { getBotStateWithExpiry, clearBotState } from "./state";
import type { BotStep, BotState } from "./state";
import type { Context } from "grammy";
import { parseCallback } from "./callbacks";
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

  // Wave 25-pre3 (Pass 5.2) — parse the wire string into a typed
  // discriminated union, then switch on `kind`. Pre-fix this was a
  // 200-line if-ladder of `data.startsWith(...)` checks. Adding a
  // Wave 26 vendor / payment / kyc callback now means: add one
  // member to `CallbackData` in callbacks.ts, then TypeScript
  // exhaustiveness forces a new `case` here.
  //
  // Backward compat: `parseCallback` accepts `menu:warranty` (legacy
  // alias for `menu:return`) and the 2-arg `qty:<type>:<n>` shape so
  // already-rendered keyboards in user chat history keep working.
  const parsed = parseCallback(data);

  if (!parsed) {
    await ctx.answerCallbackQuery("Unknown action");
    return;
  }

  switch (parsed.kind) {
    // -----------------------------------------------------------------
    // Main menu — call the same handler the slash-command would.
    // -----------------------------------------------------------------
    case "menu": {
      await ctx.answerCallbackQuery();
      switch (parsed.action) {
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
          // Wave 25-pre2 (P0 1.1) — label "Trả proxy" routes to revoke
          // flow until Wave 26 ships real warranty schema.
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

    // -----------------------------------------------------------------
    // Proxy type selection
    // -----------------------------------------------------------------
    case "type":
      await handleProxyTypeSelection(ctx, parsed.proxyType);
      return;

    case "typeCancel":
      // Existing behaviour: handleProxyTypeSelection treats "cancel"
      // as a special string that triggers the cancel reply path.
      await handleProxyTypeSelection(ctx, "cancel");
      return;

    // -----------------------------------------------------------------
    // Order mode chooser (Order nhanh / Order riêng)
    // -----------------------------------------------------------------
    case "order":
      await handleOrderModeSelection(ctx, parsed.proxyType, parsed.mode);
      return;

    case "orderCancel":
      await ctx.answerCallbackQuery();
      await ctx.reply("Đã hủy.");
      return;

    // -----------------------------------------------------------------
    // Quantity selection / cancel
    // -----------------------------------------------------------------
    case "qty":
      await handleQuantitySelection(
        ctx,
        parsed.proxyType,
        parsed.quantity,
        parsed.mode,
      );
      return;

    case "qtyCancel": {
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

    // -----------------------------------------------------------------
    // Confirm step (after qty input)
    // -----------------------------------------------------------------
    case "confirm":
      await handleConfirmCallback(ctx, parsed.result === "yes");
      return;

    // -----------------------------------------------------------------
    // /checkproxy paste-list cancel
    // -----------------------------------------------------------------
    case "checkCancel": {
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

    // -----------------------------------------------------------------
    // Language change
    // -----------------------------------------------------------------
    case "lang":
      await handleLanguageSelection(ctx, parsed.lang as SupportedLanguage);
      return;

    // -----------------------------------------------------------------
    // /cancel confirm dialog
    // -----------------------------------------------------------------
    case "cancelConfirm":
      await handleCancelConfirm(ctx, parsed.result === "yes");
      return;

    // -----------------------------------------------------------------
    // /revoke confirm-all + selection + cancel
    // -----------------------------------------------------------------
    case "revokeConfirmAll":
      await handleRevokeConfirm(ctx, parsed.count);
      return;

    case "revokeCancel": {
      await ctx.answerCallbackQuery();
      const { data: user } = await supabaseAdmin
        .from("tele_users")
        .select("language")
        .eq("telegram_id", ctx.from?.id ?? 0)
        .single();
      const lang = user?.language === "vi" ? "vi" : "en";
      await ctx.editMessageText(lang === "vi" ? "Đã hủy." : "Cancelled.");
      return;
    }

    case "revoke":
      await handleRevokeSelection(ctx, parsed.target);
      return;

    // -----------------------------------------------------------------
    // Admin actions on requests + users
    // -----------------------------------------------------------------
    case "admin":
      switch (parsed.action) {
        case "approve":
          await handleAdminApproveCallback(ctx, parsed.targetId);
          return;
        case "reject":
          await handleAdminRejectCallback(ctx, parsed.targetId);
          return;
        case "approve_user":
          await handleAdminApproveUser(ctx, parsed.targetId);
          return;
        case "block_user":
          await handleAdminBlockUser(ctx, parsed.targetId);
          return;
        case "bulk_approve":
          await handleAdminBulkApproveCallback(ctx, parsed.targetId);
          return;
        case "bulk_reject":
          await handleAdminBulkRejectCallback(ctx, parsed.targetId);
          return;
      }
      return;
  }
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
/**
 * Narrowed-state handler: each entry receives ONLY the union member
 * matching its key, so `state.proxyType` etc. are typed correctly
 * without a runtime guard. The lookup at the call site casts the
 * incoming `BotState` to the narrowed shape — safe because the
 * dispatch is keyed by `state.step`.
 */
type StateTextHandlerFor<S extends BotStep> = (
  ctx: Context,
  state: Extract<BotState, { step: S }>,
  text: string,
) => Promise<boolean>;

type StateTextHandlers = {
  [K in BotStep]: StateTextHandlerFor<K>;
};

const STATE_TEXT_HANDLERS: StateTextHandlers = {
  idle: async () => false,
  awaiting_quick_qty: (ctx, state, text) =>
    handleQtyTextInput(ctx, "awaiting_quick_qty", state.proxyType, text),
  awaiting_custom_qty: (ctx, state, text) =>
    handleQtyTextInput(ctx, "awaiting_custom_qty", state.proxyType, text),
  awaiting_confirm: async () => false,
  awaiting_check_list: (ctx, _state, text) => handleCheckListInput(ctx, text),
};

/**
 * Type-safe dispatch helper: forwards `state` to the right handler
 * with the right narrowed type. The single `as never` cast is the
 * boundary between the runtime dispatch (which only knows
 * `state.step`) and the per-step typed handlers; callers don't see
 * any `any`/`as` themselves.
 */
async function dispatchStateTextHandler(
  ctx: Context,
  state: BotState,
  text: string,
): Promise<boolean> {
  const handler = STATE_TEXT_HANDLERS[state.step];
  return (handler as StateTextHandlerFor<BotStep>)(ctx, state as never, text);
}

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
  // Wave 25-pre4 — `state` is now a typed discriminated union; the
  // `dispatchStateTextHandler` helper carries the per-step narrowing.
  // Pass 2.3 — when the read just expired, surface a recovery hint
  // before falling through to the /support/help generic fallback.
  const { state, expired } = await getBotStateWithExpiry(user.id);

  if (expired) {
    const expiredMsg = lang === "vi"
      ? "Phiên trước đã hết hạn (30 phút). Bấm /getproxy hoặc /checkproxy để bắt đầu lại."
      : "Your previous session expired (30 minutes). Use /getproxy or /checkproxy to start again.";
    await ctx.reply(expiredMsg);
    return;
  }

  const consumed = await dispatchStateTextHandler(ctx, state, ctx.message.text);
  if (consumed) return;

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
