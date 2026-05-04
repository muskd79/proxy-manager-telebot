import { describe, it, expect } from "vitest";
import {
  deriveProgressBarSegments,
  getAssignedSubBreakdown,
  getBrokenSubBreakdown,
  isBelowMinStock,
  summariseDashboard,
} from "../aggregations";
import type { CategoryDashboardRow } from "../types";

/**
 * Wave 27 — pin aggregation helpers.
 */

function makeRow(overrides: Partial<CategoryDashboardRow> = {}): CategoryDashboardRow {
  return {
    id: "cat-1",
    name: "Test cat",
    description: null,
    color: "#000",
    icon: "folder",
    sort_order: 0,
    is_hidden: false,
    default_sale_price_usd: 50_000,
    default_purchase_price_usd: null,
    min_stock_alert: 0,
    proxy_count: 0,
    cnt_available: 0,
    cnt_assigned: 0,
    cnt_reported_broken: 0,
    cnt_expired: 0,
    cnt_banned: 0,
    cnt_maintenance: 0,
    assigned_live: 0,
    assigned_die: 0,
    assigned_unchecked: 0,
    broken_live: 0,
    broken_die: 0,
    broken_unchecked: 0,
    total_live: 0,
    total_die: 0,
    total_hidden: 0,
    stock_value_usd: 0,
    revenue_usd_cumulative: 0,
    cost_usd_total: 0,
    ...overrides,
  };
}

describe("deriveProgressBarSegments", () => {
  it("returns null when proxy_count is 0", () => {
    expect(deriveProgressBarSegments(makeRow({ proxy_count: 0 }))).toBeNull();
  });

  it("computes 3 segment widths summing to 100% in the simple case", () => {
    const row = makeRow({
      proxy_count: 100,
      cnt_available: 50,
      cnt_assigned: 30,
      cnt_reported_broken: 20,
    });
    const segs = deriveProgressBarSegments(row);
    expect(segs?.available.widthPct).toBe(50);
    expect(segs?.assigned.widthPct).toBe(30);
    expect(segs?.broken.widthPct).toBe(20);
    expect(segs?.total).toBe(100);
  });

  it("rolls expired/banned/maintenance into the broken segment", () => {
    const row = makeRow({
      proxy_count: 10,
      cnt_available: 0,
      cnt_assigned: 0,
      cnt_reported_broken: 2,
      cnt_expired: 3,
      cnt_banned: 4,
      cnt_maintenance: 1,
    });
    const segs = deriveProgressBarSegments(row);
    expect(segs?.broken.count).toBe(10);
    expect(segs?.broken.widthPct).toBe(100);
  });

  it("clamps percent to [0, 100]", () => {
    // pathological: counts > proxy_count (shouldn't happen but defensive)
    const row = makeRow({
      proxy_count: 10,
      cnt_available: 50,
    });
    const segs = deriveProgressBarSegments(row);
    expect(segs?.available.widthPct).toBe(100);
  });

  it("rounds widthPct to 2 decimal places", () => {
    const row = makeRow({
      proxy_count: 3,
      cnt_available: 1, // 33.333...%
    });
    const segs = deriveProgressBarSegments(row);
    expect(segs?.available.widthPct).toBe(33.33);
  });
});

describe("getAssignedSubBreakdown", () => {
  it("extracts the 3 assigned-* fields", () => {
    const row = makeRow({
      assigned_live: 59,
      assigned_die: 55,
      assigned_unchecked: 0,
    });
    expect(getAssignedSubBreakdown(row)).toEqual({
      live: 59,
      die: 55,
      unchecked: 0,
    });
  });
});

describe("getBrokenSubBreakdown", () => {
  it("extracts the 3 broken-* fields", () => {
    const row = makeRow({
      broken_live: 18,
      broken_die: 14,
      broken_unchecked: 0,
    });
    expect(getBrokenSubBreakdown(row)).toEqual({
      live: 18,
      die: 14,
      unchecked: 0,
    });
  });
});

describe("isBelowMinStock", () => {
  it("returns false when min_stock_alert is 0", () => {
    expect(
      isBelowMinStock(makeRow({ min_stock_alert: 0, cnt_available: 0 })),
    ).toBe(false);
  });
  it("returns true when available is below threshold", () => {
    expect(
      isBelowMinStock(makeRow({ min_stock_alert: 10, cnt_available: 5 })),
    ).toBe(true);
  });
  it("returns false when available equals threshold", () => {
    expect(
      isBelowMinStock(makeRow({ min_stock_alert: 10, cnt_available: 10 })),
    ).toBe(false);
  });
  it("returns false when available exceeds threshold", () => {
    expect(
      isBelowMinStock(makeRow({ min_stock_alert: 10, cnt_available: 100 })),
    ).toBe(false);
  });
});

describe("summariseDashboard", () => {
  it("returns zeros for empty array", () => {
    const summary = summariseDashboard([]);
    expect(summary).toEqual({
      categoryCount: 0,
      hiddenCategoryCount: 0,
      totalProxies: 0,
      totalAvailable: 0,
      totalAssigned: 0,
      totalRevenueUsd: 0,
      totalCostUsd: 0,
    });
  });
  it("aggregates 3 rows correctly", () => {
    const rows = [
      makeRow({
        proxy_count: 100,
        cnt_available: 50,
        cnt_assigned: 30,
        revenue_usd_cumulative: 1000,
        cost_usd_total: 200,
      }),
      makeRow({
        proxy_count: 50,
        cnt_available: 0,
        cnt_assigned: 50,
        is_hidden: true,
        revenue_usd_cumulative: 500,
        cost_usd_total: 100,
      }),
      makeRow({
        proxy_count: 0,
      }),
    ];
    const summary = summariseDashboard(rows);
    expect(summary.categoryCount).toBe(3);
    expect(summary.hiddenCategoryCount).toBe(1);
    expect(summary.totalProxies).toBe(150);
    expect(summary.totalAvailable).toBe(50);
    expect(summary.totalAssigned).toBe(80);
    expect(summary.totalRevenueUsd).toBe(1500);
    expect(summary.totalCostUsd).toBe(300);
  });
});
