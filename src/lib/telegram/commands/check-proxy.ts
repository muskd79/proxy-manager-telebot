import type { Context } from "grammy";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { checkProxy } from "@/lib/proxy-checker";
import { getUserLanguage } from "../user";
import { logChatMessage } from "../logging";
import { denyIfNotApproved } from "../guards";
import { ChatDirection, MessageType } from "@/types/database";

export async function handleCheckProxy(ctx: Context) {
  const from = ctx.from;
  if (!from) return;

  const { data: user } = await supabaseAdmin
    .from("tele_users")
    .select("id, language, status")
    .eq("telegram_id", from.id)
    .single();

  if (!user) return;
  const lang = getUserLanguage(user);

  // Wave 23B-bot-fix — uniform gate covers pending too.
  if (await denyIfNotApproved(ctx, user, lang)) return;

  const { data: proxies } = await supabaseAdmin
    .from("proxies")
    .select("id, host, port, type")
    .eq("assigned_to", user.id)
    .eq("status", "assigned")
    .eq("is_deleted", false);

  if (!proxies || proxies.length === 0) {
    await ctx.reply(lang === "vi" ? "[i] Bạn không có proxy nào." : "[i] You have no assigned proxies.");
    return;
  }

  await ctx.reply(lang === "vi" ? "Đang kiểm tra..." : "Checking...");

  const results: string[] = [];
  for (const proxy of proxies) {
    try {
      const { alive, speed_ms } = await checkProxy(proxy.host, proxy.port, proxy.type);
      let status: string;
      if (alive) {
        status = `[OK] ${speed_ms}ms`;
      } else if (speed_ms >= 10_000) {
        status = "[X] Timeout";
      } else {
        status = "[X] Refused";
      }
      results.push(`${proxy.host}:${proxy.port} (${proxy.type.toUpperCase()}) - ${status}`);
    } catch {
      results.push(`${proxy.host}:${proxy.port} (${proxy.type.toUpperCase()}) - [!] Error`);
    }
  }

  const header = lang === "vi" ? "*Kết quả kiểm tra:*" : "*Health check results:*";
  await ctx.reply(`${header}\n\n${results.join("\n")}`, { parse_mode: "Markdown" });

  await logChatMessage(user.id, ctx.message?.message_id ?? null, ChatDirection.Incoming, "/checkproxy", MessageType.Command);
}
