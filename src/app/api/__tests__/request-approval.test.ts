import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createChainableMock } from "@test/mocks/supabase";
import { createTeleUser } from "@test/factories/user.factory";
import { createProxyRequest } from "@test/factories/request.factory";

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

const mockFromMap = new Map<string, any>();
const mockRpc = vi.fn().mockResolvedValue({ data: null, error: null });

function mockFrom(table: string) {
  if (!mockFromMap.has(table)) {
    mockFromMap.set(table, createChainableMock());
  }
  return mockFromMap.get(table)!;
}

const mockSupabase = {
  from: vi.fn((table: string) => mockFrom(table)),
  rpc: mockRpc,
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => mockSupabase),
}));

const mockAdmin = {
  id: "admin-1",
  email: "admin@test.com",
  full_name: "Test Admin",
  role: "admin",
};

vi.mock("@/lib/auth", () => ({
  requireAnyRole: vi.fn(async () => ({ admin: mockAdmin, error: null })),
  requireAdminOrAbove: vi.fn(async () => ({ admin: mockAdmin, error: null })),
  // Wave 22D-2: routes call actorLabel(admin) when writing logs.
  actorLabel: (a: { full_name?: string | null; email?: string | null }) =>
    a?.full_name || a?.email || "Admin",
}));

