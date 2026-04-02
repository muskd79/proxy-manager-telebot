import type { Context } from "grammy";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SupportedLanguage } from "@/types/telegram";
import {
  ChatDirection,
  MessageType,
  ActorType,
  ApprovalMode,
  ProxyStatus,
  RequestStatus,
  TeleUserStatus,
} from "@/types/database";
import type { ChatMessageInsert, ActivityLogInsert } from "@/types/database";
import { proxyTypeKeyboard, languageKeyboard } from "./keyboard";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const msg = {
  welcome: {
    vi: [
      "\u{1F916} *Proxy Manager Bot*",
      "",
      "Xin ch\u00E0o! Bot gi\u00FAp b\u1EA1n qu\u1EA3n l\u00FD v\u00E0 nh\u1EADn proxy nhanh ch\u00F3ng.",
      "",
      "\u{1F4CB} *C\u00E1c l\u1EC7nh c\u00F3 s\u1EB5n:*",
      "\u{1F680} /getproxy - Y\u00EAu c\u1EA7u proxy m\u1EDBi",
      "\u{1F4E6} /myproxies - Xem proxy c\u1EE7a b\u1EA1n",
      "\u{1F4CA} /status - Tr\u1EA1ng th\u00E1i t\u00E0i kho\u1EA3n",
      "\u{1F310} /language - \u0110\u1ED5i ng\u00F4n ng\u1EEF",
      "\u2753 /help - H\u01B0\u1EDBng d\u1EABn s\u1EED d\u1EE5ng",
    ].join("\n"),
    en: [
      "\u{1F916} *Proxy Manager Bot*",
      "",
      "Hello! This bot helps you manage and receive proxies quickly.",
      "",
      "\u{1F4CB} *Available commands:*",
      "\u{1F680} /getproxy - Request a new proxy",
      "\u{1F4E6} /myproxies - View your proxies",
      "\u{1F4CA} /status - Account status",
      "\u{1F310} /language - Change language",
      "\u2753 /help - Show help",
    ].join("\n"),
  },
  welcomeBack: {
    vi: "\u{1F44B} Ch\u00E0o m\u1EEBng b\u1EA1n quay l\u1EA1i!",
    en: "\u{1F44B} Welcome back!",
  },
  help: {
    vi: [
      "\u2753 *H\u01B0\u1EDBng d\u1EABn s\u1EED d\u1EE5ng*",
      "",
      "\u{1F680} /start - B\u1EAFt \u0111\u1EA7u v\u00E0 \u0111\u0103ng k\u00FD",
      "\u{1F4E5} /getproxy - Y\u00EAu c\u1EA7u proxy m\u1EDBi",
      "\u{1F4E6} /myproxies - Xem danh s\u00E1ch proxy c\u1EE7a b\u1EA1n",
      "\u{1F4CA} /status - Xem tr\u1EA1ng th\u00E1i t\u00E0i kho\u1EA3n",
      "\u{1F310} /language - \u0110\u1ED5i ng\u00F4n ng\u1EEF (Vi\u1EC7t/Anh)",
      "\u2753 /help - Hi\u1EC3n th\u1ECB tr\u1EE3 gi\u00FAp",
      "",
      "\u{1F552} *Gi\u1EDBi h\u1EA1n y\u00EAu c\u1EA7u:*",
      "M\u1ED7i ng\u01B0\u1EDDi d\u00F9ng c\u00F3 gi\u1EDBi h\u1EA1n s\u1ED1 proxy y\u00EAu c\u1EA7u theo gi\u1EDD, theo ng\u00E0y v\u00E0 t\u1ED5ng c\u1ED9ng. D\u00F9ng /status \u0111\u1EC3 xem chi ti\u1EBFt.",
    ].join("\n"),
    en: [
      "\u2753 *Help & Commands*",
      "",
      "\u{1F680} /start - Start and register",
      "\u{1F4E5} /getproxy - Request a new proxy",
      "\u{1F4E6} /myproxies - View your proxies",
      "\u{1F4CA} /status - Account status",
      "\u{1F310} /language - Change language (Vi/En)",
      "\u2753 /help - Show this help",
      "",
      "\u{1F552} *Rate limits:*",
      "Each user has hourly, daily, and total request limits. Use /status to see details.",
    ].join("\n"),
  },
  selectProxyType: {
    vi: "\u{1F4E5} Ch\u1ECDn lo\u1EA1i proxy b\u1EA1n mu\u1ED1n:",
    en: "\u{1F4E5} Select the proxy type you want:",
  },
  rateLimitExceeded: {
    vi: "\u26A0\uFE0F B\u1EA1n \u0111\u00E3 v\u01B0\u1EE3t qu\u00E1 gi\u1EDBi h\u1EA1n y\u00EAu c\u1EA7u. Vui l\u00F2ng th\u1EED l\u1EA1i sau.",
    en: "\u26A0\uFE0F You have exceeded the request limit. Please try again later.",
  },
  noProxyAvailable: {
    vi: "\u274C Hi\u1EC7n t\u1EA1i kh\u00F4ng c\u00F3 proxy n\u00E0o kh\u1EA3 d\u1EE5ng cho lo\u1EA1i n\u00E0y.",
    en: "\u274C No proxy is currently available for this type.",
  },
  proxyAssigned: {
    vi: [
      "\u2705 *Proxy \u0111\u00E3 \u0111\u01B0\u1EE3c c\u1EA5p cho b\u1EA1n:*",
      "",
      "\u{1F4CD} Host: `{host}`",
      "\u{1F6AA} Port: `{port}`",
      "\u{1F3F7}\uFE0F Lo\u1EA1i: `{type}`",
      "\u{1F464} User: `{username}`",
      "\u{1F511} Pass: `{password}`",
      "",
      "\u23F0 H\u1EBFt h\u1EA1n: {expires}",
    ].join("\n"),
    en: [
      "\u2705 *Proxy assigned to you:*",
      "",
      "\u{1F4CD} Host: `{host}`",
      "\u{1F6AA} Port: `{port}`",
      "\u{1F3F7}\uFE0F Type: `{type}`",
      "\u{1F464} User: `{username}`",
      "\u{1F511} Pass: `{password}`",
      "",
      "\u23F0 Expires: {expires}",
    ].join("\n"),
  },
  requestPending: {
    vi: "\u23F3 Y\u00EAu c\u1EA7u c\u1EE7a b\u1EA1n \u0111\u00E3 \u0111\u01B0\u1EE3c t\u1EA1o v\u00E0 \u0111ang ch\u1EDD duy\u1EC7t.\n\u{1F194} ID: `{id}`",
    en: "\u23F3 Your request has been created and is pending approval.\n\u{1F194} ID: `{id}`",
  },
  noProxies: {
    vi: "\u{1F4ED} B\u1EA1n ch\u01B0a \u0111\u01B0\u1EE3c c\u1EA5p proxy n\u00E0o.",
    en: "\u{1F4ED} You have no assigned proxies.",
  },
  accountBlocked: {
    vi: "\u{1F6AB} T\u00E0i kho\u1EA3n c\u1EE7a b\u1EA1n \u0111\u00E3 b\u1ECB kh\u00F3a. Li\u00EAn h\u1EC7 admin \u0111\u1EC3 bi\u1EBFt th\u00EAm.",
    en: "\u{1F6AB} Your account has been blocked. Contact admin for details.",
  },
  languageSelect: {
    vi: "\u{1F310} Ch\u1ECDn ng\u00F4n ng\u1EEF / Select language:",
    en: "\u{1F310} Select language / Ch\u1ECDn ng\u00F4n ng\u1EEF:",
  },
  languageChanged: {
    vi: "\u2705 Ng\u00F4n ng\u1EEF \u0111\u00E3 \u0111\u01B0\u1EE3c \u0111\u1ED5i sang Ti\u1EBFng Vi\u1EC7t.",
    en: "\u2705 Language changed to English.",
  },
  unknownCommand: {
    vi: "\u274C L\u1EC7nh kh\u00F4ng h\u1EE3p l\u1EC7. S\u1EED d\u1EE5ng /help \u0111\u1EC3 xem c\u00E1c l\u1EC7nh.",
    en: "\u274C Unknown command. Use /help to see available commands.",
  },
  maxProxiesReached: {
    vi: "\u26A0\uFE0F B\u1EA1n \u0111\u00E3 \u0111\u1EA1t gi\u1EDBi h\u1EA1n proxy t\u1ED1i \u0111a ({max_proxies}). Kh\u00F4ng th\u1EC3 y\u00EAu c\u1EA7u th\u00EAm.",
    en: "\u26A0\uFE0F You have reached the maximum proxy limit ({max_proxies}). Cannot request more.",
  },
};

