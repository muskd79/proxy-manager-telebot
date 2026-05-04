/**
 * Wave 27 — types for the categories dashboard surface.
 *
 * `CategoryDashboardRow` is the JSON shape returned by the
 * `get_category_dashboard()` RPC (mig 059). The card UI consumes
 * one of these per card.
 *
 * Kept in a dedicated file so the API route, the React UI, the
 * realtime hook, and the unit tests all import from the same source.
 * If the RPC schema changes, this is the only place to update.
 */

import type { ProxyCategory } from "@/types/database";

/**
 * One row of the dashboard. Mirrors mig 059's
 * `get_category_dashboard()` RETURNS TABLE shape exactly.
 *
 * Numeric SQL columns become `number` in JSON. The RPC
 * COALESCEs zero for any nullable count/sum so the client can
 * always render — never receive `null`.
 *
 * Wave 27 design note: live/die sub-counts are NOT included.
 * The user's sibling VIA project tracks live/die for Facebook
 * accounts (binary alive-or-banned probe); proxies have a richer
 * status enum (available/assigned/reported_broken/expired/banned/
 * maintenance) that already encodes lifecycle. Probe freshness
 * (speed_ms / last_checked_at) stays as per-proxy operational
 * metadata but does not drive the category card breakdown.
 */
export interface CategoryDashboardRow {
  // ─── identity (mirrors ProxyCategory) ────────────────────
  id: string;
  name: string;
  description: string | null;
  color: string;
  icon: string;
  sort_order: number;
  is_hidden: boolean;
  default_sale_price_usd: number | null;
  default_purchase_price_usd: number | null;
  min_stock_alert: number;
  proxy_count: number;

  // ─── per-status counts (non-deleted only) ────────────────
  cnt_available: number;
  cnt_assigned: number;
  cnt_reported_broken: number;
  cnt_expired: number;
  cnt_banned: number;
  cnt_maintenance: number;

  // ─── footer ──────────────────────────────────────────────
  /** Count of proxies with `hidden=true` in this category. */
  total_hidden: number;

  // ─── money ────────────────────────────────────────────────
  /** Point-in-time list-price total of currently assigned inventory. */
  stock_value_usd: number;
  /** All-time cumulative revenue — sum over proxy_events.assigned. */
  revenue_usd_cumulative: number;
  /** Sum of cost across all non-deleted proxies in category. */
  cost_usd_total: number;
}

/**
 * Subset of `ProxyCategory` exposed by the legacy `/api/categories`
 * GET endpoint. Re-export the existing type alias so the dashboard
 * components don't need a second import.
 */
export type CategoryRow = ProxyCategory;

/**
 * Modes for the retroactive apply RPC. Mirrors the SQL enum from
 * mig 059.
 */
export type CategoryApplyMode = "only_null" | "force";
