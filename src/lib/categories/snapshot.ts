/**
 * Wave 27 — pure JS implementation of the SQL trigger
 * `fn_proxy_snapshot_category_defaults` from mig 059.
 *
 * Why duplicate logic in JS when the trigger is the source of truth?
 *   - Form-stage prefill: the admin web UI shows the defaults BEFORE
 *     submit so the user sees what will be filled, can edit, etc.
 *   - Bot path validation: the Telegram bot's /addproxy flow renders
 *     a confirmation card before insert.
 *   - CSV import preview: import wizard shows a per-row preview
 *     including filled values.
 *
 * The trigger is the auth source of truth at the DB layer (catches
 * paths that don't run through this JS — scripts, future RPCs). This
 * file MUST stay in sync with the trigger; the parity test
 * (`snapshot.test.ts` and an integration test in PR-3) asserts both
 * paths produce the same output for the same input.
 *
 * Single responsibility: given a partial proxy + a category, return
 * the proxy with NULL/empty fields filled. No I/O.
 */

import type { Proxy, ProxyCategory } from "@/types/database";

/**
 * Subset of ProxyCategory that contributes to snapshot. Defined here
 * (not imported via Pick<>) so the function signature documents
 * exactly which category fields matter.
 */
export interface SnapshotDefaults {
  default_country: string | null;
  default_proxy_type: Proxy["type"] | null;
  default_isp: string | null;
  default_network_type: string | null;
  default_vendor_source?: string | null;
  default_purchase_price_usd?: number | null;
  default_sale_price_usd?: number | null;
}

/**
 * Subset of Proxy that the snapshot fills. We only touch these 7
 * fields; everything else on the proxy stays untouched.
 */
export interface SnapshotProxyFields {
  country: string | null;
  type: Proxy["type"] | null;
  isp: string | null;
  network_type: string | null;
  vendor_label: string | null;
  cost_usd: number | null;
  sale_price_usd: number | null;
}

/**
 * Empty-string-as-null normaliser. The bot/CSV layers may pass `""`
 * for unfilled optional fields; we treat that the same as `null`.
 *
 * Mirrors the SQL `NULLIF(field, '')` guard in the trigger.
 */
function asNullable<T extends string | number | null | undefined>(
  value: T,
): T | null {
  if (value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  if (value === null) return null;
  return value;
}

/**
 * Apply category defaults to a proxy. Returns a NEW object — never
 * mutates the input.
 *
 * Snapshot semantics: fill if NULL/empty, never overwrite.
 *
 *   applyCategoryDefaults({ host, port, country: null, ... }, cat)
 *   // → { host, port, country: cat.default_country, ... }
 *
 *   applyCategoryDefaults({ host, port, country: "VN", ... }, cat)
 *   // → { host, port, country: "VN", ... }   // preserved
 *
 * If `category` is null/undefined (no category assigned), returns the
 * proxy unchanged (matches the trigger's `IF NEW.category_id IS NULL`
 * early return).
 */
export function applyCategoryDefaults<T extends Partial<SnapshotProxyFields>>(
  proxy: T,
  category: SnapshotDefaults | null | undefined,
): T {
  if (!category) return proxy;

  const country = asNullable(proxy.country) ?? category.default_country ?? null;
  const type = (proxy.type ?? category.default_proxy_type ?? null) as
    | Proxy["type"]
    | null;
  const isp = asNullable(proxy.isp) ?? category.default_isp ?? null;
  const network_type =
    asNullable(proxy.network_type) ?? category.default_network_type ?? null;
  const vendor_label =
    asNullable(proxy.vendor_label) ?? category.default_vendor_source ?? null;
  const cost_usd =
    proxy.cost_usd ?? category.default_purchase_price_usd ?? null;
  const sale_price_usd =
    proxy.sale_price_usd ?? category.default_sale_price_usd ?? null;

  return {
    ...proxy,
    country,
    type,
    isp,
    network_type,
    vendor_label,
    cost_usd,
    sale_price_usd,
  };
}

/**
 * Convert a `ProxyCategory` row (from /api/categories) to the
 * `SnapshotDefaults` shape this module expects. Used by callers
 * that have a full category but want to feed `applyCategoryDefaults`.
 */
export function categoryToSnapshotDefaults(
  category: ProxyCategory,
): SnapshotDefaults {
  return {
    default_country: category.default_country,
    default_proxy_type: category.default_proxy_type,
    default_isp: category.default_isp,
    default_network_type: category.default_network_type,
    default_vendor_source: category.default_vendor_source ?? null,
    default_purchase_price_usd: category.default_purchase_price_usd ?? null,
    default_sale_price_usd: category.default_sale_price_usd ?? null,
  };
}
