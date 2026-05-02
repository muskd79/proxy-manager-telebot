import type { Context } from "grammy";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserLanguage } from "../user";
import { logChatMessage } from "../logging";
import { ChatDirection, MessageType } from "@/types/database";

export async function handleHistory(ctx: Context) {
  const from = ctx.from;
  if (!from) return;

  const { data: user } = await supabaseAdmin
    .from("tele_users")
    .select("id, language")
    .eq("telegram_id", from.id)
    .single();

  if (!user) return;
  const lang = getUserLanguage(user);

  const { data: requests } = await supabaseAdmin
    .from("proxy_requests")
    .select("id, status, proxy_type, created_at, processed_at")
    .eq("tele_user_id", user.id)
    .eq("is_deleted", false)
    .order("created_at", { ascending: false })
    .limit(10);

  if (!requests || requests.length === 0) {
    await ctx.reply(lang === "vi" ? "[i] Chưa có yêu cầu nào." : "[i] No request history.");
    return;
  }

  const header = lang === "vi" ? "*Lịch sử yêu cầu (10 gần nhất):*" : "*Request history (last 10):*";
  const lines = requests.map((r, i) => {
    const date = new Date(r.created_at).toISOString().split("T")[0];
    const type = r.proxy_type?.toUpperCase() || "ANY";
    const shortId = r.id ? r.id.substring(0, 8) : "--------";
    const statusMap: Record<string, string> = {
      pending: lang === "vi" ? "Đang chờ" : "Pending",
      approved: lang === "vi" ? "Đã duyệt" : "Approved",
      auto_approved: lang === "vi" ? "Tự động" : "Auto",
      rejected: lang === "vi" ? "Từ chối" : "Rejected",
      cancelled: lang === "vi" ? "Đã hủy" : "Cancelled",
    };
    return `${i + 1}. ${type} - ${statusMap[r.status] || r.status} - ${date} (ID: ${shortId})`;
  });

  await ctx.reply(`${header}\n\n${lines.join("\n")}`, { parse_mode: "Markdown" });
  await logChatMessage(user.id, ctx.message?.message_id ?? null, ChatDirection.Incoming, "/history", MessageType.Command);
}
