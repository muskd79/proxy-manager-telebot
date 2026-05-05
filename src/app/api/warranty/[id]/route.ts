/**
 * Wave 26-D-2 — PATCH /api/warranty/[id] — admin approves OR rejects.
 *
 * The most complex endpoint in Wave 26-D because the approve path
 * runs a multi-write workflow:
 *
 *   1. Check claim is still 'pending' (atomic guard against race —
 *      two admins approving same claim).
 *   2. Run 3-tier allocator → pick replacement proxy.
 *   3. UPDATE original proxy: status → maintenance OR banned (per
 *      also_mark_banned checkbox).
 *   4. UPDATE replacement proxy: status='assigned', assigned_to=user_id,
 *      assigned_at=now, expires_at=COPY FROM ORIGINAL (A6=a).
 *   5. UPDATE warranty_claims: status='approved', resolved_by=admin.id,
 *      resolved_at=now, replacement_proxy_id=picked.id, also_mark_banned.
 *   6. Decrement proxies.reliability_score by warranty_reliability_decrement.
 *   7. Insert proxy_events:
 *        - warranty_approved on original
 *        - warranty_replacement_for on replacement (cross-link)
 *        - assigned on replacement (with related_user_id)
 *
 * Reject path is simpler:
 *   1. Atomic guard (still 'pending').
 *   2. UPDATE warranty_claims: status='rejected', rejection_reason,
 *      resolved_by, resolved_at.
 *   3. UPDATE original proxy: status reported_broken → assigned (revert).
 *   4. Insert proxy_events.warranty_rejected.
 *
 * Both paths skip the formal DB transaction (Supabase JS limitation)
 * and use optimistic guards + best-effort audit. Failures captureError
 * but don't roll back — claim resolution is more important than perfect
 * audit (audit has retry via re-PATCH if needed).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAdminOrAbove } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/csrf";
import { captureError } from "@/lib/error-tracking";
import { UpdateWarrantyClaimSchema } from "@/lib/validations/warranty";
import { pickReplacementProxy } from "@/lib/warranty/allocator";
import { loadWarrantySettings } from "@/lib/warranty/settings";
import { logProxyEvent } from "@/lib/warranty/events";
import { sendTelegramMessage } from "@/lib/telegram/send";
import { safeCredentialString, escapeMarkdown } from "@/lib/telegram/format";
import { isUuid } from "@/lib/uuid";
import type { ApiResponse } from "@/types/api";
import type {
  Proxy,
  WarrantyClaim,
} from "@/types/database";

interface ApproveResult {
  claim: WarrantyClaim;
  replacement: Proxy | null;
  /** Allocator tier matched (1, 2, 3) or null. */
  allocator_tier: 1 | 2 | 3 | null;
  /** True if admin chose to mark proxy banned instead of maintenance. */
  banned: boolean;
  /**
   * Wave 26-D bug hunt v4 [HIGH] — true when steps 2-4 succeeded
   * (replacement assigned, original transitioned, audit logged) but
   * the final claim FK update returned 0 rows because the claim row
   * was hard-deleted between lock and finalise. The replacement is
   * already in the user's hands — admin should fix the warranty_claims
   * row manually via /warranty.
   */
  partial_success?: boolean;
}

interface RejectResult {
  claim: WarrantyClaim;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrfErr = assertSameOrigin(request);
  if (csrfErr) return csrfErr;

