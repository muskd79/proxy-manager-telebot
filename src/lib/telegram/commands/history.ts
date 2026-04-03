import type { Context } from "grammy";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logChatMessage } from "../utils";
import { ChatDirection, MessageType } from "@/types/database";
import type { SupportedLanguage } from "@/types/telegram";

export async function handleHistory(ctx: Context) {
  const from = ctx.from;
  if (!from) return;

  const { data: user } = await supabaseAdmin
    .from("tele_users")
    .select("id, language")
    .eq("telegram_id", from.id)
    .single();

  if (!user) return;
  const lang = (user.language as SupportedLanguage) || "en";

  const { data: requests } = await supabaseAdmin
    .from("proxy_requests")
    .select("status, proxy_type, created_at, processed_at")
    .eq("tele_user_id", user.id)
    .eq("is_deleted", false)
    .order("created_at", { ascending: false })
    .limit(10);

  if (!requests || requests.length === 0) {
    await ctx.reply(lang === "vi" ? "[i] Chua co yeu cau nao." : "[i] No request history.");
    return;
  }

  const header = lang === "vi" ? "*Lich su yeu cau (10 gan nhat):*" : "*Request history (last 10):*";
  const lines = requests.map((r, i) => {
    const date = new Date(r.created_at).toLocaleDateString();
    const type = r.proxy_type?.toUpperCase() || "ANY";
    const statusMap: Record<string, string> = {
      pending: lang === "vi" ? "Dang cho" : "Pending",
      approved: lang === "vi" ? "Da duyet" : "Approved",
      auto_approved: lang === "vi" ? "Tu dong" : "Auto",
      rejected: lang === "vi" ? "Tu choi" : "Rejected",
      cancelled: lang === "vi" ? "Da huy" : "Cancelled",
    };
    return `${i + 1}. ${type} - ${statusMap[r.status] || r.status} - ${date}`;
  });

  await ctx.reply(`${header}\n\n${lines.join("\n")}`, { parse_mode: "Markdown" });
  await logChatMessage(user.id, ctx.message?.message_id ?? null, ChatDirection.Incoming, "/history", MessageType.Command);
}
