import { describe, it, expect, vi, beforeEach } from "vitest";
import { createChainableMock } from "@test/mocks/supabase";
import { createMockTelegramContext } from "@test/mocks/telegram-context";
import { createTeleUser } from "@test/factories/user.factory";

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

vi.mock("@/lib/proxy-checker", () => ({
  checkProxy: vi.fn().mockResolvedValue({ alive: true, speed_ms: 50 }),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("handleGetProxy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFromMap.clear();
  });

  it("rejects blocked users", async () => {
    const user = createTeleUser({
      telegram_id: 123456,
      status: "blocked",
      language: "en",
    });

    const usersMock = createChainableMock({ data: user, error: null });
    mockFromMap.set("tele_users", usersMock);

    const settingsMock = createChainableMock({ data: [], error: null });
    mockFromMap.set("settings", settingsMock);

    const chatMock = createChainableMock({ data: null, error: null });
    mockFromMap.set("chat_messages", chatMock);

    const ctx = createMockTelegramContext({ userId: 123456, text: "/getproxy" });
    const { handleGetProxy } = await import("../../commands/get-proxy");
    await handleGetProxy(ctx);

    expect(ctx.reply).toHaveBeenCalled();
    const replyText = ctx._replies[0];
    expect(replyText).toContain("blocked");
  });

  it("rejects banned users", async () => {
    const user = createTeleUser({
      telegram_id: 123456,
      status: "banned",
      language: "en",
    });

    const usersMock = createChainableMock({ data: user, error: null });
    mockFromMap.set("tele_users", usersMock);

    const settingsMock = createChainableMock({ data: [], error: null });
    mockFromMap.set("settings", settingsMock);

    const chatMock = createChainableMock({ data: null, error: null });
    mockFromMap.set("chat_messages", chatMock);

    const ctx = createMockTelegramContext({ userId: 123456, text: "/getproxy" });
    const { handleGetProxy } = await import("../../commands/get-proxy");
    await handleGetProxy(ctx);

    expect(ctx.reply).toHaveBeenCalled();
    const replyText = ctx._replies[0];
    expect(replyText).toContain("blocked");
  });

  it("rejects when rate limit is exceeded", async () => {
    const user = createTeleUser({
      telegram_id: 123456,
      status: "active",
      language: "en",
      rate_limit_hourly: 3,
      proxies_used_hourly: 3, // at limit
      hourly_reset_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // not expired
    });

    const usersMock = createChainableMock({ data: user, error: null });
    mockFromMap.set("tele_users", usersMock);

    // settings for global caps (no global override)
    const settingsMock = createChainableMock({ data: [], error: null });
    mockFromMap.set("settings", settingsMock);

    const chatMock = createChainableMock({ data: null, error: null });
    mockFromMap.set("chat_messages", chatMock);

    const ctx = createMockTelegramContext({ userId: 123456, text: "/getproxy" });
    const { handleGetProxy } = await import("../../commands/get-proxy");
    await handleGetProxy(ctx);

    expect(ctx.reply).toHaveBeenCalled();
    const replyText = ctx._replies[0];
    expect(replyText).toContain("exceeded");
  });

  it("shows proxy type keyboard for active user with available rate limit", async () => {
    const user = createTeleUser({
      telegram_id: 123456,
      status: "active",
      language: "en",
      rate_limit_hourly: 10,
      rate_limit_daily: 50,
      rate_limit_total: 200,
      proxies_used_hourly: 0,
      proxies_used_daily: 0,
      proxies_used_total: 0,
      hourly_reset_at: null,
      daily_reset_at: null,
    });

    const usersMock = createChainableMock({ data: user, error: null });
    mockFromMap.set("tele_users", usersMock);

    const settingsMock = createChainableMock({ data: [], error: null });
    mockFromMap.set("settings", settingsMock);

    const chatMock = createChainableMock({ data: null, error: null });
    mockFromMap.set("chat_messages", chatMock);

    const ctx = createMockTelegramContext({ userId: 123456, text: "/getproxy" });
    const { handleGetProxy } = await import("../../commands/get-proxy");
    await handleGetProxy(ctx);

    expect(ctx.reply).toHaveBeenCalled();
    const replyText = ctx._replies[0];
    // Wave 23B-bot UX — short header "Request Proxy" + "Pick a proxy type:".
    expect(replyText).toContain("Request Proxy");
    expect(replyText).toMatch(/Pick a proxy type/i);

    // Should have an inline keyboard for proxy type selection
    const callArgs = (ctx.reply as any).mock.calls[0];
    expect(callArgs[1]).toBeDefined();
    expect(callArgs[1].reply_markup).toBeDefined();
  });
});

