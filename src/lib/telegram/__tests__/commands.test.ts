import { describe, it, expect, vi, beforeEach } from "vitest";

// Build a chainable query mock that supports arbitrary depth of .eq/.select/.order/.limit/.single
function createChainableMock(resolvedValue: any = { data: null, error: null }): any {
  const mock: any = vi.fn().mockImplementation(() => mock);
  // Terminal methods
  mock.single = vi.fn().mockResolvedValue(resolvedValue);
  mock.then = undefined; // not thenable by default
  // Chain methods that return the same mock
  mock.eq = vi.fn().mockReturnValue(mock);
  mock.in = vi.fn().mockReturnValue(mock);
  mock.neq = vi.fn().mockReturnValue(mock);
  mock.gte = vi.fn().mockReturnValue(mock);
  mock.lte = vi.fn().mockReturnValue(mock);
  mock.order = vi.fn().mockReturnValue(mock);
  mock.limit = vi.fn().mockResolvedValue({ data: [], error: null });
  mock.range = vi.fn().mockReturnValue(mock);
  mock.select = vi.fn().mockReturnValue(mock);
  // Make mock itself resolve like a promise for queries without .single()
  Object.assign(mock, { data: [], error: null });
  return mock;
}

// Mock supabaseAdmin
vi.mock("@/lib/supabase/admin", () => {
  const defaultUser = {
    id: "user-1",
    telegram_id: 123456,
    username: "testuser",
    first_name: "Test",
    language: "en",
    status: "active",
    approval_mode: "auto",
    max_proxies: 5,
    rate_limit_hourly: 10,
    rate_limit_daily: 50,
    rate_limit_total: 200,
    proxies_used_hourly: 0,
    proxies_used_daily: 0,
    proxies_used_total: 0,
    hourly_reset_at: null,
    daily_reset_at: null,
  };

  const chainable = createChainableMock({ data: defaultUser, error: null });

  return {
    supabaseAdmin: {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue(chainable),
        insert: vi.fn().mockResolvedValue({ data: null, error: null }),
        update: vi.fn().mockReturnValue(chainable),
        upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
        // Wave 23D — clearBotState in /cancel needs .delete().eq()
        delete: vi.fn().mockReturnValue(chainable),
      }),
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    },
  };
});

// Mock proxy-checker
vi.mock("@/lib/proxy-checker", () => ({
  checkProxy: vi.fn().mockResolvedValue({ alive: true, speed_ms: 50 }),
}));

// Mock logger
vi.mock("@/lib/logger", () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));

function createMockContext(
  text: string,
  from = {
    id: 123456,
    is_bot: false,
    first_name: "Test",
    username: "testuser",
  }
) {
  const replies: string[] = [];
  return {
    ctx: {
      from,
      message: {
        message_id: 1,
        text,
        chat: { id: from.id, type: "private" },
      },
      reply: vi.fn().mockImplementation((text: string) => {
        replies.push(text);
        return Promise.resolve();
      }),
      callbackQuery: { data: "" },
      answerCallbackQuery: vi.fn(),
      editMessageText: vi.fn(),
    },
    replies,
  };
}

describe("Bot Commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("handleHelp", () => {
    it("should reply with help text", async () => {
      const { handleHelp } = await import("../../telegram/commands/help");
      const { ctx, replies } = createMockContext("/help");
      await handleHelp(ctx as any);
      expect(ctx.reply).toHaveBeenCalled();
      expect(replies[0]).toContain("/getproxy");
      expect(replies[0]).toContain("/myproxies");
    });
  });

  describe("handleCancel", () => {
    it("should reply when no pending requests", async () => {
      const { handleCancel } = await import("../../telegram/commands/cancel");
      const { ctx, replies } = createMockContext("/cancel");
      await handleCancel(ctx as any);
      expect(ctx.reply).toHaveBeenCalled();
    });
  });

  describe("handleSupport", () => {
    it("should reply with support info", async () => {
      const { handleSupport } = await import(
        "../../telegram/commands/support"
      );
      const { ctx, replies } = createMockContext("/support");
      await handleSupport(ctx as any);
      expect(ctx.reply).toHaveBeenCalled();
      expect(replies[0]).toContain("admin");
    });
  });

  describe("handleHistory", () => {
    it("should reply with no history message", async () => {
      const { handleHistory } = await import(
        "../../telegram/commands/history"
      );
      const { ctx } = createMockContext("/history");
      await handleHistory(ctx as any);
      expect(ctx.reply).toHaveBeenCalled();
    });
  });

  describe("command handler existence", () => {
    it("should export all required handlers", async () => {
      const commands = await import("../../telegram/commands");
      expect(commands.handleStart).toBeDefined();
      expect(commands.handleHelp).toBeDefined();
      expect(commands.handleGetProxy).toBeDefined();
      expect(commands.handleMyProxies).toBeDefined();
      expect(commands.handleStatus).toBeDefined();
      expect(commands.handleLanguage).toBeDefined();
      expect(commands.handleCancel).toBeDefined();
      expect(commands.handleRevoke).toBeDefined();
      expect(commands.handleCheckProxy).toBeDefined();
      expect(commands.handleHistory).toBeDefined();
      expect(commands.handleSupport).toBeDefined();
    });

    it("should export all callback handlers", async () => {
      const commands = await import("../../telegram/commands");
      expect(commands.handleProxyTypeSelection).toBeDefined();
      expect(commands.handleLanguageSelection).toBeDefined();
      expect(commands.handleRevokeSelection).toBeDefined();
      expect(commands.handleUnknownCommand).toBeDefined();
    });
  });
});
