import { describe, it, expect, vi, beforeEach } from "vitest";
import { pickReplacementProxy } from "../allocator";
import type { Proxy } from "@/types/database";

/**
 * Wave 26-D bug hunt v4 [TEST] — pin the 3-tier allocator behavior.
 *
 * Allocator was previously untested even though it has the most
 * branchy logic in the warranty subsystem (3 tiers + NULL/non-NULL
 * column guards + reliability_score ordering). The v3 NULL-guard fix
 * (lines 127-142 of allocator.ts) is critical: pre-fix uncategorised
 * proxies fell through Tier 2 matching all uncategorised inventory,
 * giving back wrong-category replacements.
 *
 * These tests mock the chained Supabase query builder. Each tier's
 * tryTier call ends with `.limit(1)` returning `{ data, error }`.
 */

const ORIGINAL_ID = "00000000-0000-0000-0000-000000000001";
const REPLACEMENT_TIER1_ID = "00000000-0000-0000-0000-000000000010";
const REPLACEMENT_TIER2_ID = "00000000-0000-0000-0000-000000000020";
const REPLACEMENT_TIER3_ID = "00000000-0000-0000-0000-000000000030";

function makeProxy(overrides: Partial<Proxy> = {}): Proxy {
  return {
    id: REPLACEMENT_TIER1_ID,
    host: "1.2.3.4",
    port: 8080,
    type: "http",
    category_id: null,
    username: null,
    password: null,
    country: null,
    city: null,
    isp: null,
    status: "available",
    speed_ms: 100,
    last_checked_at: new Date().toISOString(),
    assigned_to: null,
    assigned_at: null,
    expires_at: null,
    is_deleted: false,
    deleted_at: null,
    notes: null,
    hidden: false,
    network_type: null,
    distribute_count: 0,
    reliability_score: 100,
    sale_price_usd: null,
    cost_usd: null,
    purchase_date: null,
    vendor_label: null,
    created_at: new Date().toISOString(),
    created_by: null,
    updated_at: new Date().toISOString(),
    import_batch_id: null,
    ...overrides,
  } as Proxy;
}

/**
 * Build a Supabase mock that returns predetermined rows for each
 * sequential `.limit(1)` call. The tier code calls `tryTier` up to
 * 3 times in series; each call ends with `.limit(1)` returning a
 * Promise of `{ data, error }`.
 */
function buildSupabaseMock(returns: Array<{ data: Proxy[] | null; error: unknown }>) {
  let callIdx = 0;
  // Each chained method returns a builder that proxies to itself
  // until `.limit(1)` resolves with the next return value.
  const builder: Record<string, unknown> = {};
  const chain = (..._args: unknown[]) => builder;
  builder.from = chain;
  builder.select = chain;
  builder.eq = chain;
  builder.is = chain;
  builder.neq = chain;
  builder.order = chain;
  builder.limit = vi.fn(() => {
    const ret = returns[callIdx] ?? { data: [], error: null };
    callIdx++;
    return Promise.resolve(ret);
  });

  return {
    from: vi.fn(() => builder),
  } as unknown as Parameters<typeof pickReplacementProxy>[0]["supabase"];
}

