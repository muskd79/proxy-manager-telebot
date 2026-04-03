import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendTelegramMessage } from "../send";
import { getAdminByTelegramId, notifyOtherAdmins } from "../notify-admins";

// ---------------------------------------------------------------------------
// Admin check helper (uses centralized getAdminByTelegramId)
// ---------------------------------------------------------------------------

async function isAdmin(telegramId: number): Promise<boolean> {
  const result = await getAdminByTelegramId(telegramId);
  return result.isAdmin;
}

// ---------------------------------------------------------------------------
// /requests – list pending proxy requests (admin only)
// ---------------------------------------------------------------------------

export async function handleAdminRequests(ctx: Context) {
  const from = ctx.from;
  if (!from) return;

  if (!(await isAdmin(from.id))) {
    await ctx.reply("You are not authorized as admin.");
    return;
  }

  const { data: requests } = await supabaseAdmin
    .from("proxy_requests")
    .select(
      "id, proxy_type, created_at, tele_user_id, tele_users(username, first_name, telegram_id)"
    )
    .eq("status", "pending")
    .eq("is_deleted", false)
    .order("created_at", { ascending: false })
    .limit(10);

  if (!requests || requests.length === 0) {
    await ctx.reply("No pending requests.");
    return;
  }

  const keyboard = new InlineKeyboard();
  const lines: string[] = ["*Pending Requests:*", ""];

  for (const req of requests) {
    const user = req.tele_users as unknown as {
      username?: string;
      first_name?: string;
      telegram_id: number;
    };
    const name = user?.username
      ? `@${user.username}`
      : user?.first_name || "Unknown";
    const type = req.proxy_type?.toUpperCase() || "ANY";
    const date = new Date(req.created_at).toISOString().split("T")[0];

    lines.push(`${name} - ${type} - ${date}`);
    keyboard
      .text(`Approve ${name}`, `admin_approve:${req.id}`)
      .text(`Reject`, `admin_reject:${req.id}`)
      .row();
  }

  await ctx.reply(lines.join("\n"), {
    parse_mode: "Markdown",
    reply_markup: keyboard,
  });
}

// ---------------------------------------------------------------------------
// Callback: approve a pending request
// ---------------------------------------------------------------------------

export async function handleAdminApproveCallback(
  ctx: Context,
  requestId: string
) {
  const from = ctx.from;
  if (!from || !(await isAdmin(from.id))) {
    await ctx.answerCallbackQuery("Not authorized");
    return;
  }

  // Fetch the pending request
  const { data: request } = await supabaseAdmin
    .from("proxy_requests")
    .select("id, proxy_type, tele_user_id")
    .eq("id", requestId)
    .eq("status", "pending")
    .single();

  if (!request) {
    await ctx.answerCallbackQuery("Request not found or already processed");
    return;
  }

  // Find an available proxy matching the requested type
  let proxyQuery = supabaseAdmin
    .from("proxies")
    .select("id, host, port, type, username, password")
    .eq("status", "available")
    .eq("is_deleted", false)
    .limit(1);

  if (request.proxy_type) {
    proxyQuery = proxyQuery.eq("type", request.proxy_type);
  }

  const { data: proxy } = await proxyQuery.single();

  if (!proxy) {
    await ctx.answerCallbackQuery("No proxy available");
    await ctx.editMessageText("No available proxy for this request.");
    return;
  }

  // Assign the proxy
  const expiresAt = new Date(
    Date.now() + 30 * 24 * 60 * 60 * 1000
  ).toISOString();

  await supabaseAdmin
    .from("proxies")
    .update({
      status: "assigned",
      assigned_to: request.tele_user_id,
      assigned_at: new Date().toISOString(),
      expires_at: expiresAt,
    })
    .eq("id", proxy.id);

  await supabaseAdmin
    .from("proxy_requests")
    .update({
      status: "approved",
      proxy_id: proxy.id,
      processed_at: new Date().toISOString(),
    })
    .eq("id", requestId);

  // Notify the user who requested
  const { data: teleUser } = await supabaseAdmin
    .from("tele_users")
    .select("telegram_id, language")
    .eq("id", request.tele_user_id)
    .single();

  if (teleUser) {
    const lang = (teleUser.language === "vi" || teleUser.language === "en") ? teleUser.language : "en";
    const text =
      lang === "vi"
        ? `Proxy da duoc cap!\n\n\`${proxy.host}:${proxy.port}:${proxy.username || ""}:${proxy.password || ""}\`\n\nLoai: ${proxy.type.toUpperCase()}`
        : `Proxy assigned!\n\n\`${proxy.host}:${proxy.port}:${proxy.username || ""}:${proxy.password || ""}\`\n\nType: ${proxy.type.toUpperCase()}`;

    await sendTelegramMessage(teleUser.telegram_id, text);
  }

  await ctx.answerCallbackQuery("Approved!");
  await ctx.editMessageText("Request approved. Proxy assigned to user.");

  // Notify other admins about this approval
  if (from) {
    const adminInfo = await getAdminByTelegramId(from.id);
    const userName = teleUser
      ? `user ${teleUser.telegram_id}`
      : "unknown user";
    notifyOtherAdmins(
      from.id,
      `${adminInfo.label || "Admin"} approved proxy request for ${userName}`
    ).catch(console.error);
  }
}

