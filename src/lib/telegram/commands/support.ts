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

  const text = lang === "vi"
    ? [
        "*Ho tro*",
        "",
        "Gui tin nhan bat ky trong chat nay, admin se doc va tra loi.",
        "",
        "Luu y: Admin co the mat vai phut de phan hoi.",
      ].join("\n")
    : [
        "*Support*",
        "",
        "Send any message in this chat and an admin will read and reply.",
        "",
        "Note: Admin may take a few minutes to respond.",
      ].join("\n");

  await ctx.reply(text, { parse_mode: "Markdown" });
  await logChatMessage(user.id, ctx.message?.message_id ?? null, ChatDirection.Incoming, "/support", MessageType.Command);
}
