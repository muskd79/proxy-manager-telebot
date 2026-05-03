import { describe, it, expect } from "vitest";
import { formatRelativeVi, formatRelativeWithTitle } from "../format-time";

const NOW = new Date("2026-05-03T12:00:00Z");

describe("formatRelativeVi", () => {
  it("returns '-' for null / undefined / empty", () => {
    expect(formatRelativeVi(null)).toBe("-");
    expect(formatRelativeVi(undefined)).toBe("-");
    expect(formatRelativeVi("")).toBe("-");
  });

  it("returns '-' for invalid date string", () => {
    expect(formatRelativeVi("not-a-date")).toBe("-");
  });

  it("collapses sub-minute differences to 'Vừa xong'", () => {
    expect(formatRelativeVi(new Date(NOW.getTime() - 10_000), { now: NOW })).toBe("Vừa xong");
    expect(formatRelativeVi(new Date(NOW.getTime() - 59_000), { now: NOW })).toBe("Vừa xong");
  });

  it("formats minutes (past)", () => {
    expect(formatRelativeVi(new Date(NOW.getTime() - 5 * 60_000), { now: NOW })).toBe("5 phút trước");
    expect(formatRelativeVi(new Date(NOW.getTime() - 59 * 60_000), { now: NOW })).toBe("59 phút trước");
  });

  it("formats hours (past)", () => {
    expect(formatRelativeVi(new Date(NOW.getTime() - 3 * 3600_000), { now: NOW })).toBe("3 giờ trước");
    expect(formatRelativeVi(new Date(NOW.getTime() - 23 * 3600_000), { now: NOW })).toBe("23 giờ trước");
  });

  it("formats days (past)", () => {
    expect(formatRelativeVi(new Date(NOW.getTime() - 1 * 86400_000), { now: NOW })).toBe("1 ngày trước");
    expect(formatRelativeVi(new Date(NOW.getTime() - 29 * 86400_000), { now: NOW })).toBe("29 ngày trước");
  });

  it("formats months (past, 30-day approximation)", () => {
    // 30 days exactly → 1 month
    expect(formatRelativeVi(new Date(NOW.getTime() - 30 * 86400_000), { now: NOW })).toBe("1 tháng trước");
    // 89 days → 2 months
    expect(formatRelativeVi(new Date(NOW.getTime() - 89 * 86400_000), { now: NOW })).toBe("2 tháng trước");
  });

  it("switches to absolute DD/MM/YYYY for ≥ 1 year", () => {
    const oneYearAgo = new Date(NOW.getTime() - 365 * 86400_000);
    const out = formatRelativeVi(oneYearAgo, { now: NOW });
    // vi-VN locale → DD/MM/YYYY
    expect(out).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });

  it("formats future tense for input in the future", () => {
    expect(formatRelativeVi(new Date(NOW.getTime() + 5 * 60_000), { now: NOW })).toBe("trong 5 phút");
    expect(formatRelativeVi(new Date(NOW.getTime() + 3 * 86400_000), { now: NOW })).toBe("trong 3 ngày");
  });

  it("accepts ISO string input", () => {
    const iso = new Date(NOW.getTime() - 2 * 3600_000).toISOString();
    expect(formatRelativeVi(iso, { now: NOW })).toBe("2 giờ trước");
  });

  it("forces absolute output when opts.absolute = true", () => {
    expect(formatRelativeVi(new Date(NOW.getTime() - 5 * 60_000), { now: NOW, absolute: true }))
      .toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });

  it("regression: 30 days threshold rounds correctly (Wave 26-C user feedback)", () => {
    // The user-reported "30 ngày trước" should land at exactly 30 days
    // input. Pre-fix the desktop column showed `28/04/2026 14:32` which
    // doesn't tell admins how long ago at a glance.
    const t = new Date(NOW.getTime() - 30 * 86400_000);
    // 30 * 86400_000 = MONTH boundary → flips to "1 tháng trước"
    expect(formatRelativeVi(t, { now: NOW })).toBe("1 tháng trước");
    // One day before that → "29 ngày trước"
    const t2 = new Date(NOW.getTime() - 29 * 86400_000);
    expect(formatRelativeVi(t2, { now: NOW })).toBe("29 ngày trước");
  });
});

describe("formatRelativeWithTitle", () => {
  it("returns both relative + absolute timestamps", () => {
    const t = new Date(NOW.getTime() - 5 * 60_000);
    const out = formatRelativeWithTitle(t, { now: NOW });
    expect(out.relative).toBe("5 phút trước");
    expect(out.absolute).toMatch(/\d{2}\/\d{2}\/\d{4}/);
    expect(out.absolute).toMatch(/\d{2}:\d{2}/); // hour:minute present
  });

  it("returns '-' pair for null", () => {
    const out = formatRelativeWithTitle(null);
    expect(out).toEqual({ relative: "-", absolute: "-" });
  });

  it("returns '-' pair for invalid date", () => {
    const out = formatRelativeWithTitle("garbage");
    expect(out).toEqual({ relative: "-", absolute: "-" });
  });
});