// ---------------------------------------------------------------------------
// Callback: reject a pending request
// ---------------------------------------------------------------------------

export async function handleAdminRejectCallback(
  ctx: Context,
  requestId: string
) {
  const from = ctx.from;
  if (!from || !(await isAdmin(from.id))) {
    await ctx.answerCallbackQuery("Not authorized");
    return;
  }

  await supabaseAdmin
    .from("proxy_requests")
    .update({
      status: "rejected",
      rejected_reason: "Rejected via Telegram",
      processed_at: new Date().toISOString(),
    })
    .eq("id", requestId)
    .eq("status", "pending");

  // Notify the user
  const { data: request } = await supabaseAdmin
    .from("proxy_requests")
    .select(
      "tele_user_id, tele_users(telegram_id, language)"
    )
    .eq("id", requestId)
    .single();

  if (request) {
    const user = request.tele_users as unknown as {
      telegram_id: number;
      language?: string;
    };
    if (user) {
      const lang = (user.language === "vi" || user.language === "en") ? user.language : "en";
      const text =
        lang === "vi"
          ? "Yeu cau proxy bi tu choi."
          : "Proxy request rejected.";
      await sendTelegramMessage(user.telegram_id, text);
    }
  }

  await ctx.answerCallbackQuery("Rejected");
  await ctx.editMessageText("Request rejected.");

  // Notify other admins about this rejection
  if (from) {
    const adminInfo = await getAdminByTelegramId(from.id);
    const userName = request
      ? `user request ${requestId}`
      : "unknown request";
    notifyOtherAdmins(
      from.id,
      `${adminInfo.label || "Admin"} rejected proxy request ${requestId}`
    ).catch(console.error);
  }
}

// ---------------------------------------------------------------------------
// Callback: approve a new user (from /start notification)
// ---------------------------------------------------------------------------

export async function handleAdminApproveUser(
  ctx: Context,
  userId: string
) {
  if (!ctx.from) return;

  const adminInfo = await getAdminByTelegramId(ctx.from.id);
  if (!adminInfo.isAdmin) {
    await ctx.answerCallbackQuery("Not authorized");
    return;
  }

  // Update user status to active
  const { data: user } = await supabaseAdmin
    .from("tele_users")
    .update({ status: "active" })
    .eq("id", userId)
    .eq("is_deleted", false)
    .select("telegram_id, username, first_name")
    .single();

  if (!user) {
    await ctx.answerCallbackQuery("User not found");
    return;
  }

  // Notify the user
  sendTelegramMessage(
    user.telegram_id,
    "Your account has been approved! Use /getproxy to request proxies."
  ).catch(console.error);

  // Update the admin message
  const username = user.username ? `@${user.username}` : user.first_name || "Unknown";
  await ctx.editMessageText(`[Approved] ${username} - approved by ${adminInfo.label}`);
  await ctx.answerCallbackQuery("User approved");

  // Notify other admins
  notifyOtherAdmins(
    ctx.from.id,
    `${adminInfo.label} approved user ${username}`
  ).catch(console.error);
}

// ---------------------------------------------------------------------------
// Callback: block a new user (from /start notification)
// ---------------------------------------------------------------------------

export async function handleAdminBlockUser(
  ctx: Context,
  userId: string
) {
  if (!ctx.from) return;

  const adminInfo = await getAdminByTelegramId(ctx.from.id);
  if (!adminInfo.isAdmin) {
    await ctx.answerCallbackQuery("Not authorized");
    return;
  }

  // Update user status to blocked
  const { data: user } = await supabaseAdmin
    .from("tele_users")
    .update({ status: "blocked" })
    .eq("id", userId)
    .eq("is_deleted", false)
    .select("telegram_id, username, first_name")
    .single();

  if (!user) {
    await ctx.answerCallbackQuery("User not found");
    return;
  }

  // Notify the user
  sendTelegramMessage(
    user.telegram_id,
    "Your account has been blocked. Contact support if you believe this is an error."
  ).catch(console.error);

  // Update the admin message
  const username = user.username ? `@${user.username}` : user.first_name || "Unknown";
  await ctx.editMessageText(`[Blocked] ${username} - blocked by ${adminInfo.label}`);
  await ctx.answerCallbackQuery("User blocked");

  // Notify other admins
  notifyOtherAdmins(
    ctx.from.id,
    `${adminInfo.label} blocked user ${username}`
  ).catch(console.error);
}
