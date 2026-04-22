import { describe, it, expect, vi } from "vitest";

// Mock supabase admin with rpc method
const mockRpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

import { checkApiRateLimit } from "../rate-limiter";

describe("checkApiRateLimit", () => {
  it("allows request when DB returns allowed=true", async () => {
    mockRpc.mockResolvedValueOnce({
      data: { allowed: true, remaining: 99 },
      error: null,
    });

    const result = await checkApiRateLimit("test-ip");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(99);
    expect(mockRpc).toHaveBeenCalledWith("check_api_rate_limit", {
      p_ip: "test-ip",
      p_max_requests: 100,
      p_window_seconds: 60,
    });
  });

  it("blocks when DB returns allowed=false", async () => {
    mockRpc.mockResolvedValueOnce({
      data: { allowed: false, remaining: 0 },
      error: null,
    });

    const result = await checkApiRateLimit("test-ip");
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("fails CLOSED on DB error (Wave 18B: was fail-open, caused DoS amplification)", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "DB connection failed" },
    });

    const result = await checkApiRateLimit("test-ip");
    expect(result.allowed).toBe(false); // fail-CLOSED
    expect(result.remaining).toBe(0);
    expect(result.checkFailed).toBe(true);
  });

  it("fails CLOSED on unexpected exception (Wave 18B)", async () => {
    mockRpc.mockRejectedValueOnce(new Error("Network error"));

    const result = await checkApiRateLimit("test-ip");
    expect(result.allowed).toBe(false); // fail-CLOSED
    expect(result.checkFailed).toBe(true);
  });
});
