import type { Context } from "grammy";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOrCreateUser, logChatMessage } from "../utils";
import { ChatDirection, MessageType, ProxyStatus } from "@/types/database";
import type { SupportedLanguage } from "@/types/telegram";

export async function handleStatus(ctx: Context) {
  const user = await getOrCreateUser(ctx);
  if (!user) return;

  const lang = user.language as SupportedLanguage;

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
          "*Tr\u1EA1ng th\u00E1i t\u00E0i kho\u1EA3n*",
          "",
          `Tr\u1EA1ng th\u00E1i: *${user.status}*`,
          `Ch\u1EBF \u0111\u1ED9 duy\u1EC7t: *${user.approval_mode}*`,
          `Proxy hi\u1EC7n t\u1EA1i: *${proxyCount ?? 0}* / ${user.max_proxies}`,
          "",
          "*Gi\u1EDBi h\u1EA1n y\u00EAu c\u1EA7u:*",
          `Theo gi\u1EDD: ${hBar} ${user.proxies_used_hourly}/${user.rate_limit_hourly}`,
          `Theo ng\u00E0y: ${dBar} ${user.proxies_used_daily}/${user.rate_limit_daily}`,
          `T\u1ED5ng c\u1ED9ng: ${tBar} ${user.proxies_used_total}/${user.rate_limit_total}`,
        ]
      : [
          "*Account Status*",
          "",
          `Status: *${user.status}*`,
          `Approval mode: *${user.approval_mode}*`,
          `Current proxies: *${proxyCount ?? 0}* / ${user.max_proxies}`,
          "",
          "*Rate limits:*",
          `Hourly:  ${hBar} ${user.proxies_used_hourly}/${user.rate_limit_hourly}`,
          `Daily:   ${dBar} ${user.proxies_used_daily}/${user.rate_limit_daily}`,
          `Total:   ${tBar} ${user.proxies_used_total}/${user.rate_limit_total}`,
        ];

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