function t(key: keyof typeof msg, lang: SupportedLanguage): string {
  return msg[key][lang] || msg[key].en;
}

function fillTemplate(
  template: string,
  vars: Record<string, string>
): string {
  let result = template;
  for (const [k, v] of Object.entries(vars)) {
    result = result.replaceAll(`{${k}}`, v);
  }
  return result;
}

async function getUserLang(telegramId: number): Promise<SupportedLanguage> {
  const { data } = await supabaseAdmin
    .from("tele_users")
    .select("language")
    .eq("telegram_id", telegramId)
    .single();
  return (data?.language as SupportedLanguage) || "en";
}

async function getOrCreateUser(ctx: Context) {
  const from = ctx.from;
  if (!from) return null;

  const { data: existing } = await supabaseAdmin
    .from("tele_users")
    .select("*")
    .eq("telegram_id", from.id)
    .single();

  if (existing) return existing;

  // Create new user
  const { data: newUser, error } = await supabaseAdmin
    .from("tele_users")
    .insert({
      telegram_id: from.id,
      username: from.username ?? null,
      first_name: from.first_name ?? null,
      last_name: from.last_name ?? null,
      phone: null,
      status: TeleUserStatus.Active,
      approval_mode: ApprovalMode.Auto,
      max_proxies: 5,
      rate_limit_hourly: 3,
      rate_limit_daily: 10,
      rate_limit_total: 50,
      proxies_used_hourly: 0,
      proxies_used_daily: 0,
      proxies_used_total: 0,
      hourly_reset_at: null,
      daily_reset_at: null,
      language: "en",
      notes: null,
      is_deleted: false,
      deleted_at: null,
    })
    .select()
    .single();

  if (error) {
    console.error("Error creating tele_user:", error);
    return null;
  }

  // Log activity
  await logActivity({
    actor_type: ActorType.Bot,
    actor_id: null,
    action: "user_registered",
    resource_type: "tele_user",
    resource_id: newUser.id,
    details: { telegram_id: from.id, username: from.username },
    ip_address: null,
    user_agent: null,
  });

  return newUser;
}

