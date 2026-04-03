import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock supabaseAdmin.rpc
// ---------------------------------------------------------------------------

let mockRpcReturnValue: { data: unknown; error: unknown } = {
  data: null,
  error: null,
};

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    rpc: vi.fn((_fnName: string, _params: unknown) => {
      return Promise.resolve(mockRpcReturnValue);
    }),
  },
}));

import { checkAndIncrementUsage } from "@/lib/rate-limiter";
import { supabaseAdmin } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// checkAndIncrementUsage — RPC behavior
// ---------------------------------------------------------------------------

describe("checkAndIncrementUsage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpcReturnValue = { data: null, error: null };
  });

  it("returns allowed=true and remaining counts when under limits", async () => {
    mockRpcReturnValue = {
      data: {
        allowed: true,
        remaining: { hourly: 4, daily: 19, total: 99 },
      },
      error: null,
    };

    const result = await checkAndIncrementUsage("user-123");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toEqual({ hourly: 4, daily: 19, total: 99 });

    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("check_and_increment_usage", {
      p_user_id: "user-123",
      p_global_max_total: null,
    });
  });

  it("returns allowed=false when hourly limit exceeded", async () => {
    mockRpcReturnValue = {
      data: { allowed: false, reason: "Hourly rate limit exceeded" },
      error: null,
    };

    const result = await checkAndIncrementUsage("user-123");
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("Hourly rate limit exceeded");
  });

  it("returns allowed=false when daily limit exceeded", async () => {
    mockRpcReturnValue = {
      data: { allowed: false, reason: "Daily rate limit exceeded" },
      error: null,
    };

    const result = await checkAndIncrementUsage("user-123");
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("Daily rate limit exceeded");
  });

  it("returns allowed=false when total limit exceeded", async () => {
    mockRpcReturnValue = {
      data: { allowed: false, reason: "Total rate limit exceeded" },
      error: null,
    };

    const result = await checkAndIncrementUsage("user-123");
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("Total rate limit exceeded");
  });

  it("passes globalMaxTotal to the RPC when provided", async () => {
    mockRpcReturnValue = {
      data: { allowed: true, remaining: { hourly: 1, daily: 1, total: 1 } },
      error: null,
    };

    await checkAndIncrementUsage("user-123", 50);

    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("check_and_increment_usage", {
      p_user_id: "user-123",
      p_global_max_total: 50,
    });
  });

  it("passes null global cap when globalMaxTotal is undefined", async () => {
    mockRpcReturnValue = {
      data: { allowed: true, remaining: { hourly: 1, daily: 1, total: 1 } },
      error: null,
    };

    await checkAndIncrementUsage("user-123");

    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("check_and_increment_usage", {
      p_user_id: "user-123",
      p_global_max_total: null,
    });
  });

  it("fails closed on DB error (returns allowed=false)", async () => {
    mockRpcReturnValue = {
      data: null,
      error: { message: "connection refused" },
    };

    const result = await checkAndIncrementUsage("user-123");
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("Rate limit check failed");
  });
});

// ---------------------------------------------------------------------------
// Validation hierarchy tests (pure logic, no DB)
// ---------------------------------------------------------------------------

describe("Rate limit validation hierarchy", () => {
  /**
   * These tests validate the business rules for rate limit values.
   * The actual enforcement happens in the Zod schema or the settings UI,
   * but we test the logical invariants here.
   */

  function validateHierarchy(
    hourly: number,
    daily: number,
    total: number
  ): { valid: boolean; reason?: string } {
    if (hourly > daily) {
      return { valid: false, reason: "hourly must not exceed daily" };
    }
    if (daily > total) {
      return { valid: false, reason: "daily must not exceed total" };
    }
    return { valid: true };
  }

  it("rejects hourly > daily", () => {
    const result = validateHierarchy(10, 5, 100);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("hourly must not exceed daily");
  });

  it("rejects daily > total", () => {
    const result = validateHierarchy(5, 100, 50);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("daily must not exceed total");
  });

  it("allows equal values (hourly=daily=total)", () => {
    const result = validateHierarchy(5, 5, 5);
    expect(result.valid).toBe(true);
  });

  it("allows zero limits", () => {
    const result = validateHierarchy(0, 0, 0);
    expect(result.valid).toBe(true);
  });

  it("allows valid ascending hierarchy", () => {
    const result = validateHierarchy(5, 20, 100);
    expect(result.valid).toBe(true);
  });

  it("allows hourly=daily < total", () => {
    const result = validateHierarchy(10, 10, 100);
    expect(result.valid).toBe(true);
  });

  it("allows hourly < daily=total", () => {
    const result = validateHierarchy(5, 50, 50);
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Global cap capping logic (unit test for the cap-down algorithm)
// ---------------------------------------------------------------------------

describe("Global cap enforcement logic", () => {
  /**
   * Mirrors the logic added in the settings route and user update route:
   * if a value exceeds the global cap, it gets capped down.
   */

  function applyGlobalCap(
    value: number,
    globalCap: number | null
  ): number {
    if (globalCap !== null && globalCap > 0 && value > globalCap) {
      return globalCap;
    }
    return value;
  }

  it("caps value down to global max when exceeded", () => {
    expect(applyGlobalCap(200, 100)).toBe(100);
  });

  it("keeps value when under global max", () => {
    expect(applyGlobalCap(50, 100)).toBe(50);
  });

  it("keeps value when equal to global max", () => {
    expect(applyGlobalCap(100, 100)).toBe(100);
  });

  it("does not cap when global cap is null", () => {
    expect(applyGlobalCap(200, null)).toBe(200);
  });

  it("does not cap when global cap is 0 (disabled)", () => {
    expect(applyGlobalCap(200, 0)).toBe(200);
  });

  it("does not cap when global cap is negative (invalid)", () => {
    expect(applyGlobalCap(200, -1)).toBe(200);
  });
});