  const supabase = await createClient();
  const { admin, error: authError } = await requireAdminOrAbove(supabase);
  if (authError) return authError;

  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json(
      { success: false, error: "Invalid claim id" } satisfies ApiResponse<never>,
      { status: 400 },
    );
  }

  try {
    const body = await request.json();
    const parsed = UpdateWarrantyClaimSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Validation failed",
          message: parsed.error.issues.map((i) => i.message).join("; "),
        } satisfies ApiResponse<never>,
        { status: 400 },
      );
    }

    // Fetch the claim — must be pending.
    const { data: claim, error: claimErr } = await supabaseAdmin
      .from("warranty_claims")
      .select("*, proxy:proxies!warranty_claims_proxy_id_fkey(*)")
      .eq("id", id)
      .single();

    if (claimErr || !claim) {
      return NextResponse.json(
        { success: false, error: "Claim not found" } satisfies ApiResponse<never>,
        { status: 404 },
      );
    }

    if (claim.status !== "pending") {
      return NextResponse.json(
        {
          success: false,
          error: "Claim is no longer pending",
          message: `Hiện trạng thái: ${claim.status}`,
        } satisfies ApiResponse<never>,
        { status: 409 },
      );
    }

    // Wave 26-D bug hunt v2 [TS#2] — guard against dangling FK row.
    // claim.proxy could be null if the proxy got deleted between the
    // claim being created and admin opening the dialog. Pre-fix
    // `original: claim.proxy as Proxy` would silently let downstream
    // code crash on `original.id` etc.
    if (!claim.proxy) {
      return NextResponse.json(
        {
          success: false,
          error: "Original proxy not found (FK dangling)",
          message:
            "Proxy gốc của claim này đã bị xoá. Hãy reject claim với lý do tương ứng để xử lý.",
        } satisfies ApiResponse<never>,
        { status: 404 },
      );
    }

    if (parsed.data.action === "approve") {
      return await handleApprove({
        claimId: id,
        adminId: admin.id,
        original: claim.proxy as Proxy,
        userId: claim.user_id,
        alsoMarkBanned: parsed.data.also_mark_banned,
      });
    } else {
      return await handleReject({
        claimId: id,
        adminId: admin.id,
        proxyId: claim.proxy_id,
        rejection_reason: parsed.data.rejection_reason,
      });
    }
  } catch (err) {
    captureError(err, { source: "api.warranty.patch.unexpected", extra: { claim_id: id } });
    return NextResponse.json(
      { success: false, error: "Internal server error" } satisfies ApiResponse<never>,
      { status: 500 },
    );
  }
}

