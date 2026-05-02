import type { Context } from "grammy";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOrCreateUser, getUserLanguage } from "../user";
import { logChatMessage } from "../logging";
import { ChatDirection, MessageType, ProxyStatus } from "@/types/database";

export async function handleStatus(ctx: Context) {
  const user = await getOrCreateUser(ctx);
  if (!user) return;

  const lang = getUserLanguage(user);

  await logChatMessage(
    user.id,
    ctx.message?.message_id ?? null,
    ChatDirection.Incoming,
    "/status",
    MessageType.Command
  );

  const { count: proxyCount } = await supabaseAdmin
    .from("proxies")
    .select("*", { count: "exact", head: true })
    .eq("assigned_to", user.id)
    .eq("status", ProxyStatus.Assigned);

  function progressBar(used: number, limit: number): string {
    const filled = Math.min(Math.round((used / limit) * 10), 10);
    return "[" + "#".repeat(filled) + "-".repeat(10 - filled) + "]";
  }

  const hBar = progressBar(user.proxies_used_hourly, user.rate_limit_hourly);
  const dBar = progressBar(user.proxies_used_daily, user.rate_limit_daily);
  const tBar = progressBar(user.proxies_used_total, user.rate_limit_total);

  const statusLines =
    lang === "vi"
      ? [
          "*Trạng thái tài khoản*",
          "",
          `Trạng thái: *${user.status}*`,
          `Chế độ duyệt: *${user.approval_mode}*`,
          `Proxy hiện tại: *${proxyCount ?? 0}* / ${user.max_proxies}`,
          "",
          "*Giới hạn yêu cầu:*",
          `Theo giờ: ${hBar} ${user.proxies_used_hourly}/${user.rate_limit_hourly} (reset mỗi giờ)`,
          `Theo ngày: ${dBar} ${user.proxies_used_daily}/${user.rate_limit_daily} (reset mỗi 24 giờ)`,
          `Tổng cộng: ${tBar} ${user.proxies_used_total}/${user.rate_limit_total} (giới hạn trọn đời)`,
        ]
      : [
          "*Account Status*",
          "",
          `Status: *${user.status}*`,
          `Approval mode: *${user.approval_mode}*`,
          `Current proxies: *${proxyCount ?? 0}* / ${user.max_proxies}`,
          "",
          "*Rate limits:*",
          `Hourly:  ${hBar} ${user.proxies_used_hourly}/${user.rate_limit_hourly} (resets every hour)`,
          `Daily:   ${dBar} ${user.proxies_used_daily}/${user.rate_limit_daily} (resets every 24 hours)`,
          `Total:   ${tBar} ${user.proxies_used_total}/${user.rate_limit_total} (lifetime limit)`,
        ];

  // Add reset time info
  const hourlyReset = user.hourly_reset_at ? new Date(user.hourly_reset_at) : null;
  const dailyReset = user.daily_reset_at ? new Date(user.daily_reset_at) : null;
  const now = new Date();

  if (hourlyReset && hourlyReset > now) {
    const mins = Math.ceil((hourlyReset.getTime() - now.getTime()) / 60000);
    statusLines.push(lang === "vi" ? `Reset theo giờ: ${mins} phút` : `Hourly reset: ${mins} min`);
  }
  if (dailyReset && dailyReset > now) {
    const hours = Math.ceil((dailyReset.getTime() - now.getTime()) / 3600000);
    statusLines.push(lang === "vi" ? `Reset theo ngày: ${hours} giờ` : `Daily reset: ${hours} hrs`);
  }

  const text = statusLines.join("\n");
  await ctx.reply(text, { parse_mode: "Markdown" });
  await logChatMessage(
    user.id,
    null,
    ChatDirection.Outgoing,
    text,
    MessageType.Text
  );
}
