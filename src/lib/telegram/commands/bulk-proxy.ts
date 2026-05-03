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
import { CB } from "../callbacks";

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
      // Wave 25-pre3 (Pass 2.6) — branch on pool size so the user
      // knows whether to ping admin (kho rỗng) or just retry later
      // (all currently assigned). One extra count() query, runs only
      // on the failure path so cost is negligible.
      const { count: poolCount } = await supabaseAdmin
        .from("proxies")
        .select("*", { count: "exact", head: true })
        .eq("type", proxyType)
        .eq("is_deleted", false);

      const text = (poolCount ?? 0) === 0
        ? (lang === "vi"
            ? `[X] Loại ${proxyType.toUpperCase()} chưa có trong kho. Vui lòng liên hệ admin (/support) để bổ sung.`
            : `[X] No ${proxyType.toUpperCase()} proxies in stock. Contact admin (/support) to add some.`)
        : (lang === "vi"
            ? `[X] Tất cả proxy ${proxyType.toUpperCase()} đang được sử dụng. Vui lòng thử lại sau ít phút.`
            : `[X] All ${proxyType.toUpperCase()} proxies are currently in use. Please retry in a few minutes.`);

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
      // Wave 25-pre2 (P0 4.A) — restore diacritics. The bulkPartialAssigned
      // template in messages.ts already has the accented version; reuse it
      // via fillTemplate instead of duplicating an inline string here.
      resultMsg = fillTemplate(t("bulkPartialAssigned", lang), {
        assigned: String(data.assigned),
        requested: String(quantity),
        type: proxyType.toUpperCase(),
        missing: String(missing),
      });
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
      const filename = `proxies_${proxyType}_${data.assigned}.txt`;
      await sendTelegramDocument(ctx.from.id, buffer, filename, resultMsg);
      // Wave 23C — audit row for the file delivery (mig 049). Best-effort:
      // a failed audit insert must NOT break the user-facing reply.
      supabaseAdmin
        .from("bot_files")
        .insert({
          tele_user_id: user.id,
          filename,
          size_bytes: buffer.length,
          kind: "bulk_assign",
          context: { proxy_type: proxyType, count: data.assigned, batch_id: batchId },
        })
        .then(({ error }) => {
          if (error) console.error("bot_files audit insert failed:", error.message);
        });
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
        .text("Approve", CB.admin("bulk_approve", request.id))
        .text("Reject", CB.admin("bulk_reject", request.id));
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

  // Phase 1B (B-014) — race fix. Pre-fix UPDATE didn't filter
  // status=pending; if a second admin clicked approve concurrently
  // both would call bulk_assign_proxies and double-assign. Filter
  // + RETURNING so only the FIRST admin's UPDATE wins; the second
  // admin's path falls through and short-circuits on data.length=0.
  const { data: updatedRows } = await supabaseAdmin
    .from("proxy_requests")
    .update({
      status: "approved",
      approved_by: adminInfo.adminId || null,
      processed_at: new Date().toISOString(),
      batch_id: batchId,
    })
    .eq("id", requestId)
    .eq("status", "pending")
    .select("id");
  if (!updatedRows || updatedRows.length === 0) {
    await ctx.answerCallbackQuery("Request already processed");
    await ctx.editMessageText("[Already processed by another admin]");
    return;
  }

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
      const filename = `proxies_${request.proxy_type}_${data.assigned}.txt`;
      sendTelegramDocument(teleUser.telegram_id, buffer, filename, userMsg).catch(console.error);
      // Wave 23C — audit row (mig 049). Best-effort, fire-and-forget.
      supabaseAdmin
        .from("bot_files")
        .insert({
          tele_user_id: teleUser.id,
          filename,
          size_bytes: buffer.length,
          kind: "bulk_assign_admin_approved",
          context: {
            proxy_type: request.proxy_type,
            count: data.assigned,
            batch_id: batchId,
            request_id: requestId,
          },
        })
        .then(({ error }) => {
          if (error) console.error("bot_files audit insert failed:", error.message);
        });
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
