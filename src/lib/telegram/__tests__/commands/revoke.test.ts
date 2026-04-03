import { describe, it, expect, vi, beforeEach } from "vitest";
import { createChainableMock } from "@test/mocks/supabase";
import { createMockTelegramContext } from "@test/mocks/telegram-context";
import { createTeleUser } from "@test/factories/user.factory";
import { createProxy } from "@test/factories/proxy.factory";

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

const mockFromMap = new Map<string, any>();

function mockFrom(table: string) {
  if (!mockFromMap.has(table)) {
    mockFromMap.set(table, createChainableMock());
  }
  return mockFromMap.get(table)!;
}

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => mockFrom(table)),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  },
}));

vi.mock("@/lib/logger", () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("handleRevoke", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFromMap.clear();
  });

  it("shows 'no proxies' message when user has no assigned proxies", async () => {
    const user = createTeleUser({
      telegram_id: 123456,
      status: "active",
      language: "en",
    });

    // getOrCreateUser: tele_users.select().eq().single()
    const usersMock = createChainableMock({ data: user, error: null });
    mockFromMap.set("tele_users", usersMock);

    // proxies: no assigned proxies
    const proxiesMock = createChainableMock({ data: [], error: null });
    mockFromMap.set("proxies", proxiesMock);

    const settingsMock = createChainableMock({ data: [], error: null });
    mockFromMap.set("settings", settingsMock);

    const chatMock = createChainableMock({ data: null, error: null });
    mockFromMap.set("chat_messages", chatMock);

    const ctx = createMockTelegramContext({ userId: 123456, text: "/revoke" });
    const { handleRevoke } = await import("../../commands/revoke");
    await handleRevoke(ctx);

    expect(ctx.reply).toHaveBeenCalled();
    const replyText = ctx._replies[0];
    expect(replyText).toContain("no assigned proxies");
  });

  it("auto-revokes when user has exactly one proxy", async () => {
    const user = createTeleUser({
      telegram_id: 123456,
      status: "active",
      language: "en",
    });

    const proxy = createProxy({
      id: "proxy-1",
      host: "10.0.0.1",
      port: 3128,
      type: "http",
      assigned_to: user.id,
      status: "assigned",
    });

    const usersMock = createChainableMock({ data: user, error: null });
    mockFromMap.set("tele_users", usersMock);

    // proxies.select returns a single proxy
    const proxiesMock = createChainableMock({ data: [proxy], error: null });
    mockFromMap.set("proxies", proxiesMock);

    const settingsMock = createChainableMock({ data: [], error: null });
    mockFromMap.set("settings", settingsMock);

    const chatMock = createChainableMock({ data: null, error: null });
    mockFromMap.set("chat_messages", chatMock);

    const activityMock = createChainableMock({ data: null, error: null });
    mockFromMap.set("activity_logs", activityMock);

    const ctx = createMockTelegramContext({ userId: 123456, text: "/revoke" });
    const { handleRevoke } = await import("../../commands/revoke");
    await handleRevoke(ctx);

    expect(ctx.reply).toHaveBeenCalled();
    const replyText = ctx._replies[0];
    expect(replyText).toContain("Successfully returned proxy");
    expect(replyText).toContain("10.0.0.1:3128");
  });

  it("shows selection keyboard when user has multiple proxies", async () => {
    const user = createTeleUser({
      telegram_id: 123456,
      status: "active",
      language: "en",
    });

    const proxy1 = createProxy({
      id: "p1",
      host: "10.0.0.1",
      port: 8080,
      type: "http",
      assigned_to: user.id,
      status: "assigned",
    });
    const proxy2 = createProxy({
      id: "p2",
      host: "10.0.0.2",
      port: 1080,
      type: "socks5",
      assigned_to: user.id,
      status: "assigned",
    });

    const usersMock = createChainableMock({ data: user, error: null });
    mockFromMap.set("tele_users", usersMock);

    const proxiesMock = createChainableMock({ data: [proxy1, proxy2], error: null });
    mockFromMap.set("proxies", proxiesMock);

    const settingsMock = createChainableMock({ data: [], error: null });
    mockFromMap.set("settings", settingsMock);

    const chatMock = createChainableMock({ data: null, error: null });
    mockFromMap.set("chat_messages", chatMock);

    const ctx = createMockTelegramContext({ userId: 123456, text: "/revoke" });
    const { handleRevoke } = await import("../../commands/revoke");
    await handleRevoke(ctx);

    expect(ctx.reply).toHaveBeenCalled();
    const replyText = ctx._replies[0];
    expect(replyText).toContain("Select proxy to return");

    // Should have inline keyboard with proxy options
    const callArgs = (ctx.reply as any).mock.calls[0];
    expect(callArgs[1]).toBeDefined();
    expect(callArgs[1].reply_markup).toBeDefined();
  });
});

