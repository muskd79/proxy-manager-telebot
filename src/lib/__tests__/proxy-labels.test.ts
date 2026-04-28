import { describe, it, expect } from "vitest";
import {
  networkTypeLabel,
  proxyStatusBadges,
  deriveExpiryStatus,
  EXPIRY_LABEL,
  NETWORK_TYPE_LABEL,
  STATUS_LABEL,
} from "@/lib/proxy-labels";

/**
 * Wave 22J — proxy display label tests.
 *
 * Pin the contract for:
 *   - Vietnamese rendering of all enum values
 *   - Dual-badge logic (lifecycle + expiry + hidden)
 *   - Expiry derivation rules (7-day "sắp hết hạn" threshold)
 */

describe("networkTypeLabel — Wave 22J", () => {
  it("returns 'Chưa phân loại' for null/undefined", () => {
    expect(networkTypeLabel(null)).toBe("Chưa phân loại");
    expect(networkTypeLabel(undefined)).toBe("Chưa phân loại");
  });

  it("maps each enum value to its Vietnamese label", () => {
    expect(networkTypeLabel("isp")).toBe("ISP");
    expect(networkTypeLabel("datacenter_ipv4")).toBe("Datacenter IPv4");
    expect(networkTypeLabel("datacenter_ipv6")).toBe("Datacenter IPv6");
    expect(networkTypeLabel("residential")).toBe("Dân cư");
    expect(networkTypeLabel("mobile")).toBe("Mobile (4G/5G)");
    expect(networkTypeLabel("static_residential")).toBe("Static Residential");
  });

  it("NETWORK_TYPE_LABEL covers every NETWORK_TYPE_VALUES entry", () => {
    // Loop assertion — if a new enum value is added but the label
    // map isn't updated, this fails.
    const keys = Object.keys(NETWORK_TYPE_LABEL);
    expect(keys.length).toBeGreaterThanOrEqual(6);
    for (const k of keys) {
      expect(typeof NETWORK_TYPE_LABEL[k as keyof typeof NETWORK_TYPE_LABEL]).toBe("string");
    }
  });
});

describe("STATUS_LABEL — Wave 22J Vietnamese rebrand", () => {
  it("uses 'Sẵn sàng / Đã giao / Báo lỗi / Bảo trì' per the user spec", () => {
    expect(STATUS_LABEL.available).toBe("Sẵn sàng");
    expect(STATUS_LABEL.assigned).toBe("Đã giao");
    expect(STATUS_LABEL.banned).toBe("Báo lỗi");
    expect(STATUS_LABEL.maintenance).toBe("Bảo trì");
    expect(STATUS_LABEL.expired).toBe("Hết hạn");
  });
});

describe("deriveExpiryStatus — Wave 22J", () => {
  const NOW = new Date("2025-06-15T12:00:00Z");

  it("returns 'never' for null expires_at (proxy không có hạn)", () => {
    expect(deriveExpiryStatus(null, NOW)).toBe("never");
    expect(deriveExpiryStatus(undefined, NOW)).toBe("never");
  });

  it("returns 'expired' when expires_at <= now", () => {
    expect(deriveExpiryStatus("2025-06-15T11:59:59Z", NOW)).toBe("expired");
    expect(deriveExpiryStatus("2024-01-01T00:00:00Z", NOW)).toBe("expired");
  });

  it("returns 'expiring_soon' within 7 days", () => {
    expect(deriveExpiryStatus("2025-06-16T00:00:00Z", NOW)).toBe("expiring_soon");
    expect(deriveExpiryStatus("2025-06-21T11:59:59Z", NOW)).toBe("expiring_soon");
  });

  it("returns 'valid' when more than 7 days away", () => {
    expect(deriveExpiryStatus("2025-06-23T00:00:00Z", NOW)).toBe("valid");
    expect(deriveExpiryStatus("2026-01-01T00:00:00Z", NOW)).toBe("valid");
  });

  it("EXPIRY_LABEL is fully Vietnamese", () => {
    expect(EXPIRY_LABEL.valid).toBe("Còn hạn");
    expect(EXPIRY_LABEL.expiring_soon).toBe("Sắp hết hạn");
    expect(EXPIRY_LABEL.expired).toBe("Hết hạn");
    expect(EXPIRY_LABEL.never).toBe("Vĩnh viễn");
  });
});

describe("proxyStatusBadges — Wave 22J dual-badge logic", () => {
  it("an 'available' + valid expiry proxy renders 2 badges (Sẵn sàng + Còn hạn)", () => {
    const future = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const badges = proxyStatusBadges({ status: "available", expires_at: future, hidden: false });
    expect(badges.map((b) => b.label)).toEqual(["Sẵn sàng", "Còn hạn"]);
  });

  it("a 'hidden' proxy renders 'Đã ẩn' first regardless of other state", () => {
    const future = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const badges = proxyStatusBadges({ status: "available", expires_at: future, hidden: true });
    expect(badges[0].label).toBe("Đã ẩn");
  });

  it("expired status badge is suppressed in favour of derived expiry", () => {
    // Pre-22J: status='expired' was its own badge. Wave 22J: that's
    // redundant with the expiry-status column, so we only render the
    // expiry badge ("Hết hạn") and skip the lifecycle one.
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const badges = proxyStatusBadges({ status: "expired", expires_at: past, hidden: false });
    const labels = badges.map((b) => b.label);
    expect(labels).toContain("Hết hạn");
    // The lifecycle 'Hết hạn' from STATUS_LABEL is suppressed; only
    // the expiry-derived one shows up.
    expect(labels.filter((l) => l === "Hết hạn").length).toBe(1);
  });

  it("'never expires' proxy shows only the lifecycle badge", () => {
    const badges = proxyStatusBadges({ status: "available", expires_at: null, hidden: false });
    expect(badges.map((b) => b.label)).toEqual(["Sẵn sàng"]);
  });

  it("a banned + hidden proxy shows 'Đã ẩn' + 'Báo lỗi'", () => {
    const badges = proxyStatusBadges({ status: "banned", expires_at: null, hidden: true });
    expect(badges.map((b) => b.label)).toEqual(["Đã ẩn", "Báo lỗi"]);
  });
});