describe("pickReplacementProxy — 3-tier fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Tier 1 match: same category + same network_type returns immediately", async () => {
    const original = makeProxy({
      id: ORIGINAL_ID,
      category_id: "cat-A",
      network_type: "isp",
      type: "http",
    });
    const tier1Match = makeProxy({
      id: REPLACEMENT_TIER1_ID,
      category_id: "cat-A",
      network_type: "isp",
      type: "http",
    });
    const supabase = buildSupabaseMock([
      { data: [tier1Match], error: null }, // tier 1 query returns one
      // tiers 2 + 3 should NEVER be called
    ]);

    const result = await pickReplacementProxy({ originalProxy: original, supabase });

    expect(result.tier).toBe(1);
    expect(result.proxy?.id).toBe(REPLACEMENT_TIER1_ID);
  });

  it("Tier 2 fallback: category matches when network_type differs", async () => {
    const original = makeProxy({
      id: ORIGINAL_ID,
      category_id: "cat-A",
      network_type: "isp",
      type: "http",
    });
    const tier2Match = makeProxy({
      id: REPLACEMENT_TIER2_ID,
      category_id: "cat-A",
      network_type: "datacenter_ipv4", // different from original
      type: "http",
    });
    const supabase = buildSupabaseMock([
      { data: [], error: null }, // tier 1 empty
      { data: [tier2Match], error: null }, // tier 2 returns
    ]);

    const result = await pickReplacementProxy({ originalProxy: original, supabase });

    expect(result.tier).toBe(2);
    expect(result.proxy?.id).toBe(REPLACEMENT_TIER2_ID);
  });

  it("Tier 3 fallback: any same-protocol available proxy", async () => {
    const original = makeProxy({
      id: ORIGINAL_ID,
      category_id: "cat-A",
      network_type: "isp",
      type: "http",
    });
    const tier3Match = makeProxy({
      id: REPLACEMENT_TIER3_ID,
      category_id: "cat-Z", // unrelated
      network_type: "mobile",
      type: "http",
    });
    const supabase = buildSupabaseMock([
      { data: [], error: null }, // tier 1 empty
      { data: [], error: null }, // tier 2 empty
      { data: [tier3Match], error: null }, // tier 3 returns
    ]);

    const result = await pickReplacementProxy({ originalProxy: original, supabase });

    expect(result.tier).toBe(3);
    expect(result.proxy?.id).toBe(REPLACEMENT_TIER3_ID);
  });

  it("NULL category: skips Tier 1 and Tier 2, jumps to Tier 3", async () => {
    // The bug v3 fix: when category_id is null, "same category" is
    // semantically meaningless — running tier 1/2 with `is("category_id", null)`
    // would match all uncategorised proxies (potentially wrong-category).
    // Allocator must skip directly to tier 3 (any same-protocol).
    const original = makeProxy({
      id: ORIGINAL_ID,
      category_id: null,
      network_type: null,
      type: "http",
    });
    const tier3Match = makeProxy({ id: REPLACEMENT_TIER3_ID, type: "http" });
    const supabase = buildSupabaseMock([
      { data: [tier3Match], error: null }, // first (and only) call should be tier 3
    ]);

    const result = await pickReplacementProxy({ originalProxy: original, supabase });

    expect(result.tier).toBe(3);
    expect(result.proxy?.id).toBe(REPLACEMENT_TIER3_ID);
  });

  it("NULL network_type only: runs Tier 2 (category match) then Tier 3", async () => {
    // Tier 1 needs BOTH meaningful — skip when network_type is null.
    // Tier 2 only needs category — runs.
    const original = makeProxy({
      id: ORIGINAL_ID,
      category_id: "cat-A",
      network_type: null,
      type: "http",
    });
    const tier2Match = makeProxy({
      id: REPLACEMENT_TIER2_ID,
      category_id: "cat-A",
      type: "http",
    });
    const supabase = buildSupabaseMock([
      { data: [tier2Match], error: null }, // tier 2 returns directly
    ]);

    const result = await pickReplacementProxy({ originalProxy: original, supabase });

    expect(result.tier).toBe(2);
    expect(result.proxy?.id).toBe(REPLACEMENT_TIER2_ID);
  });

  it("All tiers exhausted returns { proxy: null, tier: null }", async () => {
    const original = makeProxy({
      id: ORIGINAL_ID,
      category_id: "cat-A",
      network_type: "isp",
      type: "http",
    });
    const supabase = buildSupabaseMock([
      { data: [], error: null }, // tier 1
      { data: [], error: null }, // tier 2
      { data: [], error: null }, // tier 3
    ]);

    const result = await pickReplacementProxy({ originalProxy: original, supabase });

    expect(result.tier).toBeNull();
    expect(result.proxy).toBeNull();
  });

  it("Throws when DB query errors", async () => {
    const original = makeProxy({
      id: ORIGINAL_ID,
      category_id: "cat-A",
      network_type: "isp",
      type: "http",
    });
    const supabase = buildSupabaseMock([
      { data: null, error: { message: "DB exploded" } },
    ]);

    await expect(
      pickReplacementProxy({ originalProxy: original, supabase }),
    ).rejects.toThrow(/Allocator query failed/);
  });
});
