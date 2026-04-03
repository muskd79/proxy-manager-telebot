import type { Context } from "grammy";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { checkProxy } from "@/lib/proxy-checker";
import { getUserLanguage, logChatMessage } from "../utils";
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

  if (user.status === "blocked" || user.status === "banned") {
    await ctx.reply(lang === "vi" ? "[X] Tai khoan bi chan." : "[X] Account blocked.");
    return;
  }

  const { data: proxies } = await supabaseAdmin
    .from("proxies")
    .select("id, host, port, type")
    .eq("assigned_to", user.id)
    .eq("status", "assigned")
    .eq("is_deleted", false);

  if (!proxies || proxies.length === 0) {
    await ctx.reply(lang === "vi" ? "[i] Ban khong co proxy nao." : "[i] You have no assigned proxies.");
    return;
  }

  await ctx.reply(lang === "vi" ? "Dang kiem tra..." : "Checking...");

  const results: string[] = [];
  for (const proxy of proxies) {
    try {
      const { alive, speed_ms } = await checkProxy(proxy.host, proxy.port, proxy.type);
      const status = alive ? `[OK] ${speed_ms}ms` : "[X] Dead";
      results.push(`${proxy.host}:${proxy.port} (${proxy.type.toUpperCase()}) - ${status}`);
    } catch {
      results.push(`${proxy.host}:${proxy.port} (${proxy.type.toUpperCase()}) - [X] Error`);
    }
  }

  const header = lang === "vi" ? "*Ket qua kiem tra:*" : "*Health check results:*";
  await ctx.reply(`${header}\n\n${results.join("\n")}`, { parse_mode: "Markdown" });

  await logChatMessage(user.id, ctx.message?.message_id ?? null, ChatDirection.Incoming, "/checkproxy", MessageType.Command);
}
