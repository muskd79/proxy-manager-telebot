import type { Context } from "grammy";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { t } from "../messages";
import { getOrCreateUser, getUserLanguage, logChatMessage } from "../utils";
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

  const lines = proxies.map((p, i) => {
    const expires = p.expires_at
      ? new Date(p.expires_at).toLocaleDateString()
      : "N/A";
    const expiryLabel = lang === "vi" ? "Hết hạn" : "Expires";
    return `${i + 1}. \`${p.host}:${p.port}:${p.username ?? ""}:${p.password ?? ""}\` (${p.type.toUpperCase()}) - ${expiryLabel}: ${expires}`;
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
