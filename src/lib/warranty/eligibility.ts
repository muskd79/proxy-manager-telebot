/**
 * Wave 26-D — warranty eligibility + anti-abuse check.
 *
 * Pure functions called by:
 *   - bot when user clicks "Báo lỗi" (validate before opening claim)
 *   - POST /api/warranty (defence-in-depth — bot might be out of sync)
 *
 * Rules (from BRAINSTORM_PROXIES_2026-05-03.md vòng 2-4 user-chốt):
 *
 *   A2 HYBRID — eligibility window:
 *     - setting `warranty_eligibility_unlimited` = false (default)
 *       → claim only allowed within 24h after assigned_at
 *     - setting `warranty_eligibility_unlimited` = true
 *       → claim allowed ANYTIME the proxy is still valid (expires_at
 *         > now OR null)
 *
 *   A3 (e) — anti-abuse trio:
 *     - max `warranty_max_pending` (default 2) pending claims per user
 *     - max `warranty_max_per_30d` (default 5) claims per user in
 *       the rolling 30-day window
 *     - cooldown `warranty_cooldown_minutes` (default 60) between any
 *       two consecutive claims by the same user
 *
 *   Plus: status check — user can ONLY claim a proxy in status
 *   `assigned` AND assigned to themselves. Other statuses (already
 *   reported_broken, expired, banned, available) reject up-front.
 *
 *   Plus: duplicate guard — user can't have 2 pending claims against
 *   the SAME proxy.
 *
 * Tests cover every reject path (10 cases). The bot uses these
 * functions client-side BEFORE submit so users see a friendly Vietnamese
 * error instead of an HTTP 400.
 */

import type { Proxy, WarrantyClaim } from "@/types/database";
import { ProxyStatus } from "@/types/database";

// ─── Settings shape (subset of /settings table values) ─────────────
export interface WarrantySettings {
  /** A2 — when true, claim allowed any time within proxy lifetime. */
  eligibility_unlimited: boolean;
  /** A3-a — max simultaneous pending claims per user. */
  max_pending: number;
  /** A3-b — max claims in rolling 30 days per user. */
  max_per_30d: number;
  /** A3-c — minimum minutes between two consecutive claims. */
  cooldown_minutes: number;
}

export const DEFAULT_WARRANTY_SETTINGS: WarrantySettings = {
  eligibility_unlimited: false,
  max_pending: 2,
  max_per_30d: 5,
  cooldown_minutes: 60,
};

const ELIGIBILITY_WINDOW_HOURS = 24;
const MS_PER_HOUR = 3_600_000;
const MS_PER_30D = 30 * 24 * MS_PER_HOUR;
const MS_PER_MINUTE = 60_000;

// ─── Reject reason codes — UI maps these to Vietnamese strings ────
export type WarrantyEligibilityResult =
  | { allowed: true }
  | { allowed: false; code: WarrantyRejectCode; details?: string };

export type WarrantyRejectCode =
  | "proxy_not_assigned_to_user"
  | "proxy_status_invalid"        // not in 'assigned' state
  | "outside_eligibility_window"   // > 24h after assigned_at, unlimited=false
  | "proxy_expired"                // expires_at < now
  | "duplicate_pending_claim"      // user already has pending claim on same proxy
  | "max_pending_reached"          // ≥ warranty_max_pending pending across all proxies
  | "max_per_30d_reached"          // ≥ warranty_max_per_30d in last 30d
  | "cooldown_active";             // last claim < cooldown ago

// Friendly Vietnamese strings — exported so bot + web can render
// the same message without each surface re-translating.
export const WARRANTY_REJECT_LABEL_VI: Record<WarrantyRejectCode, string> = {
  proxy_not_assigned_to_user:
    "Proxy này không phải của bạn — không thể báo lỗi",
  proxy_status_invalid:
    "Proxy không ở trạng thái có thể báo lỗi (đã được xử lý hoặc đã thu hồi)",
  outside_eligibility_window:
    "Quá thời gian được phép báo lỗi (24h sau khi nhận proxy)",
  proxy_expired: "Proxy đã hết hạn — không thể báo lỗi",
  duplicate_pending_claim:
    "Bạn đã báo lỗi proxy này — đang chờ admin xử lý",
  max_pending_reached:
    "Bạn đã có quá nhiều claim đang chờ duyệt. Hãy đợi admin xử lý xong.",
  max_per_30d_reached:
    "Bạn đã dùng hết số lần báo lỗi trong 30 ngày qua.",
  cooldown_active:
    "Vui lòng đợi vài phút trước khi báo lỗi tiếp.",
};

