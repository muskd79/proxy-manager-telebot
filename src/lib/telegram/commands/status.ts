import type { Context } from "grammy";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOrCreateUser, getUserLanguage, logChatMessage } from "../utils";
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
          "*Trang thai tai khoan*",
          "",
          `Trang thai: *${user.status}*`,
          `Che do duyet: *${user.approval_mode}*`,
          `Proxy hien tai: *${proxyCount ?? 0}* / ${user.max_proxies}`,
          "",
          "*Gioi han yeu cau:*",
          `Theo gio: ${hBar} ${user.proxies_used_hourly}/${user.rate_limit_hourly} (reset moi gio)`,
          `Theo ngay: ${dBar} ${user.proxies_used_daily}/${user.rate_limit_daily} (reset moi 24 gio)`,
          `Tong cong: ${tBar} ${user.proxies_used_total}/${user.rate_limit_total} (gioi han tron doi)`,
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
    statusLines.push(lang === "vi" ? `Reset theo gio: ${mins} phut` : `Hourly reset: ${mins} min`);
  }
  if (dailyReset && dailyReset > now) {
    const hours = Math.ceil((dailyReset.getTime() - now.getTime()) / 3600000);
    statusLines.push(lang === "vi" ? `Reset theo ngay: ${hours} gio` : `Daily reset: ${hours} hrs`);
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
