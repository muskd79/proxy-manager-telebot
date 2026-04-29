import type { Context } from "grammy";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { t, fillTemplate } from "../messages";
import { getUserLanguage } from "../user";
import { logChatMessage } from "../logging";
import { sendTelegramMessage, sendTelegramDocument } from "../send";
import { formatProxiesAsText, formatProxiesAsBuffer } from "../format-proxies";
import { notifyAllAdmins, notifyOtherAdmins, getAdminByTelegramId } from "../notify-admins";
import { autoAssignProxy, createManualRequest } from "./assign-proxy";
import { ChatDirection, MessageType, ApprovalMode } from "@/types/database";
import type { OrderMode } from "../keyboard";
import { InlineKeyboard } from "grammy";

const BULK_AUTO_THRESHOLD = 5; // Above this, force manual approval

/**
 * Wave 23B-bot UX — `mode` = "quick" | "custom" derived from the
 * order-type screen the user picked first. Quick honors the user's
 * approval_mode + threshold; Custom always queues for admin.
 *
 * Default 'quick' keeps callers that haven't migrated yet on the
 * legacy auto-or-manual decision.
 */
export async function handleQuantitySelection(
  ctx: Context,
  proxyType: string,
  quantity: number,
  mode: OrderMode = "quick",
) {
  if (!ctx.from) return;

  const { data: user } = await supabaseAdmin
    .from("tele_users")
    .select("*")
    .eq("telegram_id", ctx.from.id)
    .single();

  if (!user) return;
  const lang = getUserLanguage(user);

  await logChatMessage(user.id, null, ChatDirection.Incoming, `qty:${mode}:${proxyType}:${quantity}`, MessageType.Callback);

  // Wave 23B-bot UX — new message per step instead of editing the
  // previous one, so the user keeps a chat trail of their choices.
  if (quantity === 1 && mode === "quick") {
    if (user.approval_mode === ApprovalMode.Auto) {
      const result = await autoAssignProxy(user, proxyType, lang);
      await ctx.answerCallbackQuery();
      await ctx.reply(result.text, result.parseMode ? { parse_mode: result.parseMode } : undefined);
    } else {
      const result = await createManualRequest(user, proxyType, lang);
      await ctx.answerCallbackQuery();
      await ctx.reply(result.text);
    }
    return;
  }

  // Wave 23B-bot UX — Custom order ALWAYS goes to admin queue.
  // Quick order honors the threshold + user approval mode (legacy).
  const forceManual =
    mode === "custom" ||
    quantity > BULK_AUTO_THRESHOLD ||
    user.approval_mode === ApprovalMode.Manual;

  if (!forceManual) {
    // Auto-assign bulk
    const batchId = crypto.randomUUID();
    const { data, error } = await supabaseAdmin.rpc("bulk_assign_proxies", {
      p_user_id: user.id,
      p_type: proxyType,
      p_quantity: quantity,
      p_admin_id: null,
      p_batch_id: batchId,
    });

    if (error || !data?.success || data.assigned === 0) {
      const text = t("noProxyAvailable", lang);
      await ctx.answerCallbackQuery();
      await ctx.reply(text);
      return;
    }

    const proxies = data.proxies as Array<{ host: string; port: number; username: string | null; password: string | null }>;
    await ctx.answerCallbackQuery();

    // Build result message - clarify partial assignment
    let resultMsg = fillTemplate(t("bulkProxyAssigned", lang), {
      count: String(data.assigned),
      type: proxyType.toUpperCase(),
    });
    if (data.assigned < quantity) {
      const missing = quantity - data.assigned;
      resultMsg = lang === "vi"
        ? `[OK] ${data.assigned}/${quantity} proxy ${proxyType.toUpperCase()} da cap! (${missing} khong kha dung - thu lai sau)`
        : `[OK] ${data.assigned}/${quantity} proxies assigned! (${missing} not available - try again later)`;
    }

    if (proxies.length <= 3) {
      // Send inline
      const proxyLines = formatProxiesAsText(proxies);
      const text = resultMsg + "\n\n`" + proxyLines + "`";
      await ctx.reply(text, { parse_mode: "Markdown" });
    } else {
      // Send as file
      const buffer = formatProxiesAsBuffer(proxies);
      await ctx.reply(resultMsg);
      await sendTelegramDocument(ctx.from.id, buffer, `proxies_${proxyType}_${data.assigned}.txt`, resultMsg);
    }

    await logChatMessage(user.id, null, ChatDirection.Outgoing, `Bulk assigned ${data.assigned} ${proxyType} proxies`, MessageType.Text);
  } else {
    // Manual approval needed - create pending request with quantity
    const { data: request } = await supabaseAdmin
      .from("proxy_requests")
      .insert({
        tele_user_id: user.id,
        proxy_id: null,
        proxy_type: proxyType as "http" | "https" | "socks5",
        status: "pending",
        approval_mode: "manual",
        requested_at: new Date().toISOString(),
        quantity,
        is_deleted: false,
      })
      .select()
      .single();

    const text = fillTemplate(t("bulkRequestPending", lang), {
      count: String(quantity),
      type: proxyType.toUpperCase(),
    });
    await ctx.answerCallbackQuery();
    await ctx.reply(text);

    // Notify admins
    const username = user.username ? `@${user.username}` : user.first_name || "Unknown";
    const adminText = `[!] Bulk proxy request\n\nUser: ${username}\nType: ${proxyType.toUpperCase()}\nQuantity: ${quantity}\n\nUse /requests or web dashboard to approve.`;

    if (request) {
      const keyboard = new InlineKeyboard()
        .text("Approve", `admin_bulk_approve:${request.id}`)
        .text("Reject", `admin_bulk_reject:${request.id}`);
      notifyAllAdmins(adminText, { inlineKeyboard: keyboard }).catch(console.error);
    }

    await logChatMessage(user.id, null, ChatDirection.Outgoing, text, MessageType.Text);
  }
}

