/**
 * Wave 26-D-2B — bot warranty flow.
 *
 * Two entry points:
 *   1. handleWarrantyClaim — from inline button "Báo lỗi" (rendered
 *      under the /myproxies list). Validates eligibility client-side,
 *      then renders the reason picker keyboard.
 *   2. handleWarrantyReason — from reason picker. If reason !== "other",
 *      submit immediately. If reason === "other", set bot state to
 *      `awaiting_warranty_reason_text` so the user types the description.
 *
 * Plus:
 *   - handleWarrantyReasonText — bot's message:text handler delegates
 *     here when state is `awaiting_warranty_reason_text`.
 *   - handleWarrantyCancel — inline button cancel, restores state to idle.
 *
 * All eligibility checks run BOTH client-side here AND server-side in
 * the API route (defence-in-depth — bot might be out of sync after a
 * settings change).
 */

import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logChatMessage } from "../logging";
import { ChatDirection, MessageType, type Proxy } from "@/types/database";
import { getOrCreateUser, getUserLanguage } from "../user";
import { CB } from "../callbacks";
import type { WarrantyReasonCode } from "../callbacks";
import {
  checkWarrantyEligibility,
  WARRANTY_REJECT_LABEL_VI,
} from "@/lib/warranty/eligibility";
import { loadWarrantySettings } from "@/lib/warranty/settings";
import { logProxyEvent } from "@/lib/warranty/events";
import { setBotState, clearBotState } from "../state";
import { captureError } from "@/lib/error-tracking";
import { escapeMarkdown } from "../format";
// Wave 26-D bug hunt v2 [MEDIUM] — single source of truth for warranty
// labels (was duplicated across this file, the admin table, and the
// /api/warranty notifier).
import {
  WARRANTY_REASON_LABEL_VI,
  WARRANTY_REASON_LABEL_EN,
} from "@/lib/warranty-labels";

// ─── Reason picker keyboard (one button per row, mobile-friendly) ──
// Built off WARRANTY_REASON_LABEL_* + a synthetic "other" suffix
// nudging the user to type the description. The order is preserved
// from the original WARRANTY_REASON_CODES tuple so user muscle memory
// holds across the 26-D-2B refactor.
const REASON_BUTTONS_VI: ReadonlyArray<{
  code: WarrantyReasonCode;
  label: string;
}> = [
  { code: "no_connect", label: WARRANTY_REASON_LABEL_VI.no_connect },
  { code: "slow", label: WARRANTY_REASON_LABEL_VI.slow },
  { code: "ip_blocked", label: WARRANTY_REASON_LABEL_VI.ip_blocked },
  { code: "wrong_country", label: WARRANTY_REASON_LABEL_VI.wrong_country },
  { code: "auth_fail", label: WARRANTY_REASON_LABEL_VI.auth_fail },
  { code: "other", label: "Lý do khác (gõ tay)" },
];

const REASON_BUTTONS_EN: ReadonlyArray<{
  code: WarrantyReasonCode;
  label: string;
}> = [
  { code: "no_connect", label: WARRANTY_REASON_LABEL_EN.no_connect },
  { code: "slow", label: WARRANTY_REASON_LABEL_EN.slow },
  { code: "ip_blocked", label: WARRANTY_REASON_LABEL_EN.ip_blocked },
  { code: "wrong_country", label: WARRANTY_REASON_LABEL_EN.wrong_country },
  { code: "auth_fail", label: WARRANTY_REASON_LABEL_EN.auth_fail },
  { code: "other", label: "Other (type description)" },
];

const REASON_LABEL_VI: Record<WarrantyReasonCode, string> = WARRANTY_REASON_LABEL_VI;

/**
 * Build the reason picker inline keyboard. 6 buttons, 1 per row for
 * easy thumb-tap on mobile + 1 cancel button at bottom.
 */
function reasonKeyboard(
  proxyId: string,
  lang: "vi" | "en",
): InlineKeyboard {
  const buttons = lang === "vi" ? REASON_BUTTONS_VI : REASON_BUTTONS_EN;
  const kb = new InlineKeyboard();
  for (const b of buttons) {
    kb.text(b.label, CB.warrantyReason(proxyId, b.code)).row();
  }
  kb.text(lang === "vi" ? "Huỷ" : "Cancel", CB.warrantyCancel());
  return kb;
}

