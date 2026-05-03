import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOrCreateUser, getUserLanguage } from "../user";
import { logChatMessage } from "../logging";
import { revokeProxy } from "../revoke";
import { denyIfNotApproved } from "../guards";
import { CB } from "../callbacks";
import { ChatDirection, MessageType, ProxyStatus } from "@/types/database";

export async function handleRevoke(ctx: Context) {
  const from = ctx.from;
  if (!from) return;

  const user = await getOrCreateUser(ctx);
  if (!user) return;
  const lang = getUserLanguage(user);

  await logChatMessage(
    user.id,
    ctx.message?.message_id ?? null,
    ChatDirection.Incoming,
    "/revoke",
    MessageType.Command
  );

  // Wave 23B-bot-fix — gate blocked/banned/pending uniformly.
  if (await denyIfNotApproved(ctx, user, lang)) return;

  // Get user's assigned proxies
  const { data: proxies } = await supabaseAdmin
    .from("proxies")
    .select("id, host, port, type")
    .eq("assigned_to", user.id)
    .eq("status", ProxyStatus.Assigned)
    .eq("is_deleted", false);

  if (!proxies || proxies.length === 0) {
    const text =
      lang === "vi"
        ? "[i] B\u1EA1n kh\u00F4ng c\u00F3 proxy n\u00E0o \u0111ang s\u1EED d\u1EE5ng."
        : "[i] You have no assigned proxies.";
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

  if (proxies.length === 1) {
    // Auto revoke the only proxy
    await revokeProxy(proxies[0].id, user.id);
    const text =
      lang === "vi"
        ? `[OK] \u0110\u00E3 tr\u1EA3 proxy \`${proxies[0].host}:${proxies[0].port}\` th\u00E0nh c\u00F4ng.`
        : `[OK] Successfully returned proxy \`${proxies[0].host}:${proxies[0].port}\`.`;
    await ctx.reply(text, { parse_mode: "Markdown" });
    await logChatMessage(
      user.id,
      null,
      ChatDirection.Outgoing,
      text,
      MessageType.Text
    );
  } else {
    // Show inline keyboard to select which proxy to revoke
    const keyboard = new InlineKeyboard();
    proxies.forEach((p) => {
      keyboard
        .text(
          `${p.type.toUpperCase()} ${p.host}:${p.port}`,
          CB.revoke(p.id),
        )
        .row();
    });
    keyboard
      .text(lang === "vi" ? "Tr\u1EA3 t\u1EA5t c\u1EA3" : "Return all", CB.revokeConfirmAll(proxies.length))
      .row();

    const text =
      lang === "vi" ? "Ch\u1ECDn proxy mu\u1ED1n tr\u1EA3:" : "Select proxy to return:";
    await ctx.reply(text, { reply_markup: keyboard });
    await logChatMessage(
      user.id,
      null,
      ChatDirection.Outgoing,
      text,
      MessageType.Text
    );
  }
}

export async function handleRevokeConfirm(ctx: Context, count: string) {
  if (!ctx.from) return;

  const { data: user } = await supabaseAdmin
    .from("tele_users")
    .select("*")
    .eq("telegram_id", ctx.from.id)
    .single();

  if (!user) return;
  const lang = getUserLanguage(user);

  const confirmText = lang === "vi"
    ? `Bạn có chắc không? Hành động này sẽ trả tất cả ${count} proxy.`
    : `Are you sure? This will return ALL ${count} proxies.`;

  const keyboard = new InlineKeyboard()
    .text(lang === "vi" ? "Có" : "Yes", CB.revoke("all"))
    .text(lang === "vi" ? "Không" : "No", CB.revokeCancel());

  await ctx.answerCallbackQuery();
  await ctx.editMessageText(confirmText, { reply_markup: keyboard });
}

export async function handleRevokeSelection(ctx: Context, proxyId: string) {
  if (!ctx.from) return;

  const { data: user } = await supabaseAdmin
    .from("tele_users")
    .select("*")
    .eq("telegram_id", ctx.from.id)
    .single();

  if (!user) return;
  const lang = getUserLanguage(user);

  await logChatMessage(
    user.id,
    null,
    ChatDirection.Incoming,
    `revoke:${proxyId}`,
    MessageType.Callback
  );

  if (proxyId === "all") {
    // Revoke all assigned proxies
    const { data: proxies } = await supabaseAdmin
      .from("proxies")
      .select("id, host, port")
      .eq("assigned_to", user.id)
      .eq("status", ProxyStatus.Assigned)
      .eq("is_deleted", false);

    if (!proxies || proxies.length === 0) {
      await ctx.answerCallbackQuery(
        lang === "vi"
          ? "Kh\u00F4ng c\u00F3 proxy n\u00E0o \u0111\u1EC3 tr\u1EA3."
          : "No proxies to return."
      );
      return;
    }

    // Wave 25-pre1 (P0 7.2) \u2014 count successful revokes. Pre-fix loop
    // ignored the boolean return; if RPC fail (DB hiccup) the user
    // saw "\u0111\u00E3 tr\u1EA3 th\u00E0nh c\u00F4ng" while the proxy is still assigned.
    // Now Promise.allSettled in parallel + count truthy returns +
    // surface the failed count.
    const results = await Promise.allSettled(
      proxies.map((p) => revokeProxy(p.id, user.id)),
    );
    const okCount = results.filter(
      (r) => r.status === "fulfilled" && r.value === true,
    ).length;
    const failedCount = proxies.length - okCount;

    const text =
      lang === "vi"
        ? failedCount === 0
          ? `[OK] \u0110\u00E3 tr\u1EA3 t\u1EA5t c\u1EA3 ${okCount} proxy th\u00E0nh c\u00F4ng.`
          : `[OK] \u0110\u00E3 tr\u1EA3 ${okCount}/${proxies.length} proxy. ${failedCount} th\u1EA5t b\u1EA1i \u2014 vui l\u00F2ng th\u1EED l\u1EA1i.`
        : failedCount === 0
          ? `[OK] Successfully returned all ${okCount} proxies.`
          : `[OK] Returned ${okCount}/${proxies.length}. ${failedCount} failed \u2014 please retry.`;
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(text);
    await logChatMessage(
      user.id,
      null,
      ChatDirection.Outgoing,
      text,
      MessageType.Text
    );
  } else {
    // Revoke a specific proxy - verify it belongs to this user
    const { data: proxy } = await supabaseAdmin
      .from("proxies")
      .select("id, host, port")
      .eq("id", proxyId)
      .eq("assigned_to", user.id)
      .eq("status", ProxyStatus.Assigned)
      .single();

    if (!proxy) {
      await ctx.answerCallbackQuery(
        lang === "vi" ? "Proxy kh\u00F4ng h\u1EE3p l\u1EC7." : "Invalid proxy."
      );
      return;
    }

    // Wave 25-pre1 (P0 7.4) \u2014 single revoke also need to honor the
    // RPC return. If false the proxy is still assigned (RPC race
    // with cron expiry, DB error). Show user a retry hint instead
    // of lying with "\u0111\u00E3 tr\u1EA3 th\u00E0nh c\u00F4ng".
    const ok = await revokeProxy(proxy.id, user.id);

    const text = ok
      ? lang === "vi"
        ? `[OK] \u0110\u00E3 tr\u1EA3 proxy \`${proxy.host}:${proxy.port}\` th\u00E0nh c\u00F4ng.`
        : `[OK] Successfully returned proxy \`${proxy.host}:${proxy.port}\`.`
      : lang === "vi"
        ? `[X] Tr\u1EA3 proxy \`${proxy.host}:${proxy.port}\` th\u1EA5t b\u1EA1i \u2014 vui l\u00F2ng th\u1EED l\u1EA1i.`
        : `[X] Failed to return proxy \`${proxy.host}:${proxy.port}\` \u2014 please retry.`;
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(text, { parse_mode: "Markdown" });
    await logChatMessage(
      user.id,
      null,
      ChatDirection.Outgoing,
      text,
      MessageType.Text
    );
  }
}
