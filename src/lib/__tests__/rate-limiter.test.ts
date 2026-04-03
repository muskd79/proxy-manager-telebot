import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock supabase admin to avoid requiring real credentials
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {},
}));

import { checkApiRateLimit } from "../rate-limiter";

describe("checkApiRateLimit", () => {
  it("allows first request", () => {
    const result = checkApiRateLimit("test-ip-" + Date.now());
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBeGreaterThan(0);
  });

  it("tracks request count", () => {
    const ip = "track-test-" + Date.now();
    const r1 = checkApiRateLimit(ip);
    const r2 = checkApiRateLimit(ip);
    expect(r2.remaining).toBeLessThan(r1.remaining);
  });

  it("blocks after limit exceeded", () => {
    const ip = "block-test-" + Date.now();
    // Exhaust the limit
    for (let i = 0; i < 101; i++) {
      checkApiRateLimit(ip);
    }
    const result = checkApiRateLimit(ip);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });
});
