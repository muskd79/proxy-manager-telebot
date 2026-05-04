/**
 * Wave 27 — pure formatters for the categories dashboard.
 *
 * No I/O, no React. Single responsibility: turn numbers into
 * Vietnamese-style display strings.
 *
 * Test target: 100% line coverage. Every branch + boundary value
 * pinned in `formatters.test.ts`.
 */

/**
 * Vietnamese-style abbreviated currency. The user uses VND-equivalent
 * "K" / "M" / "B" suffixes even when the underlying value is USD —
 * that's their domain convention.
 *
 * Examples:
 *   formatVnd(50)         → "50"
 *   formatVnd(50_000)     → "50K"
 *   formatVnd(11_400_000) → "11.4M"
 *   formatVnd(2_000_000_000) → "2B"
 *   formatVnd(0)          → "0"
 *   formatVnd(null)       → "—"
 *   formatVnd(undefined)  → "—"
 *
 * Negative values are rare (shouldn't be) but supported — leading
 * minus retained.
 */
export function formatVnd(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (value === 0) return "0";

  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);

  if (abs >= 1_000_000_000) {
    return `${sign}${trimDecimal(abs / 1_000_000_000)}B`;
  }
  if (abs >= 1_000_000) {
    return `${sign}${trimDecimal(abs / 1_000_000)}M`;
  }
  if (abs >= 1_000) {
    return `${sign}${trimDecimal(abs / 1_000)}K`;
  }
  return `${sign}${abs}`;
}

/**
 * Round-trip-friendly trim: 11.0 → "11", 11.4 → "11.4", 11.45 → "11.5"
 * (one decimal place max).
 */
function trimDecimal(n: number): string {
  const oneDp = Math.round(n * 10) / 10;
  // toString drops trailing zero (11.0 → "11") naturally.
  return oneDp.toString();
}

/**
 * Compact integer count. Below 10000 shows as-is; 10000+ becomes
 * "10K+" / "12K+" / etc. so card headers stay narrow.
 *
 * Examples:
 *   formatCount(0)      → "0"
 *   formatCount(147)    → "147"
 *   formatCount(9999)   → "9999"
 *   formatCount(10_000) → "10K+"
 *   formatCount(12_345) → "12K+"
 */
export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "0";
  const n = Math.max(0, Math.floor(value));
  if (n < 10_000) return n.toString();
  return `${Math.floor(n / 1000)}K+`;
}

/**
 * Compute profit margin from revenue + cost. Returns the absolute
 * profit in the same unit (USD here). UI renders it via `formatVnd`.
 *
 * If cost is 0 or null, profit equals revenue (treated as pure
 * income). If revenue is 0, profit is the negative of cost
 * (purchases not yet sold).
 */
export function computeMargin(
  revenue: number | null | undefined,
  cost: number | null | undefined,
): number {
  const r = typeof revenue === "number" && !Number.isNaN(revenue) ? revenue : 0;
  const c = typeof cost === "number" && !Number.isNaN(cost) ? cost : 0;
  return r - c;
}

/**
 * Vietnamese label for a status name when used in card breakdown rows.
 * Mirrors `proxy-labels.ts STATUS_LABEL` — kept here for the small
 * subset the card uses (we don't expose every status on the card).
 */
export const STATUS_LABEL_VI: Record<
  | "available"
  | "assigned"
  | "reported_broken"
  | "expired"
  | "banned"
  | "maintenance",
  string
> = {
  available: "Sẵn sàng",
  assigned: "Đã giao",
  // Wave 27 craft review [code-reviewer LOW] — was "Báo lỗi" but
  // canonical proxy-labels.ts uses "Đang báo lỗi". Aligned to match
  // so the category card breakdown matches the proxy table badge.
  reported_broken: "Đang báo lỗi",
  expired: "Hết hạn",
  banned: "Đã chặn",
  maintenance: "Bảo trì",
};
