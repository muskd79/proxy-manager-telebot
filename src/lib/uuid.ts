/**
 * Wave 26-D bug hunt v2 [security H1] — strict UUID validation helper.
 *
 * Pre-fix: many API routes used the loose regex `/^[0-9a-f-]{36}$/i`
 * which accepted bogus inputs like `--------------------------------------`
 * (36 dashes) or `0000000000000000000000000000000000000` (35 zeros + dash).
 * Postgres's UUID cast then rejected these, surfacing as 500 errors that
 * leaked an info oracle.
 *
 * Now: import `isUuid` everywhere a UUID-shape gate is needed. Strict
 * RFC-4122 pattern: 8-4-4-4-12 hex with literal dashes only at fixed
 * positions.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}
