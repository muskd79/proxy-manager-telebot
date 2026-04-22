import { describe, it, expect, vi } from "vitest";
import { enqueuePurchase, assertValidTransition } from "../purchase";

function mockChain(final: { data: unknown; error: unknown }) {
  const chain = {
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(final),
    eq: vi.fn().mockReturnThis(),
  };
  return chain;
}

function mockSupabase(chains: Record<string, ReturnType<typeof mockChain>[]>) {
  const fromCalls: Record<string, number> = {};
  return {
    from: vi.fn((table: string) => {
      fromCalls[table] = (fromCalls[table] ?? 0) + 1;
      const arr = chains[table] ?? [];
      const chain = arr[fromCalls[table] - 1] ?? arr[arr.length - 1];
      return chain;
    }),
    __fromCalls: () => fromCalls,
  } as unknown as Parameters<typeof enqueuePurchase>[0];
}

describe("enqueuePurchase", () => {
  const validReq = {
    vendorId: "00000000-0000-0000-0000-000000000001",
    vendorProductId: "00000000-0000-0000-0000-000000000002",
    adminId: "00000000-0000-0000-0000-000000000003",
    idempotencyKey: "018f0000-0000-0000-0000-000000000000",
    quantity: 5,
    unitCostUsd: 1.25,
  };

  it("inserts a new pending order on first call", async () => {
    const chain = mockChain({
      data: { id: "order-1", status: "pending" },
      error: null,
    });
    const supabase = mockSupabase({ vendor_orders: [chain] });

    const result = await enqueuePurchase(supabase, validReq);
    expect(result).toEqual({
      orderId: "order-1",
      status: "pending",
      deduplicated: false,
    });
    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotency_key: validReq.idempotencyKey,
        quantity: 5,
        total_cost_usd: 6.25,
        status: "pending",
      }),
    );
  });

  it("returns existing row on unique-violation (dedup)", async () => {
    const insertChain = mockChain({
      data: null,
      error: { code: "23505", message: "duplicate key" },
    });
    const selectChain = mockChain({
      data: { id: "order-1", status: "processing" },
      error: null,
    });
    const supabase = mockSupabase({
      vendor_orders: [insertChain, selectChain],
    });

    const result = await enqueuePurchase(supabase, validReq);
    expect(result).toEqual({
      orderId: "order-1",
      status: "processing",
      deduplicated: true,
    });
  });

  it("throws on non-conflict DB error", async () => {
    const chain = mockChain({
      data: null,
      error: { code: "42P01", message: "relation does not exist" },
    });
    const supabase = mockSupabase({ vendor_orders: [chain] });
    await expect(enqueuePurchase(supabase, validReq)).rejects.toThrow(
      /relation does not exist/,
    );
  });

  it("rejects zero or negative quantity", async () => {
    const chain = mockChain({ data: null, error: null });
    const supabase = mockSupabase({ vendor_orders: [chain] });
    await expect(
      enqueuePurchase(supabase, { ...validReq, quantity: 0 }),
    ).rejects.toThrow(/quantity/);
    await expect(
      enqueuePurchase(supabase, { ...validReq, quantity: -1 }),
    ).rejects.toThrow(/quantity/);
  });

  it("rejects overlong idempotency key", async () => {
    const chain = mockChain({ data: null, error: null });
    const supabase = mockSupabase({ vendor_orders: [chain] });
    await expect(
      enqueuePurchase(supabase, {
        ...validReq,
        idempotencyKey: "x".repeat(200),
      }),
    ).rejects.toThrow(/idempotencyKey/);
  });
});

describe("assertValidTransition", () => {
  it("accepts valid hop", () => {
    expect(() => assertValidTransition("pending", "processing")).not.toThrow();
  });

  it("throws on invalid hop", () => {
    expect(() => assertValidTransition("refunded", "pending")).toThrow(
      /Invalid vendor order transition/,
    );
  });
});
