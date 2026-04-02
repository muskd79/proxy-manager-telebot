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
    vi: "Chao mung ban den voi Proxy Manager Bot!\n\nSu dung /help de xem cac lenh co san.",
    en: "Welcome to Proxy Manager Bot!\n\nUse /help to see available commands.",
  },
  welcomeBack: {
    vi: "Chao mung ban quay lai!",
    en: "Welcome back!",
  },
  help: {
    vi: [
      "Cac lenh co san:",
      "/start - Bat dau va dang ky",
      "/getproxy - Yeu cau proxy moi",
      "/myproxies - Xem proxy cua ban",
      "/status - Trang thai tai khoan",
      "/language - Doi ngon ngu",
      "/help - Hien thi tro giup",
    ].join("\n"),
    en: [
      "Available commands:",
      "/start - Start and register",
      "/getproxy - Request a new proxy",
      "/myproxies - View your proxies",
      "/status - Account status",
      "/language - Change language",
      "/help - Show help",
    ].join("\n"),
  },
  selectProxyType: {
    vi: "Chon loai proxy ban muon:",
    en: "Select the proxy type you want:",
  },
  rateLimitExceeded: {
    vi: "Ban da vuot qua gioi han yeu cau. Vui long thu lai sau.",
    en: "You have exceeded the request limit. Please try again later.",
  },
  noProxyAvailable: {
    vi: "Hien tai khong co proxy nao kha dung cho loai nay.",
    en: "No proxy is currently available for this type.",
  },
  proxyAssigned: {
    vi: "Proxy da duoc cap cho ban:\n\nHost: {host}\nPort: {port}\nLoai: {type}\nUser: {username}\nPass: {password}\n\nHet han: {expires}",
    en: "Proxy assigned to you:\n\nHost: {host}\nPort: {port}\nType: {type}\nUser: {username}\nPass: {password}\n\nExpires: {expires}",
  },
  requestPending: {
    vi: "Yeu cau cua ban da duoc tao va dang cho duyet.\nID: {id}",
    en: "Your request has been created and is pending approval.\nID: {id}",
  },
  noProxies: {
    vi: "Ban chua duoc cap proxy nao.",
    en: "You have no assigned proxies.",
  },
  accountBlocked: {
    vi: "Tai khoan cua ban da bi khoa. Lien he admin de biet them.",
    en: "Your account has been blocked. Contact admin for details.",
  },
  languageSelect: {
    vi: "Chon ngon ngu / Select language:",
    en: "Select language / Chon ngon ngu:",
  },
  languageChanged: {
    vi: "Ngon ngu da duoc doi sang Tieng Viet.",
    en: "Language changed to English.",
  },
  unknownCommand: {
    vi: "Lenh khong hop le. Su dung /help de xem cac lenh.",
    en: "Unknown command. Use /help to see available commands.",
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

  const text = isNew ? t("welcome", lang) : t("welcomeBack", lang);
  await ctx.reply(text);

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
  await ctx.reply(text);

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
    await ctx.editMessageText(text);
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
    return `${i + 1}. ${p.host}:${p.port} (${p.type.toUpperCase()}) - Exp: ${expires}`;
  });

  const header = lang === "vi" ? "Proxy cua ban:" : "Your proxies:";
  const text = `${header}\n\n${lines.join("\n")}`;
  await ctx.reply(text);
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

  const statusLines =
    lang === "vi"
      ? [
          "Trang thai tai khoan:",
          `Trang thai: ${user.status}`,
          `Che do duyet: ${user.approval_mode}`,
          `Proxy hien tai: ${proxyCount ?? 0} / ${user.max_proxies}`,
          "",
          "Gioi han yeu cau:",
          `  Theo gio: ${user.proxies_used_hourly} / ${user.rate_limit_hourly}`,
          `  Theo ngay: ${user.proxies_used_daily} / ${user.rate_limit_daily}`,
          `  Tong cong: ${user.proxies_used_total} / ${user.rate_limit_total}`,
        ]
      : [
          "Account Status:",
          `Status: ${user.status}`,
          `Approval mode: ${user.approval_mode}`,
          `Current proxies: ${proxyCount ?? 0} / ${user.max_proxies}`,
          "",
          "Rate limits:",
          `  Hourly: ${user.proxies_used_hourly} / ${user.rate_limit_hourly}`,
          `  Daily: ${user.proxies_used_daily} / ${user.rate_limit_daily}`,
          `  Total: ${user.proxies_used_total} / ${user.rate_limit_total}`,
        ];

  const text = statusLines.join("\n");
  await ctx.reply(text);
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
