import { describe, it, expect, vi, beforeEach } from "vitest";
import { createChainableMock } from "@test/mocks/supabase";
import { createMockTelegramContext } from "@test/mocks/telegram-context";
import { createTeleUser } from "@test/factories/user.factory";

// ---------------------------------------------------------------------------
// Mock setup (before imports)
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

const mockNotifyAllAdmins = vi.fn().mockResolvedValue(undefined);
vi.mock("../../notify-admins", () => ({
  notifyAllAdmins: (...args: any[]) => mockNotifyAllAdmins(...args),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("handleStart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFromMap.clear();
  });

  it("sends welcome message with commands for a returning user", async () => {
    const user = createTeleUser({
      telegram_id: 123456,
      username: "testuser",
      first_name: "Test",
      status: "active",
      language: "en",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z", // different from created_at = returning user
    });

    // tele_users.select().eq().single() returns existing user
    const usersMock = createChainableMock({ data: user, error: null });
    mockFromMap.set("tele_users", usersMock);

    // proxies.select().eq().eq() returns count
    const proxiesMock = createChainableMock({ data: null, error: null, count: 2 });
    mockFromMap.set("proxies", proxiesMock);

    // settings mock for getOrCreateUser
    const settingsMock = createChainableMock({ data: [], error: null });
    mockFromMap.set("settings", settingsMock);

    // chat_messages insert
    const chatMock = createChainableMock({ data: null, error: null });
    mockFromMap.set("chat_messages", chatMock);

    const ctx = createMockTelegramContext({ userId: 123456, text: "/start" });
    const { handleStart } = await import("../../commands/start");
    await handleStart(ctx);

    // Wave 23B-bot redesign — welcome card no longer dumps the
    // slash command list into the body. Commands surface via the
    // inline mainMenuKeyboard (sent as second reply) and the native
    // bot menu (left of file-attach). The body keeps Title + greeting
    // + proxy fraction only.
    expect(ctx.reply).toHaveBeenCalled();
    const firstReply = ctx._replies[0];
    expect(firstReply).toContain("Proxy Manager Bot");
    expect(firstReply).toContain("Welcome back");
    expect(firstReply).not.toContain("/getproxy");

    // Second reply carries the inline menu prompt.
    const secondReply = ctx._replies[1];
    expect(secondReply).toMatch(/Pick an action|Chon chuc nang/i);
  });

  it("sends registration greeting for a new user", async () => {
    const user = createTeleUser({
      telegram_id: 123456,
      username: "newguy",
      first_name: "New",
      status: "active",
      language: "en",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z", // same as created_at = new user
    });

    const usersMock = createChainableMock({ data: user, error: null });
    mockFromMap.set("tele_users", usersMock);

    const proxiesMock = createChainableMock({ data: null, error: null, count: 0 });
    mockFromMap.set("proxies", proxiesMock);

    const settingsMock = createChainableMock({ data: [], error: null });
    mockFromMap.set("settings", settingsMock);

    const chatMock = createChainableMock({ data: null, error: null });
    mockFromMap.set("chat_messages", chatMock);

    const ctx = createMockTelegramContext({ userId: 123456, text: "/start" });
    const { handleStart } = await import("../../commands/start");
    await handleStart(ctx);

    expect(ctx.reply).toHaveBeenCalled();
    const replyText = ctx._replies[0];
    expect(replyText).toContain("registered successfully");
  });

  it("does NOT notify admins on /start before AUP acceptance (Wave 18B gate)", async () => {
    // Wave 18B moved admin notification out of handleStart and into the AUP
    // accept callback, so admins are not asked to approve users who haven't
    // accepted the terms (and may later decline).
    const user = createTeleUser({
      telegram_id: 789,
      username: "fresh",
      first_name: "Fresh",
      status: "pending",
      language: "en",
      aup_accepted_at: null, // not accepted yet -> AUP prompt, no admin notify
      aup_version: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    });

    const usersMock = createChainableMock({ data: user, error: null });
    mockFromMap.set("tele_users", usersMock);
    const proxiesMock = createChainableMock({ data: null, error: null, count: 0 });
    mockFromMap.set("proxies", proxiesMock);
    const settingsMock = createChainableMock({ data: [], error: null });
    mockFromMap.set("settings", settingsMock);
    const chatMock = createChainableMock({ data: null, error: null });
    mockFromMap.set("chat_messages", chatMock);

    const ctx = createMockTelegramContext({ userId: 789, username: "fresh", text: "/start" });
    const { handleStart } = await import("../../commands/start");
    await handleStart(ctx);

    // Reply should be the AUP prompt, not the pending-registration message.
    expect(ctx.reply).toHaveBeenCalled();
    const replyText = ctx._replies[0];
    expect(replyText).toMatch(/terms of use|proxy service/i);

    // Admins are NOT notified yet — they only hear about the user after
    // AUP acceptance (that is exercised by handleAupAcceptCallback tests).
    expect(mockNotifyAllAdmins).not.toHaveBeenCalled();
  });

  it("does not notify admins for returning users", async () => {
    const user = createTeleUser({
      telegram_id: 123456,
      status: "active",
      language: "en",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-05T00:00:00Z", // returning user
    });

    const usersMock = createChainableMock({ data: user, error: null });
    mockFromMap.set("tele_users", usersMock);

    const proxiesMock = createChainableMock({ data: null, error: null, count: 1 });
    mockFromMap.set("proxies", proxiesMock);

    const settingsMock = createChainableMock({ data: [], error: null });
    mockFromMap.set("settings", settingsMock);

    const chatMock = createChainableMock({ data: null, error: null });
    mockFromMap.set("chat_messages", chatMock);

    const ctx = createMockTelegramContext({ userId: 123456, text: "/start" });
    const { handleStart } = await import("../../commands/start");
    await handleStart(ctx);

    expect(mockNotifyAllAdmins).not.toHaveBeenCalled();
  });

  it("shows blocked status correctly for blocked user", async () => {
    const user = createTeleUser({
      telegram_id: 123456,
      status: "blocked",
      language: "en",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-05T00:00:00Z",
    });

    const usersMock = createChainableMock({ data: user, error: null });
    mockFromMap.set("tele_users", usersMock);

    const proxiesMock = createChainableMock({ data: null, error: null, count: 0 });
    mockFromMap.set("proxies", proxiesMock);

    const settingsMock = createChainableMock({ data: [], error: null });
    mockFromMap.set("settings", settingsMock);

    const chatMock = createChainableMock({ data: null, error: null });
    mockFromMap.set("chat_messages", chatMock);

    const ctx = createMockTelegramContext({ userId: 123456, text: "/start" });
    const { handleStart } = await import("../../commands/start");
    await handleStart(ctx);

    // Wave 23B-bot — blocked users now get a dedicated "account
    // blocked" card instead of the active-user welcome + menu.
    // No mainMenuKeyboard reply.
    expect(ctx.reply).toHaveBeenCalled();
    const replyText = ctx._replies[0];
    expect(replyText).toMatch(/blocked/i);
    expect(replyText).toMatch(/support/i);
    // Only one reply — no menu shown to blocked users.
    expect(ctx._replies).toHaveLength(1);
  });

  it("redesign: active user receives mainMenuKeyboard on second reply", async () => {
    const user = createTeleUser({
      telegram_id: 123456,
      status: "active",
      language: "vi",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-05T00:00:00Z",
    });

    const usersMock = createChainableMock({ data: user, error: null });
    mockFromMap.set("tele_users", usersMock);
    const proxiesMock = createChainableMock({ data: null, error: null, count: 1 });
    mockFromMap.set("proxies", proxiesMock);
    const settingsMock = createChainableMock({ data: [], error: null });
    mockFromMap.set("settings", settingsMock);
    const chatMock = createChainableMock({ data: null, error: null });
    mockFromMap.set("chat_messages", chatMock);

    const ctx = createMockTelegramContext({ userId: 123456, text: "/start" });
    const { handleStart } = await import("../../commands/start");
    await handleStart(ctx);

    // First reply: text + remove_keyboard (drop legacy reply keyboard)
    // Second reply: short prompt + inline mainMenuKeyboard
    expect(ctx._replies).toHaveLength(2);
    expect(ctx._replies[1]).toMatch(/Chon chuc nang/i);
  });
});
