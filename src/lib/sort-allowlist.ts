/**
 * Wave 22D-3 — sortBy injection guard.
 *
 * Pre-22D-3, four list routes (proxies, logs, users, requests) passed
 * the unvalidated `sortBy` URL param straight into Supabase's
 * `.order(column, ...)` call. PostgREST accepts the column name
 * literally, so a malformed value either:
 *   - Returns a 500 with the raw error message exposing schema info
 *     (every one of those routes returns `error.message` to the
 *     client on failure).
 *   - Triggers a sort against an unintended column (privacy /
 *     side-channel leakage).
 *
 * Fix: each route registers a typed allowlist of legal sort columns
 * (the actual column names that exist on the table); `safeSort()`
 * picks `column` from the allowlist or falls back to a default.
 *
 * The Set-based check is O(1) and gives TypeScript narrowing — there
 * is no string concatenation, no SQL fragment, no escape work.
 *
 * Why a Set, not a union type alone?
 *   The URL param arrives as plain `string | null`. We need a runtime
 *   guard, not just a compile-time one. The Set IS the runtime guard;
 *   the TS type just keeps callers honest.
 */

export interface SortValidator<T extends string> {
  /** Allowed column names. */
  readonly allowed: ReadonlySet<T>;
  /** Default column when input is missing or invalid. */
  readonly fallback: T;
}

export function makeSortValidator<T extends string>(
  allowed: readonly T[],
  fallback: T,
): SortValidator<T> {
  return {
    allowed: new Set(allowed),
    fallback,
  };
}

/**
 * Returns a safe column name guaranteed to be in the allowlist.
 * Pass the raw URL param; this function handles null/undefined/empty.
 */
export function safeSort<T extends string>(
  validator: SortValidator<T>,
  input: string | null | undefined,
): T {
  if (input && (validator.allowed as ReadonlySet<string>).has(input)) {
    return input as T;
  }
  return validator.fallback;
}

// ============================================================
// Per-route allowlists. Centralised here so a schema change in one
// table is visible at one location instead of scattered across 4
// route files.
// ============================================================

export const PROXIES_SORT = makeSortValidator(
  [
    "created_at",
    "updated_at",
    "host",
    "port",
    "country",
    "type",
    "status",
    "expires_at",
    "assigned_at",
  ],
  "created_at",
);

export const LOGS_SORT = makeSortValidator(
  ["created_at", "actor_type", "action", "resource_type"],
  "created_at",
);

export const USERS_SORT = makeSortValidator(
  [
    "created_at",
    "updated_at",
    "username",
    "first_name",
    "last_name",
    "telegram_id",
    "status",
    "proxies_used_total",
  ],
  "created_at",
);

export const REQUESTS_SORT = makeSortValidator(
  [
    "requested_at",
    "processed_at",
    "status",
    "proxy_type",
    "country",
  ],
  "requested_at",
);