describe("handleProxyTypeSelection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFromMap.clear();
  });

  it("shows max proxies reached message when at limit", async () => {
    const user = createTeleUser({
      telegram_id: 123456,
      status: "active",
      language: "en",
      max_proxies: 5,
      rate_limit_hourly: 10,
      rate_limit_daily: 50,
      rate_limit_total: 200,
      proxies_used_hourly: 0,
      proxies_used_daily: 0,
      proxies_used_total: 0,
      hourly_reset_at: null,
      daily_reset_at: null,
    });

    // user lookup
    const usersMock = createChainableMock({ data: user, error: null });
    mockFromMap.set("tele_users", usersMock);

    // settings for global caps
    const settingsMock = createChainableMock({ data: [], error: null });
    mockFromMap.set("settings", settingsMock);

    // proxy count: user already at max
    const proxiesMock = createChainableMock({ data: null, error: null, count: 5 });
    mockFromMap.set("proxies", proxiesMock);

    const chatMock = createChainableMock({ data: null, error: null });
    mockFromMap.set("chat_messages", chatMock);

    const ctx = createMockTelegramContext({
      userId: 123456,
      callbackData: "proxy_type:http",
    });

    const { handleProxyTypeSelection } = await import("../../commands/get-proxy");
    await handleProxyTypeSelection(ctx, "http");

    // Wave 23B-bot UX — new message instead of edit.
    expect(ctx.reply).toHaveBeenCalled();
    const replyText = ctx._replies[0];
    expect(replyText).toContain("maximum proxy limit");
  });

  it("shows quantity keyboard when user has capacity", async () => {
    const user = createTeleUser({
      telegram_id: 123456,
      status: "active",
      language: "en",
      max_proxies: 5,
      rate_limit_hourly: 10,
      rate_limit_daily: 50,
      rate_limit_total: 200,
      proxies_used_hourly: 0,
      proxies_used_daily: 0,
      proxies_used_total: 0,
      hourly_reset_at: null,
      daily_reset_at: null,
    });

    const usersMock = createChainableMock({ data: user, error: null });
    mockFromMap.set("tele_users", usersMock);

    const settingsMock = createChainableMock({ data: [], error: null });
    mockFromMap.set("settings", settingsMock);

    // only 2 assigned, max is 5
    const proxiesMock = createChainableMock({ data: null, error: null, count: 2 });
    mockFromMap.set("proxies", proxiesMock);

    const chatMock = createChainableMock({ data: null, error: null });
    mockFromMap.set("chat_messages", chatMock);

    const ctx = createMockTelegramContext({
      userId: 123456,
      callbackData: "proxy_type:socks5",
    });

    const { handleProxyTypeSelection } = await import("../../commands/get-proxy");
    await handleProxyTypeSelection(ctx, "socks5");

    // Wave 23B-bot UX (per VIA pattern) — type selection now shows
    // the Order nhanh / Order riêng chooser, not the quantity
    // keyboard directly. Quantity comes after a mode is picked.
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalled();
    const replyText = ctx._replies[0];
    expect(replyText).toMatch(/Choose order type|Chọn loại đặt hàng/i);

    // Should have reply_markup for orderTypeKeyboard
    const callArgs = (ctx.reply as any).mock.calls[0];
    expect(callArgs[1]).toBeDefined();
    expect(callArgs[1].reply_markup).toBeDefined();
  });
});
