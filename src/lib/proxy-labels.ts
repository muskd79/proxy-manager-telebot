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

/**
 * Wave 26-C — alias map for legacy / human-friendly network_type values
 * that should be normalised to the canonical enum. Pre-fix, the import
 * wizard wrote `IPv4`, `Datacenter IPv4`, `dân cư`, `4G`, etc.
 * directly into proxies.network_type because the schema only enforced
 * length, not enum membership. The /proxies filter dropdown (which
 * sends canonical values like `datacenter_ipv4`) then failed to match
 * those rows — admins reported the list "không đồng bộ" with the
 * filter result count.
 *
 * Keys MUST be lower-case. We canonicalise by lower-casing the input
 * BEFORE looking up here.
 */
const NETWORK_TYPE_ALIASES: Record<string, NetworkType> = {
  // Canonical (idempotent — the lower-cased canonical maps to itself)
  isp: "isp",
  datacenter_ipv4: "datacenter_ipv4",
  datacenter_ipv6: "datacenter_ipv6",
  residential: "residential",
  mobile: "mobile",
  static_residential: "static_residential",
  // Legacy / human-friendly variants seen in production data
  "datacenter ipv4": "datacenter_ipv4",
  "datacenter-ipv4": "datacenter_ipv4",
  ipv4: "datacenter_ipv4",
  dc_ipv4: "datacenter_ipv4",
  dc4: "datacenter_ipv4",
  "datacenter ipv6": "datacenter_ipv6",
  "datacenter-ipv6": "datacenter_ipv6",
  ipv6: "datacenter_ipv6",
  dc_ipv6: "datacenter_ipv6",
  dc6: "datacenter_ipv6",
  "dân cư": "residential",
  "dan cu": "residential",
  resi: "residential",
  res: "residential",
  "4g": "mobile",
  "5g": "mobile",
  "4g/5g": "mobile",
  lte: "mobile",
  "static residential": "static_residential",
  "static-residential": "static_residential",
  "resi tĩnh": "static_residential",
  static_resi: "static_residential",
};

/**
 * Wave 26-C — normalise any user-supplied / legacy network_type value
 * to the canonical enum. Returns `null` for empty / unrecognised input.
 *
 * Idempotent: passing a canonical value returns it unchanged. Pure —
 * no side effects, no DB calls.
 *
 * Used by:
 *   - All four /api/proxies write paths (POST, PATCH, import, GET filter)
 *   - The category default_network_type write paths
 *   - The proxy form / import / category form on submit
 *   - networkTypeLabel() so even legacy DB rows render correctly
 */
export function normalizeNetworkType(
  raw: string | null | undefined,
): NetworkType | null {
  if (raw == null) return null;
  const cleaned = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (!cleaned) return null;
  // Direct hit (canonical or known alias)
  const direct = NETWORK_TYPE_ALIASES[cleaned];
  if (direct) return direct;
  // Try with spaces collapsed to underscores (e.g. "static residential")
  const underscored = cleaned.replace(/[\s-]/g, "_");
  const viaUnderscore = NETWORK_TYPE_ALIASES[underscored];
  if (viaUnderscore) return viaUnderscore;
  // Final fallback: the cleaned string itself if it's a known canonical
  if ((NETWORK_TYPE_VALUES as readonly string[]).includes(underscored)) {
    return underscored as NetworkType;
  }
  return null;
}

export function networkTypeLabel(
  t: NetworkType | string | null | undefined,
): string {
  if (!t) return "Chưa phân loại";
  // Normalise first so legacy rows (e.g. "IPv4", "Datacenter IPv4")
  // still render as "Datacenter IPv4" instead of leaking the raw value.
  const canonical = normalizeNetworkType(t);
  if (canonical) return NETWORK_TYPE_LABEL[canonical];
  // Unrecognised — fall through to the raw string so admins can spot
  // the bad data and clean it up via bulk-edit.
  return t;
}

// ============================================================
// Lifecycle status — proxies.status enum + hidden boolean
// ============================================================

// Wave 26-D bug hunt v2 [TS#5] — pre-fix `reported_broken` was missing
// from this union, so any proxy in that status fell through to the
// raw enum string in statusLabel() and was rendered as "Sẵn sàng" in
// proxyStatusBadges() (debugger flagged: warranty-pending proxies
// looked available). Now: full coverage.
export type ProxyStatusValue =
  | "available"
  | "assigned"
  | "reported_broken"
  | "expired"
  | "banned"
  | "maintenance";

export const STATUS_LABEL: Record<ProxyStatusValue, string> = {
  available: "Sẵn sàng",
  assigned: "Đã giao",
  reported_broken: "Đang báo lỗi",
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
  reported_broken: "destructive",
  expired: "outline",
  banned: "destructive",
  maintenance: "outline",
};

export function statusLabel(s: ProxyStatusValue | string): string {
  return STATUS_LABEL[s as ProxyStatusValue] ?? s;
}

// ============================================================
// Request lifecycle status — proxy_requests.status enum
//
// Wave 27 craft review [code-reviewer #3+#4, HIGH] — single source
// of truth for request status labels. Pre-fix the same map appeared
// in 3+ places with drift ("Đã huỷ" vs "bị huỷ") — admins navigating
// from history → trash for the same request saw different wording.
// Now: every consumer imports from here.
// ============================================================

export type RequestStatusValue =
  | "pending"
  | "approved"
  | "auto_approved"
  | "rejected"
  | "expired"
  | "cancelled";

export const REQUEST_STATUS_LABEL: Record<RequestStatusValue, string> = {
  pending: "Chờ duyệt",
  approved: "Đã duyệt",
  auto_approved: "Tự động duyệt",
  rejected: "Đã từ chối",
  expired: "Hết hạn chờ",
  cancelled: "Đã huỷ",
};

/**
 * Verb form for in-sentence interpolation (e.g., "Yêu cầu được duyệt").
 * Kept separate from the noun-form `REQUEST_STATUS_LABEL` (used in
 * pills/chips) because Vietnamese verb conjugation differs from
 * standalone noun phrases. Both maps share the same key set and
 * MUST stay in sync.
 */
export const REQUEST_STATUS_VERB_VI: Record<RequestStatusValue, string> = {
  pending: "đang chờ duyệt",
  approved: "được duyệt",
  auto_approved: "được duyệt tự động",
  rejected: "bị từ chối",
  expired: "hết hạn chờ",
  cancelled: "bị huỷ",
};

export const REQUEST_STATUS_BADGE: Record<
  RequestStatusValue,
  "default" | "secondary" | "outline" | "destructive"
> = {
  pending: "outline",
  approved: "default",
  auto_approved: "default",
  rejected: "destructive",
  expired: "secondary",
  cancelled: "secondary",
};

export function requestStatusLabel(s: RequestStatusValue | string): string {
  return REQUEST_STATUS_LABEL[s as RequestStatusValue] ?? s;
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
  // Wave 26-D bug hunt v2 [TS#5] — `reported_broken` is the
  // warranty-pending state. Pre-fix it fell through to "Sẵn sàng"
  // here, which is wrong (proxy is NOT distributable). Render it as
  // a distinct destructive-tone "Đang báo lỗi" badge before the
  // expiring_soon / assigned checks so admin sees warranty queue at
  // a glance.
  if (p.status === "reported_broken") {
    return [{ label: "Đang báo lỗi", variant: "destructive" }];
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