async function logChatMessage(
  teleUserId: string,
  messageId: number | null,
  direction: ChatDirection,
  text: string | null,
  messageType: MessageType,
  rawData?: Record<string, unknown> | null
) {
  const insert: ChatMessageInsert = {
    tele_user_id: teleUserId,
    telegram_message_id: messageId,
    direction,
    message_text: text,
    message_type: messageType,
    raw_data: rawData ?? null,
  };
  await supabaseAdmin.from("chat_messages").insert(insert);
}

async function logActivity(log: ActivityLogInsert) {
  await supabaseAdmin.from("activity_logs").insert(log);
}

function checkRateLimit(user: {
  rate_limit_hourly: number;
  rate_limit_daily: number;
  rate_limit_total: number;
  proxies_used_hourly: number;
  proxies_used_daily: number;
  proxies_used_total: number;
  hourly_reset_at: string | null;
  daily_reset_at: string | null;
}): { allowed: boolean; resetHourly: boolean; resetDaily: boolean } {
  const now = new Date();
  let resetHourly = false;
  let resetDaily = false;

  let usedHourly = user.proxies_used_hourly;
  let usedDaily = user.proxies_used_daily;

  if (user.hourly_reset_at && new Date(user.hourly_reset_at) <= now) {
    usedHourly = 0;
    resetHourly = true;
  }
  if (user.daily_reset_at && new Date(user.daily_reset_at) <= now) {
    usedDaily = 0;
    resetDaily = true;
  }

  const allowed =
    usedHourly < user.rate_limit_hourly &&
    usedDaily < user.rate_limit_daily &&
    user.proxies_used_total < user.rate_limit_total;

  return { allowed, resetHourly, resetDaily };
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

export async function handleStart(ctx: Context) {
  const user = await getOrCreateUser(ctx);
  if (!user) return;

  const lang = user.language as SupportedLanguage;
  const isNew = !user.updated_at || user.created_at === user.updated_at;

  // Log incoming
  await logChatMessage(
    user.id,
    ctx.message?.message_id ?? null,
    ChatDirection.Incoming,
    "/start",
    MessageType.Command
  );

  let text: string;
  if (isNew) {
    text = t("welcome", lang);
  } else {
    const statusLabel = lang === "vi" ? "Tr\u1EA1ng th\u00E1i" : "Status";
    const proxyLabel = lang === "vi" ? "Proxy hi\u1EC7n t\u1EA1i" : "Current proxies";
    const { count: proxyCount } = await supabaseAdmin
      .from("proxies")
      .select("*", { count: "exact", head: true })
      .eq("assigned_to", user.id)
      .eq("status", ProxyStatus.Assigned);

    text = [
      t("welcomeBack", lang),
      "",
      `\u{1F4CB} ${statusLabel}: ${user.status}`,
      `\u{1F4E6} ${proxyLabel}: ${proxyCount ?? 0}/${user.max_proxies}`,
    ].join("\n");
  }
  await ctx.reply(text, { parse_mode: "Markdown" });

  // Log outgoing
  await logChatMessage(
    user.id,
    null,
    ChatDirection.Outgoing,
    text,
    MessageType.Text
  );
}

export async function handleHelp(ctx: Context) {
  const lang = await getUserLang(ctx.from?.id ?? 0);
  const user = await getOrCreateUser(ctx);
  if (!user) return;

  await logChatMessage(
    user.id,
    ctx.message?.message_id ?? null,
    ChatDirection.Incoming,
    "/help",
    MessageType.Command
  );

  const text = t("help", lang);
  await ctx.reply(text, { parse_mode: "Markdown" });

  await logChatMessage(
    user.id,
    null,
    ChatDirection.Outgoing,
    text,
    MessageType.Text
  );
}

export async function handleGetProxy(ctx: Context) {
  const user = await getOrCreateUser(ctx);
  if (!user) return;

  const lang = user.language as SupportedLanguage;

  await logChatMessage(
    user.id,
    ctx.message?.message_id ?? null,
    ChatDirection.Incoming,
    "/getproxy",
    MessageType.Command
  );

  // Check blocked
  if (user.status === TeleUserStatus.Blocked || user.status === TeleUserStatus.Banned) {
    const text = t("accountBlocked", lang);
    await ctx.reply(text);
    await logChatMessage(user.id, null, ChatDirection.Outgoing, text, MessageType.Text);
    return;
  }

  // Check rate limit
  const { allowed, resetHourly, resetDaily } = checkRateLimit(user);

  // Reset counters if needed
  if (resetHourly || resetDaily) {
    const updates: Record<string, unknown> = {};
    if (resetHourly) {
      updates.proxies_used_hourly = 0;
      updates.hourly_reset_at = new Date(
        Date.now() + 60 * 60 * 1000
      ).toISOString();
    }
    if (resetDaily) {
      updates.proxies_used_daily = 0;
      updates.daily_reset_at = new Date(
        Date.now() + 24 * 60 * 60 * 1000
      ).toISOString();
    }
    await supabaseAdmin.from("tele_users").update(updates).eq("id", user.id);
  }

  if (!allowed) {
    const text = t("rateLimitExceeded", lang);
    await ctx.reply(text);
    await logChatMessage(user.id, null, ChatDirection.Outgoing, text, MessageType.Text);
    return;
  }

  // Show proxy type selection
  const text = t("selectProxyType", lang);
  await ctx.reply(text, { reply_markup: proxyTypeKeyboard(lang) });
  await logChatMessage(user.id, null, ChatDirection.Outgoing, text, MessageType.Text);
}

export async function handleProxyTypeSelection(
  ctx: Context,
  proxyType: string
) {
  if (!ctx.from) return;

  const { data: user } = await supabaseAdmin
    .from("tele_users")
    .select("*")
    .eq("telegram_id", ctx.from.id)
    .single();

  if (!user) return;

  const lang = user.language as SupportedLanguage;

  await logChatMessage(
    user.id,
    null,
    ChatDirection.Incoming,
    `proxy_type:${proxyType}`,
    MessageType.Callback
  );

  // Re-check rate limit
  const { allowed } = checkRateLimit(user);
  if (!allowed) {
    const text = t("rateLimitExceeded", lang);
    await ctx.answerCallbackQuery(text);
    return;
  }

  // Check max_proxies limit
  const { count: assignedCount } = await supabaseAdmin
    .from("proxies")
    .select("*", { count: "exact", head: true })
    .eq("assigned_to", user.id)
    .eq("status", ProxyStatus.Assigned)
    .eq("is_deleted", false);

  if (assignedCount !== null && assignedCount >= user.max_proxies) {
    const text = fillTemplate(t("maxProxiesReached", lang), {
      max_proxies: String(user.max_proxies),
    });
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(text);
    await logChatMessage(user.id, null, ChatDirection.Outgoing, text, MessageType.Text);
    return;
  }

  if (user.approval_mode === ApprovalMode.Auto) {
    // Auto assign: find available proxy of selected type
    const { data: proxy } = await supabaseAdmin
      .from("proxies")
      .select("*")
      .eq("type", proxyType)
      .eq("status", ProxyStatus.Available)
      .eq("is_deleted", false)
      .limit(1)
      .single();

    if (!proxy) {
      const text = t("noProxyAvailable", lang);
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(text);
      await logChatMessage(user.id, null, ChatDirection.Outgoing, text, MessageType.Text);
      return;
    }

    // Assign proxy
    const expiresAt = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000
    ).toISOString();
    await supabaseAdmin
      .from("proxies")
      .update({
        status: ProxyStatus.Assigned,
        assigned_to: user.id,
        assigned_at: new Date().toISOString(),
        expires_at: expiresAt,
      })
      .eq("id", proxy.id);

    // Create request record
    await supabaseAdmin.from("proxy_requests").insert({
      tele_user_id: user.id,
      proxy_id: proxy.id,
      proxy_type: proxyType as "http" | "https" | "socks5",
      status: RequestStatus.AutoApproved,
      approval_mode: ApprovalMode.Auto,
      requested_at: new Date().toISOString(),
      processed_at: new Date().toISOString(),
      expires_at: expiresAt,
      is_deleted: false,
      deleted_at: null,
      country: null,
      approved_by: null,
      rejected_reason: null,
    });

    // Increment usage
    await supabaseAdmin
      .from("tele_users")
      .update({
        proxies_used_hourly: user.proxies_used_hourly + 1,
        proxies_used_daily: user.proxies_used_daily + 1,
        proxies_used_total: user.proxies_used_total + 1,
        hourly_reset_at:
          user.hourly_reset_at ??
          new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        daily_reset_at:
          user.daily_reset_at ??
          new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      })
      .eq("id", user.id);

    const text = fillTemplate(t("proxyAssigned", lang), {
      host: proxy.host,
      port: String(proxy.port),
      type: proxy.type.toUpperCase(),
      username: proxy.username ?? "N/A",
      password: proxy.password ?? "N/A",
      expires: new Date(expiresAt).toLocaleDateString(),
    });

    await ctx.answerCallbackQuery();
    await ctx.editMessageText(text, { parse_mode: "Markdown" });
    await logChatMessage(user.id, null, ChatDirection.Outgoing, text, MessageType.Text);

    await logActivity({
      actor_type: ActorType.Bot,
      actor_id: null,
      action: "proxy_auto_assigned",
      resource_type: "proxy",
      resource_id: proxy.id,
      details: { tele_user_id: user.id, proxy_type: proxyType },
      ip_address: null,
      user_agent: null,
    });
  } else {
    // Manual mode: create pending request
    const { data: request } = await supabaseAdmin
      .from("proxy_requests")
      .insert({
        tele_user_id: user.id,
        proxy_id: null,
        proxy_type: proxyType as "http" | "https" | "socks5",
        status: RequestStatus.Pending,
        approval_mode: ApprovalMode.Manual,
        requested_at: new Date().toISOString(),
        is_deleted: false,
        deleted_at: null,
        country: null,
        approved_by: null,
        rejected_reason: null,
        processed_at: null,
        expires_at: null,
      })
      .select()
      .single();

    const text = fillTemplate(t("requestPending", lang), {
      id: request?.id ?? "unknown",
    });

    await ctx.answerCallbackQuery();
    await ctx.editMessageText(text);
    await logChatMessage(user.id, null, ChatDirection.Outgoing, text, MessageType.Text);

    await logActivity({
      actor_type: ActorType.TeleUser,
      actor_id: user.id,
      action: "proxy_request_created",
      resource_type: "proxy_request",
      resource_id: request?.id ?? null,
      details: { proxy_type: proxyType },
      ip_address: null,
      user_agent: null,
    });
  }
}

