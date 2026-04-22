import { describe, it, expect, vi, beforeEach } from "vitest";
import { createChainableMock } from "@test/mocks/supabase";
import { createMockTelegramContext } from "@test/mocks/telegram-context";
import { createTeleUser } from "@test/factories/user.factory";

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

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => mockFrom(table)),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

vi.mock("@/lib/telegram/send", () => ({
  sendTelegramMessage: vi.fn().mockResolvedValue({ success: true }),
  sendTelegramDocument: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("@/lib/logger", () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Tests — autoAssignProxy (Bug 2: atomic proxy assignment via RPC)
// ---------------------------------------------------------------------------

describe("autoAssignProxy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFromMap.clear();
    mockRpc.mockResolvedValue({ data: null, error: null });
  });

  it("returns rate limit error when read-only rate check disallows", async () => {
    // Fresh user fetched from DB — at hourly limit
    const freshUser = createTeleUser({
      id: "user-1",
      rate_limit_hourly: 3,
      proxies_used_hourly: 3, // at limit
      hourly_reset_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      rate_limit_daily: 10,
      proxies_used_daily: 0,
      rate_limit_total: 50,
      proxies_used_total: 0,
    });

    // loadGlobalCaps reads settings
    const settingsMock = createChainableMock({ data: [], error: null });
    mockFromMap.set("settings", settingsMock);

    // Fresh user fetch from tele_users
    const usersMock = createChainableMock({ data: freshUser, error: null });
    mockFromMap.set("tele_users", usersMock);

    // chat_messages for logging
    const chatMock = createChainableMock({ data: null, error: null });
    mockFromMap.set("chat_messages", chatMock);

    const { autoAssignProxy } = await import("../../commands/assign-proxy");
    const result = await autoAssignProxy(
      { id: "user-1" } as Record<string, unknown>,
      "http",
      "en"
    );

    expect(result.success).toBe(false);
    expect(result.text).toContain("exceeded");
    // Should NOT have called the RPC since rate limit check failed early
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("calls bulk_assign_proxies RPC with quantity=1 (atomic)", async () => {
    // Fresh user — under all limits
    const freshUser = createTeleUser({
      id: "user-2",
      rate_limit_hourly: 10,
      proxies_used_hourly: 0,
      rate_limit_daily: 50,
      proxies_used_daily: 0,
      rate_limit_total: 200,
      proxies_used_total: 0,
      hourly_reset_at: null,
      daily_reset_at: null,
    });

    const settingsMock = createChainableMock({ data: [], error: null });
    mockFromMap.set("settings", settingsMock);

    const usersMock = createChainableMock({ data: freshUser, error: null });
    mockFromMap.set("tele_users", usersMock);

    const chatMock = createChainableMock({ data: null, error: null });
    mockFromMap.set("chat_messages", chatMock);

    const logsMock = createChainableMock({ data: null, error: null });
    mockFromMap.set("activity_logs", logsMock);

    // RPC returns successful assignment
    mockRpc.mockResolvedValueOnce({
      data: {
        success: true,
        assigned: 1,
        requested: 1,
        proxies: [
          {
            id: "p1",
            host: "1.2.3.4",
            port: 8080,
            type: "http",
            username: "user",
            password: "pass",
          },
        ],
        batch_id: "batch-1",
      },
      error: null,
    });

    const { autoAssignProxy } = await import("../../commands/assign-proxy");
    const result = await autoAssignProxy(
      { id: "user-2" } as Record<string, unknown>,
      "http",
      "en"
    );

    expect(result.success).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith("bulk_assign_proxies", {
      p_user_id: "user-2",
      p_type: "http",
      p_quantity: 1,
      p_admin_id: null,
      p_batch_id: expect.any(String),
    });
  });

  it("returns no proxy error when RPC returns assigned=0", async () => {
    const freshUser = createTeleUser({
      id: "user-3",
      rate_limit_hourly: 10,
      proxies_used_hourly: 0,
      rate_limit_daily: 50,
      proxies_used_daily: 0,
      rate_limit_total: 200,
      proxies_used_total: 0,
      hourly_reset_at: null,
      daily_reset_at: null,
    });

    const settingsMock = createChainableMock({ data: [], error: null });
    mockFromMap.set("settings", settingsMock);

    const usersMock = createChainableMock({ data: freshUser, error: null });
    mockFromMap.set("tele_users", usersMock);

    const chatMock = createChainableMock({ data: null, error: null });
    mockFromMap.set("chat_messages", chatMock);

    // RPC returns no proxies assigned
    mockRpc.mockResolvedValueOnce({
      data: {
        success: false,
        assigned: 0,
        requested: 1,
        proxies: [],
        batch_id: null,
      },
      error: null,
    });

    const { autoAssignProxy } = await import("../../commands/assign-proxy");
    const result = await autoAssignProxy(
      { id: "user-3" } as Record<string, unknown>,
      "socks5",
      "en"
    );

    expect(result.success).toBe(false);
    expect(result.text).toContain("available");
  });

  it("returns proxy details with credentials on successful assignment", async () => {
    const freshUser = createTeleUser({
      id: "user-4",
      rate_limit_hourly: 10,
      proxies_used_hourly: 0,
      rate_limit_daily: 50,
      proxies_used_daily: 0,
      rate_limit_total: 200,
      proxies_used_total: 0,
      hourly_reset_at: null,
      daily_reset_at: null,
    });

    const settingsMock = createChainableMock({ data: [], error: null });
    mockFromMap.set("settings", settingsMock);

    const usersMock = createChainableMock({ data: freshUser, error: null });
    mockFromMap.set("tele_users", usersMock);

    const chatMock = createChainableMock({ data: null, error: null });
    mockFromMap.set("chat_messages", chatMock);

    const logsMock = createChainableMock({ data: null, error: null });
    mockFromMap.set("activity_logs", logsMock);

    mockRpc.mockResolvedValueOnce({
      data: {
        success: true,
        assigned: 1,
        requested: 1,
        proxies: [
          {
            id: "p2",
            host: "203.0.113.2",
            port: 1080,
            type: "socks5",
            username: "proxyuser",
            password: "proxypass",
          },
        ],
        batch_id: "batch-2",
      },
      error: null,
    });

    const { autoAssignProxy } = await import("../../commands/assign-proxy");
    const result = await autoAssignProxy(
      { id: "user-4" } as Record<string, unknown>,
      "socks5",
      "en"
    );

    expect(result.success).toBe(true);
    expect(result.text).toContain("203.0.113.2");
    expect(result.text).toContain("1080");
    expect(result.text).toContain("proxyuser");
    expect(result.text).toContain("proxypass");
    expect(result.parseMode).toBe("Markdown");
  });
});

// ---------------------------------------------------------------------------
// Tests — handleGetProxy (Bug 1: race condition fix)
// ---------------------------------------------------------------------------

describe("handleGetProxy — rate limit flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFromMap.clear();
    mockRpc.mockResolvedValue({ data: null, error: null });
  });

  it("shows error and does not proceed when rate limit exceeded", async () => {
    const user = createTeleUser({
      telegram_id: 500,
      status: "active",
      language: "en",
      rate_limit_hourly: 3,
      proxies_used_hourly: 3, // at limit
      hourly_reset_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      rate_limit_daily: 10,
      proxies_used_daily: 0,
      rate_limit_total: 50,
      proxies_used_total: 0,
    });

    const usersMock = createChainableMock({ data: user, error: null });
    mockFromMap.set("tele_users", usersMock);

    const settingsMock = createChainableMock({ data: [], error: null });
    mockFromMap.set("settings", settingsMock);

    const chatMock = createChainableMock({ data: null, error: null });
    mockFromMap.set("chat_messages", chatMock);

    const ctx = createMockTelegramContext({ userId: 500, text: "/getproxy" });

    const { handleGetProxy } = await import("../../commands/get-proxy");
    await handleGetProxy(ctx);

    expect(ctx.reply).toHaveBeenCalledTimes(1);
    expect(ctx._replies[0]).toContain("exceeded");

    // Should NOT have shown proxy type keyboard
    const callArgs = (ctx.reply as any).mock.calls[0];
    expect(callArgs[1]?.reply_markup).toBeUndefined();
  });

  it("shows proxy type keyboard when rate limit allows (no counter reset)", async () => {
    const user = createTeleUser({
      telegram_id: 501,
      status: "active",
      language: "en",
      rate_limit_hourly: 10,
      proxies_used_hourly: 2,
      rate_limit_daily: 50,
      proxies_used_daily: 5,
      rate_limit_total: 200,
      proxies_used_total: 10,
      hourly_reset_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      daily_reset_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });

    const usersMock = createChainableMock({ data: user, error: null });
    mockFromMap.set("tele_users", usersMock);

    const settingsMock = createChainableMock({ data: [], error: null });
    mockFromMap.set("settings", settingsMock);

    const chatMock = createChainableMock({ data: null, error: null });
    mockFromMap.set("chat_messages", chatMock);

    const ctx = createMockTelegramContext({ userId: 501, text: "/getproxy" });

    const { handleGetProxy } = await import("../../commands/get-proxy");
    await handleGetProxy(ctx);

    expect(ctx.reply).toHaveBeenCalledTimes(1);
    expect(ctx._replies[0]).toContain("Select the proxy type");

    // Should have inline keyboard
    const callArgs = (ctx.reply as any).mock.calls[0];
    expect(callArgs[1]?.reply_markup).toBeDefined();

    // The RPC should NOT have been called (read-only check only, no DB writes)
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests — handleProxyTypeSelection (Bug 1: shows quantity keyboard)
// ---------------------------------------------------------------------------

describe("handleProxyTypeSelection — quantity keyboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFromMap.clear();
    mockRpc.mockResolvedValue({ data: null, error: null });
  });

  it("shows quantity keyboard after type selection when under limits", async () => {
    const user = createTeleUser({
      telegram_id: 600,
      status: "active",
      language: "en",
      max_proxies: 10,
      rate_limit_hourly: 10,
      proxies_used_hourly: 0,
      rate_limit_daily: 50,
      proxies_used_daily: 0,
      rate_limit_total: 200,
      proxies_used_total: 0,
      hourly_reset_at: null,
      daily_reset_at: null,
    });

    const usersMock = createChainableMock({ data: user, error: null });
    mockFromMap.set("tele_users", usersMock);

    const settingsMock = createChainableMock({ data: [], error: null });
    mockFromMap.set("settings", settingsMock);

    // Only 1 proxy assigned, max is 10
    const proxiesMock = createChainableMock({
      data: null,
      error: null,
      count: 1,
    });
    mockFromMap.set("proxies", proxiesMock);

    const chatMock = createChainableMock({ data: null, error: null });
    mockFromMap.set("chat_messages", chatMock);

    const ctx = createMockTelegramContext({
      userId: 600,
      callbackData: "proxy_type:http",
    });

    const { handleProxyTypeSelection } = await import(
      "../../commands/get-proxy"
    );
    await handleProxyTypeSelection(ctx, "http");

    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    expect(ctx.editMessageText).toHaveBeenCalled();
    expect(ctx._edits[0]).toContain("How many proxies");

    // Quantity keyboard should be present
    const callArgs = (ctx.editMessageText as any).mock.calls[0];
    expect(callArgs[1]?.reply_markup).toBeDefined();
  });
});
