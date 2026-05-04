import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createChainableMock } from "@test/mocks/supabase";

/**
 * Wave 26-D bug hunt v4 [TEST] — pin every error path of
 * PATCH /api/warranty/[id].
 *
 * The route is the most complex mutation endpoint in the codebase:
 * 7 sequential DB writes for approve, 4 for reject, race-safe via
 * .eq("status","pending") guards. Pre-v4 it had ZERO direct tests.
 *
 * Strategy: mock at the boundary layer (allocator, Supabase client,
 * Telegram, audit). Drive the route through each error branch by
 * configuring the chainable mock's `single()`/`maybeSingle()` return
 * value PER TEST.
 */

// ─── Mocks ────────────────────────────────────────────────────────

const mockAdmin = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "admin@test.local",
  full_name: "Test Admin",
  role: "admin" as const,
  is_active: true,
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({})),
}));

vi.mock("@/lib/auth", () => ({
  requireAdminOrAbove: vi.fn(async () => ({ admin: mockAdmin, error: null })),
  requireAnyRole: vi.fn(async () => ({ admin: mockAdmin, error: null })),
  actorLabel: (a: { full_name?: string | null; email?: string | null }) =>
    a?.full_name || a?.email || "Admin",
}));

vi.mock("@/lib/csrf", () => ({
  // assertSameOrigin returns null (= passes) in NODE_ENV=test in real
  // impl. We mirror that here so the route progresses past the CSRF
  // gate during tests.
  assertSameOrigin: () => null,
  sanitizeLogLine: (s: string) => s,
}));

vi.mock("@/lib/error-tracking", () => ({
  captureError: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/telegram/send", () => ({
  sendTelegramMessage: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("@/lib/warranty/events", () => ({
  logProxyEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/warranty/settings", () => ({
  loadWarrantySettings: vi.fn(async () => ({
    eligibility_unlimited: false,
    max_pending: 2,
    max_per_30d: 5,
    cooldown_minutes: 60,
    reliability_decrement: 5,
  })),
}));

const mockPickReplacement = vi.fn();
vi.mock("@/lib/warranty/allocator", () => ({
  pickReplacementProxy: (...args: unknown[]) => mockPickReplacement(...args),
}));

// supabaseAdmin chainable mocks per table.
const fromMocks = new Map<string, ReturnType<typeof createChainableMock>>();
function getOrCreateMock(table: string) {
  if (!fromMocks.has(table)) {
    fromMocks.set(table, createChainableMock());
  }
  return fromMocks.get(table)!;
}

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: (table: string) => getOrCreateMock(table),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  },
}));

import { PATCH } from "@/app/api/warranty/[id]/route";

// ─── Helpers ──────────────────────────────────────────────────────

const VALID_CLAIM_ID = "11111111-1111-4111-8111-111111111111";
const VALID_USER_ID = "22222222-2222-4222-8222-222222222222";
const VALID_PROXY_ID = "33333333-3333-4333-8333-333333333333";

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest(
    `http://localhost/api/warranty/${VALID_CLAIM_ID}`,
    {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    },
  );
}

