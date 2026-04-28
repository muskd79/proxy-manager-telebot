import { describe, it, expect } from "vitest";
import { deriveExpiryStatus } from "@/lib/proxy-labels";

/**
 * Wave 22L (Phase 1 — C3 fix) regression test for the expiryStatus
 * filter on /api/proxies.
 *
 * Pre-22L bug at src/app/api/proxies/route.ts:93:
 *   `expiryStatus === "valid"` mapped to `expires_at > NOW()+7d` —
 *   silently excluding proxies expiring within the next 6 days from
 *   the "Còn hạn" filter. Comment ghi đúng "valid = NULL OR > NOW()"
 *   nhưng code SAI.
 *
 * Wave 22L semantics (matches deriveExpiryStatus in proxy-labels):
 *   never          : expires_at IS NULL (vĩnh viễn — counts as valid)
 *   expired        : expires_at <= NOW() AND non-null
 *   expiring_soon  : NOW() < expires_at <= NOW()+7d
 *   valid          : expires_at > NOW()+7d  OR  expires_at IS NULL
 */

describe("expiryStatus filter — Wave 22L C3 fix consistency", () => {
  const NOW = new Date("2025-06-15T12:00:00Z");

  it("a proxy expiring 6 days from now is 'expiring_soon', NOT 'valid'", () => {
    const sixDays = new Date(NOW.getTime() + 6 * 86_400_000).toISOString();
    expect(deriveExpiryStatus(sixDays, NOW)).toBe("expiring_soon");
  });

  it("a proxy expiring 8 days from now is 'valid'", () => {
    const eightDays = new Date(NOW.getTime() + 8 * 86_400_000).toISOString();
    expect(deriveExpiryStatus(eightDays, NOW)).toBe("valid");
  });

  it("NULL expires_at is 'never' (vĩnh viễn — counts as valid in filter)", () => {
    expect(deriveExpiryStatus(null, NOW)).toBe("never");
  });

  it("expired 1 hour ago is 'expired'", () => {
    const oneHourAgo = new Date(NOW.getTime() - 3_600_000).toISOString();
    expect(deriveExpiryStatus(oneHourAgo, NOW)).toBe("expired");
  });

  it("boundary: 7 days minus 1 second → 'expiring_soon'", () => {
    const justUnder7d = new Date(NOW.getTime() + 7 * 86_400_000 - 1000).toISOString();
    expect(deriveExpiryStatus(justUnder7d, NOW)).toBe("expiring_soon");
  });

  it("boundary: exactly 7 days → 'valid' (implementation uses strict <)", () => {
    // Note: deriveExpiryStatus uses `t - now < 7d` (strict). The
    // exact-7-day boundary lands on "valid", not "expiring_soon".
    // If product wants inclusive, change `<` to `<=` in proxy-labels.
    const exactly7d = new Date(NOW.getTime() + 7 * 86_400_000).toISOString();
    expect(deriveExpiryStatus(exactly7d, NOW)).toBe("valid");
  });
});
