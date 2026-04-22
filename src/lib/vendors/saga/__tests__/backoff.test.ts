import { describe, it, expect } from "vitest";
import {
  computeBackoffMs,
  computeNextAttemptAt,
  shouldDlq,
  MAX_ATTEMPTS_BEFORE_DLQ,
} from "../backoff";

describe("computeBackoffMs", () => {
  it("returns 0 for attempt 0 (no delay on first run)", () => {
    expect(computeBackoffMs(0)).toBe(0);
  });

  it("follows the 1s / 4s / 16s / 64s / 256s sequence (midpoint)", () => {
    const midpoint = () => 0.5; // zero jitter
    expect(computeBackoffMs(1, { random: midpoint })).toBe(1000);
    expect(computeBackoffMs(2, { random: midpoint })).toBe(4000);
    expect(computeBackoffMs(3, { random: midpoint })).toBe(16000);
    expect(computeBackoffMs(4, { random: midpoint })).toBe(64000);
    expect(computeBackoffMs(5, { random: midpoint })).toBe(256000);
  });

  it("stays within +/-25% jitter band", () => {
    const minRand = () => 0; // worst negative jitter
    const maxRand = () => 1; // worst positive jitter
    for (let a = 1; a <= 5; a++) {
      const low = computeBackoffMs(a, { random: minRand });
      const high = computeBackoffMs(a, { random: maxRand });
      const nominal = 1000 * Math.pow(4, a - 1);
      expect(low).toBeGreaterThanOrEqual(Math.floor(nominal * 0.75));
      expect(high).toBeLessThanOrEqual(Math.floor(nominal * 1.25) + 1);
    }
  });

  it("never returns negative", () => {
    const neg = () => -10; // pathological
    expect(computeBackoffMs(3, { random: neg })).toBeGreaterThanOrEqual(0);
  });
});

describe("computeNextAttemptAt", () => {
  it("adds backoff to the supplied now()", () => {
    const now = new Date("2026-05-01T00:00:00Z");
    const next = computeNextAttemptAt(2, { random: () => 0.5 }, now);
    expect(next.getTime() - now.getTime()).toBe(4000);
  });
});

describe("shouldDlq", () => {
  it("is true at the MAX threshold", () => {
    expect(shouldDlq(MAX_ATTEMPTS_BEFORE_DLQ)).toBe(true);
    expect(shouldDlq(MAX_ATTEMPTS_BEFORE_DLQ + 1)).toBe(true);
  });

  it("is false below the threshold", () => {
    expect(shouldDlq(0)).toBe(false);
    expect(shouldDlq(MAX_ATTEMPTS_BEFORE_DLQ - 1)).toBe(false);
  });
});