// ─── Approve flow ─────────────────────────────────────────────────────
//
// Wave 26-D bug hunt — race-safe rewrite. Pre-fix had multiple race
// conditions (P0-1, P0-3, P0-5 from agent findings):
//   - Two admins approve same claim → both pass status='pending'
//     check → second's UPDATE on original proxy hits 0 rows but
//     `error` is null → silently treats as success → orphaned
//     replacement proxy.
//   - Allocator SELECT then UPDATE on replacement → another auto-assign
//     can grab the proxy in between → UPDATE 0 rows → silent corruption.
//
// New flow uses the claim row AS THE LOCK:
//   1. UPDATE claim → status='approved' WITH .eq("status","pending").
//      `.select().maybeSingle()` returns null when 0 rows matched,
//      meaning another admin won the race. Return 409.
//   2. Run allocator — best-effort.
//   3. UPDATE replacement proxy with `.select().maybeSingle()` to
//      catch 0-row updates from concurrent auto-assign.
//   4. UPDATE original proxy.
//   5. UPDATE claim again to set replacement_proxy_id (final).
//
// On step 2 or 3 failure: REVERT step 1 (status back to 'pending')
// so the claim is retry-able.
async function handleApprove(args: {
  claimId: string;
  adminId: string;
  original: Proxy;
  userId: string;
  alsoMarkBanned: boolean;
}): Promise<NextResponse<ApiResponse<ApproveResult>>> {
  const { claimId, adminId, original, userId, alsoMarkBanned } = args;
  const settings = await loadWarrantySettings();
  const resolvedAtIso = new Date().toISOString();

  // Wave 27 bug hunt v7 [debugger #2, HIGH] — refuse to approve a
  // claim whose original proxy is already past its expires_at.
  // Pre-fix: handleApprove copied `original.expires_at` to the
  // replacement (line ~310). If admin opened the claim hours after
  // submit, original may already be expired — replacement was
  // assigned with an already-past expiry, immediately collected by
  // the next expire-proxies cron run. User saw "proxy assigned"
  // followed by "proxy expired" within minutes.
  //
  // Now: bail early with 422; admin can `reject` the claim with a
  // helpful reason ("hết hạn — không bảo hành được") and re-issue
  // a fresh proxy via the manual flow if appropriate.
  if (original.expires_at && new Date(original.expires_at) < new Date()) {
    return NextResponse.json(
      {
        success: false,
        error: "original_proxy_expired",
        message:
          "Proxy gốc đã hết hạn. Hãy reject claim với lý do tương ứng — không thể duyệt bảo hành cho proxy đã hết hạn.",
      } satisfies ApiResponse<never> & { message: string },
      { status: 422 },
    );
  }

  // Wave 27 bug hunt v9 [debugger #3, MEDIUM] — refuse to auto-pick a
  // replacement when the original has no expires_at. Pre-fix the
  // replacement was assigned with `expires_at: null`, silently
  // promoting the user to a perpetual lease whenever the original
  // proxy was imported without a duration (CSV import oversight, free
  // pool, etc.). The schema legitimately allows null = no expiry, but
  // there's no way to tell "intentional perpetual" from "import
  // forgot to set duration", so the safe default is to make admin
  // assign the replacement manually with an explicit expiry. Admins
  // can still revoke and re-issue via the manual assign flow.
  if (original.expires_at === null) {
    return NextResponse.json(
      {
        success: false,
        error: "original_proxy_has_no_expiry",
        message:
          "Proxy gốc không có thời hạn (expires_at = null). Auto-pick replacement sẽ kế thừa thời hạn → cấp vĩnh viễn ngoài ý muốn. Hãy reject claim hoặc revoke proxy gốc và assign thủ công cho user với thời hạn cụ thể.",
      } satisfies ApiResponse<never> & { message: string },
      { status: 422 },
    );
  }

  // 1. ATOMIC CLAIM LOCK — flip claim to approved with replacement
  // still null. The .eq("status","pending") + .select().maybeSingle()
  // is the lock; if another admin won, this returns null.
  const { data: lockedClaim, error: lockErr } = await supabaseAdmin
    .from("warranty_claims")
    .update({
      status: "approved",
      also_mark_banned: alsoMarkBanned,
      resolved_by: adminId,
      resolved_at: resolvedAtIso,
      // replacement_proxy_id stays null — set in step 5 if allocator wins
    })
    .eq("id", claimId)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();

  if (lockErr || !lockedClaim) {
    captureError(lockErr ?? new Error("Claim already approved/rejected (race)"), {
      source: "api.warranty.approve.lock_claim",
      extra: { claim_id: claimId },
    });
    return NextResponse.json(
      {
        success: false,
        error: "Claim no longer pending (another admin won the race)",
        message:
          "Yêu cầu này đã được admin khác xử lý cùng lúc. Vui lòng tải lại trang.",
      } satisfies ApiResponse<never>,
      { status: 409 },
    );
  }

  // Helper — revert the claim back to pending so admin can retry.
  // Used when allocator/proxy updates fail after we won the lock.
  //
  // Wave 26-D bug hunt v3 [HIGH] — race guard. Pre-fix the revert
  // UPDATE had no guard on status / resolved_by, so it would
  // unconditionally clear the claim's resolved fields. If between
  // our lock-win (status=approved, resolved_by=admin.id) and the
  // revert call ANY other process had touched the claim (e.g.,
  // a webhook retry, an admin clicking approve a second time and
  // somehow winning the new lock), we'd silently overwrite their
  // state. Now: only revert IF the claim is still in the exact
  // state we left it (`approved` + `resolved_by = admin.id`); if
  // someone else now owns it, leave it alone.
  async function revertClaim(reason: string) {
    captureError(new Error(`approve revert: ${reason}`), {
      source: "api.warranty.approve.revert",
      extra: { claim_id: claimId, reason },
    });
    await supabaseAdmin
      .from("warranty_claims")
      .update({
        status: "pending",
        resolved_by: null,
        resolved_at: null,
      })
      .eq("id", claimId)
      .eq("status", "approved")
      .eq("resolved_by", adminId);
  }

  // 2. Allocator. Tier 3 fallback to "any available". Wave 26-D bug
  // hunt [P0-3] — pickReplacementProxy still has SELECT/UPDATE race
  // window with auto-assign; mitigated by step 3's atomic guard.
  const { proxy: replacement, tier } = await pickReplacementProxy({
    originalProxy: original,
    supabase: supabaseAdmin,
  });

  if (!replacement) {
    await revertClaim("no_replacement_available");
    return NextResponse.json(
      {
        success: false,
        error: "no_replacement_available",
        message:
          "Không tìm được proxy thay thế (đã thử cả 3 tier: cùng category+network, cùng category, bất kỳ). Hãy import thêm proxy hoặc thử lại sau. Yêu cầu được giữ ở trạng thái Đang đợi.",
      } satisfies ApiResponse<never>,
      { status: 503 },
    );
  }

  const newOriginalStatus = alsoMarkBanned ? "banned" : "maintenance";
  const decrement = settings.reliability_decrement;
  const newReliabilityScore = Math.max(
    0,
    (original.reliability_score ?? 100) - decrement,
  );

  // 3. UPDATE replacement — atomic guard via .eq("status","available").
  // .select().maybeSingle() returns null on 0-row UPDATE (another
  // auto-assign grabbed it between SELECT and UPDATE).
  const { data: updatedReplacement, error: repErr } = await supabaseAdmin
    .from("proxies")
    .update({
      status: "assigned",
      assigned_to: userId,
      assigned_at: resolvedAtIso,
      expires_at: original.expires_at,
    })
    .eq("id", replacement.id)
    .eq("status", "available")
    .select("id")
    .maybeSingle();

  if (repErr || !updatedReplacement) {
    await revertClaim("replacement_grabbed_by_concurrent_assign");
    captureError(
      repErr ?? new Error("Replacement proxy grabbed by concurrent assign"),
      {
        source: "api.warranty.approve.update_replacement",
        extra: { claim_id: claimId, replacement_id: replacement.id },
      },
    );
    return NextResponse.json(
      {
        success: false,
        error: "replacement_no_longer_available",
        message:
          "Proxy thay thế đã bị cấp cho user khác giữa chừng. Vui lòng thử lại — yêu cầu vẫn ở trạng thái Đang đợi.",
      } satisfies ApiResponse<never>,
      { status: 409 },
    );
  }

  // 4. UPDATE original — atomic guard via .eq("status","reported_broken").
  // If 0 rows match (admin manually changed status outside this flow),
  // we don't revert because replacement is already assigned to user.
  // Log a warning so support can investigate.
  const { data: updatedOriginal } = await supabaseAdmin
    .from("proxies")
    .update({
      status: newOriginalStatus,
      assigned_to: null,
      assigned_at: null,
      reliability_score: newReliabilityScore,
    })
    .eq("id", original.id)
    .eq("status", "reported_broken")
    .select("id")
    .maybeSingle();

  if (!updatedOriginal) {
    captureError(
      new Error("Original proxy not in reported_broken at approve time"),
      {
        source: "api.warranty.approve.update_original_skipped",
        extra: {
          claim_id: claimId,
          original_id: original.id,
          original_status_at_fetch: original.status,
        },
      },
    );
    // Don't revert — replacement is already assigned to user. Just log
    // the inconsistency. Admin can manually fix the original proxy
    // status if it ended up wrong.
  }

  // 5. UPDATE claim with final replacement_proxy_id.
  //
  // Wave 26-D bug hunt v4 [HIGH] — switch to `.maybeSingle()` and
  // treat 0-row updates as a partial-success.
  //
  // Pre-fix this used `.single()` which throws PGRST116 on 0 rows AND
  // doesn't distinguish that case from a real DB error. If anything
  // failed here (e.g., another process hard-deleted the claim row
  // between step 1 lock and now), we returned 500 — telling admin
  // "approval failed" — even though steps 2-4 had already succeeded:
  //   * proxy assigned to the user (replacement now in user's hands)
  //   * original proxy status flipped (no longer in pool)
  //   * notification fired
  //
  // Rolling those back is hard (replacement is "live" — user could
  // already be using it). The honest response is "partial success":
  // 200 with `partial_success: true` + a clear message. Admin sees
  // the claim row is missing the FK and can fix manually via the
  // warranty page.
  const { data: updatedClaim, error: claimErr } = await supabaseAdmin
    .from("warranty_claims")
    .update({ replacement_proxy_id: replacement.id })
    .eq("id", claimId)
    .select("*")
    .maybeSingle();

  if (claimErr) {
    captureError(claimErr, {
      source: "api.warranty.approve.update_claim_final.db_error",
      extra: { claim_id: claimId },
    });
    return NextResponse.json(
      {
        success: false,
        error: "Failed to finalise claim",
        message:
          "Đã cấp proxy thay thế nhưng không cập nhật được claim do lỗi DB. Vui lòng kiểm tra warranty_claims thủ công.",
      } satisfies ApiResponse<never>,
      { status: 500 },
    );
  }
  if (!updatedClaim) {
    // 0-row update — claim was hard-deleted between our lock and now.
    // Replacement is already in user's hands; report partial success.
    captureError(new Error("Claim row missing at final FK update"), {
      source: "api.warranty.approve.update_claim_final.0rows",
      extra: { claim_id: claimId, replacement_id: replacement.id },
    });
    // Fire audit + notify even on partial success — they don't depend
    // on the FK being persisted.
    await Promise.allSettled([
      logProxyEvent({
        proxy_id: original.id,
        event_type: "warranty_approved",
        actor_type: "admin",
        actor_id: adminId,
        related_user_id: userId,
        related_proxy_id: replacement.id,
        details: {
          claim_id: claimId,
          partial_success: true,
          reason: "claim_row_missing_at_final_fk_update",
        },
      }),
    ]);
    void notifyUserApproved(userId, original, replacement).catch((err) => {
      captureError(err, {
        source: "api.warranty.approve.notify_user",
        extra: { claim_id: claimId, user_id: userId },
      });
    });
    return NextResponse.json(
      {
        success: true,
        data: {
          claim: lockedClaim as WarrantyClaim,
          replacement,
          allocator_tier: tier,
          banned: alsoMarkBanned,
          partial_success: true,
        },
      } satisfies ApiResponse<ApproveResult>,
    );
  }

  // 5. Audit events — best-effort.
  await Promise.all([
    logProxyEvent({
      proxy_id: original.id,
      event_type: "warranty_approved",
      actor_type: "admin",
      actor_id: adminId,
      related_user_id: userId,
      related_proxy_id: replacement.id,
      details: {
        claim_id: claimId,
        also_mark_banned: alsoMarkBanned,
        new_status: newOriginalStatus,
        allocator_tier: tier,
        reliability_score: newReliabilityScore,
      },
    }),
    logProxyEvent({
      proxy_id: replacement.id,
      event_type: "warranty_replacement_for",
      actor_type: "admin",
      actor_id: adminId,
      related_user_id: userId,
      related_proxy_id: original.id,
      details: { claim_id: claimId, allocator_tier: tier },
    }),
    logProxyEvent({
      proxy_id: replacement.id,
      event_type: "assigned",
      actor_type: "admin",
      actor_id: adminId,
      related_user_id: userId,
      details: {
        via: "warranty_replacement",
        original_proxy_id: original.id,
        claim_id: claimId,
      },
    }),
  ]);

  // 6. Notify user via bot Telegram (F1=c). Best-effort — failed
  // notification doesn't roll back the approval. Fetch telegram_id +
  // language from tele_users for the DM.
  void notifyUserApproved(userId, original, replacement).catch((err) => {
    captureError(err, {
      source: "api.warranty.approve.notify_user",
      extra: { claim_id: claimId, user_id: userId },
    });
  });

  return NextResponse.json({
    success: true,
    data: {
      claim: updatedClaim as WarrantyClaim,
      replacement: replacement,
      allocator_tier: tier,
      banned: alsoMarkBanned,
    },
  } satisfies ApiResponse<ApproveResult>);
}

