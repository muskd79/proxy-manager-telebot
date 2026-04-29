import { describe, it, expect, vi, beforeEach } from "vitest";

const mockUserSelect = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: () => mockUserSelect(),
          maybeSingle: () => mockUserSelect(),
        })),
      })),
    })),
  },
}));

vi.mock("../logging", () => ({
  logChatMessage: vi.fn().mockResolvedValue(undefined),
}));

const mockClearBotState = vi.fn().mockResolvedValue(undefined);
vi.mock("../state", () => ({
  clearBotState: (...args: unknown[]) => mockClearBotState(...args),
}));

const mockHandleQuantitySelection = vi.fn().mockResolvedValue(undefined);
vi.mock("../commands/bulk-proxy", () => ({
  handleQuantitySelection: (...args: unknown[]) => mockHandleQuantitySelection(...args),
}));

import { handleQtyTextInput } from "../commands/custom-order";

function mkCtx() {
  const replies: string[] = [];
  return {
    replies,
    ctx: {
      from: { id: 999 },
      reply: vi.fn(async (text: string) => { replies.push(text); }),
    },
  };
}

describe("handleQtyTextInput (Wave 23B-bot, VIA-style text input)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserSelect.mockResolvedValue({ data: { id: "u1", language: "vi" }, error: null });
  });

  it("rejects non-numeric text with friendly error", async () => {
    const { ctx, replies } = mkCtx();
    const consumed = await handleQtyTextInput(
      ctx as never,
      "awaiting_quick_qty",
      "http",
      "abc",
    );
    expect(consumed).toBe(true);
    expect(replies[0]).toMatch(/không hợp lệ|invalid/i);
    expect(mockHandleQuantitySelection).not.toHaveBeenCalled();
  });

  it("rejects negative number", async () => {
    const { ctx } = mkCtx();
    await handleQtyTextInput(ctx as never, "awaiting_quick_qty", "http", "-3");
    expect(mockHandleQuantitySelection).not.toHaveBeenCalled();
  });

  it("rejects zero", async () => {
    const { ctx } = mkCtx();
    await handleQtyTextInput(ctx as never, "awaiting_quick_qty", "http", "0");
    expect(mockHandleQuantitySelection).not.toHaveBeenCalled();
  });

  it("regression: accepts arbitrary number 3 (user feedback case)", async () => {
    const { ctx } = mkCtx();
    const consumed = await handleQtyTextInput(
      ctx as never,
      "awaiting_quick_qty",
      "http",
      "3",
    );
    expect(consumed).toBe(true);
    expect(mockClearBotState).toHaveBeenCalledWith("u1");
    expect(mockHandleQuantitySelection).toHaveBeenCalledWith(
      ctx,
      "http",
      3,
      "quick",
    );
  });

  it("custom mode allows up to 100", async () => {
    const { ctx } = mkCtx();
    await handleQtyTextInput(ctx as never, "awaiting_custom_qty", "https", "73");
    expect(mockHandleQuantitySelection).toHaveBeenCalledWith(
      ctx,
      "https",
      73,
      "custom",
    );
  });

  it("custom mode rejects 101 with limit message", async () => {
    const { ctx, replies } = mkCtx();
    await handleQtyTextInput(ctx as never, "awaiting_custom_qty", "https", "101");
    expect(mockHandleQuantitySelection).not.toHaveBeenCalled();
    expect(replies[0]).toMatch(/100/);
  });

  it("quick mode rejects 11 with hint to use Order riêng", async () => {
    const { ctx, replies } = mkCtx();
    await handleQtyTextInput(ctx as never, "awaiting_quick_qty", "http", "11");
    expect(mockHandleQuantitySelection).not.toHaveBeenCalled();
    expect(replies[0]).toMatch(/Order riêng|Custom order/i);
  });

  it("returns false for non-qty steps (caller continues default flow)", async () => {
    const { ctx } = mkCtx();
    const consumed = await handleQtyTextInput(
      ctx as never,
      "idle" as never,
      "http",
      "5",
    );
    expect(consumed).toBe(false);
  });

  it("missing proxyType resets state and asks user to /start", async () => {
    const { ctx, replies } = mkCtx();
    const consumed = await handleQtyTextInput(
      ctx as never,
      "awaiting_quick_qty",
      undefined,
      "5",
    );
    expect(consumed).toBe(true);
    expect(mockClearBotState).toHaveBeenCalled();
    expect(replies[0]).toMatch(/hết hạn|expired/i);
  });
});
