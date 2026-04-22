/**
 * Key validation for Durable Object routing.
 *
 * DO names are derived from `(vendor_slug, scope)`. Without validation an
 * attacker with a valid HMAC could spawn unbounded DO instances by rotating
 * random `scope` values, exhausting our DO namespace and running up the
 * per-instance-hour bill.
 *
 * Regex is intentionally loose so `scope="default"` (non-UUID) works in
 * Wave 20C. When credential rotation lands, callers pass UUID v4/v7 as
 * scope — both match the same regex.
 */

export const KEY_RE = /^[a-z0-9_-]{1,64}:[a-z0-9_-]{1,64}$/;

export function isValidKey(key: string): boolean {
  if (typeof key !== "string") return false;
  if (key.length > 129) return false;
  return KEY_RE.test(key);
}

export function assertValidKey(key: unknown): asserts key is string {
  if (typeof key !== "string" || !isValidKey(key)) {
    throw new KeyGuardError(
      `Invalid key "${typeof key === "string" ? key.slice(0, 40) : typeof key}" — must match ${KEY_RE}`,
    );
  }
}

export class KeyGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeyGuardError";
  }
}
