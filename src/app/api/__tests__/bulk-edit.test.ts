import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Wave 22E-3 regression tests for bulk-edit (bug B2).
 *
 * Pre-fix bug: route did SELECT current statuses → app-side guard →
 * UPDATE. Two concurrent admins could both pass the guard with stale
 * status reads, then both UPDATE → illegal final state.
 *
 * Fix (mig 030): single safe_bulk_edit_proxies RPC where the guard
 * lives INSIDE the same transaction as the UPDATE. These tests pin
 * the contract — no future refactor can split the guard back out
 * without breaking these assertions.
 */

const mockRpc = vi.fn();
const mockInsert = vi.fn().mockResolvedValue({ data: null, error: null });

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: () => ({ insert: mockInsert }),
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: () =>
        Promise.resolve({
          data: { user: { email: "admin@test.com" } },
          error: null,
        }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            single: () =>
              Promise.resolve({
                data: {
                  id: "00000000-0000-4000-8000-000000000099",
                  email: "admin@test.com",
                  full_name: "Admin",
                  role: "admin",
                  is_active: true,
                },
                error: null,
              }),
          }),
        }),
      }),
    }),
  }),
}));

const ORIG_ENV = {
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
};

import { POST } from "@/app/api/proxies/bulk-edit/route";

function mkRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/proxies/bulk-edit", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/proxies/bulk-edit — Wave 22E-3 regression (B2)", () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockInsert.mockClear();
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
  });

  afterEach(() => {
    if (ORIG_ENV.NEXT_PUBLIC_APP_URL !== undefined) {
      process.env.NEXT_PUBLIC_APP_URL = ORIG_ENV.NEXT_PUBLIC_APP_URL;
    }
  });

  it("calls safe_bulk_edit_proxies (NOT the legacy SELECT-then-UPDATE pattern)", async () => {
    mockRpc.mockResolvedValueOnce({ data: { ok: true, updated: 3 }, error: null });

    const res = await POST(
      mkRequest({
        ids: [
          "00000000-0000-4000-8000-000000000001",
          "00000000-0000-4000-8000-000000000002",
          "00000000-0000-4000-8000-000000000003",
        ],
        updates: { status: "available" },
      }),
    );

    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledOnce();
    expect(mockRpc).toHaveBeenCalledWith(
      "safe_bulk_edit_proxies",
      expect.objectContaining({
        p_status: "available",
        p_ids: expect.any(Array),
      }),
    );
  });

  it("returns 409 with invalid_count when RPC reports illegal transition", async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        ok: false,
        error: "invalid_status_transition",
        invalid_count: 2,
        requested_status: "available",
      },
      error: null,
    });

    const res = await POST(
      mkRequest({
        ids: [
          "00000000-0000-4000-8000-000000000001",
          "00000000-0000-4000-8000-000000000002",
        ],
        updates: { status: "available" },
      }),
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.invalid_count).toBe(2);
    expect(body.error).toMatch(/cannot transition/);
  });

  it("does NOT issue any UPDATE when guard fails — guarantee against partial bulk", async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        ok: false,
        error: "invalid_status_transition",
        invalid_count: 1,
      },
      error: null,
    });

    await POST(
      mkRequest({
        ids: ["00000000-0000-4000-8000-000000000001"],
        updates: { status: "available" },
      }),
    );

    // The RPC was called exactly once; no separate UPDATE round-trip.
    // (The pre-fix race had THREE round-trips: SELECT, UPDATE, log.)
    const rpcCalls = mockRpc.mock.calls.map((c) => c[0]);
    expect(rpcCalls.filter((n) => n === "safe_bulk_edit_proxies").length).toBe(1);
  });

  it("rejects empty ids array via Zod schema", async () => {
    const res = await POST(
      mkRequest({
        ids: [],
        updates: { status: "available" },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects > 5000 ids", async () => {
    const ids = Array.from({ length: 5001 }, (_, i) =>
      `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    const res = await POST(
      mkRequest({ ids, updates: { status: "available" } }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects updates with no fields", async () => {
    const res = await POST(
      mkRequest({
        ids: ["00000000-0000-4000-8000-000000000001"],
        updates: {},
      }),
    );
    expect(res.status).toBe(400);
  });
});

import { afterEach } from "vitest";