export async function handleAdminBulkApproveCallback(ctx: Context, requestId: string) {
  if (!ctx.from) return;

  const adminInfo = await getAdminByTelegramId(ctx.from.id);
  if (!adminInfo.isAdmin) {
    await ctx.answerCallbackQuery("Not authorized");
    return;
  }

  // Fetch request
  const { data: request } = await supabaseAdmin
    .from("proxy_requests")
    .select("*, tele_users(id, telegram_id, username, first_name)")
    .eq("id", requestId)
    .single();

  if (!request || request.status !== "pending") {
    await ctx.answerCallbackQuery("Request already processed");
    await ctx.editMessageText("[Already processed]");
    return;
  }

  const teleUser = (request as Record<string, unknown>).tele_users as {
    id: string;
    telegram_id: number;
    username: string | null;
    first_name: string | null;
  } | null;

  // Check user rate limits before approving
  const requestQuantity = (request.quantity as number) || 1;
  if (requestQuantity > 0) {
    const { data: rateLimitUser } = await supabaseAdmin
      .from("tele_users")
      .select("rate_limit_hourly, rate_limit_daily, rate_limit_total, proxies_used_hourly, proxies_used_daily, proxies_used_total")
      .eq("id", request.tele_user_id)
      .single();

    if (rateLimitUser) {
      const remainingHourly = rateLimitUser.rate_limit_hourly - rateLimitUser.proxies_used_hourly;
      const remainingDaily = rateLimitUser.rate_limit_daily - rateLimitUser.proxies_used_daily;
      const remainingTotal = rateLimitUser.rate_limit_total - rateLimitUser.proxies_used_total;
      const maxAllowed = Math.min(remainingHourly, remainingDaily, remainingTotal);

      if (maxAllowed <= 0) {
        await ctx.answerCallbackQuery("User has reached their rate limit");
        await ctx.editMessageText(`[Rate Limit] User has no remaining quota. Cannot approve.`);
        return;
      }

      if (requestQuantity > maxAllowed) {
        await ctx.answerCallbackQuery("Rate limit exceeded");
        await ctx.editMessageText(`[Rate Limit] User can only receive ${maxAllowed} more proxies. Requested: ${requestQuantity}. Reduce quantity or adjust limits.`);
        return;
      }
    }
  }

  const batchId = crypto.randomUUID();

  // Bulk assign
  const { data, error } = await supabaseAdmin.rpc("bulk_assign_proxies", {
    p_user_id: request.tele_user_id,
    p_type: request.proxy_type,
    p_quantity: request.quantity,
    p_admin_id: adminInfo.adminId || null,
    p_batch_id: batchId,
  });

  if (error || !data?.success || data.assigned === 0) {
    await ctx.answerCallbackQuery("No proxies available");
    return;
  }

  // Update original request
  await supabaseAdmin
    .from("proxy_requests")
    .update({
      status: "approved",
      approved_by: adminInfo.adminId || null,
      processed_at: new Date().toISOString(),
      batch_id: batchId,
    })
    .eq("id", requestId);

  // Send proxies to user
  const proxies = data.proxies as Array<{ host: string; port: number; username: string | null; password: string | null }>;
  if (teleUser?.telegram_id) {
    let userMsg: string;
    if (data.assigned < request.quantity) {
      const missing = request.quantity - data.assigned;
      userMsg = `[OK] ${data.assigned}/${request.quantity} proxies assigned! (${missing} not available - try again later)`;
    } else {
      userMsg = `[OK] ${data.assigned} proxies assigned!`;
    }

    if (proxies.length <= 3) {
      const proxyLines = formatProxiesAsText(proxies);
      sendTelegramMessage(teleUser.telegram_id, `${userMsg}\n\n\`${proxyLines}\``).catch(console.error);
    } else {
      const buffer = formatProxiesAsBuffer(proxies);
      sendTelegramDocument(teleUser.telegram_id, buffer, `proxies_${request.proxy_type}_${data.assigned}.txt`, userMsg).catch(console.error);
    }
  }

  // Update admin message
  const username = teleUser?.username ? `@${teleUser.username}` : teleUser?.first_name || "Unknown";
  await ctx.editMessageText(`[Approved] ${data.assigned}/${request.quantity} ${request.proxy_type} proxies for ${username} - by ${adminInfo.label}`);
  await ctx.answerCallbackQuery(`Approved ${data.assigned} proxies`);

  // Notify other admins
  notifyOtherAdmins(ctx.from.id, `${adminInfo.label} approved ${data.assigned} ${request.proxy_type} proxies for ${username}`).catch(console.error);
}

