/**
 * Wave 26-D bug hunt v4 [HIGH] — single source of truth for warranty
 * claim submission.
 *
 * Pre-fix the bot (`src/lib/telegram/commands/warranty.ts`'s
 * `submitWarrantyClaim`) and the HTTP endpoint
 * (`src/app/api/warranty/route.ts` POST) each implemented the same
 * 4-step submit pipeline:
 *   1. Re-fetch proxy + claims + settings.
 *   2. Re-run `checkWarrantyEligibility`.
 *   3. INSERT warranty_claims (and translate 23505 to a friendly
 *      duplicate-pending error).
 *   4. UPDATE proxies.status assigned -> reported_broken (atomic
 *      guard via `.eq("status", "assigned")`).
 *   5. logProxyEvent.
 *
 * They had ALREADY drifted — the bot path forgot to check
 * `proxyRes.error` (only `!proxyRes.data`), so a Supabase network
 * error fell through to a `proxy: null` eligibility call and crashed
 * the request. The HTTP path was correct.
 *
 * Now: this module is the only place those 5 steps live. Both
 * callers translate the typed result into their own output format
 * (Telegram reply vs JSON response).
 *
 * Side effects:
 *   - Writes to `warranty_claims`, `proxies`, `proxy_events`.
 *   - Calls `captureError` for non-fatal sub-failures (status
 *     transition or audit insert) but does NOT abort on them; the
 *     claim is the source of truth and admin can resolve manually.
 *
 * Pure-ish: deterministic given the DB state. Does NOT send
 * Telegram messages, does NOT format human-readable strings.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { captureError } from "@/lib/error-tracking";
import {
  checkWarrantyEligibility,
  type WarrantyRejectCode,
} from "@/lib/warranty/eligibility";
import { loadWarrantySettings } from "@/lib/warranty/settings";
import { logProxyEvent } from "@/lib/warranty/events";
import type {
  Proxy,
  WarrantyClaim,
  WarrantyClaimStatus,
  WarrantyReasonCode,
} from "@/types/database";

// ============================================================
// Types
// ============================================================

export interface SubmitWarrantyClaimInput {
  userId: string;
  proxyId: string;
  reasonCode: WarrantyReasonCode;
  reasonText: string | null;
}

/**
 * Discriminated union covering every terminal state of the submit
 * pipeline. Both bot and HTTP callers exhaustively switch on `kind`
 * to render their own UX (Telegram message vs HTTP status code +
 * JSON body).
 *
 * `kind` values:
 *   - `ok`             → claim row inserted, proxy transitioned, audit logged
 *   - `proxy_not_found` → proxy_id doesn't exist OR DB error fetching it
 *   - `ineligible`     → eligibility gate rejected (with code)
 *   - `duplicate_pending` → 23505 unique violation on (user_id, proxy_id)
 *   - `internal_error` → unexpected error (DB down, etc.)
 */
export type SubmitWarrantyClaimResult =
  | { kind: "ok"; claim: WarrantyClaim }
  | { kind: "proxy_not_found" }
  | { kind: "ineligible"; code: WarrantyRejectCode }
  | { kind: "duplicate_pending" }
  | { kind: "internal_error"; error: unknown };

// ============================================================
// Implementation
// ============================================================

const MS_PER_30D = 30 * 24 * 60 * 60 * 1000;

/**
 * Run the complete warranty submit pipeline. Used by:
 *   - the in-process Telegram bot (commands/warranty.ts)
 *   - the HTTP endpoint /api/warranty POST (for external bot deployments)
 *
 * Both callers MUST have already verified the user exists in
 * `tele_users` with `is_deleted = false` — this function does NOT
 * re-verify because that's the caller's auth surface.
 */
