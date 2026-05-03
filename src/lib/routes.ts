/**
 * Wave 25-pre2 (Pass 7.D) — admin web URL builders.
 *
 * Pre-fix dashboard KPI cards (and other dashboards) hardcoded URLs
 * like `/proxies?status=available` as raw strings. URL refactors
 * (e.g. renaming `?status=` → `?state=`, or moving `/proxies` under
 * `/admin/proxies`) silently broke the drill-downs because nothing
 * pointed back at the call sites.
 *
 * Convention
 * ----------
 * - One builder per admin page that accepts URL params.
 * - Builder name matches the route segment, with the page noun
 *   pluralised when the page lists rows (`proxies`, `users`,
 *   `requests`).
 * - Each builder accepts an optional params object; missing params
 *   produce the bare path (no `?`).
 * - Always use `URLSearchParams` for encoding — never manual `+`
 *   concatenation. Preserves correctness for spaces, `&`, etc.
 *
 * To add a new builder:
 *   1. Add a function below.
 *   2. Add a unit test in __tests__/routes.test.ts that asserts
 *      both the bare and parameterised forms.
 *   3. Replace inline string call sites — grep for the raw path
 *      to find them.
 */

type SearchParamValue = string | number | boolean | null | undefined;

function buildPath(base: string, params?: Record<string, SearchParamValue>): string {
  if (!params) return base;
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") continue;
    sp.set(key, String(value));
  }
  const query = sp.toString();
  return query ? `${base}?${query}` : base;
}

/** Proxy list/management page. Filter by status, type, category, etc. */
export function proxiesRoute(params?: {
  status?: "available" | "assigned" | "expired" | "banned" | "maintenance";
  type?: "http" | "https" | "socks5";
  categoryId?: string;
  q?: string;
}): string {
  return buildPath("/proxies", params);
}

/** Single proxy detail page. */
export function proxyDetailRoute(id: string): string {
  return `/proxies/${encodeURIComponent(id)}`;
}

/** Telegram users list page. Filter by status. */
export function usersRoute(params?: {
  status?: "active" | "blocked" | "banned" | "pending";
  q?: string;
}): string {
  return buildPath("/users", params);
}

/** Single Telegram user detail page. */
export function userDetailRoute(id: string): string {
  return `/users/${encodeURIComponent(id)}`;
}

/** Proxy requests list. Filter by status. */
export function requestsRoute(params?: {
  status?: "pending" | "approved" | "auto_approved" | "rejected" | "cancelled";
  q?: string;
}): string {
  return buildPath("/requests", params);
}

/** Activity history merged with logs (Wave 22P). */
export function historyRoute(): string {
  return "/history";
}

/** Admin dashboard root. */
export function dashboardRoute(): string {
  return "/dashboard";
}

/** Convenience: namespaced object for callers who prefer `routes.proxies(...)`. */
export const routes = {
  dashboard: dashboardRoute,
  proxies: proxiesRoute,
  proxyDetail: proxyDetailRoute,
  users: usersRoute,
  userDetail: userDetailRoute,
  requests: requestsRoute,
  history: historyRoute,
} as const;
