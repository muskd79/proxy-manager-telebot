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

const mockSetState = vi.fn().mockResolvedValue(undefined);
const mockClearState = vi.fn().mockResolvedValue(undefined);
vi.mock("../state", () => ({
  setBotState: (...args: unknown[]) => mockSetState(...args),
  clearBotState: (...args: unknown[]) => mockClearState(...args),
  getBotState: vi.fn().mockResolvedValue({ step: "idle" }),
}));

const mockDetectProxy = vi.fn();
vi.mock("@/lib/proxy-detect", () => ({
  detectProxy: (...args: unknown[]) => mockDetectProxy(...args),
}));

import { handleCheckProxy, handleCheckListInput } from "../commands/check-proxy";

function mkCtx() {
  const replies: Array<{ text: string; opts?: unknown }> = [];
  return {
    replies,
    ctx: {
      from: { id: 999 },
      message: { message_id: 1 },
      reply: vi.fn(async (text: string, opts?: unknown) => {
        replies.push({ text, opts });
      }),
    },
  };
}

describe("handleCheckProxy (Wave 24-checkproxy redesign)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserSelect.mockResolvedValue({
      data: { id: "u1", language: "vi", status: "active" },
      error: null,
    });
  });

  it("regression: prompts paste-list and sets awaiting_check_list state", async () => {
    const { ctx, replies } = mkCtx();
    await handleCheckProxy(ctx as never);

    expect(mockSetState).toHaveBeenCalledWith("u1", expect.objectContaining({
      step: "awaiting_check_list",
    }));
    expect(replies[0].text).toMatch(/Kiểm tra proxy|Check proxies/i);
    expect(replies[0].text).toMatch(/host:port/);
    expect(replies[0].text).toMatch(/20/); // max-per-batch hint
  });
});

describe("handleCheckListInput (Wave 24-checkproxy)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserSelect.mockResolvedValue({
      data: { id: "u1", language: "vi" },
      error: null,
    });
  });

  it("rejects empty list with friendly error", async () => {
    const { ctx, replies } = mkCtx();
    const handled = await handleCheckListInput(ctx as never, "garbage no colon");
    expect(handled).toBe(true);
    expect(replies[0].text).toMatch(/Không tìm thấy proxy hợp lệ|No valid proxies/i);
    expect(mockDetectProxy).not.toHaveBeenCalled();
  });

  it("regression: rejects more than 20 proxies with limit message", async () => {
    const { ctx, replies } = mkCtx();
    const lines = Array.from({ length: 25 }, (_, i) => `1.2.3.${i}:8080`).join("\n");
    const handled = await handleCheckListInput(ctx as never, lines);
    expect(handled).toBe(true);
    expect(replies[0].text).toMatch(/Tối đa.*20|Maximum.*20/);
    expect(mockDetectProxy).not.toHaveBeenCalled();
  });

  it("probes 3 valid proxies and reports alive/dead/latency/type", async () => {
    mockDetectProxy
      .mockResolvedValueOnce({ alive: true, type: "http", speed_ms: 120, probes: {} })
      .mockResolvedValueOnce({ alive: false, type: null, speed_ms: 5000, probes: {} })
      .mockResolvedValueOnce({ alive: true, type: "socks5", speed_ms: 80, probes: {} });

    const { ctx, replies } = mkCtx();
    const handled = await handleCheckListInput(
      ctx as never,
      "1.1.1.1:80\n2.2.2.2:81\n3.3.3.3:1080",
    );
    expect(handled).toBe(true);
    expect(mockDetectProxy).toHaveBeenCalledTimes(3);

    // First reply: "Đang kiểm tra 3 proxy..."
    expect(replies[0].text).toMatch(/Đang kiểm tra/);
    expect(replies[0].text).toContain("3");

    // Second reply: result table
    const result = replies[1].text;
    expect(result).toMatch(/2\/3 sống/); // 2 alive of 3
    expect(result).toContain("1.1.1.1:80");
    expect(result).toContain("HTTP");
    expect(result).toContain("120ms");
    expect(result).toContain("2.2.2.2:81");
    expect(result).toMatch(/không phản hồi|unreachable/);
    expect(result).toContain("3.3.3.3:1080");
    expect(result).toContain("SOCKS5");
  });

  it("clearBotState before probe so user not stuck mid-flow", async () => {
    mockDetectProxy.mockResolvedValue({
      alive: true,
      type: "http",
      speed_ms: 100,
      probes: {},
    });
    const { ctx } = mkCtx();
    await handleCheckListInput(ctx as never, "1.1.1.1:80");
    expect(mockClearState).toHaveBeenCalledWith("u1");
  });

  it("counts invalid lines + still probes the valid ones", async () => {
    mockDetectProxy.mockResolvedValueOnce({
      alive: true,
      type: "http",
      speed_ms: 100,
      probes: {},
    });
    const { ctx, replies } = mkCtx();
    await handleCheckListInput(
      ctx as never,
      "garbage\n1.1.1.1:80\nno-port\n",
    );
    expect(mockDetectProxy).toHaveBeenCalledTimes(1);
    expect(replies[0].text).toMatch(/Đang kiểm tra/);
    // 2 garbage rows are reported as "(bỏ N dòng lỗi)"
    expect(replies[0].text).toMatch(/bỏ 2 dòng lỗi|skipped 2 bad lines/);
  });

  it("flags SSRF-blocked proxy distinctly from unreachable", async () => {
    mockDetectProxy.mockResolvedValueOnce({
      alive: false,
      type: null,
      speed_ms: 0,
      ssrf_blocked: true,
      ssrf_reason: "private",
      probes: {},
    });
    const { ctx, replies } = mkCtx();
    await handleCheckListInput(ctx as never, "127.0.0.1:8080");
    const result = replies[1].text;
    expect(result).toMatch(/IP bị chặn|blocked/);
  });
});