describe("handleRevokeSelection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFromMap.clear();
  });

  it("revokes a specific proxy successfully", async () => {
    const user = createTeleUser({
      telegram_id: 123456,
      status: "active",
      language: "en",
    });

    const proxy = createProxy({
      id: "proxy-1",
      host: "10.0.0.1",
      port: 3128,
      assigned_to: user.id,
      status: "assigned",
    });

    // user lookup (for handleRevokeSelection, it does tele_users.select().eq().single())
    const usersMock = createChainableMock({ data: user, error: null });
    mockFromMap.set("tele_users", usersMock);

    // proxy lookup for specific proxy
    const proxiesMock = createChainableMock({ data: proxy, error: null });
    mockFromMap.set("proxies", proxiesMock);

    const chatMock = createChainableMock({ data: null, error: null });
    mockFromMap.set("chat_messages", chatMock);

    const activityMock = createChainableMock({ data: null, error: null });
    mockFromMap.set("activity_logs", activityMock);

    const ctx = createMockTelegramContext({
      userId: 123456,
      callbackData: "revoke:proxy-1",
    });

    const { handleRevokeSelection } = await import("../../commands/revoke");
    await handleRevokeSelection(ctx, "proxy-1");

    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    expect(ctx.editMessageText).toHaveBeenCalled();
    const editText = ctx._edits[0];
    expect(editText).toContain("Successfully returned proxy");
    expect(editText).toContain("10.0.0.1:3128");
  });

  it("answers callback with error when proxy is invalid", async () => {
    const user = createTeleUser({
      telegram_id: 123456,
      status: "active",
      language: "en",
    });

    const usersMock = createChainableMock({ data: user, error: null });
    mockFromMap.set("tele_users", usersMock);

    // proxy not found
    const proxiesMock = createChainableMock({ data: null, error: { message: "not found" } });
    mockFromMap.set("proxies", proxiesMock);

    const chatMock = createChainableMock({ data: null, error: null });
    mockFromMap.set("chat_messages", chatMock);

    const ctx = createMockTelegramContext({
      userId: 123456,
      callbackData: "revoke:nonexistent",
    });

    const { handleRevokeSelection } = await import("../../commands/revoke");
    await handleRevokeSelection(ctx, "nonexistent");

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
      expect.stringContaining("Invalid proxy")
    );
  });

  it("revokes all proxies when proxyId is 'all'", async () => {
    const user = createTeleUser({
      telegram_id: 123456,
      status: "active",
      language: "en",
    });

    const proxies = [
      createProxy({ id: "p1", host: "10.0.0.1", port: 8080, assigned_to: user.id, status: "assigned" }),
      createProxy({ id: "p2", host: "10.0.0.2", port: 1080, assigned_to: user.id, status: "assigned" }),
    ];

    const usersMock = createChainableMock({ data: user, error: null });
    mockFromMap.set("tele_users", usersMock);

    // proxies for revoke all
    const proxiesMock = createChainableMock({ data: proxies, error: null });
    mockFromMap.set("proxies", proxiesMock);

    const chatMock = createChainableMock({ data: null, error: null });
    mockFromMap.set("chat_messages", chatMock);

    const activityMock = createChainableMock({ data: null, error: null });
    mockFromMap.set("activity_logs", activityMock);

    const ctx = createMockTelegramContext({
      userId: 123456,
      callbackData: "revoke:all",
    });

    const { handleRevokeSelection } = await import("../../commands/revoke");
    await handleRevokeSelection(ctx, "all");

    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    expect(ctx.editMessageText).toHaveBeenCalled();
    const editText = ctx._edits[0];
    expect(editText).toContain("all 2 proxies");
  });
});