vi.mock("@/lib/logger", () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/telegram/send", () => ({
  sendTelegramMessage: vi.fn().mockResolvedValue({ success: true }),
  sendTelegramDocument: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("@/lib/telegram/notify-admins", () => ({
  notifyOtherAdmins: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Helper to create PUT request
// ---------------------------------------------------------------------------

function createPutRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/requests/req-1", {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Import the route handler (uses the @ alias to avoid bracket issues)
// ---------------------------------------------------------------------------

import { PUT } from "@/app/api/requests/[id]/route";

// ---------------------------------------------------------------------------
// Tests — Bug 3: bulk approve rate limit
// ---------------------------------------------------------------------------

describe("PUT /api/requests/[id] — bulk approve rate limit checks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFromMap.clear();
    mockRpc.mockResolvedValue({ data: null, error: null });
  });

  it("returns 400 when user rate limit is fully exceeded", async () => {
    const teleUser = createTeleUser({
      id: "tele-user-1",
      rate_limit_hourly: 5,
      rate_limit_daily: 20,
      rate_limit_total: 50,
      proxies_used_hourly: 5, // at hourly limit
      proxies_used_daily: 10,
      proxies_used_total: 30,
      max_proxies: 100,
    });

    const request = createProxyRequest({
      id: "req-1",
      tele_user_id: "tele-user-1",
      proxy_type: "http",
      quantity: 3,
      status: "pending",
    });

    // Current request lookup
    const requestsMock = createChainableMock({ data: request, error: null });
    mockFromMap.set("proxy_requests", requestsMock);

    // Tele user lookup for rate limit check
    const usersMock = createChainableMock({ data: teleUser, error: null });
    mockFromMap.set("tele_users", usersMock);

    const req = createPutRequest({ status: "approved", auto_assign: true });
    const response = await PUT(req, {
      params: Promise.resolve({ id: "req-1" }),
    });
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain("rate limit");
  });

  it("succeeds when user has remaining capacity for bulk", async () => {
    const teleUser = createTeleUser({
      id: "tele-user-2",
      telegram_id: 888,
      rate_limit_hourly: 10,
      rate_limit_daily: 50,
      rate_limit_total: 200,
      proxies_used_hourly: 0,
      proxies_used_daily: 0,
      proxies_used_total: 0,
      max_proxies: 100,
      language: "en",
    });

    const request = createProxyRequest({
      id: "req-2",
      tele_user_id: "tele-user-2",
      proxy_type: "http",
      quantity: 3,
      status: "pending",
    });

    // Current request lookup
    const requestsMock = createChainableMock({ data: request, error: null });
    mockFromMap.set("proxy_requests", requestsMock);

    // Tele user lookups (rate limit + notification)
    const usersMock = createChainableMock({ data: teleUser, error: null });
    mockFromMap.set("tele_users", usersMock);

    // chat_messages insert
    const chatMock = createChainableMock({ data: null, error: null });
    mockFromMap.set("chat_messages", chatMock);

    // bulk_assign_proxies RPC success
    mockRpc.mockResolvedValueOnce({
      data: {
        success: true,
        assigned: 3,
        proxies: [
          { host: "1.1.1.1", port: 8080, username: "u1", password: "p1" },
          { host: "1.1.1.2", port: 8080, username: "u2", password: "p2" },
          { host: "1.1.1.3", port: 8080, username: "u3", password: "p3" },
        ],
        batch_id: "batch-abc",
      },
      error: null,
    });

    const req = createPutRequest({ status: "approved", auto_assign: true });
    const response = await PUT(req, {
      params: Promise.resolve({ id: "req-2" }),
    });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.message).toContain("Bulk approved");
    expect(mockRpc).toHaveBeenCalledWith(
      "bulk_assign_proxies",
      expect.objectContaining({
        p_user_id: "tele-user-2",
        p_type: "http",
        p_quantity: 3,
        p_admin_id: "admin-1",
      })
    );
  });

  it("returns 400 with 'can only receive X more' when quantity exceeds remaining", async () => {
    const teleUser = createTeleUser({
      id: "tele-user-3",
      rate_limit_hourly: 10,
      rate_limit_daily: 50,
      rate_limit_total: 200,
      proxies_used_hourly: 8, // only 2 remaining hourly
      proxies_used_daily: 5,
      proxies_used_total: 10,
      max_proxies: 100,
    });

    const request = createProxyRequest({
      id: "req-3",
      tele_user_id: "tele-user-3",
      proxy_type: "socks5",
      quantity: 5, // wants 5 but only 2 remaining
      status: "pending",
    });

    const requestsMock = createChainableMock({ data: request, error: null });
    mockFromMap.set("proxy_requests", requestsMock);

    const usersMock = createChainableMock({ data: teleUser, error: null });
    mockFromMap.set("tele_users", usersMock);

    const req = createPutRequest({ status: "approved", auto_assign: true });
    const response = await PUT(req, {
      params: Promise.resolve({ id: "req-3" }),
    });
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain("can only receive 2 more");
  });

  it("single approve uses safe_assign_proxy RPC", async () => {
    const teleUser = createTeleUser({
      id: "tele-user-4",
      telegram_id: 999,
      rate_limit_hourly: 10,
      rate_limit_daily: 50,
      rate_limit_total: 200,
      proxies_used_hourly: 0,
      proxies_used_daily: 0,
      proxies_used_total: 0,
      max_proxies: 100,
      language: "en",
    });

    const request = createProxyRequest({
      id: "req-4",
      tele_user_id: "tele-user-4",
      proxy_type: "http",
      quantity: 1, // single
      status: "pending",
    });

    // Current request lookup
    const requestsMock = createChainableMock({ data: request, error: null });
    mockFromMap.set("proxy_requests", requestsMock);

    // Tele user lookups
    const usersMock = createChainableMock({ data: teleUser, error: null });
    mockFromMap.set("tele_users", usersMock);

    // chat_messages
    const chatMock = createChainableMock({ data: null, error: null });
    mockFromMap.set("chat_messages", chatMock);

    // safe_assign_proxy RPC result
    mockRpc.mockResolvedValueOnce({
      data: {
        success: true,
        tele_user_id: "tele-user-4",
        proxy: {
          host: "2.2.2.2",
          port: 3128,
          type: "http",
          username: "u1",
          password: "p1",
        },
      },
      error: null,
    });

    const req = createPutRequest({
      status: "approved",
      proxy_id: "67a1fa17-2d82-4add-9344-1593ce207686",
    });
    const response = await PUT(req, {
      params: Promise.resolve({ id: "req-4" }),
    });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith(
      "safe_assign_proxy",
      expect.objectContaining({
        p_request_id: "req-4",
        p_proxy_id: "67a1fa17-2d82-4add-9344-1593ce207686",
        p_admin_id: "admin-1",
      })
    );
  });
});
