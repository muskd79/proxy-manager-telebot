import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { t } from "../messages";
import { getOrCreateUser, getUserLanguage } from "../user";
import { logChatMessage } from "../logging";
import { mainMenuKeyboard } from "../keyboard";
import { notifyAllAdmins } from "../notify-admins";
import { escapeMarkdown } from "../format";
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

  // Wave 23C-fix — AUP gate removed per user request 2026-04-29
  // ("bỏ đoạn chấp nhận chính sách đi"). User now lands directly
  // in the pending-approval welcome (or active welcome if already
  // approved). Admin notification moved here so it fires the first
  // time we see a brand-new pending user — replaces the old
  // AUP-accept-callback notify path.
  if (isNew && user.status === "pending") {
    const username = ctx.from?.username
      ? `@${ctx.from.username}`
      : ctx.from?.first_name || "Unknown";
    const adminText = `[New User] ${username} (ID: ${ctx.from?.id ?? user.telegram_id}) registered and is pending approval.\n\nApprove or block?`;
    const adminKb = new InlineKeyboard()
      .text("Approve", `admin_approve_user:${user.id}`)
      .text("Block", `admin_block_user:${user.id}`);
    notifyAllAdmins(adminText, { inlineKeyboard: adminKb }).catch((e) =>
      console.error("notify-admins on first /start failed:", e instanceof Error ? e.message : String(e)),
    );
  }

  // If user is new or pending, show limited message
  if (isNew || user.status === "pending") {
    const pendingText = lang === "vi"
      ? [
          "*Proxy Manager Bot*",
          "",
          "Xin chào! Bạn đã đăng ký thành công.",
          "",
          "[i] Tài khoản của bạn đang chờ admin duyệt. Bạn sẽ được thông báo khi được phê duyệt.",
          "",
          "/support - Hỗ trợ",
          "/language - Đổi ngôn ngữ",
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

    // Wave 23C-fix — admin notification fires earlier in this same
    // handler when isNew && pending. The old AUP-callback notify
    // path is removed.
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

  // Wave 23B-bot UX (per user spec 2026-04-29) — single welcome
  // card with greeting, bot purpose, available-proxy count, and the
  // inline mainMenuKeyboard. Pre-fix used 2 messages + a slash
  // dump; the user wanted one clean welcome message instead.
  //
  // proxyCount here is the AVAILABLE pool (status='available'), not
  // the user's own assigned ones, because the welcome shows market
  // depth ("21 proxy sẵn sàng") not personal inventory.
  const { count: availableProxies } = await supabaseAdmin
    .from("proxies")
    .select("*", { count: "exact", head: true })
    .eq("status", ProxyStatus.Available)
    .eq("is_deleted", false);

  // Wave 25-pre1 (P0 1.1) — escape Markdown special chars in user
  // first_name. Pre-fix a Telegram name like "*bold*" or "[bracket]"
  // broke the welcome with 400 "can't parse entities".
  const rawFirstName = ctx.from?.first_name?.trim() || user.first_name || "";
  const firstName = escapeMarkdown(rawFirstName);

  // Wave 25-pre2 (Pass 4.5) — zero-pool contingency. When the
  // available pool is 0 a literal "0 proxy sẵn sàng" reads as
  // "the bot is broken." Append a softer line so user knows it's
  // a stocking issue, not a bug.
  const poolCount = availableProxies ?? 0;
  const zeroPoolHint = poolCount === 0
    ? (lang === "vi"
      ? "\n_Đang nạp thêm proxy — vui lòng quay lại sau ít phút._"
      : "\n_Restocking proxies — please come back in a few minutes._")
    : "";

  const text = lang === "vi"
    ? [
        firstName ? `Xin chào *${firstName}*!` : "Xin chào!",
        "",
        "*Proxy Bot*",
        "Bot hỗ trợ yêu cầu và quản lý proxy.",
        `Hiện có *${poolCount}* proxy sẵn sàng.${zeroPoolHint}`,
        "",
        "Chọn chức năng bên dưới:",
      ].join("\n")
    : [
        firstName ? `Hello *${firstName}*!` : "Hello!",
        "",
        "*Proxy Bot*",
        "Bot for requesting and managing proxies.",
        `*${poolCount}* proxies available.${zeroPoolHint}`,
        "",
        "Pick an action below:",
      ].join("\n");

  await ctx.reply(text, {
    parse_mode: "Markdown",
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
