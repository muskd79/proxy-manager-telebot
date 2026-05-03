/**
 * Wave 26-D-2 — URL codec for /warranty filter state. Mirrors
 * src/components/requests/request-filters-url.ts pattern so admins
 * can bookmark / share filtered warranty views.
 */

import {
  DEFAULT_WARRANTY_FILTERS,
  WARRANTY_STATUS_OPTIONS,
  WARRANTY_WITHIN_OPTIONS,
  WARRANTY_REASON_OPTIONS,
  HAS_REPLACEMENT_OPTIONS,
  type WarrantyPageFilters,
  type TimeBucket,
} from "./warranty-filters";

const STATUS_VALUES = new Set<string>(WARRANTY_STATUS_OPTIONS.map((o) => o.value));
const WITHIN_VALUES = new Set<TimeBucket>(WARRANTY_WITHIN_OPTIONS.map((o) => o.value));
const REASON_VALUES = new Set<string>(WARRANTY_REASON_OPTIONS.map((o) => o.value));
const HAS_REPLACEMENT_VALUES = new Set<string>(HAS_REPLACEMENT_OPTIONS.map((o) => o.value));

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f-]{36}$/i;

export function parseWarrantyFiltersFromSearchParams(
  params: URLSearchParams,
): WarrantyPageFilters {
  const status = params.get("status");
  const within = params.get("within");
  const reasonCode = params.get("reasonCode");
  const hasReplacement = params.get("hasReplacement");
  const resolvedBy = params.get("resolvedBy");
  const dateFrom = params.get("dateFrom");
  const dateTo = params.get("dateTo");

  return {
    status: status && STATUS_VALUES.has(status) ? status : DEFAULT_WARRANTY_FILTERS.status,
    within:
      within && WITHIN_VALUES.has(within as TimeBucket)
        ? (within as TimeBucket)
        : DEFAULT_WARRANTY_FILTERS.within,
    dateFrom: dateFrom && ISO_DATE_RE.test(dateFrom) ? dateFrom : undefined,
    dateTo: dateTo && ISO_DATE_RE.test(dateTo) ? dateTo : undefined,
    reasonCode:
      reasonCode && REASON_VALUES.has(reasonCode)
        ? reasonCode
        : DEFAULT_WARRANTY_FILTERS.reasonCode,
    hasReplacement:
      hasReplacement && HAS_REPLACEMENT_VALUES.has(hasReplacement)
        ? hasReplacement
        : DEFAULT_WARRANTY_FILTERS.hasReplacement,
    resolvedBy:
      resolvedBy && (resolvedBy === "all" || UUID_RE.test(resolvedBy))
        ? resolvedBy
        : DEFAULT_WARRANTY_FILTERS.resolvedBy,
    search: (params.get("search") ?? "").slice(0, 200),
  };
}

export function formatWarrantyFiltersToSearchParams(
  filters: WarrantyPageFilters,
): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.status !== DEFAULT_WARRANTY_FILTERS.status)
    params.set("status", filters.status);
  if (filters.within !== DEFAULT_WARRANTY_FILTERS.within)
    params.set("within", filters.within);
  if (filters.within === "custom") {
    if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
    if (filters.dateTo) params.set("dateTo", filters.dateTo);
  }
  if (filters.reasonCode !== DEFAULT_WARRANTY_FILTERS.reasonCode)
    params.set("reasonCode", filters.reasonCode);
  if (filters.hasReplacement !== DEFAULT_WARRANTY_FILTERS.hasReplacement)
    params.set("hasReplacement", filters.hasReplacement);
  if (filters.resolvedBy !== DEFAULT_WARRANTY_FILTERS.resolvedBy)
    params.set("resolvedBy", filters.resolvedBy);
  if (filters.search) params.set("search", filters.search);
  return params;
}

/** Same time-bucket math as request-filters-url.ts. */
export function resolveWarrantyTimeBucket(
  filters: WarrantyPageFilters,
  now: Date = new Date(),
): { dateFrom?: string; dateTo?: string } {
  switch (filters.within) {
    case "today": {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      return { dateFrom: toIsoDate(start) };
    }
    case "7d": {
      const start = new Date(now);
      start.setDate(start.getDate() - 7);
      start.setHours(0, 0, 0, 0);
      return { dateFrom: toIsoDate(start) };
    }
    case "30d": {
      const start = new Date(now);
      start.setDate(start.getDate() - 30);
      start.setHours(0, 0, 0, 0);
      return { dateFrom: toIsoDate(start) };
    }
    case "custom":
      return { dateFrom: filters.dateFrom, dateTo: filters.dateTo };
    case "all":
    default:
      return {};
  }
}

function toIsoDate(d: Date): string {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}
