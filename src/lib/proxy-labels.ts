/**
 * Wave 22J — single source of truth for proxy display labels.
 *
 * Centralised so any future i18n switch is a one-file change. The
 * UI everywhere (table headers, badges, filter dropdowns, form
 * labels) imports from here instead of hardcoding strings.
 *
 * All labels here are Vietnamese-first per the user's requirement
 * for full Vietnamese UI on the proxy management surface. English
 * fallback comes from the source enum value.
 */

import type { Proxy } from "@/types/database";
import { EXPIRING_SOON_THRESHOLD_MS } from "@/lib/constants";

// ============================================================
// Network type — proxy classification
// ============================================================

export const NETWORK_TYPE_VALUES = [
  "isp",
  "datacenter_ipv4",
  "datacenter_ipv6",
  "residential",
  "mobile",
  "static_residential",
] as const;

export type NetworkType = (typeof NETWORK_TYPE_VALUES)[number];

export const NETWORK_TYPE_LABEL: Record<NetworkType, string> = {
  isp: "ISP",
  datacenter_ipv4: "Datacenter IPv4",
  datacenter_ipv6: "Datacenter IPv6",
  residential: "Dân cư",
  mobile: "Mobile (4G/5G)",
  static_residential: "Static Residential",
};

export const NETWORK_TYPE_BADGE: Record<
  NetworkType,
  "default" | "secondary" | "outline" | "destructive"
> = {
  isp: "default",
  datacenter_ipv4: "secondary",
  datacenter_ipv6: "secondary",
  residential: "default",
  mobile: "outline",
  static_residential: "default",
};

export function networkTypeLabel(t: NetworkType | null | undefined): string {
  if (!t) return "Chưa phân loại";
  return NETWORK_TYPE_LABEL[t] ?? t;
}

// ============================================================
// Lifecycle status — proxies.status enum + hidden boolean
// ============================================================

export type ProxyStatusValue =
  | "available"
  | "assigned"
  | "expired"
  | "banned"
  | "maintenance";

export const STATUS_LABEL: Record<ProxyStatusValue, string> = {
  available: "Sẵn sàng",
  assigned: "Đã giao",
  expired: "Hết hạn",
  banned: "Báo lỗi",
  maintenance: "Bảo trì",
};

export const STATUS_BADGE: Record<
  ProxyStatusValue,
  "default" | "secondary" | "outline" | "destructive"
> = {
  available: "default",
  assigned: "secondary",
  expired: "outline",
  banned: "destructive",
  maintenance: "outline",
};

export function statusLabel(s: ProxyStatusValue | string): string {
  return STATUS_LABEL[s as ProxyStatusValue] ?? s;
}

// ============================================================
// Expiry status — derived from expires_at (separate from
// lifecycle status per the user's request).
// ============================================================

export type ExpiryStatus = "valid" | "expiring_soon" | "expired" | "never";

export const EXPIRY_LABEL: Record<ExpiryStatus, string> = {
  valid: "Còn hạn",
  expiring_soon: "Sắp hết hạn",
  expired: "Hết hạn",
  never: "Vĩnh viễn",
};

export const EXPIRY_BADGE: Record<
  ExpiryStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  valid: "default",
  expiring_soon: "outline",
  expired: "destructive",
  never: "outline",
};

/**
 * Derive expiry state from a proxy's expires_at timestamp.
 * "Sắp hết hạn" threshold = 7 days. Adjust here if the rule
 * changes; UI never recomputes.
 */
export function deriveExpiryStatus(
  expires_at: string | null | undefined,
  now = new Date(),
): ExpiryStatus {
  if (!expires_at) return "never";
  const t = new Date(expires_at).getTime();
  const nowMs = now.getTime();
  if (t <= nowMs) return "expired";
  if (t - nowMs < EXPIRING_SOON_THRESHOLD_MS) return "expiring_soon";
  return "valid";
}

// ============================================================
// Wire protocol (proxy.type) — UI label
// ============================================================

export const TYPE_LABEL: Record<"http" | "https" | "socks5", string> = {
  http: "HTTP",
  https: "HTTPS",
  socks5: "SOCKS5",
};

// ============================================================
// Combined "trạng thái" badge logic for the proxy table.
// Returns a list of badges to render in the status column —
// hidden + lifecycle + expiry, in that priority order.
// ============================================================

export interface StatusBadge {
  label: string;
  variant: "default" | "secondary" | "outline" | "destructive";
  tone?: "muted";
}

/**
 * Wave 22AB — single-badge model per user spec.
 *
 * Pre-22AB returned an array (lifecycle + expiry + hidden each as
 * own badge) which produced confusing rows like "Bảo trì + Sắp hết
 * hạn + ...". User explicitly said: "trạng thái cần có: sẵn sàng,
 * đã giao, báo lỗi, đã ẩn, sắp hết hạn — chỉ có 5 loại này thôi".
 *
 * Priority order (highest first wins; only ONE badge rendered):
 *   1. hidden=true          → "Đã ẩn"        (cascade trigger keeps
 *                                              proxies.hidden in sync
 *                                              with category.is_hidden,
 *                                              so this covers both)
 *   2. status="banned"      → "Báo lỗi"
 *   3. expires_at within 3d → "Sắp hết hạn"  (NOT yet expired)
 *   4. status="assigned"    → "Đã giao"
 *   5. else                 → "Sẵn sàng"
 *
 * `maintenance` and `expired` enum values still exist server-side
 * for legacy data; they fall through to "Sẵn sàng" in the UI. If
 * an admin needs to see them surgically they can sort by status
 * column — the filter dropdown stops exposing them.
 *
 * Returns array (length 1 or 0) so the table cell map stays the
 * same — one less call site to update.
 */
export function proxyStatusBadges(
  p: Pick<Proxy, "status" | "expires_at" | "hidden">,
): StatusBadge[] {
  if (p.hidden) {
    return [{ label: "Đã ẩn", variant: "outline", tone: "muted" }];
  }
  if (p.status === "banned") {
    return [{ label: "Báo lỗi", variant: "destructive" }];
  }
  // expiring_soon overrides assigned/available so admin sees the
  // urgency BEFORE the lifecycle status.
  const exp = deriveExpiryStatus(p.expires_at);
  if (exp === "expiring_soon") {
    return [{ label: "Sắp hết hạn", variant: "outline" }];
  }
  if (p.status === "assigned") {
    return [{ label: "Đã giao", variant: "secondary" }];
  }
  return [{ label: "Sẵn sàng", variant: "default" }];
}