function makePendingClaim(overrides: Record<string, unknown> = {}) {
  return {
    id: VALID_CLAIM_ID,
    proxy_id: VALID_PROXY_ID,
    user_id: VALID_USER_ID,
    status: "pending",
    reason_code: "no_connect",
    reason_text: null,
    replacement_proxy_id: null,
    also_mark_banned: false,
    resolved_by: null,
    resolved_at: null,
    rejection_reason: null,
    created_at: new Date().toISOString(),
    proxy: {
      id: VALID_PROXY_ID,
      host: "1.2.3.4",
      port: 8080,
      type: "http",
      status: "reported_broken",
      category_id: null,
      network_type: null,
      country: null,
      assigned_to: VALID_USER_ID,
      expires_at: null,
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fromMocks.clear();
  mockPickReplacement.mockReset();
});

// ─── Tests ────────────────────────────────────────────────────────

describe("PATCH /api/warranty/[id] — input validation", () => {
  it("returns 400 for non-UUID claim id", async () => {
    const req = new NextRequest("http://localhost/api/warranty/not-a-uuid", {
      method: "PATCH",
      body: JSON.stringify({ action: "approve" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: "not-a-uuid" }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Invalid claim id/i);
  });

  it("returns 400 when body has neither approve nor reject action", async () => {
    const res = await PATCH(makeRequest({}), {
      params: Promise.resolve({ id: VALID_CLAIM_ID }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Validation failed");
  });

  it("returns 400 when reject action lacks rejection_reason", async () => {
    const res = await PATCH(makeRequest({ action: "reject" }), {
      params: Promise.resolve({ id: VALID_CLAIM_ID }),
    });
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/warranty/[id] — claim lookup", () => {
  it("returns 404 when claim doesn't exist", async () => {
    const claimMock = createChainableMock({ data: null, error: null });
    fromMocks.set("warranty_claims", claimMock);

    const res = await PATCH(makeRequest({ action: "approve" }), {
      params: Promise.resolve({ id: VALID_CLAIM_ID }),
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Claim not found");
  });

  it("returns 409 when claim is no longer pending", async () => {
    const resolvedClaim = makePendingClaim({ status: "approved" });
    const claimMock = createChainableMock({ data: resolvedClaim, error: null });
    fromMocks.set("warranty_claims", claimMock);

    const res = await PATCH(makeRequest({ action: "approve" }), {
      params: Promise.resolve({ id: VALID_CLAIM_ID }),
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.message).toMatch(/approved/i);
  });

  it("returns 404 when proxy FK is dangling (proxy: null)", async () => {
    const claimWithNullProxy = makePendingClaim({ proxy: null });
    const claimMock = createChainableMock({
      data: claimWithNullProxy,
      error: null,
    });
    fromMocks.set("warranty_claims", claimMock);

    const res = await PATCH(makeRequest({ action: "approve" }), {
      params: Promise.resolve({ id: VALID_CLAIM_ID }),
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/FK dangling/i);
  });
});

describe("PATCH /api/warranty/[id] — approve flow", () => {
  it("returns 503 when allocator finds no replacement", async () => {
    const pendingClaim = makePendingClaim();
    // Initial claim fetch
    const claimMock = createChainableMock({ data: pendingClaim, error: null });
    // Critical: the lock UPDATE re-uses the same mock — its
    // .maybeSingle() returns the locked claim row.
    claimMock.maybeSingle = vi.fn().mockResolvedValue({
      data: { ...pendingClaim, status: "approved" },
      error: null,
    });
    fromMocks.set("warranty_claims", claimMock);

    // Allocator returns null → 503 path.
    mockPickReplacement.mockResolvedValue({ proxy: null, tier: null });

    const res = await PATCH(makeRequest({ action: "approve" }), {
      params: Promise.resolve({ id: VALID_CLAIM_ID }),
    });

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/no.*replacement/i);
  });

  it("returns 409 when claim was raced by another admin (lock UPDATE returned null)", async () => {
    const pendingClaim = makePendingClaim();
    const claimMock = createChainableMock({ data: pendingClaim, error: null });
    // Lock UPDATE returns null → the .eq("status","pending") didn't match
    // because another admin already flipped it.
    claimMock.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    fromMocks.set("warranty_claims", claimMock);

    const res = await PATCH(makeRequest({ action: "approve" }), {
      params: Promise.resolve({ id: VALID_CLAIM_ID }),
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.message).toMatch(/admin khác|đã được/i);
  });
});

describe("PATCH /api/warranty/[id] — reject flow", () => {
  it("returns 200 on happy-path reject", async () => {
    const pendingClaim = makePendingClaim();
    const claimMock = createChainableMock({ data: pendingClaim, error: null });
    // Reject's lock UPDATE returns the rejected claim row.
    claimMock.maybeSingle = vi.fn().mockResolvedValue({
      data: { ...pendingClaim, status: "rejected", rejection_reason: "test reason" },
      error: null,
    });
    fromMocks.set("warranty_claims", claimMock);

    // proxies UPDATE for revert from reported_broken to assigned.
    const proxiesMock = createChainableMock({ data: null, error: null });
    fromMocks.set("proxies", proxiesMock);

    const res = await PATCH(
      makeRequest({ action: "reject", rejection_reason: "test reason" }),
      { params: Promise.resolve({ id: VALID_CLAIM_ID }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data?.claim?.status).toBe("rejected");
  });

  it("returns 409 when reject's atomic lock loses to a concurrent transition", async () => {
    const pendingClaim = makePendingClaim();
    const claimMock = createChainableMock({ data: pendingClaim, error: null });
    // Lock UPDATE returns null — race lost.
    claimMock.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    fromMocks.set("warranty_claims", claimMock);

    const res = await PATCH(
      makeRequest({ action: "reject", rejection_reason: "stop spam" }),
      { params: Promise.resolve({ id: VALID_CLAIM_ID }) },
    );

    expect(res.status).toBe(409);
  });
});
