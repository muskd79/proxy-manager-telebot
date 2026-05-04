/**
 * Wave 27 — pure aggregation helpers for the categories dashboard.
 *
 * No I/O, no React. Take a `CategoryDashboardRow` (which is the
 * RPC's already-aggregated output) and derive UI-friendly shapes
 * — segment widths for the progress bar, bool flags for empty
 * states, etc.
 *
 * Single responsibility per function. Every branch tested.
 */

import type { CategoryDashboardRow } from "./types";

/**
 * Segments for the stacked stock progress bar. Each segment's
 * `widthPct` is a clamped percent (0–100). The 3 segments sum to
 * `≤ 100` (fewer than 100% when some statuses fall outside the
 * 3-bucket simplification — expired/banned/maintenance get folded
 * into "broken" for the bar's purpose).
 *
 * If `total` is 0, returns `null` so the UI renders the empty
 * placeholder bar instead of dividing by zero.
 */
export interface StockProgressSegments {
  available: { count: number; widthPct: number };
  assigned: { count: number; widthPct: number };
  broken: { count: number; widthPct: number };
  total: number;
}

export function deriveProgressBarSegments(
  row: Pick<
    CategoryDashboardRow,
    | "cnt_available"
    | "cnt_assigned"
    | "cnt_reported_broken"
    | "cnt_expired"
    | "cnt_banned"
    | "cnt_maintenance"
    | "proxy_count"
  >,
): StockProgressSegments | null {
  const availableCount = row.cnt_available;
  const assignedCount = row.cnt_assigned;
  // "Broken" on the bar = reported_broken + banned + expired + maintenance.
  // The card's row breakdown still itemises each, but the bar simplifies
  // to 3 colors so it stays readable at the card scale.
  const brokenCount =
    row.cnt_reported_broken + row.cnt_expired + row.cnt_banned + row.cnt_maintenance;

  // Use proxy_count as the denominator (matches the "Tồn kho" total
  // shown on the right of the bar header). Some statuses might not be
  // in the 3 visible buckets (e.g., a soft_deleted+restored proxy
  // mid-cycle) — that's why segments can sum to < 100%.
  const total = row.proxy_count;
  if (total <= 0) return null;

  return {
    available: {
      count: availableCount,
      widthPct: clampPct((availableCount / total) * 100),
    },
    assigned: {
      count: assignedCount,
      widthPct: clampPct((assignedCount / total) * 100),
    },
    broken: {
      count: brokenCount,
      widthPct: clampPct((brokenCount / total) * 100),
    },
    total,
  };
}

function clampPct(p: number): number {
  if (!Number.isFinite(p)) return 0;
  if (p < 0) return 0;
  if (p > 100) return 100;
  // Round to 2 decimal places — enough for sub-pixel CSS calc accuracy.
  return Math.round(p * 100) / 100;
}

/**
 * Status row builder — consolidates a row's per-status counts into
 * a list of {key, count, label, dotColor} ready for rendering. The
 * card's right-hand breakdown column iterates this list. Statuses
 * with count=0 are omitted so empty categories don't show 6 zero
 * rows.
 *
 * Order matches the user's mental model: Sẵn sàng first (admin's
 * primary stock metric), then Đã giao, then problem states.
 */
export interface StatusBreakdownItem {
  /** Stable key for React. */
  key:
    | "available"
    | "assigned"
    | "reported_broken"
    | "expired"
    | "banned"
    | "maintenance";
  /** Vietnamese label rendered next to the dot. */
  label: string;
  /** Count value displayed before the label. */
  count: number;
  /** Tone hint — UI maps to a Tailwind dot color class. */
  tone: "available" | "assigned" | "broken" | "muted";
}

export function buildStatusBreakdown(
  row: Pick<
    CategoryDashboardRow,
    | "cnt_available"
    | "cnt_assigned"
    | "cnt_reported_broken"
    | "cnt_expired"
    | "cnt_banned"
    | "cnt_maintenance"
  >,
  options: { hideZero?: boolean } = {},
): StatusBreakdownItem[] {
  const hideZero = options.hideZero ?? true;
  const items: StatusBreakdownItem[] = [
    { key: "available", label: "Sẵn sàng", count: row.cnt_available, tone: "available" },
    { key: "assigned", label: "Đã giao", count: row.cnt_assigned, tone: "assigned" },
    { key: "reported_broken", label: "Báo lỗi", count: row.cnt_reported_broken, tone: "broken" },
    { key: "expired", label: "Hết hạn", count: row.cnt_expired, tone: "muted" },
    { key: "banned", label: "Đã chặn", count: row.cnt_banned, tone: "broken" },
    { key: "maintenance", label: "Bảo trì", count: row.cnt_maintenance, tone: "muted" },
  ];
  return hideZero ? items.filter((i) => i.count > 0) : items;
}

/**
 * Derive whether the card should render the "Below min stock" warning.
 * Min stock alert uses the COUNT OF AVAILABLE (admin's intuition: "I
 * want at least N proxies ready to give out"). If min_stock_alert is
 * 0/null/missing, no alert.
 */
export function isBelowMinStock(
  row: Pick<CategoryDashboardRow, "cnt_available" | "min_stock_alert">,
): boolean {
  const min = row.min_stock_alert;
  if (typeof min !== "number" || min <= 0) return false;
  return row.cnt_available < min;
}

/**
 * Aggregate stats across an array of dashboard rows. Used by the
 * page-level summary (e.g., toolbar showing "Total: 5 categories,
 * 1234 proxies, 11.4M revenue").
 */
export interface DashboardSummary {
  categoryCount: number;
  hiddenCategoryCount: number;
  totalProxies: number;
  totalAvailable: number;
  totalAssigned: number;
  totalRevenueUsd: number;
  totalCostUsd: number;
}

export function summariseDashboard(
  rows: ReadonlyArray<CategoryDashboardRow>,
): DashboardSummary {
  return {
    categoryCount: rows.length,
    hiddenCategoryCount: rows.filter((r) => r.is_hidden).length,
    totalProxies: rows.reduce((acc, r) => acc + r.proxy_count, 0),
    totalAvailable: rows.reduce((acc, r) => acc + r.cnt_available, 0),
    totalAssigned: rows.reduce((acc, r) => acc + r.cnt_assigned, 0),
    totalRevenueUsd: rows.reduce(
      (acc, r) => acc + (r.revenue_usd_cumulative || 0),
      0,
    ),
    totalCostUsd: rows.reduce((acc, r) => acc + (r.cost_usd_total || 0), 0),
  };
}
