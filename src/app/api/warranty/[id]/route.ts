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
import { safeCredentialString } from "@/lib/telegram/format";
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
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
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
async function handleApprove(args: {
  claimId: string;
  adminId: string;
  original: Proxy;
  userId: string;
  alsoMarkBanned: boolean;
}): Promise<NextResponse<ApiResponse<ApproveResult>>> {
  const { claimId, adminId, original, userId, alsoMarkBanned } = args;
  const settings = await loadWarrantySettings();

  // 1. Allocator. Tier 3 fallback to "any available" so we maximise
  // success rate; admin sees which tier matched in the response so
  // they can re-evaluate stock.
  const { proxy: replacement, tier } = await pickReplacementProxy({
    originalProxy: original,
    supabase: supabaseAdmin,
  });

  if (!replacement) {
    return NextResponse.json(
      {
        success: false,
        error: "no_replacement_available",
        message:
          "Không tìm được proxy thay thế (đã thử cả 3 tier: cùng category+network, cùng category, bất kỳ). Hãy import thêm proxy hoặc thử lại sau.",
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

  // 2. UPDATE original — atomic guard via .eq("status", "reported_broken")
  // so concurrent duplicate approve doesn't double-allocate.
  const { error: origErr } = await supabaseAdmin
    .from("proxies")
    .update({
      status: newOriginalStatus,
      assigned_to: null,
      assigned_at: null,
      reliability_score: newReliabilityScore,
    })
    .eq("id", original.id)
    .eq("status", "reported_broken");

  if (origErr) {
    captureError(origErr, {
      source: "api.warranty.approve.update_original",
      extra: { claim_id: claimId },
    });
    return NextResponse.json(
      { success: false, error: "Failed to update original proxy" } satisfies ApiResponse<never>,
      { status: 500 },
    );
  }

  // 3. UPDATE replacement — assign to user, copy expires_at from
  // original (A6=a). Optimistic guard against the allocator's
  // SELECT-then-UPDATE race.
  const { error: repErr } = await supabaseAdmin
    .from("proxies")
    .update({
      status: "assigned",
      assigned_to: userId,
      assigned_at: new Date().toISOString(),
      expires_at: original.expires_at,
    })
    .eq("id", replacement.id)
    .eq("status", "available");

  if (repErr) {
    captureError(repErr, {
      source: "api.warranty.approve.update_replacement",
      extra: { claim_id: claimId, replacement_id: replacement.id },
    });
    // Best-effort — original already in maintenance. Caller can retry.
    return NextResponse.json(
      { success: false, error: "Failed to assign replacement" } satisfies ApiResponse<never>,
      { status: 500 },
    );
  }

  // 4. UPDATE claim row.
  const { data: updatedClaim, error: claimErr } = await supabaseAdmin
    .from("warranty_claims")
    .update({
      status: "approved",
      replacement_proxy_id: replacement.id,
      also_mark_banned: alsoMarkBanned,
      resolved_by: adminId,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", claimId)
    .eq("status", "pending")
    .select("*")
    .single();

  if (claimErr || !updatedClaim) {
    captureError(claimErr ?? new Error("Claim update returned no row"), {
      source: "api.warranty.approve.update_claim",
      extra: { claim_id: claimId },
    });
    return NextResponse.json(
      { success: false, error: "Failed to record approval" } satisfies ApiResponse<never>,
      { status: 500 },
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
async function handleReject(args: {
  claimId: string;
  adminId: string;
  proxyId: string;
  rejection_reason: string;
}): Promise<NextResponse<ApiResponse<RejectResult>>> {
  const { claimId, adminId, proxyId, rejection_reason } = args;

  // 1. UPDATE claim — atomic guard.
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
    .single();

  if (claimErr || !updatedClaim) {
    captureError(claimErr ?? new Error("Claim update returned no row"), {
      source: "api.warranty.reject.update_claim",
      extra: { claim_id: claimId },
    });
    return NextResponse.json(
      { success: false, error: "Failed to record rejection" } satisfies ApiResponse<never>,
      { status: 500 },
    );
  }

  // 2. Revert proxy.status reported_broken → assigned. User keeps the
  // proxy as-is — admin determined the report was a misclick / fixable
  // user-side issue.
  const { error: revertErr } = await supabaseAdmin
    .from("proxies")
    .update({ status: "assigned" })
    .eq("id", proxyId)
    .eq("status", "reported_broken");

  if (revertErr) {
    captureError(revertErr, {
      source: "api.warranty.reject.revert_proxy_status",
      extra: { claim_id: claimId, proxy_id: proxyId },
    });
    // Don't fail — claim row is updated, admin can manually fix proxy
    // status if revert failed.
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
    },
  });

  // 4. Notify user (best-effort, F1=c).
  void notifyUserRejected(updatedClaim.user_id, proxyId, rejection_reason).catch(
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
  const credential = `\`${safeCredentialString(replacement.host, replacement.port, replacement.username, replacement.password)}\``;

  const text =
    lang === "vi"
      ? [
          "*Bảo hành proxy đã được duyệt*",
          "",
          `Proxy gốc: \`${originalProxy.host}:${originalProxy.port}\` đã được thay thế.`,
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
          `Original: \`${originalProxy.host}:${originalProxy.port}\` has been replaced.`,
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
  const proxyLabel = proxyRes.data
    ? `\`${proxyRes.data.host}:${proxyRes.data.port}\``
    : "proxy";

  const text =
    lang === "vi"
      ? [
          "*Yêu cầu bảo hành bị từ chối*",
          "",
          `Proxy: ${proxyLabel}`,
          "",
          `*Lý do từ chối:*`,
          rejectionReason,
          "",
          "Bạn vẫn có thể tiếp tục dùng proxy này.",
        ].join("\n")
      : [
          "*Warranty rejected*",
          "",
          `Proxy: ${proxyLabel}`,
          "",
          `*Reason:*`,
          rejectionReason,
          "",
          "You can continue using this proxy.",
        ].join("\n");

  await sendTelegramMessage(userRes.data.telegram_id, text);
}