export async function handleAdminBulkRejectCallback(ctx: Context, requestId: string) {
  if (!ctx.from) return;

  const adminInfo = await getAdminByTelegramId(ctx.from.id);
  if (!adminInfo.isAdmin) {
    await ctx.answerCallbackQuery("Not authorized");
    return;
  }

  const { data: request } = await supabaseAdmin
    .from("proxy_requests")
    .select("*, tele_users(telegram_id, username, first_name)")
    .eq("id", requestId)
    .single();

  if (!request || request.status !== "pending") {
    await ctx.answerCallbackQuery("Already processed");
    await ctx.editMessageText("[Already processed]");
    return;
  }

  await supabaseAdmin
    .from("proxy_requests")
    .update({ status: "rejected", approved_by: adminInfo.adminId || null, processed_at: new Date().toISOString() })
    .eq("id", requestId);

  const teleUser = (request as Record<string, unknown>).tele_users as {
    telegram_id: number;
    username: string | null;
    first_name: string | null;
  } | null;
  if (teleUser?.telegram_id) {
    sendTelegramMessage(teleUser.telegram_id, `[X] Your bulk proxy request for ${request.quantity} ${request.proxy_type} has been rejected.`).catch(console.error);
  }

  const username = teleUser?.username ? `@${teleUser.username}` : "Unknown";
  await ctx.editMessageText(`[Rejected] Bulk request for ${username} - by ${adminInfo.label}`);
  await ctx.answerCallbackQuery("Rejected");

  notifyOtherAdmins(ctx.from.id, `${adminInfo.label} rejected bulk ${request.proxy_type} request from ${username}`).catch(console.error);
}
