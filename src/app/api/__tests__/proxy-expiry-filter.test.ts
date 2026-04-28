import { describe, it, expect } from "vitest";
import { deriveExpiryStatus } from "@/lib/proxy-labels";

/**
 * Wave 22L → Wave 22AB — expiryStatus tests, threshold updated.
 *
 * Wave 22AB lowered the "expiring_soon" threshold from 7 days to
 * 3 days per user spec: "nếu còn 3 ngày thì sẽ được chuyển sang
 * trạng thái sắp hết hạn".
 *
 * Wave 22L's C3 fix (consistency between badge derivation and the
 * /api/proxies expiryStatus filter) still holds — we just shifted
 * the threshold constant; the predicate shape is unchanged.
 *
 * Semantics (current):
 *   never          : expires_at IS NULL
 *   expired        : expires_at <= NOW() AND non-null
 *   expiring_soon  : NOW() < expires_at < NOW()+3d
 *   valid          : expires_at >= NOW()+3d  OR  expires_at IS NULL
 */

describe("expiryStatus filter — Wave 22AB threshold = 3 days", () => {
  const NOW = new Date("2025-06-15T12:00:00Z");

  it("expiring 2 days from now is 'expiring_soon'", () => {
    const twoDays = new Date(NOW.getTime() + 2 * 86_400_000).toISOString();
    expect(deriveExpiryStatus(twoDays, NOW)).toBe("expiring_soon");
  });

  it("expiring 4 days from now is 'valid' (outside 3-day window)", () => {
    const fourDays = new Date(NOW.getTime() + 4 * 86_400_000).toISOString();
    expect(deriveExpiryStatus(fourDays, NOW)).toBe("valid");
  });

  it("NULL expires_at is 'never' (vĩnh viễn — counts as valid in filter)", () => {
    expect(deriveExpiryStatus(null, NOW)).toBe("never");
  });

  it("expired 1 hour ago is 'expired'", () => {
    const oneHourAgo = new Date(NOW.getTime() - 3_600_000).toISOString();
    expect(deriveExpiryStatus(oneHourAgo, NOW)).toBe("expired");
  });

  it("boundary: 3 days minus 1 second → 'expiring_soon'", () => {
    const justUnder3d = new Date(NOW.getTime() + 3 * 86_400_000 - 1000).toISOString();
    expect(deriveExpiryStatus(justUnder3d, NOW)).toBe("expiring_soon");
  });

  it("boundary: exactly 3 days → 'valid' (implementation uses strict <)", () => {
    // deriveExpiryStatus uses `t - now < 3d` (strict). The
    // exact-3-day boundary lands on "valid", not "expiring_soon".
    const exactly3d = new Date(NOW.getTime() + 3 * 86_400_000).toISOString();
    expect(deriveExpiryStatus(exactly3d, NOW)).toBe("valid");
  });
});
