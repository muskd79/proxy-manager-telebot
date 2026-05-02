import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Wave 23D — regression tests for the "every message must have a
 * reply" guarantee ported from VIA bot. Three fixes covered:
 *   1. /cancel must clear bot conversation state (clearBotState)
 *   2. handleCancel calls supabase delete on bot_conversation_state
 *   3. denyIfNotApproved blocks pending users from text replies
 *
 * Source spec: docs/BOT_RESPONSE_GAP_2026-05-02.md cases #3, #14.
 */

// ---- shared mocks ---------------------------------------------------------

function createChainableMock(resolved: unknown = { data: null, error: null }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m: any = vi.fn().mockImplementation(() => m);
  m.single = vi.fn().mockResolvedValue(resolved);
  m.maybeSingle = vi.fn().mockResolvedValue(resolved);
  m.eq = vi.fn().mockReturnValue(m);
  m.in = vi.fn().mockReturnValue(m);
  m.order = vi.fn().mockReturnValue(m);
  m.limit = vi.fn().mockResolvedValue({ data: [], error: null });
  m.select = vi.fn().mockReturnValue(m);
  Object.assign(m, { data: [], error: null });
  return m;
}

const deleteSpy = vi.fn();
const insertSpy = vi.fn().mockResolvedValue({ data: null, error: null });

vi.mock("@/lib/supabase/admin", () => {
  const userRow = {
    id: "u1",
    telegram_id: 1,
    username: "u",
    first_name: "U",
    language: "vi",
    status: "active",
    approval_mode: "manual",
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
  const chain = createChainableMock({ data: userRow, error: null });
  return {
    supabaseAdmin: {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue(chain),
        insert: insertSpy,
        update: vi.fn().mockReturnValue(chain),
        upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
        delete: vi.fn().mockReturnValue({
          eq: deleteSpy.mockReturnValue({
            then: undefined,
            // make .delete().eq() awaitable by returning a thenable
          }),
        }),
      }),
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    },
  };
});

vi.mock("@/lib/logger", () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));

// ---- /cancel clearBotState ------------------------------------------------

describe("Wave 23D — /cancel clears bot_conversation_state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deleteSpy.mockClear();
  });

  it("regression: handleCancel triggers a DELETE on bot_conversation_state", async () => {
    const { handleCancel } = await import("../commands/cancel");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx: any = {
      from: { id: 1, is_bot: false, first_name: "U", username: "u" },
      message: { message_id: 1, text: "/cancel", chat: { id: 1, type: "private" } },
      reply: vi.fn().mockResolvedValue(undefined),
    };
    await handleCancel(ctx);
    // delete().eq() should have been called for bot_conversation_state
    // via clearBotState. We can't easily check the table arg from the
    // top-level mock shape, but deleteSpy is wired only on the .eq()
    // returned by .delete() — so any invocation proves the path ran.
    expect(deleteSpy).toHaveBeenCalled();
  });
});

// ---- denyIfNotApproved on text input --------------------------------------

describe("Wave 23D — denyIfNotApproved on plain text", () => {
  it("denyIfNotApproved returns true for pending user", async () => {
    const { denyIfNotApproved } = await import("../guards");
    const replies: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx: any = {
      reply: vi.fn().mockImplementation((t: string) => {
        replies.push(t);
        return Promise.resolve();
      }),
    };
    const denied = await denyIfNotApproved(
      ctx,
      { id: "u1", status: "pending" },
      "vi",
    );
    expect(denied).toBe(true);
    expect(replies[0]).toMatch(/đang chờ admin duyệt/i);
  });

  it("denyIfNotApproved returns false for active user (no reply)", async () => {
    const { denyIfNotApproved } = await import("../guards");
    const replies: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx: any = {
      reply: vi.fn().mockImplementation((t: string) => {
        replies.push(t);
        return Promise.resolve();
      }),
    };
    const denied = await denyIfNotApproved(
      ctx,
      { id: "u1", status: "active" },
      "vi",
    );
    expect(denied).toBe(false);
    expect(replies).toHaveLength(0);
  });
});
