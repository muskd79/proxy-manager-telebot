/**
 * Wave 28 — single source of truth for the sentinel category.
 *
 * Every proxy MUST belong to a category (Wave 28 business rule).
 * When admin imports / creates a proxy without picking one, AND when
 * admin deletes a non-sentinel category that still has proxies, the
 * orphans are re-homed to this sentinel.
 *
 * UUID is hardcoded so SQL migration + JS code reference the same
 * value. The cross-validation test
 * `src/__tests__/wave28/default_category_constant.test.ts` greps the
 * SQL migration to assert literal-for-literal match — catches the
 * #1 multi-dev hazard (someone updates one but not the other).
 *
 * Do NOT change this UUID once a deploy has applied mig 068. The
 * value lives in production rows; renaming would orphan every
 * proxy currently pointing at it.
 *
 * Naming: "Mặc định" (Vietnamese for "default"). Translates cleanly
 * across the Vietnamese-first UI; `is_system = true` in the DB row
 * makes UI surfaces visually distinct + blocks rename / delete.
 */

/** UUID of the system "Mặc định" category. Mirrors mig 068 SQL literal. */
export const DEFAULT_CATEGORY_ID =
  "00000000-0000-0000-0000-0000000028ca" as const;

/** Vietnamese display name; matches the row inserted by mig 068. */
export const DEFAULT_CATEGORY_NAME = "Mặc định" as const;

/**
 * Type-narrowing helper: is this a system-protected category?
 * Pre-Wave-28 rows don't have `is_system` (defaulted false). Use the
 * UUID check as a fallback.
 */
export function isDefaultCategory(
  category: { id: string; is_system?: boolean | null } | null | undefined,
): boolean {
  if (!category) return false;
  return category.is_system === true || category.id === DEFAULT_CATEGORY_ID;
}
