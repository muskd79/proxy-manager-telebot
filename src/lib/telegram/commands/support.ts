import type { Context } from "grammy";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserLanguage } from "../user";
import { logChatMessage } from "../logging";
import { ChatDirection, MessageType } from "@/types/database";

export async function handleSupport(ctx: Context) {
  const from = ctx.from;
  if (!from) return;

  const { data: user } = await supabaseAdmin
    .from("tele_users")
    .select("id, language")
    .eq("telegram_id", from.id)
    .single();

  if (!user) {
    await ctx.reply("Please use /start first.");
    return;
  }
  const lang = getUserLanguage(user);

  // Wave 25-pre2 (Pass 4.4) — truthful copy. Pre-fix said "Send any
  // message" + "may take a few minutes" — both untruths. Reality:
  // (a) only text within ~30 min of /support is forwarded to admin
  //     (handlers.ts:362 RECENT_MESSAGE_WINDOW_MS), and
  // (b) reply latency depends entirely on admin availability.
  // Be specific so users don't think the bot is broken.
  const text = lang === "vi"
    ? [
        "*Hỗ trợ*",
        "",
        "Gửi nội dung bạn cần ngay sau khi đọc tin này.",
        "Mọi tin nhắn văn bản trong vòng *30 phút* sẽ được chuyển tới admin.",
        "",
        "Phản hồi thường trong giờ hành chính.",
      ].join("\n")
    : [
        "*Support*",
        "",
        "Send your question right after reading this message.",
        "Any text message within the next *30 minutes* will be forwarded to an admin.",
        "",
        "Replies typically arrive during business hours.",
      ].join("\n");

  await ctx.reply(text, { parse_mode: "Markdown" });
  await logChatMessage(user.id, ctx.message?.message_id ?? null, ChatDirection.Incoming, "/support", MessageType.Command);
}
