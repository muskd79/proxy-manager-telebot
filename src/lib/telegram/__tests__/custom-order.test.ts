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
const mockSetBotState = vi.fn().mockResolvedValue(undefined);
vi.mock("../state", () => ({
  clearBotState: (...args: unknown[]) => mockClearBotState(...args),
  setBotState: (...args: unknown[]) => mockSetBotState(...args),
  getBotState: vi.fn().mockResolvedValue({ step: "idle" }),
}));

const mockHandleQuantitySelection = vi.fn().mockResolvedValue(undefined);
vi.mock("../commands/bulk-proxy", () => ({
  handleQuantitySelection: (...args: unknown[]) => mockHandleQuantitySelection(...args),
}));

// Wave 25-pre4 (Pass 7.2) — handleQtyTextInput now calls loadGlobalCaps
// to read quick_order_max / custom_order_max from settings. Mock it
// to return the historical defaults so existing assertions still hold.
vi.mock("../rate-limit", () => ({
  loadGlobalCaps: vi.fn().mockResolvedValue({
    quick_order_max: 10,
    custom_order_max: 100,
    bulk_auto_threshold: 5,
  }),
  ORDER_MODE_DEFAULTS: {
    quick_order_max: 10,
    custom_order_max: 100,
    bulk_auto_threshold: 5,
  },
}));

import { handleQtyTextInput, handleConfirmCallback } from "../commands/custom-order";
import * as stateModule from "../state";

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
    // Wave 23E — message ported from VIA validate.number key.
    expect(replies[0]).toMatch(/Vui lòng nhập một|Please enter a number/i);
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
    const { ctx, replies } = mkCtx();
    const consumed = await handleQtyTextInput(
      ctx as never,
      "awaiting_quick_qty",
      "http",
      "3",
    );
    expect(consumed).toBe(true);
    // Wave 24-1 — qty no longer auto-places; sets state to
    // awaiting_confirm and asks "Xác nhận?" with summary.
    expect(mockSetBotState).toHaveBeenCalledWith("u1", expect.objectContaining({
      step: "awaiting_confirm",
      proxyType: "http",
      quantity: 3,
      mode: "quick",
    }));
    expect(replies[0]).toMatch(/Xác nhận|Confirm/i);
    expect(replies[0]).toContain("3");
    expect(mockHandleQuantitySelection).not.toHaveBeenCalled();
  });

  it("custom mode allows up to 100 (waits for confirm)", async () => {
    const { ctx, replies } = mkCtx();
    await handleQtyTextInput(ctx as never, "awaiting_custom_qty", "https", "73");
    expect(mockSetBotState).toHaveBeenCalledWith("u1", expect.objectContaining({
      step: "awaiting_confirm",
      proxyType: "https",
      quantity: 73,
      mode: "custom",
    }));
    expect(replies[0]).toContain("73");
    expect(mockHandleQuantitySelection).not.toHaveBeenCalled();
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

// ---- Wave 24-1 confirm callback ------------------------------------------

describe("handleConfirmCallback (Wave 24-1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserSelect.mockResolvedValue({ data: { id: "u1", language: "vi" }, error: null });
  });

  it("Yes → places order via handleQuantitySelection then clears state", async () => {
    vi.spyOn(stateModule, "getBotState").mockResolvedValueOnce({
      step: "awaiting_confirm",
      proxyType: "http",
      quantity: 3,
      mode: "quick",
    });
    const replies: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx: any = {
      from: { id: 999 },
      reply: vi.fn(async (t: string) => { replies.push(t); }),
      answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    };
    await handleConfirmCallback(ctx, true);
    expect(mockClearBotState).toHaveBeenCalled();
    expect(mockHandleQuantitySelection).toHaveBeenCalledWith(ctx, "http", 3, "quick");
  });

  it("No → cancels with reply, never places order", async () => {
    vi.spyOn(stateModule, "getBotState").mockResolvedValueOnce({
      step: "awaiting_confirm",
      proxyType: "http",
      quantity: 3,
      mode: "quick",
    });
    const replies: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx: any = {
      from: { id: 999 },
      reply: vi.fn(async (t: string) => { replies.push(t); }),
      answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    };
    await handleConfirmCallback(ctx, false);
    expect(mockClearBotState).toHaveBeenCalled();
    expect(mockHandleQuantitySelection).not.toHaveBeenCalled();
    expect(replies[0]).toMatch(/Đã hủy|cancelled/i);
  });

  it("State drift (idle) → expired message, never places", async () => {
    vi.spyOn(stateModule, "getBotState").mockResolvedValueOnce({ step: "idle" });
    const replies: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx: any = {
      from: { id: 999 },
      reply: vi.fn(async (t: string) => { replies.push(t); }),
      answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    };
    await handleConfirmCallback(ctx, true);
    expect(mockHandleQuantitySelection).not.toHaveBeenCalled();
    expect(replies[0]).toMatch(/hết hạn|expired/i);
  });
});