export async function handleMyProxies(ctx: Context) {
  const user = await getOrCreateUser(ctx);
  if (!user) return;

  const lang = user.language as SupportedLanguage;

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
    await logChatMessage(user.id, null, ChatDirection.Outgoing, text, MessageType.Text);
    return;
  }

  const lines = proxies.map((p, i) => {
    const expires = p.expires_at
      ? new Date(p.expires_at).toLocaleDateString()
      : "N/A";
    const expiryLabel = lang === "vi" ? "H\u1EBFt h\u1EA1n" : "Expires";
    return [
      `*${i + 1}.* \`${p.host}:${p.port}\``,
      `   \u{1F3F7}\uFE0F ${p.type.toUpperCase()} | \u23F0 ${expiryLabel}: ${expires}`,
    ].join("\n");
  });

  const header = lang === "vi" ? "\u{1F4E6} *Proxy c\u1EE7a b\u1EA1n:*" : "\u{1F4E6} *Your proxies:*";
  const text = `${header}\n\n${lines.join("\n\n")}`;
  await ctx.reply(text, { parse_mode: "Markdown" });
  await logChatMessage(user.id, null, ChatDirection.Outgoing, text, MessageType.Text);
}

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
    return "\u2588".repeat(filled) + "\u2591".repeat(10 - filled);
  }

  const hBar = progressBar(user.proxies_used_hourly, user.rate_limit_hourly);
  const dBar = progressBar(user.proxies_used_daily, user.rate_limit_daily);
  const tBar = progressBar(user.proxies_used_total, user.rate_limit_total);

  const statusLines =
    lang === "vi"
      ? [
          "\u{1F4CA} *Tr\u1EA1ng th\u00E1i t\u00E0i kho\u1EA3n*",
          "",
          `\u{1F464} Tr\u1EA1ng th\u00E1i: *${user.status}*`,
          `\u2699\uFE0F Ch\u1EBF \u0111\u1ED9 duy\u1EC7t: *${user.approval_mode}*`,
          `\u{1F4E6} Proxy hi\u1EC7n t\u1EA1i: *${proxyCount ?? 0}* / ${user.max_proxies}`,
          "",
          "\u{1F552} *Gi\u1EDBi h\u1EA1n y\u00EAu c\u1EA7u:*",
          `Theo gi\u1EDD: ${hBar} ${user.proxies_used_hourly}/${user.rate_limit_hourly}`,
          `Theo ng\u00E0y: ${dBar} ${user.proxies_used_daily}/${user.rate_limit_daily}`,
          `T\u1ED5ng c\u1ED9ng: ${tBar} ${user.proxies_used_total}/${user.rate_limit_total}`,
        ]
      : [
          "\u{1F4CA} *Account Status*",
          "",
          `\u{1F464} Status: *${user.status}*`,
          `\u2699\uFE0F Approval mode: *${user.approval_mode}*`,
          `\u{1F4E6} Current proxies: *${proxyCount ?? 0}* / ${user.max_proxies}`,
          "",
          "\u{1F552} *Rate limits:*",
          `Hourly:  ${hBar} ${user.proxies_used_hourly}/${user.rate_limit_hourly}`,
          `Daily:   ${dBar} ${user.proxies_used_daily}/${user.rate_limit_daily}`,
          `Total:   ${tBar} ${user.proxies_used_total}/${user.rate_limit_total}`,
        ];

  const text = statusLines.join("\n");
  await ctx.reply(text, { parse_mode: "Markdown" });
  await logChatMessage(user.id, null, ChatDirection.Outgoing, text, MessageType.Text);
}