// ─── Step 1: user clicks "Báo lỗi" on /myproxies ──────────────────
export async function handleWarrantyClaim(
  ctx: Context,
  proxyId: string,
): Promise<void> {
  const user = await getOrCreateUser(ctx);
  if (!user) return;
  const lang = getUserLanguage(user);

  // Acknowledge the callback so the spinner stops on user side.
  await ctx.answerCallbackQuery();

  // Pre-fetch proxy + recent claims so we can run the eligibility gate
  // client-side BEFORE prompting the reason picker. Saves a round trip
  // and gives a clean Vietnamese error if something doesn't pass.
  //
  // Wave 26-D bug hunt v3 [HIGH] — match Step 4 (`submitWarrantyClaim`)
  // by scoping the claims query to the trailing 30-day window instead
  // of the legacy `.limit(50)`. Pre-fix a power-user with 50+ historical
  // claims older than 30 days had the oldest ones truncated, making the
  // 30d cap + pending-count + cooldown checks see a falsely low number.
  // The picker would render → user picks reason → step 4's correct-window
  // gate fires → re-runs the same checks against the FULL 30d window
  // and (sometimes) rejects, causing a confusing "click button → click
  // reason → reason rejected" UX.
  const sinceIso30d = new Date(
    Date.now() - 30 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const [proxyRes, claimsRes, settings] = await Promise.all([
    supabaseAdmin.from("proxies").select("*").eq("id", proxyId).single(),
    supabaseAdmin
      .from("warranty_claims")
      .select("id, proxy_id, status, created_at")
      .eq("user_id", user.id)
      .gte("created_at", sinceIso30d)
      .order("created_at", { ascending: false }),
    loadWarrantySettings(),
  ]);

  if (proxyRes.error || !proxyRes.data) {
    await ctx.reply(lang === "vi" ? "Không tìm thấy proxy này." : "Proxy not found.");
    return;
  }

  const eligibility = checkWarrantyEligibility({
    proxy: proxyRes.data as Proxy,
    userId: user.id,
    userClaims: claimsRes.data ?? [],
    settings,
  });
  if (!eligibility.allowed) {
    const errMsg =
      lang === "vi"
        ? WARRANTY_REJECT_LABEL_VI[eligibility.code]
        : translateRejectEn(eligibility.code);
    await ctx.reply(`[!] ${errMsg}`);
    return;
  }

  // Eligibility OK — show the reason picker. Escape host:port because
  // hosts can contain dots/dashes that Markdown V1 mostly tolerates,
  // but defence-in-depth: vendor migrations have shown weird hosts.
  const proxy = proxyRes.data as Proxy;
  const safeHostPort = escapeMarkdown(`${proxy.host}:${proxy.port}`);
  const text =
    lang === "vi"
      ? `Bạn đang báo lỗi proxy *${safeHostPort}*\n\nVì sao bạn báo lỗi?`
      : `Reporting proxy *${safeHostPort}*\n\nWhat's the reason?`;
  await ctx.reply(text, {
    parse_mode: "Markdown",
    reply_markup: reasonKeyboard(proxyId, lang),
  });

  // Audit chat message (outgoing — masked credentials).
  await logChatMessage(
    user.id,
    null,
    ChatDirection.Outgoing,
    `[Warranty prompt] proxy=${proxy.host}:${proxy.port}`,
    MessageType.Text,
  );
}

// ─── Step 2: user picks a reason from the keyboard ────────────────
export async function handleWarrantyReason(
  ctx: Context,
  proxyId: string,
  reasonCode: WarrantyReasonCode,
): Promise<void> {
  const user = await getOrCreateUser(ctx);
  if (!user) return;
  const lang = getUserLanguage(user);

  await ctx.answerCallbackQuery();

  // Reason "other" → state machine prompts for free-text input.
  if (reasonCode === "other") {
    await setBotState(user.id, {
      step: "awaiting_warranty_reason_text",
      proxyId,
    });
    const text =
      lang === "vi"
        ? "Vui lòng *gõ mô tả lý do* (tối thiểu 5 ký tự, tối đa 2000):"
        : "Please *type the reason* (min 5, max 2000 chars):";
    await ctx.reply(text, { parse_mode: "Markdown" });
    return;
  }

  // Other 5 reasons → submit immediately.
  await submitWarrantyClaim(ctx, user.id, proxyId, reasonCode, null);
}

// ─── Step 3 (only when reason="other"): user types text ───────────
export async function handleWarrantyReasonText(
  ctx: Context,
  proxyId: string,
  text: string,
): Promise<void> {
  const user = await getOrCreateUser(ctx);
  if (!user) return;
  const lang = getUserLanguage(user);

  const trimmed = text.trim();
  if (trimmed.length < 5) {
    await ctx.reply(
      lang === "vi"
        ? "[!] Lý do quá ngắn — vui lòng gõ ít nhất 5 ký tự."
        : "[!] Reason too short — please type at least 5 chars.",
    );
    return; // keep state — user can retry
  }
  if (trimmed.length > 2000) {
    await ctx.reply(
      lang === "vi"
        ? "[!] Lý do quá dài — tối đa 2000 ký tự."
        : "[!] Reason too long — max 2000 chars.",
    );
    return;
  }

  // Clear state BEFORE submit so a slow API doesn't trap user.
  await clearBotState(user.id);
  await submitWarrantyClaim(ctx, user.id, proxyId, "other", trimmed);
}

// ─── Step 4 (cancel button): clear state + dismiss ────────────────
export async function handleWarrantyCancel(ctx: Context): Promise<void> {
  const user = await getOrCreateUser(ctx);
  if (!user) return;
  const lang = getUserLanguage(user);

  await ctx.answerCallbackQuery();
  await clearBotState(user.id);
  await ctx.reply(lang === "vi" ? "Đã huỷ báo lỗi." : "Cancelled.");
}

// ─── Submit helper — actually POST to /api/warranty ──────────────
async function submitWarrantyClaim(
  ctx: Context,
  userId: string,
  proxyId: string,
  reasonCode: WarrantyReasonCode,
  reasonText: string | null,
): Promise<void> {
  const user = await getOrCreateUser(ctx);
  if (!user) return;
  const lang = getUserLanguage(user);

  // Direct DB insert via admin client — equivalent to POST /api/warranty
  // but skips the HTTP round-trip + x-bot-secret dance. The API route
  // is for external bot callers; the in-process bot has admin access
  // already.
  //
  // Wave 26-D bug hunt [P0-4, code-reviewer P0-2] — re-run eligibility
  // gate IMMEDIATELY before insert. Pre-fix the gate ran in
  // handleWarrantyClaim (step 1) but there was a 30-min state TTL
  // window during which a settings change / proxy expiry / concurrent
  // admin action could invalidate the original eligibility. Now we
  // re-fetch fresh proxy + claims + settings, re-run gate, on reject
  // bail with a friendly message. Cheap (3 small queries) — worth the
  // safety.
  try {
    const sinceIso = new Date(
      Date.now() - 30 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const [proxyRes, claimsRes, settings] = await Promise.all([
      supabaseAdmin.from("proxies").select("*").eq("id", proxyId).maybeSingle(),
      supabaseAdmin
        .from("warranty_claims")
        .select("id, proxy_id, status, created_at")
        .eq("user_id", userId)
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false }),
      loadWarrantySettings(),
    ]);

    if (!proxyRes.data) {
      await ctx.reply(
        lang === "vi" ? "Không tìm thấy proxy này." : "Proxy not found.",
      );
      return;
    }

    const eligibility = checkWarrantyEligibility({
      proxy: proxyRes.data,
      userId,
      userClaims: claimsRes.data ?? [],
      settings,
    });
    if (!eligibility.allowed) {
      const errMsg =
        lang === "vi"
          ? WARRANTY_REJECT_LABEL_VI[eligibility.code]
          : eligibility.code; // English fallback
      await ctx.reply(`[!] ${errMsg}`);
      return;
    }

    const { data: claim, error } = await supabaseAdmin
      .from("warranty_claims")
      .insert({
        proxy_id: proxyId,
        user_id: userId,
        reason_code: reasonCode,
        reason_text: reasonText,
        status: "pending",
      })
      .select("id")
      .single();

    if (error || !claim) {
      // Wave 26-D bug hunt [HIGH-1] — partial UNIQUE index in mig 058
      // raises 23505 unique_violation when two simultaneous bot taps
      // both try to insert pending claims for the same (user, proxy).
      // Show a friendly message instead of a generic error.
      const code = (error as { code?: string } | null)?.code;
      if (code === "23505") {
        await ctx.reply(
          lang === "vi"
            ? "[!] Bạn đã báo lỗi proxy này — đang chờ admin xử lý."
            : "[!] You already reported this proxy — admin is reviewing.",
        );
        return;
      }
      captureError(error ?? new Error("Claim insert returned no row"), {
        source: "bot.warranty.submit",
        extra: { userId, proxyId, reasonCode },
      });
      await ctx.reply(
        lang === "vi"
          ? "[!] Có lỗi xảy ra. Vui lòng thử lại sau."
          : "[!] An error occurred. Please try again.",
      );
      return;
    }

    // Transition proxy.status assigned → reported_broken (atomic guard).
    const { error: statusErr } = await supabaseAdmin
      .from("proxies")
      .update({ status: "reported_broken" })
      .eq("id", proxyId)
      .eq("status", "assigned");
    if (statusErr) {
      captureError(statusErr, {
        source: "bot.warranty.submit.status_transition",
        extra: { userId, proxyId, claim_id: claim.id },
      });
    }

    // Audit event.
    await logProxyEvent({
      proxy_id: proxyId,
      event_type: "reported_broken",
      actor_type: "tele_user",
      actor_id: userId,
      related_user_id: userId,
      details: { reason_code: reasonCode, reason_text: reasonText, claim_id: claim.id },
    });

    const reasonLabel =
      lang === "vi"
        ? REASON_LABEL_VI[reasonCode]
        : translateReasonEn(reasonCode);
    // User-typed reason_text may contain Markdown chars — escape so
    // a `*` doesn't break the parse_mode rendering.
    const safeReasonText = reasonText ? escapeMarkdown(reasonText) : null;

    const successText =
      lang === "vi"
        ? [
            "*Đã ghi nhận báo lỗi*",
            "",
            `Lý do: ${reasonLabel}`,
            safeReasonText ? `Mô tả: ${safeReasonText}` : null,
            "",
            "Admin sẽ kiểm tra và phản hồi sớm. Bạn có thể tiếp tục dùng các proxy khác bình thường.",
          ]
            .filter(Boolean)
            .join("\n")
        : [
            "*Warranty claim submitted*",
            "",
            `Reason: ${reasonLabel}`,
            safeReasonText ? `Description: ${safeReasonText}` : null,
            "",
            "Admin will review and respond soon. You can continue using other proxies normally.",
          ]
            .filter(Boolean)
            .join("\n");

    await ctx.reply(successText, { parse_mode: "Markdown" });

    await logChatMessage(
      userId,
      null,
      ChatDirection.Outgoing,
      `[Warranty submitted] claim_id=${claim.id}`,
      MessageType.Text,
    );
  } catch (err) {
    captureError(err, {
      source: "bot.warranty.submit.unexpected",
      extra: { userId, proxyId, reasonCode },
    });
    await ctx.reply(
      lang === "vi"
        ? "[!] Có lỗi xảy ra. Vui lòng thử lại sau."
        : "[!] An error occurred. Please try again.",
    );
  }
}

// ─── i18n helpers ───────────────────────────────────────────────
function translateRejectEn(
  code: keyof typeof WARRANTY_REJECT_LABEL_VI,
): string {
  switch (code) {
    case "proxy_not_assigned_to_user":
      return "This proxy isn't yours — you can't report it";
    case "proxy_status_invalid":
      return "Proxy is not in a state that can be reported";
    case "outside_eligibility_window":
      return "Outside the warranty window (24h after assignment)";
    case "proxy_expired":
      return "Proxy already expired — can't report";
    case "duplicate_pending_claim":
      return "You already reported this proxy — admin is reviewing";
    case "max_pending_reached":
      return "You have too many pending warranty claims. Wait for admin to resolve them.";
    case "max_per_30d_reached":
      return "You've used all warranty submissions for the past 30 days.";
    case "cooldown_active":
      return "Please wait a few minutes before submitting another claim.";
  }
}

function translateReasonEn(code: WarrantyReasonCode): string {
  switch (code) {
    case "no_connect":
      return "Cannot connect";
    case "slow":
      return "Too slow";
    case "ip_blocked":
      return "IP blocked";
    case "wrong_country":
      return "Wrong country";
    case "auth_fail":
      return "Auth failed";
    case "other":
      return "Other";
  }
}
