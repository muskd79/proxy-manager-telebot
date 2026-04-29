import type { Context } from "grammy";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { t } from "../messages";
import { getOrCreateUser, getUserLanguage } from "../user";
import { logChatMessage } from "../logging";
import { denyIfNotApproved } from "../guards";
import { ChatDirection, MessageType, ProxyStatus } from "@/types/database";

export async function handleMyProxies(ctx: Context) {
  const user = await getOrCreateUser(ctx);
  if (!user) return;

  const lang = getUserLanguage(user);

  await logChatMessage(
    user.id,
    ctx.message?.message_id ?? null,
    ChatDirection.Incoming,
    "/myproxies",
    MessageType.Command
  );

  // Wave 23B-bot-fix — gate blocked/banned/pending uniformly.
  if (await denyIfNotApproved(ctx, user, lang)) return;

  const { data: proxies } = await supabaseAdmin
    .from("proxies")
    .select("*")
    .eq("assigned_to", user.id)
    .eq("status", ProxyStatus.Assigned)
    .eq("is_deleted", false);

  if (!proxies || proxies.length === 0) {
    const text = t("noProxies", lang);
    await ctx.reply(text);
    await logChatMessage(
      user.id,
      null,
      ChatDirection.Outgoing,
      text,
      MessageType.Text
    );
    return;
  }

  const now = new Date();
  const threeDaysMs = 3 * 24 * 60 * 60 * 1000;

  const lines = proxies.map((p, i) => {
    const expires = p.expires_at
      ? new Date(p.expires_at).toISOString().split("T")[0]
      : "N/A";
    const expiryLabel = lang === "vi" ? "Het han" : "Expires";

    // FIX 5: Format credentials - show "no auth" when empty
    const hasAuth = p.username && p.password;
    const credential = hasAuth
      ? `\`${p.host}:${p.port}:${p.username}:${p.password}\``
      : `\`${p.host}:${p.port}\` (${lang === "vi" ? "khong xac thuc" : "no auth"})`;

    // FIX 12: Expiry warning if within 3 days
    let expiryWarning = "";
    if (p.expires_at) {
      const expiresDate = new Date(p.expires_at);
      if (expiresDate.getTime() - now.getTime() <= threeDaysMs && expiresDate > now) {
        expiryWarning = lang === "vi" ? " [!] Sap het han!" : " [!] Expires soon!";
      }
    }

    return `${i + 1}. ${credential} (${p.type.toUpperCase()}) - ${expiryLabel}: ${expires}${expiryWarning}`;
  });

  const header =
    lang === "vi"
      ? `*Proxy của bạn (${proxies.length}/${user.max_proxies}):*`
      : `*Your proxies (${proxies.length}/${user.max_proxies}):*`;
  const text = `${header}\n\n${lines.join("\n")}`;
  await ctx.reply(text, { parse_mode: "Markdown" });
  await logChatMessage(
    user.id,
    null,
    ChatDirection.Outgoing,
    text,
    MessageType.Text
  );
}
