import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Wave 22E-4 unit tests for the rate-limit module extracted from utils.ts.
 *
 * `checkRateLimit` is a pure function — no DB, no clock injection, just
 * input → output. These tests pin the contract so any future refactor
 * (or a hand-rolled re-implementation by an agent) breaks loudly.
 *
 * `loadGlobalCaps` is integration-y; we mock supabaseAdmin for the
 * happy-path shape check.
 */

const mockIn = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({ in: (...args: unknown[]) => mockIn(...args) }),
    }),
  },
}));

import { checkRateLimit, loadGlobalCaps } from "@/lib/telegram/rate-limit";

const baseUser = {
  rate_limit_hourly: 3,
  rate_limit_daily: 10,
  rate_limit_total: 50,
  proxies_used_hourly: 0,
  proxies_used_daily: 0,
  proxies_used_total: 0,
  hourly_reset_at: null,
  daily_reset_at: null,
};

describe("checkRateLimit — Wave 22E-4 module split contract", () => {
  it("allows when all counters are below their limits", () => {
    const result = checkRateLimit(baseUser);
    expect(result.allowed).toBe(true);
    expect(result.resetHourly).toBe(false);
    expect(result.resetDaily).toBe(false);
  });

  it("denies when hourly counter is at its limit", () => {
    const result = checkRateLimit({ ...baseUser, proxies_used_hourly: 3 });
    expect(result.allowed).toBe(false);
  });

  it("denies when daily counter is at its limit", () => {
    const result = checkRateLimit({ ...baseUser, proxies_used_daily: 10 });
    expect(result.allowed).toBe(false);
  });

  it("denies when total counter is at its limit", () => {
    const result = checkRateLimit({ ...baseUser, proxies_used_total: 50 });
    expect(result.allowed).toBe(false);
  });

  it("flags resetHourly when hourly_reset_at is in the past", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const result = checkRateLimit({
      ...baseUser,
      proxies_used_hourly: 3, // would deny otherwise
      hourly_reset_at: past,
    });
    // After reset, used_hourly is treated as 0 → allowed.
    expect(result.allowed).toBe(true);
    expect(result.resetHourly).toBe(true);
  });

  it("flags resetDaily when daily_reset_at is in the past", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const result = checkRateLimit({
      ...baseUser,
      proxies_used_daily: 10,
      daily_reset_at: past,
    });
    expect(result.allowed).toBe(true);
    expect(result.resetDaily).toBe(true);
  });

  it("does NOT flag reset when reset timestamp is in the future", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const result = checkRateLimit({
      ...baseUser,
      proxies_used_hourly: 3,
      hourly_reset_at: future,
    });
    // Counter still at 3, no reset → denied.
    expect(result.allowed).toBe(false);
    expect(result.resetHourly).toBe(false);
  });

  it("global cap shrinks the effective total limit", () => {
    // User has rate_limit_total=50, used 25. With global_max_total_requests=20,
    // the effective limit becomes 20, so 25 >= 20 → denied.
    const result = checkRateLimit(
      { ...baseUser, proxies_used_total: 25 },
      { global_max_total_requests: 20 },
    );
    expect(result.allowed).toBe(false);
  });

  it("global cap is ignored when zero or negative", () => {
    const result = checkRateLimit(
      { ...baseUser, proxies_used_total: 25 },
      { global_max_total_requests: 0 },
    );
    // Falls back to the user's own rate_limit_total of 50 — 25 < 50 → allowed.
    expect(result.allowed).toBe(true);
  });

  it("global cap that is larger than user limit does not raise the cap", () => {
    // User capped at 50, used 51 (somehow inflated). Even with global=1000,
    // we use the smaller of the two — so 51 >= 50 → denied.
    const result = checkRateLimit(
      { ...baseUser, proxies_used_total: 50 },
      { global_max_total_requests: 1000 },
    );
    expect(result.allowed).toBe(false);
  });
});

describe("loadGlobalCaps — Wave 22E-4 module split contract", () => {
  beforeEach(() => {
    mockIn.mockReset();
  });

  it("returns shaped object when both caps are set", async () => {
    mockIn.mockResolvedValueOnce({
      data: [
        { key: "global_max_proxies", value: { value: 100 } },
        { key: "global_max_total_requests", value: { value: 1000 } },
      ],
      error: null,
    });
    const caps = await loadGlobalCaps();
    expect(caps).toEqual({
      global_max_proxies: 100,
      global_max_total_requests: 1000,
    });
  });

  it("ignores non-numeric or non-positive values", async () => {
    mockIn.mockResolvedValueOnce({
      data: [
        { key: "global_max_proxies", value: { value: "abc" } },
        { key: "global_max_total_requests", value: { value: -5 } },
      ],
      error: null,
    });
    const caps = await loadGlobalCaps();
    // Both values are filtered out; resulting object is empty.
    expect(caps).toEqual({});
  });

  it("returns empty object when settings table has no rows", async () => {
    mockIn.mockResolvedValueOnce({ data: null, error: null });
    const caps = await loadGlobalCaps();
    expect(caps).toEqual({});
  });
});
