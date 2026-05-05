import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { t } from "../messages";
import { getOrCreateUser, getUserLanguage } from "../user";
import { logChatMessage } from "../logging";
import { denyIfNotApproved } from "../guards";
import { safeCredentialString } from "../format";
import { chunkMessage } from "../chunk";
import { ChatDirection, MessageType, ProxyStatus } from "@/types/database";
import { CB } from "../callbacks";

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

  // Wave 28-H — embed category name in /myproxies output so users
  // can tell "US Residential" vs "VN Datacenter" at a glance. Pre-
  // fix the line only had host:port + protocol + expiry; the
  // category was the dimension users actually paid for under the
  // Wave 28 pricing model but it was invisible.
  const { data: proxies } = await supabaseAdmin
    .from("proxies")
    .select("*, category:proxy_categories(name, is_system)")
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
    const expiryLabel = lang === "vi" ? "Hết hạn" : "Expires";

    // FIX 5: Format credentials - show "no auth" when empty.
    // Wave 25-pre1 (P0 3.1) — sanitize backtick chars in host /
    // username / password before embedding in a backtick block,
    // otherwise a credential like `pass`123` breaks Markdown.
    const hasAuth = p.username && p.password;
    const credential = hasAuth
      ? `\`${safeCredentialString(p.host, p.port, p.username, p.password)}\``
      : `\`${safeCredentialString(p.host, p.port)}\` (${lang === "vi" ? "không xác thực" : "no auth"})`;

    // FIX 12: Expiry warning if within 3 days
    let expiryWarning = "";
    if (p.expires_at) {
      const expiresDate = new Date(p.expires_at);
      if (expiresDate.getTime() - now.getTime() <= threeDaysMs && expiresDate > now) {
        expiryWarning = lang === "vi" ? " [!] Sắp hết hạn!" : " [!] Expires soon!";
      }
    }

    // Wave 28-H — show category name (skip when it's the system
    // sentinel "Mặc định" since that's an internal fallback bucket
    // not user-facing). Append on a continuation line so the
    // primary credential line stays scannable + copyable.
    const cat = (
      p as unknown as {
        category?: { name?: string; is_system?: boolean } | null;
      }
    ).category;
    const categoryLine =
      cat && cat.name && !cat.is_system
        ? `\n   ${lang === "vi" ? "Danh mục" : "Category"}: ${cat.name}`
        : "";

    return `${i + 1}. ${credential} (${p.type.toUpperCase()}) - ${expiryLabel}: ${expires}${expiryWarning}${categoryLine}`;
  });

  const header =
    lang === "vi"
      ? `*Proxy của bạn (${proxies.length}/${user.max_proxies}):*`
      : `*Your proxies (${proxies.length}/${user.max_proxies}):*`;
  const text = `${header}\n\n${lines.join("\n")}`;
  // Wave 25-pre4 (Pass 2.1) — split on Telegram's 4096 ceiling.
  // A user with ~80 max_proxies and full credentials easily blew
  // past it; pre-fix the API returned 400 and the user saw silence.
  for (const chunk of chunkMessage(text)) {
    await ctx.reply(chunk, { parse_mode: "Markdown" });
  }

  // Wave 26-D-2B — warranty per-proxy buttons. Posted as a SEPARATE
  // follow-up message so the credential listing above stays clean
  // (and so the chunked-message split above doesn't have to think
  // about reply_markup placement). Telegram allows up to 100 inline
  // rows; even users with 80 max_proxies fit.
  if (proxies.length > 0) {
    const warrantyHeader =
      lang === "vi"
        ? "Proxy nào bị lỗi? Bấm để báo lỗi:"
        : "Which proxy is broken? Tap to report:";
    const kb = new InlineKeyboard();
    proxies.forEach((p, i) => {
      const buttonLabel =
        lang === "vi"
          ? `Báo lỗi #${i + 1}`
          : `Report #${i + 1}`;
      kb.text(buttonLabel, CB.warrantyClaim(p.id)).row();
    });
    await ctx.reply(warrantyHeader, { reply_markup: kb });
  }

  // Wave 25-pre1 (P0 3.9) — mask credentials in audit log. Pre-fix
  // chat_messages stored full host:port:user:pass; if the DB ever
  // leaks (snapshot, debug dump) every proxy credential leaks too.
  // The user's chat already has the message; the audit log just
  // needs to know "user got their proxy list".
  const masked = `${header}\n\n[${proxies.length} proxies — credentials masked in audit log]`;
  await logChatMessage(
    user.id,
    null,
    ChatDirection.Outgoing,
    masked,
    MessageType.Text
  );
}
