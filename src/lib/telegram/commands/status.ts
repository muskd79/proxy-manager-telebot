// markdown-escape: opt-out — Wave 25-pre4 audit: every Markdown
// interpolation in this file is a Markdown-safe value (enum strings
// for status/approval_mode, integers for counts/limits/percentages,
// pre-formatted bar strings of `[#-]`). No user-controlled data is
// interpolated. If a future addition introduces user-facing strings
// (e.g. `user.first_name`), import escapeMarkdown and remove this
// opt-out.
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
    // Wave 25-pre1 (P0 5.1) — admin can set rate_limit_*=0 which used
    // to throw RangeError("Invalid count value") via NaN.repeat().
    // Treat zero/negative limit as "no quota" → render as full empty.
    if (!Number.isFinite(limit) || limit <= 0) {
      return "[----------]";
    }
    const safeUsed = Number.isFinite(used) && used > 0 ? used : 0;
    const filled = Math.min(Math.round((safeUsed / limit) * 10), 10);
    return "[" + "#".repeat(filled) + "-".repeat(10 - filled) + "]";
  }

  // Wave 25-pre2 (Pass 6.A) — lead with the percentage so a screen
  // reader (or a fast-scanning human) gets the meaningful number FIRST,
  // before the bar-art "open square pound pound dash dash...". Falls
  // back to "—%" when limit ≤ 0 (admin-disabled quota).
  function pct(used: number, limit: number): string {
    if (!Number.isFinite(limit) || limit <= 0) return "—%";
    const safeUsed = Number.isFinite(used) && used > 0 ? used : 0;
    return `${Math.min(100, Math.round((safeUsed / limit) * 100))}%`;
  }

  // Wave 25-pre3 (Pass 2.2) — quota state hint. Pre-fix the bar
  // `[----------]` was ambiguous: limit=0 (admin disabled) vs
  // used=limit (exhausted) both rendered as full empty. Now append
  // the cause so the user knows whether to retry later or contact
  // admin.
  function quotaState(used: number, limit: number, lng: "vi" | "en"): string {
    if (!Number.isFinite(limit) || limit <= 0) {
      return lng === "vi" ? " (không khả dụng)" : " (disabled)";
    }
    const safeUsed = Number.isFinite(used) && used > 0 ? used : 0;
    if (safeUsed >= limit) {
      return lng === "vi" ? " (đã hết quota)" : " (quota exhausted)";
    }
    return "";
  }

  const hBar = progressBar(user.proxies_used_hourly, user.rate_limit_hourly);
  const dBar = progressBar(user.proxies_used_daily, user.rate_limit_daily);
  const tBar = progressBar(user.proxies_used_total, user.rate_limit_total);
  const hPct = pct(user.proxies_used_hourly, user.rate_limit_hourly);
  const dPct = pct(user.proxies_used_daily, user.rate_limit_daily);
  const tPct = pct(user.proxies_used_total, user.rate_limit_total);
  const hState = quotaState(user.proxies_used_hourly, user.rate_limit_hourly, lang);
  const dState = quotaState(user.proxies_used_daily, user.rate_limit_daily, lang);
  const tState = quotaState(user.proxies_used_total, user.rate_limit_total, lang);

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
          `Theo giờ: ${hPct} ${hBar} ${user.proxies_used_hourly}/${user.rate_limit_hourly}${hState} (reset mỗi giờ)`,
          `Theo ngày: ${dPct} ${dBar} ${user.proxies_used_daily}/${user.rate_limit_daily}${dState} (reset mỗi 24 giờ)`,
          `Tổng cộng: ${tPct} ${tBar} ${user.proxies_used_total}/${user.rate_limit_total}${tState} (giới hạn trọn đời)`,
        ]
      : [
          "*Account Status*",
          "",
          `Status: *${user.status}*`,
          `Approval mode: *${user.approval_mode}*`,
          `Current proxies: *${proxyCount ?? 0}* / ${user.max_proxies}`,
          "",
          "*Rate limits:*",
          `Hourly: ${hPct} ${hBar} ${user.proxies_used_hourly}/${user.rate_limit_hourly}${hState} (resets every hour)`,
          `Daily:  ${dPct} ${dBar} ${user.proxies_used_daily}/${user.rate_limit_daily}${dState} (resets every 24 hours)`,
          `Total:  ${tPct} ${tBar} ${user.proxies_used_total}/${user.rate_limit_total}${tState} (lifetime limit)`,
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
