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
 * Wave 22J → Wave 22AB — proxy display label tests, refreshed.
 *
 * Wave 22AB collapsed the dual-badge model into a SINGLE-badge
 * priority chain per user spec: status filter must show only 5
 * buckets — Sẵn sàng / Đã giao / Báo lỗi / Đã ẩn / Sắp hết hạn.
 *
 * Threshold for "expiring_soon" dropped from 7 days to 3 days
 * (constants.ts EXPIRING_SOON_THRESHOLD_MS).
 *
 * Tests below pin both behaviours so a regression is loud.
 */

describe("networkTypeLabel — Wave 22AB", () => {
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
    const keys = Object.keys(NETWORK_TYPE_LABEL);
    expect(keys.length).toBeGreaterThanOrEqual(6);
    for (const k of keys) {
      expect(typeof NETWORK_TYPE_LABEL[k as keyof typeof NETWORK_TYPE_LABEL]).toBe("string");
    }
  });
});

describe("STATUS_LABEL — kept for legacy display, NOT a UI source of truth", () => {
  it("VI labels still resolve for legacy callers", () => {
    expect(STATUS_LABEL.available).toBe("Sẵn sàng");
    expect(STATUS_LABEL.assigned).toBe("Đã giao");
    expect(STATUS_LABEL.banned).toBe("Báo lỗi");
    // 'maintenance' + 'expired' enum values are still present in DB
    // but the Wave 22AB filter dropdown stops exposing them.
    expect(STATUS_LABEL.maintenance).toBe("Bảo trì");
    expect(STATUS_LABEL.expired).toBe("Hết hạn");
  });
});

describe("deriveExpiryStatus — Wave 22AB threshold = 3 days", () => {
  const NOW = new Date("2025-06-15T12:00:00Z");

  it("returns 'never' for null expires_at", () => {
    expect(deriveExpiryStatus(null, NOW)).toBe("never");
    expect(deriveExpiryStatus(undefined, NOW)).toBe("never");
  });

  it("returns 'expired' when expires_at <= now", () => {
    expect(deriveExpiryStatus("2025-06-15T11:59:59Z", NOW)).toBe("expired");
    expect(deriveExpiryStatus("2024-01-01T00:00:00Z", NOW)).toBe("expired");
  });

  it("returns 'expiring_soon' within the 3-day window", () => {
    expect(deriveExpiryStatus("2025-06-16T00:00:00Z", NOW)).toBe("expiring_soon");
    expect(deriveExpiryStatus("2025-06-18T11:59:59Z", NOW)).toBe("expiring_soon");
  });

  it("returns 'valid' when more than 3 days away", () => {
    expect(deriveExpiryStatus("2025-06-19T00:00:00Z", NOW)).toBe("valid");
    expect(deriveExpiryStatus("2026-01-01T00:00:00Z", NOW)).toBe("valid");
  });

  it("EXPIRY_LABEL still fully Vietnamese for legacy callers", () => {
    expect(EXPIRY_LABEL.valid).toBe("Còn hạn");
    expect(EXPIRY_LABEL.expiring_soon).toBe("Sắp hết hạn");
    expect(EXPIRY_LABEL.expired).toBe("Hết hạn");
    expect(EXPIRY_LABEL.never).toBe("Vĩnh viễn");
  });
});

describe("proxyStatusBadges — Wave 22AB single-badge priority chain", () => {
  it("hidden=true wins over everything else", () => {
    const future = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const badges = proxyStatusBadges({ status: "available", expires_at: future, hidden: true });
    expect(badges).toHaveLength(1);
    expect(badges[0].label).toBe("Đã ẩn");
  });

  it("banned beats expiring_soon + assigned", () => {
    const soon = new Date(Date.now() + 86_400_000).toISOString(); // 1 day
    const badges = proxyStatusBadges({ status: "banned", expires_at: soon, hidden: false });
    expect(badges).toHaveLength(1);
    expect(badges[0].label).toBe("Báo lỗi");
  });

  it("expiring_soon overrides assigned + available when within 3 days", () => {
    const soon = new Date(Date.now() + 86_400_000).toISOString();
    const aBadges = proxyStatusBadges({ status: "available", expires_at: soon, hidden: false });
    expect(aBadges[0].label).toBe("Sắp hết hạn");
    const bBadges = proxyStatusBadges({ status: "assigned", expires_at: soon, hidden: false });
    expect(bBadges[0].label).toBe("Sắp hết hạn");
  });

  it("assigned + valid expiry → 'Đã giao'", () => {
    const future = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const badges = proxyStatusBadges({ status: "assigned", expires_at: future, hidden: false });
    expect(badges).toHaveLength(1);
    expect(badges[0].label).toBe("Đã giao");
  });

  it("available + valid expiry → 'Sẵn sàng' (default)", () => {
    const badges = proxyStatusBadges({ status: "available", expires_at: null, hidden: false });
    expect(badges).toHaveLength(1);
    expect(badges[0].label).toBe("Sẵn sàng");
  });

  it("legacy maintenance + expired enums fall through to 'Sẵn sàng'", () => {
    // Wave 22AB intentionally drops these from the visible status set.
    // Sorting/admin-only views can still surface them; default UI hides.
    const m = proxyStatusBadges({ status: "maintenance", expires_at: null, hidden: false });
    expect(m[0].label).toBe("Sẵn sàng");
    const e = proxyStatusBadges({ status: "expired", expires_at: null, hidden: false });
    expect(e[0].label).toBe("Sẵn sàng");
  });
});