export async function handleLanguage(ctx: Context) {
  const user = await getOrCreateUser(ctx);
  if (!user) return;

  const lang = user.language as SupportedLanguage;

  await logChatMessage(
    user.id,
    ctx.message?.message_id ?? null,
    ChatDirection.Incoming,
    "/language",
    MessageType.Command
  );

  const text = t("languageSelect", lang);
  await ctx.reply(text, { reply_markup: languageKeyboard() });
  await logChatMessage(user.id, null, ChatDirection.Outgoing, text, MessageType.Text);
}

export async function handleLanguageSelection(
  ctx: Context,
  newLang: SupportedLanguage
) {
  if (!ctx.from) return;

  const { data: user } = await supabaseAdmin
    .from("tele_users")
    .select("*")
    .eq("telegram_id", ctx.from.id)
    .single();

  if (!user) return;

  await logChatMessage(
    user.id,
    null,
    ChatDirection.Incoming,
    `lang:${newLang}`,
    MessageType.Callback
  );

  await supabaseAdmin
    .from("tele_users")
    .update({ language: newLang })
    .eq("id", user.id);

  const text = t("languageChanged", newLang);
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(text);
  await logChatMessage(user.id, null, ChatDirection.Outgoing, text, MessageType.Text);
}

export async function handleUnknownCommand(ctx: Context) {
  const user = await getOrCreateUser(ctx);
  if (!user) return;

  const lang = user.language as SupportedLanguage;

  await logChatMessage(
    user.id,
    ctx.message?.message_id ?? null,
    ChatDirection.Incoming,
    ctx.message?.text ?? null,
    MessageType.Command
  );

  const text = t("unknownCommand", lang);
  await ctx.reply(text);
  await logChatMessage(user.id, null, ChatDirection.Outgoing, text, MessageType.Text);
}