interface CheckEligibilityArgs {
  proxy: Proxy;
  /** ID of the user attempting to file a claim. */
  userId: string;
  /** All claims by this user — caller fetched, passed in for purity. */
  userClaims: ReadonlyArray<
    Pick<WarrantyClaim, "id" | "proxy_id" | "status" | "created_at">
  >;
  settings?: Partial<WarrantySettings>;
  /** Inject `now` for deterministic tests. */
  now?: Date;
}

/**
 * Wave 26-D — gate function. Pure, deterministic when `now` is fixed.
 * Order of checks matters for UX — return the MOST USER-MEANINGFUL
 * reject first so the bot can render a single helpful message:
 *
 *   1. Proxy ownership / status (sanity)
 *   2. Eligibility window (most common reject)
 *   3. Per-proxy duplicate claim
 *   4. Per-user pending cap
 *   5. Per-user 30d cap
 *   6. Cooldown
 *
 * If everything passes, returns { allowed: true }.
 */
export function checkWarrantyEligibility({
  proxy,
  userId,
  userClaims,
  settings,
  now = new Date(),
}: CheckEligibilityArgs): WarrantyEligibilityResult {
  const cfg: WarrantySettings = { ...DEFAULT_WARRANTY_SETTINGS, ...settings };

  // 1. Proxy must currently be assigned to THIS user.
  if (proxy.assigned_to !== userId) {
    return { allowed: false, code: "proxy_not_assigned_to_user" };
  }
  if (proxy.status !== ProxyStatus.Assigned) {
    return {
      allowed: false,
      code: "proxy_status_invalid",
      details: `current=${proxy.status}`,
    };
  }

  // 2. Hard expiry — proxy already past expires_at can't be warrantied.
  if (proxy.expires_at) {
    const expiresMs = new Date(proxy.expires_at).getTime();
    if (expiresMs <= now.getTime()) {
      return { allowed: false, code: "proxy_expired" };
    }
  }

  // 3. Eligibility window (24h after assigned_at) UNLESS unlimited toggle on.
  if (!cfg.eligibility_unlimited) {
    if (!proxy.assigned_at) {
      // No assigned_at means we can't compute the 24h window. Treat
      // as outside-window for safety. In practice if assigned_to is
      // set, assigned_at is too (set atomically in auto_assign_proxy
      // RPC mig 004).
      return { allowed: false, code: "outside_eligibility_window" };
    }
    const assignedMs = new Date(proxy.assigned_at).getTime();
    const windowEnd = assignedMs + ELIGIBILITY_WINDOW_HOURS * MS_PER_HOUR;
    if (now.getTime() > windowEnd) {
      return { allowed: false, code: "outside_eligibility_window" };
    }
  }

  // 4. Per-proxy duplicate guard.
  const duplicate = userClaims.find(
    (c) => c.proxy_id === proxy.id && c.status === "pending",
  );
  if (duplicate) {
    return { allowed: false, code: "duplicate_pending_claim" };
  }

  // 5. Per-user pending cap.
  const pendingCount = userClaims.filter((c) => c.status === "pending").length;
  if (pendingCount >= cfg.max_pending) {
    return {
      allowed: false,
      code: "max_pending_reached",
      details: `${pendingCount}/${cfg.max_pending}`,
    };
  }

  // 6. Per-user 30d cap (counts ALL statuses — pending + approved + rejected).
  const thirtyDaysAgo = now.getTime() - MS_PER_30D;
  const last30dCount = userClaims.filter(
    (c) => new Date(c.created_at).getTime() >= thirtyDaysAgo,
  ).length;
  if (last30dCount >= cfg.max_per_30d) {
    return {
      allowed: false,
      code: "max_per_30d_reached",
      details: `${last30dCount}/${cfg.max_per_30d}`,
    };
  }

  // 7. Cooldown — last claim's age vs cooldown_minutes.
  if (cfg.cooldown_minutes > 0 && userClaims.length > 0) {
    const lastClaim = userClaims.reduce<typeof userClaims[number] | null>(
      (latest, c) => {
        if (!latest) return c;
        return new Date(c.created_at).getTime() >
          new Date(latest.created_at).getTime()
          ? c
          : latest;
      },
      null,
    );
    if (lastClaim) {
      const sinceMs = now.getTime() - new Date(lastClaim.created_at).getTime();
      if (sinceMs < cfg.cooldown_minutes * MS_PER_MINUTE) {
        const remainingMin = Math.ceil(
          (cfg.cooldown_minutes * MS_PER_MINUTE - sinceMs) / MS_PER_MINUTE,
        );
        return {
          allowed: false,
          code: "cooldown_active",
          details: `${remainingMin}min`,
        };
      }
    }
  }

  return { allowed: true };
}
