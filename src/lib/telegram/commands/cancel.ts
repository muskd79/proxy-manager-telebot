// markdown-escape: opt-out — Wave 25-pre4 audit: only ISO date
// strings, proxy type enum, and integer counts are interpolated in
// the Markdown payload. No user-supplied free-form string.
import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOrCreateUser, getUserLanguage } from "../user";
import { logChatMessage } from "../logging";
import { clearBotState } from "../state";
import { CB } from "../callbacks";
import { ChatDirection, MessageType, RequestStatus } from "@/types/database";

export async function handleCancel(ctx: Context) {
  const from = ctx.from;
  if (!from) return;

  const user = await getOrCreateUser(ctx);
  if (!user) return;
  const lang = getUserLanguage(user);

  await logChatMessage(
    user.id,
    ctx.message?.message_id ?? null,
    ChatDirection.Incoming,
    "/cancel",
    MessageType.Command
  );

  // Wave 23D — also clear conversation state. Pre-fix /cancel only
  // dropped pending DB requests; if the user was mid-flow (e.g.
  // awaiting_quick_qty) the state survived and the next text message
  // got eaten by the qty-input handler. VIA bot pattern.
  await clearBotState(user.id);

  // Fetch pending requests with details
  const { data: pendingRequests } = await supabaseAdmin
    .from("proxy_requests")
    .select("id, proxy_type, created_at")
    .eq("tele_user_id", user.id)
    .eq("status", RequestStatus.Pending)
    .eq("is_deleted", false)
    .order("created_at", { ascending: true });

  if (!pendingRequests || pendingRequests.length === 0) {
    const text =
      lang === "vi"
        ? "[i] Không có yêu cầu nào đang chờ để hủy."
        : "[i] No pending requests to cancel.";
    await ctx.reply(text);
    await logChatMessage(
      user.id,
      null,
      ChatDirection.Outgoing,
      text,
      MessageType.Text
    );
    return;
  }

  // Show pending requests list with confirmation
  const header = lang === "vi" ? "*Yêu cầu đang chờ:*" : "*Pending requests:*";
  const lines = pendingRequests.map((r, i) => {
    const type = r.proxy_type?.toUpperCase() || "ANY";
    const date = new Date(r.created_at).toISOString().split("T")[0];
    return `${i + 1}. ${type} - ${date}`;
  });

  const confirmLabel = lang === "vi" ? "Hủy tất cả?" : "Cancel all?";
  const text = `${header}\n\n${lines.join("\n")}\n\n${confirmLabel}`;

  const keyboard = new InlineKeyboard()
    .text(lang === "vi" ? "Có" : "Yes", CB.cancelConfirm("yes"))
    .text(lang === "vi" ? "Không" : "No", CB.cancelConfirm("no"));

  await ctx.reply(text, { parse_mode: "Markdown", reply_markup: keyboard });
  await logChatMessage(
    user.id,
    null,
    ChatDirection.Outgoing,
    text,
    MessageType.Text
  );
}

export async function handleCancelConfirm(ctx: Context, confirmed: boolean) {
  if (!ctx.from) return;

  const { data: user } = await supabaseAdmin
    .from("tele_users")
    .select("id, language")
    .eq("telegram_id", ctx.from.id)
    .single();

  if (!user) return;
  const lang = (user.language === "vi" || user.language === "en") ? user.language : "en";

  await ctx.answerCallbackQuery();

  if (!confirmed) {
    await ctx.editMessageText(lang === "vi" ? "Đã hủy." : "Cancelled.");
    return;
  }

  const { data: pendingRequests } = await supabaseAdmin
    .from("proxy_requests")
    .select("id")
    .eq("tele_user_id", user.id)
    .eq("status", RequestStatus.Pending)
    .eq("is_deleted", false);

  if (!pendingRequests || pendingRequests.length === 0) {
    await ctx.editMessageText(lang === "vi" ? "[i] Không có yêu cầu nào đang chờ." : "[i] No pending requests.");
    return;
  }

  // Phase 1B (B-008) — race fix. Pre-fix UPDATE didn't filter
  // status=pending; if admin approved a request between our SELECT
  // and UPDATE, we'd flip the now-approved row back to cancelled
  // and orphan the proxy already delivered. Add the filter so the
  // UPDATE only touches rows that are STILL pending — others slip
  // through silently which is the correct outcome.
  const { data: cancelled } = await supabaseAdmin
    .from("proxy_requests")
    .update({ status: "cancelled", processed_at: new Date().toISOString() })
    .in("id", pendingRequests.map((r) => r.id))
    .eq("status", RequestStatus.Pending)
    .select("id");
  const cancelledCount = cancelled?.length ?? 0;

  const text =
    lang === "vi"
      ? `[OK] Đã hủy ${cancelledCount} yêu cầu đang chờ.`
      : `[OK] Cancelled ${cancelledCount} pending request(s).`;
  await ctx.editMessageText(text);
  await logChatMessage(
    user.id,
    null,
    ChatDirection.Outgoing,
    text,
    MessageType.Text
  );
}