export async function submitWarrantyClaimCore(
  input: SubmitWarrantyClaimInput,
): Promise<SubmitWarrantyClaimResult> {
  const { userId, proxyId, reasonCode, reasonText } = input;

  try {
    // 1. Refetch fresh state for the eligibility gate.
    //
    // Why re-fetch in the bot path even though handleWarrantyClaim
    // already fetched: between picking the reason and submitting,
    // settings could have changed, the proxy could have expired, or
    // the user could have hit their 30-day cap via another claim.
    // Re-running the gate IMMEDIATELY before insert closes that
    // 30-min state TTL window. Three small queries — cheap.
    const sinceIso = new Date(Date.now() - MS_PER_30D).toISOString();
    const [proxyRes, claimsRes, settings] = await Promise.all([
      supabaseAdmin
        .from("proxies")
        .select("*")
        .eq("id", proxyId)
        .maybeSingle(),
      supabaseAdmin
        .from("warranty_claims")
        .select("id, proxy_id, status, created_at")
        .eq("user_id", userId)
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false }),
      loadWarrantySettings(),
    ]);

    // Wave 26-D bug hunt v4 [HIGH] — check `proxyRes.error` not just
    // `!proxyRes.data`. A Supabase network error sets BOTH error and
    // data=null; pre-fix the bot path treated this as a clean 404,
    // hiding real outages.
    if (proxyRes.error || !proxyRes.data) {
      if (proxyRes.error) {
        captureError(proxyRes.error, {
          source: "warranty.submit.proxy_fetch",
          extra: { userId, proxyId },
        });
      }
      return { kind: "proxy_not_found" };
    }

    if (claimsRes.error) {
      // Don't fail outright — eligibility gate handles missing claims
      // gracefully (treats as empty list = first-time user). But log
      // so ops can see if claim queries are systematically failing.
      captureError(claimsRes.error, {
        source: "warranty.submit.claims_fetch",
        extra: { userId, proxyId },
      });
    }

    // 2. Re-run eligibility.
    const eligibility = checkWarrantyEligibility({
      proxy: proxyRes.data as Proxy,
      userId,
      userClaims: claimsRes.data ?? [],
      settings,
    });
    if (!eligibility.allowed) {
      return { kind: "ineligible", code: eligibility.code };
    }

    // 3. INSERT the claim. The partial UNIQUE index from mig 058
    // raises 23505 when two simultaneous taps both try to insert
    // pending claims for the same (user, proxy) — translate to a
    // friendly duplicate-pending result.
    const { data: claim, error: claimErr } = await supabaseAdmin
      .from("warranty_claims")
      .insert({
        proxy_id: proxyId,
        user_id: userId,
        reason_code: reasonCode,
        reason_text: reasonText,
        status: "pending" as WarrantyClaimStatus,
      })
      .select("*")
      .single();

    if (claimErr || !claim) {
      const code = (claimErr as { code?: string } | null)?.code;
      if (code === "23505") {
        return { kind: "duplicate_pending" };
      }
      captureError(claimErr ?? new Error("Claim insert returned no row"), {
        source: "warranty.submit.insert",
        extra: { userId, proxyId, reasonCode },
      });
      return { kind: "internal_error", error: claimErr };
    }

    // 4. Transition proxy.status assigned -> reported_broken.
    // The .eq("status", "assigned") guard ensures we don't stomp
    // a concurrent admin transition (e.g., admin already revoked
    // the proxy between the gate and now).
    const { error: statusErr } = await supabaseAdmin
      .from("proxies")
      .update({ status: "reported_broken" })
      .eq("id", proxyId)
      .eq("status", "assigned");
    if (statusErr) {
      captureError(statusErr, {
        source: "warranty.submit.status_transition",
        extra: { userId, proxyId, claim_id: claim.id },
      });
      // Don't roll back — the claim row is the source of truth and
      // admin can manually resolve a desync via the warranty page.
    }

    // 5. Best-effort audit. await here so caller's response isn't
    // sent before the audit row hits the DB; logProxyEvent itself
    // swallows non-critical failures.
    await logProxyEvent({
      proxy_id: proxyId,
      event_type: "reported_broken",
      actor_type: "tele_user",
      actor_id: userId,
      related_user_id: userId,
      details: {
        reason_code: reasonCode,
        reason_text: reasonText,
        claim_id: claim.id,
      },
    });

    return { kind: "ok", claim: claim as WarrantyClaim };
  } catch (err) {
    captureError(err, {
      source: "warranty.submit.unexpected",
      extra: { userId, proxyId, reasonCode },
    });
    return { kind: "internal_error", error: err };
  }
}