// ─── Reject flow ──────────────────────────────────────────────────────
//
// Wave 26-D bug hunt — race-safe via .select().maybeSingle() on the
// claim UPDATE. If another admin already approved/rejected, the
// .eq("status","pending") guard returns 0 rows → null → 409.
async function handleReject(args: {
  claimId: string;
  adminId: string;
  proxyId: string;
  rejection_reason: string;
}): Promise<NextResponse<ApiResponse<RejectResult>>> {
  const { claimId, adminId, proxyId, rejection_reason } = args;

  // 1. UPDATE claim — atomic guard. .maybeSingle() returns null when
  // race lost; .single() would throw on 0 rows which we want to handle
  // with a clean 409.
  const { data: updatedClaim, error: claimErr } = await supabaseAdmin
    .from("warranty_claims")
    .update({
      status: "rejected",
      rejection_reason,
      resolved_by: adminId,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", claimId)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();

  if (claimErr || !updatedClaim) {
    captureError(claimErr ?? new Error("Claim update returned no row (race)"), {
      source: "api.warranty.reject.update_claim",
      extra: { claim_id: claimId },
    });
    return NextResponse.json(
      {
        success: false,
        error: "Claim no longer pending (another admin won the race)",
        message: "Yêu cầu này đã được xử lý rồi. Vui lòng tải lại trang.",
      } satisfies ApiResponse<never>,
      { status: 409 },
    );
  }

  // 2. Revert proxy.status reported_broken → assigned. User keeps the
  // proxy as-is — admin determined the report was a misclick / fixable
  // user-side issue.
  //
  // Wave 28-F [HIGH, audit #3] — detect 0-row revert via .select() so
  // the user-notification can include "your proxy was changed in the
  // meantime — verify before continuing to use it" instead of the
  // unconditional "Bạn vẫn có thể tiếp tục dùng proxy này" lie.
  // Pre-fix: if the proxy was banned / available-d by another admin
  // mid-claim, the .eq("status","reported_broken") matched 0 rows,
  // revertErr was null, and the user was told to keep using a
  // banned proxy. Now: revertedRows tracks how many we actually
  // updated; the notify path receives a flag for the bot reply.
  const { data: revertedRows, error: revertErr } = await supabaseAdmin
    .from("proxies")
    .update({ status: "assigned" })
    .eq("id", proxyId)
    .eq("status", "reported_broken")
    .select("id, status");

  const revertSucceeded =
    !revertErr && Array.isArray(revertedRows) && revertedRows.length > 0;

  if (revertErr) {
    captureError(revertErr, {
      source: "api.warranty.reject.revert_proxy_status",
      extra: { claim_id: claimId, proxy_id: proxyId },
    });
    // Don't fail — claim row is updated, admin can manually fix proxy
    // status if revert failed.
  }

  if (!revertSucceeded && !revertErr) {
    // 0-row case: another admin changed proxy status mid-flight.
    // Log with high signal so ops + the user-notification path
    // both know to handle the divergence.
    captureError(
      new Error(
        "warranty.reject: proxy revert 0-row — another admin changed status mid-claim",
      ),
      {
        source: "api.warranty.reject.revert_zero_row",
        extra: { claim_id: claimId, proxy_id: proxyId },
      },
    );
  }

  // 3. Audit event.
  await logProxyEvent({
    proxy_id: proxyId,
    event_type: "warranty_rejected",
    actor_type: "admin",
    actor_id: adminId,
    related_user_id: updatedClaim.user_id,
    details: {
      claim_id: claimId,
      rejection_reason,
      // Wave 28-F — record whether the revert took effect so the
      // event log shows the divergence for any later "why is the
      // user complaining?" investigation.
      proxy_revert_succeeded: revertSucceeded,
    },
  });

  // 4. Notify user (best-effort, F1=c).
  // Pass `proxyStillUsable` so the bot reply can be honest: if the
  // revert didn't take, the message tells the user to verify with
  // admin before relying on the proxy again.
  void notifyUserRejected(
    updatedClaim.user_id,
    proxyId,
    rejection_reason,
    revertSucceeded,
  ).catch(
    (err) => {
      captureError(err, {
        source: "api.warranty.reject.notify_user",
        extra: { claim_id: claimId, user_id: updatedClaim.user_id },
      });
    },
  );

  return NextResponse.json({
    success: true,
    data: { claim: updatedClaim as WarrantyClaim },
  } satisfies ApiResponse<RejectResult>);
}

// ─── Notification helpers ─────────────────────────────────────────────
async function notifyUserApproved(
  userId: string,
  originalProxy: Proxy,
  replacement: Proxy,
): Promise<void> {
  const { data: user } = await supabaseAdmin
    .from("tele_users")
    .select("telegram_id, language")
    .eq("id", userId)
    .single();
  if (!user?.telegram_id) return;

  const lang = user.language === "en" ? "en" : "vi";
  // Wave 26-D bug hunt — also escape original proxy host:port
  // (defence-in-depth, host might contain dot/dash but unusual chars
  // could leak through). safeCredentialString already escapes backticks
  // for the credential block.
  const credential = `\`${safeCredentialString(replacement.host, replacement.port, replacement.username, replacement.password)}\``;
  const originalLabel = `\`${escapeMarkdown(`${originalProxy.host}:${originalProxy.port}`)}\``;

  const text =
    lang === "vi"
      ? [
          "*Bảo hành proxy đã được duyệt*",
          "",
          `Proxy gốc: ${originalLabel} đã được thay thế.`,
          "",
          `*Proxy mới của bạn:*`,
          credential,
          `(${replacement.type.toUpperCase()})`,
          "",
          "Hạn dùng giữ nguyên như proxy gốc. Chúc bạn dùng tốt!",
        ].join("\n")
      : [
          "*Warranty approved*",
          "",
          `Original: ${originalLabel} has been replaced.`,
          "",
          `*Your new proxy:*`,
          credential,
          `(${replacement.type.toUpperCase()})`,
          "",
          "Expiry date is preserved from the original. Enjoy!",
        ].join("\n");

  await sendTelegramMessage(user.telegram_id, text);
}

async function notifyUserRejected(
  userId: string,
  proxyId: string,
  rejectionReason: string,
  // Wave 28-F [HIGH, audit #3] — caller passes whether the proxy
  // actually reverted to `assigned`. If false, the bot reply tells
  // the user to verify with admin before relying on the proxy
  // (it might have been banned mid-claim by another admin).
  proxyStillUsable: boolean,
): Promise<void> {
  const [userRes, proxyRes] = await Promise.all([
    supabaseAdmin
      .from("tele_users")
      .select("telegram_id, language")
      .eq("id", userId)
      .single(),
    supabaseAdmin
      .from("proxies")
      .select("host, port")
      .eq("id", proxyId)
      .single(),
  ]);
  if (!userRes.data?.telegram_id) return;

  const lang = userRes.data.language === "en" ? "en" : "vi";
  // Wave 26-D bug hunt [MED-1] — escape user-facing strings before
  // injecting into parse_mode=Markdown. Pre-fix: admin-typed
  // rejection_reason with `*` or unclosed backtick caused Telegram
  // 400 "can't parse entities" → notification silently failed.
  const proxyLabel = proxyRes.data
    ? `\`${escapeMarkdown(`${proxyRes.data.host}:${proxyRes.data.port}`)}\``
    : "proxy";
  const safeReason = escapeMarkdown(rejectionReason);

  // Wave 28-F — branch the closing line based on whether the
  // proxy actually reverted to assigned. Honest message in both
  // states.
  const closingLineVi = proxyStillUsable
    ? "Bạn vẫn có thể tiếp tục dùng proxy này."
    : "Lưu ý: proxy này hiện không còn ở trạng thái dùng được. Vui lòng liên hệ admin để xác nhận trước khi tiếp tục sử dụng.";
  const closingLineEn = proxyStillUsable
    ? "You can continue using this proxy."
    : "Note: this proxy is no longer usable. Please confirm with admin before continuing to use it.";

  const text =
    lang === "vi"
      ? [
          "*Yêu cầu bảo hành bị từ chối*",
          "",
          `Proxy: ${proxyLabel}`,
          "",
          `*Lý do từ chối:*`,
          safeReason,
          "",
          closingLineVi,
        ].join("\n")
      : [
          "*Warranty rejected*",
          "",
          `Proxy: ${proxyLabel}`,
          "",
          `*Reason:*`,
          safeReason,
          "",
          closingLineEn,
        ].join("\n");

  await sendTelegramMessage(userRes.data.telegram_id, text);
}
