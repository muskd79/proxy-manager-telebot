/**
 * Wave 26-D-post1 — pure codec between URL search params and
 * RequestPageFilters. Lets admins bookmark / share filtered views.
 *
 * Design principles:
 *   - Default values DON'T appear in the URL (clean URLs).
 *   - Unknown / malformed params silently fall back to defaults
 *     (graceful degradation).
 *   - Round-trip stable: parse(format(x)) === x for every reachable x.
 *
 * Tests pin every public function so refactors don't drift the codec
 * between the filter component and the page that hosts it.
 */

import {
  DEFAULT_REQUEST_FILTERS,
  STATUS_OPTIONS,
  WITHIN_OPTIONS,
  PROXY_TYPE_OPTIONS,
  APPROVAL_MODE_OPTIONS,
  type RequestPageFilters,
  type TimeBucket,
} from "./request-filters";

const STATUS_VALUES = new Set<string>(STATUS_OPTIONS.map((o) => o.value));
const WITHIN_VALUES = new Set<TimeBucket>(WITHIN_OPTIONS.map((o) => o.value));
const PROXY_TYPE_VALUES = new Set<string>(PROXY_TYPE_OPTIONS.map((o) => o.value));
const APPROVAL_MODE_VALUES = new Set<string>(APPROVAL_MODE_OPTIONS.map((o) => o.value));

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse URL search params into a RequestPageFilters object.
 * Unknown values fall back to the default value for that key.
 */
export function parseFiltersFromSearchParams(
  params: URLSearchParams,
): RequestPageFilters {
  const status = params.get("status");
  const within = params.get("within");
  const proxyType = params.get("proxyType") ?? params.get("type");
  const approvalMode = params.get("approvalMode") ?? params.get("mode");
  const dateFrom = params.get("dateFrom");
  const dateTo = params.get("dateTo");

  return {
    status: status && STATUS_VALUES.has(status) ? status : DEFAULT_REQUEST_FILTERS.status,
    within:
      within && WITHIN_VALUES.has(within as TimeBucket)
        ? (within as TimeBucket)
        : DEFAULT_REQUEST_FILTERS.within,
    dateFrom: dateFrom && ISO_DATE_RE.test(dateFrom) ? dateFrom : undefined,
    dateTo: dateTo && ISO_DATE_RE.test(dateTo) ? dateTo : undefined,
    proxyType:
      proxyType && PROXY_TYPE_VALUES.has(proxyType)
        ? proxyType
        : DEFAULT_REQUEST_FILTERS.proxyType,
    approvalMode:
      approvalMode && APPROVAL_MODE_VALUES.has(approvalMode)
        ? approvalMode
        : DEFAULT_REQUEST_FILTERS.approvalMode,
    country: (params.get("country") ?? "").slice(0, 100),
    search: (params.get("search") ?? "").slice(0, 200),
  };
}

/**
 * Format a RequestPageFilters back to a URLSearchParams. Default
 * values are omitted so the URL stays clean.
 */
export function formatFiltersToSearchParams(
  filters: RequestPageFilters,
): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.status !== DEFAULT_REQUEST_FILTERS.status) {
    params.set("status", filters.status);
  }
  if (filters.within !== DEFAULT_REQUEST_FILTERS.within) {
    params.set("within", filters.within);
  }
  if (filters.within === "custom") {
    if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
    if (filters.dateTo) params.set("dateTo", filters.dateTo);
  }
  if (filters.proxyType !== DEFAULT_REQUEST_FILTERS.proxyType) {
    params.set("proxyType", filters.proxyType);
  }
  if (filters.approvalMode !== DEFAULT_REQUEST_FILTERS.approvalMode) {
    params.set("approvalMode", filters.approvalMode);
  }
  if (filters.country) params.set("country", filters.country);
  if (filters.search) params.set("search", filters.search);
  return params;
}

/**
 * Translate a TimeBucket into a [dateFrom, dateTo] pair for the API.
 * Custom buckets pass through the explicit dates already on the
 * filters object. "all" returns no constraint.
 *
 * Pure + deterministic when `now` is provided — vitest covers each
 * branch.
 */
export function resolveTimeBucket(
  filters: RequestPageFilters,
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
      return {
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
      };
    case "all":
    default:
      return {};
  }
}

function toIsoDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
