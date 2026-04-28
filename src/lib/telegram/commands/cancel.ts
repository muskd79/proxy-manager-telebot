import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOrCreateUser, getUserLanguage } from "../user";
import { logChatMessage } from "../logging";
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
        ? "[i] Khong co yeu cau nao dang cho de huy."
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
  const header = lang === "vi" ? "*Yeu cau dang cho:*" : "*Pending requests:*";
  const lines = pendingRequests.map((r, i) => {
    const type = r.proxy_type?.toUpperCase() || "ANY";
    const date = new Date(r.created_at).toISOString().split("T")[0];
    return `${i + 1}. ${type} - ${date}`;
  });

  const confirmLabel = lang === "vi" ? "Huy tat ca?" : "Cancel all?";
  const text = `${header}\n\n${lines.join("\n")}\n\n${confirmLabel}`;

  const keyboard = new InlineKeyboard()
    .text(lang === "vi" ? "Co" : "Yes", "cancel_confirm:yes")
    .text(lang === "vi" ? "Khong" : "No", "cancel_confirm:no");

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
    await ctx.editMessageText(lang === "vi" ? "Da huy." : "Cancelled.");
    return;
  }

  const { data: pendingRequests } = await supabaseAdmin
    .from("proxy_requests")
    .select("id")
    .eq("tele_user_id", user.id)
    .eq("status", RequestStatus.Pending)
    .eq("is_deleted", false);

  if (!pendingRequests || pendingRequests.length === 0) {
    await ctx.editMessageText(lang === "vi" ? "[i] Khong co yeu cau nao dang cho." : "[i] No pending requests.");
    return;
  }

  await supabaseAdmin
    .from("proxy_requests")
    .update({ status: "cancelled", processed_at: new Date().toISOString() })
    .in("id", pendingRequests.map((r) => r.id));

  const text =
    lang === "vi"
      ? `[OK] Da huy ${pendingRequests.length} yeu cau dang cho.`
      : `[OK] Cancelled ${pendingRequests.length} pending request(s).`;
  await ctx.editMessageText(text);
  await logChatMessage(
    user.id,
    null,
    ChatDirection.Outgoing,
    text,
    MessageType.Text
  );
}
