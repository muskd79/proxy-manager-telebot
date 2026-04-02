import type { Context } from "grammy";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOrCreateUser, logChatMessage } from "../utils";
import { ChatDirection, MessageType, RequestStatus } from "@/types/database";
import type { SupportedLanguage } from "@/types/telegram";

export async function handleCancel(ctx: Context) {
  const from = ctx.from;
  if (!from) return;

  const user = await getOrCreateUser(ctx);
  if (!user) return;
  const lang = (user.language as SupportedLanguage) || "vi";

  await logChatMessage(
    user.id,
    ctx.message?.message_id ?? null,
    ChatDirection.Incoming,
    "/cancel",
    MessageType.Command
  );

  // Cancel any pending requests
  const { data: pendingRequests } = await supabaseAdmin
    .from("proxy_requests")
    .select("id")
    .eq("tele_user_id", user.id)
    .eq("status", RequestStatus.Pending)
    .eq("is_deleted", false);

  if (pendingRequests && pendingRequests.length > 0) {
    await supabaseAdmin
      .from("proxy_requests")
      .update({ status: "cancelled", processed_at: new Date().toISOString() })
      .in(
        "id",
        pendingRequests.map((r) => r.id)
      );

    const text =
      lang === "vi"
        ? `[OK] \u0110\u00E3 h\u1EE7y ${pendingRequests.length} y\u00EAu c\u1EA7u \u0111ang ch\u1EDD.`
        : `[OK] Cancelled ${pendingRequests.length} pending request(s).`;
    await ctx.reply(text);
    await logChatMessage(
      user.id,
      null,
      ChatDirection.Outgoing,
      text,
      MessageType.Text
    );
  } else {
    const text =
      lang === "vi"
        ? "[i] Kh\u00F4ng c\u00F3 y\u00EAu c\u1EA7u n\u00E0o \u0111ang ch\u1EDD \u0111\u1EC3 h\u1EE7y."
        : "[i] No pending requests to cancel.";
    await ctx.reply(text);
    await logChatMessage(
      user.id,
      null,
      ChatDirection.Outgoing,
      text,
      MessageType.Text
    );
  }
}
