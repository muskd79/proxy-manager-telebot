import { describe, it, expect } from "vitest";
import {
  formatVnd,
  formatCount,
  computeMargin,
  STATUS_LABEL_VI,
} from "../formatters";

/**
 * Wave 27 — pin every branch of the categories formatters.
 */

describe("formatVnd", () => {
  it("returns '—' for null", () => {
    expect(formatVnd(null)).toBe("—");
  });
  it("returns '—' for undefined", () => {
    expect(formatVnd(undefined)).toBe("—");
  });
  it("returns '—' for NaN", () => {
    expect(formatVnd(Number.NaN)).toBe("—");
  });
  it("returns '0' for 0", () => {
    expect(formatVnd(0)).toBe("0");
  });

  describe("under 1K", () => {
    it("returns the integer as-is", () => {
      expect(formatVnd(50)).toBe("50");
      expect(formatVnd(999)).toBe("999");
    });
  });

  describe("K range (1K - 999K)", () => {
    it("formats 1000 as '1K'", () => {
      expect(formatVnd(1000)).toBe("1K");
    });
    it("formats 50000 as '50K'", () => {
      expect(formatVnd(50_000)).toBe("50K");
    });
    it("formats 80000 as '80K'", () => {
      expect(formatVnd(80_000)).toBe("80K");
    });
    it("formats 110000 as '110K'", () => {
      expect(formatVnd(110_000)).toBe("110K");
    });
  });

  describe("M range (1M - 999M)", () => {
    it("formats 1000000 as '1M'", () => {
      expect(formatVnd(1_000_000)).toBe("1M");
    });
    it("formats 11400000 as '11.4M'", () => {
      expect(formatVnd(11_400_000)).toBe("11.4M");
    });
    it("formats 35300000 as '35.3M'", () => {
      expect(formatVnd(35_300_000)).toBe("35.3M");
    });
    it("rounds 11_450_000 to '11.5M'", () => {
      expect(formatVnd(11_450_000)).toBe("11.5M");
    });
  });

  describe("B range", () => {
    it("formats 2_000_000_000 as '2B'", () => {
      expect(formatVnd(2_000_000_000)).toBe("2B");
    });
    it("formats 3_500_000_000 as '3.5B'", () => {
      expect(formatVnd(3_500_000_000)).toBe("3.5B");
    });
  });

  describe("negative values", () => {
    it("preserves the negative sign in K range", () => {
      expect(formatVnd(-50_000)).toBe("-50K");
    });
    it("preserves the negative sign in M range", () => {
      expect(formatVnd(-1_500_000)).toBe("-1.5M");
    });
  });
});

describe("formatCount", () => {
  it("returns '0' for null/undefined/NaN", () => {
    expect(formatCount(null)).toBe("0");
    expect(formatCount(undefined)).toBe("0");
    expect(formatCount(Number.NaN)).toBe("0");
  });
  it("returns the integer as-is below 10000", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(147)).toBe("147");
    expect(formatCount(9999)).toBe("9999");
  });
  it("uses 'K+' shorthand at 10000+", () => {
    expect(formatCount(10_000)).toBe("10K+");
    expect(formatCount(12_345)).toBe("12K+");
    expect(formatCount(99_999)).toBe("99K+");
    expect(formatCount(100_000)).toBe("100K+");
  });
  it("clamps negatives to 0", () => {
    expect(formatCount(-5)).toBe("0");
  });
  it("floors fractional input", () => {
    expect(formatCount(147.9)).toBe("147");
  });
});

describe("computeMargin", () => {
  it("subtracts cost from revenue", () => {
    expect(computeMargin(11_400_000, 1_100_000)).toBe(10_300_000);
  });
  it("treats null/undefined as 0", () => {
    expect(computeMargin(null, null)).toBe(0);
    expect(computeMargin(100, undefined)).toBe(100);
    expect(computeMargin(undefined, 50)).toBe(-50);
  });
  it("treats NaN as 0", () => {
    expect(computeMargin(Number.NaN, 100)).toBe(-100);
  });
  it("returns negative when cost > revenue (unsold inventory)", () => {
    expect(computeMargin(0, 5_000_000)).toBe(-5_000_000);
  });
});

describe("STATUS_LABEL_VI", () => {
  it("has a Vietnamese label for every status enum value", () => {
    expect(STATUS_LABEL_VI.available).toBe("Sẵn sàng");
    expect(STATUS_LABEL_VI.assigned).toBe("Đã giao");
    expect(STATUS_LABEL_VI.reported_broken).toBe("Báo lỗi");
    expect(STATUS_LABEL_VI.expired).toBe("Hết hạn");
    expect(STATUS_LABEL_VI.banned).toBe("Đã chặn");
    expect(STATUS_LABEL_VI.maintenance).toBe("Bảo trì");
  });
});
