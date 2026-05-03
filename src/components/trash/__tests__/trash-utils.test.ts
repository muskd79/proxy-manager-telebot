import { describe, it, expect } from "vitest";
import {
  computeTrashCountdown,
  formatDeletedAt,
  TRASH_RETENTION_DAYS,
} from "../trash-utils";

/**
 * Wave 26-D-post1/D — pin every threshold transition for the trash
 * countdown badge. Critical because admin uses this to know which
 * rows are about to be auto-purged forever.
 */

const NOW = new Date("2026-05-04T12:00:00Z");

function daysAgo(n: number): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

describe("computeTrashCountdown", () => {
  it("returns danger + 'Không rõ' for null/undefined deleted_at", () => {
    expect(computeTrashCountdown(null, NOW)).toEqual({
      daysLeft: 0,
      label: "Không rõ",
      tone: "danger",
    });
    expect(computeTrashCountdown(undefined, NOW)).toEqual({
      daysLeft: 0,
      label: "Không rõ",
      tone: "danger",
    });
  });

  it("returns danger + 'Không rõ' for malformed timestamp", () => {
    const result = computeTrashCountdown("not-a-date", NOW);
    expect(result.tone).toBe("danger");
    expect(result.label).toBe("Không rõ");
  });

  it("ok tone when many days left (just-deleted)", () => {
    const result = computeTrashCountdown(daysAgo(0), NOW);
    expect(result.tone).toBe("ok");
    expect(result.daysLeft).toBeGreaterThan(7);
    expect(result.label).toMatch(/Còn \d+ ngày/);
  });

  it("ok tone with 8 days left", () => {
    const result = computeTrashCountdown(daysAgo(22), NOW);
    expect(result.tone).toBe("ok");
    expect(result.daysLeft).toBe(8);
  });

  it("warn tone with 7 days left", () => {
    const result = computeTrashCountdown(daysAgo(23), NOW);
    expect(result.tone).toBe("warn");
    expect(result.daysLeft).toBe(7);
  });

  it("warn tone with 2 days left", () => {
    const result = computeTrashCountdown(daysAgo(28), NOW);
    expect(result.tone).toBe("warn");
    expect(result.daysLeft).toBe(2);
  });

  it("danger tone with 1 day left", () => {
    const result = computeTrashCountdown(daysAgo(29), NOW);
    expect(result.tone).toBe("danger");
    expect(result.daysLeft).toBe(1);
    expect(result.label).toBe("Hôm nay sẽ xoá");
  });

  it("danger tone when past retention", () => {
    const result = computeTrashCountdown(daysAgo(31), NOW);
    expect(result.tone).toBe("danger");
    expect(result.daysLeft).toBe(0);
    expect(result.label).toBe("Đã quá hạn");
  });

  it("danger tone exactly at retention boundary", () => {
    // 30 days exactly → msLeft = 0 → "Đã quá hạn"
    const result = computeTrashCountdown(daysAgo(TRASH_RETENTION_DAYS), NOW);
    expect(result.tone).toBe("danger");
    expect(result.label).toBe("Đã quá hạn");
  });
});

describe("formatDeletedAt", () => {
  it("returns '—' for null/undefined", () => {
    expect(formatDeletedAt(null)).toBe("—");
    expect(formatDeletedAt(undefined)).toBe("—");
  });

  it("returns '—' for malformed date", () => {
    expect(formatDeletedAt("garbage")).toBe("—");
  });

  it("formats valid ISO to vi-VN string", () => {
    const out = formatDeletedAt("2026-05-04T08:30:00Z");
    expect(out).toMatch(/04\/05\/2026/);
    expect(out).toMatch(/\d{2}:\d{2}/); // hour:minute present
  });
});
