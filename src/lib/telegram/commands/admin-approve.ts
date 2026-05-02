import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendTelegramMessage } from "../send";
import { getAdminByTelegramId, notifyOtherAdmins } from "../notify-admins";
// DEFAULT_PROXY_EXPIRY_MS no longer needed: safe_assign_proxy RPC
// is now the source of truth for proxy state on approval.

/** Minimal tele_users shape returned by the JOIN in .select(...tele_users(...)). */
type JoinedTeleUser = {
  username?: string;
  first_name?: string;
  telegram_id: number;
  language?: string;
};

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
    // Supabase returns the joined relation as array for one-to-many FKs.
    const user = (req.tele_users as unknown) as JoinedTeleUser;
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

  // Phase 1C (B-007) — migrate to safe_assign_proxy RPC.
  // Pre-fix: SELECT proxy + 2 separate UPDATEs (proxy then request)
  // → 2 admins clicking Approve concurrently could both pass the
  // SELECT (status='available'), both UPDATE proxy=assigned, both
  // UPDATE request=approved → same proxy promised to two users.
  // The RPC (mig 027) is atomic + idempotent (returns "already
  // processed" when the second admin races in).

  // 1. Fetch the pending request (read-only — RPC re-checks).
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

  // 2. Pick first available proxy of the requested type.
  let proxyQuery = supabaseAdmin
    .from("proxies")
    .select("id")
    .eq("status", "available")
    .eq("is_deleted", false)
    .limit(1);
  if (request.proxy_type) {
    proxyQuery = proxyQuery.eq("type", request.proxy_type);
  }
  const { data: proxyRow } = await proxyQuery.maybeSingle();
  if (!proxyRow) {
    await ctx.answerCallbackQuery("No proxy available");
    await ctx.editMessageText("No available proxy for this request.");
    return;
  }

  // 3. Atomic assign via RPC.
  const adminInfoForRpc = await getAdminByTelegramId(from.id);
  const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc(
    "safe_assign_proxy",
    {
      p_request_id: requestId,
      p_proxy_id: proxyRow.id,
      p_admin_id: adminInfoForRpc.adminId || null,
    },
  );

  if (rpcError || !rpcResult || (rpcResult as { success?: boolean }).success !== true) {
    const errMsg =
      (rpcResult as { error?: string } | null)?.error ||
      (rpcError ? "Assignment failed" : "Assignment failed");
    await ctx.answerCallbackQuery(errMsg);
    await ctx.editMessageText(`[X] ${errMsg}`);
    return;
  }

  const proxy = (rpcResult as {
    proxy: {
      id: string;
      host: string;
      port: number;
      type: string;
      username: string | null;
      password: string | null;
    };
  }).proxy;

  // 4. Notify the user who requested.
  const { data: teleUser } = await supabaseAdmin
    .from("tele_users")
    .select("telegram_id, language")
    .eq("id", request.tele_user_id)
    .single();

  if (teleUser) {
    const lang = (teleUser.language === "vi" || teleUser.language === "en") ? teleUser.language : "en";
    const text =
      lang === "vi"
        ? `Proxy đã được cấp!\n\n\`${proxy.host}:${proxy.port}:${proxy.username || ""}:${proxy.password || ""}\`\n\nLoại: ${proxy.type.toUpperCase()}`
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
    // Supabase returns the joined relation as array for one-to-many FKs.
    const user = (request.tele_users as unknown) as JoinedTeleUser;
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
