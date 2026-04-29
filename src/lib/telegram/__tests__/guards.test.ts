import { describe, it, expect, vi, beforeEach } from "vitest";
import { TeleUserStatus } from "@/types/database";
import { denyIfNotApproved } from "../guards";

vi.mock("../logging", () => ({
  logChatMessage: vi.fn().mockResolvedValue(undefined),
}));

function mkCtx() {
  const replies: string[] = [];
  return {
    replies,
    ctx: {
      reply: vi.fn(async (text: string) => {
        replies.push(text);
      }),
    },
  };
}

describe("denyIfNotApproved (Wave 23B-bot-fix)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows active user — returns false, no reply", async () => {
    const { ctx, replies } = mkCtx();
    const denied = await denyIfNotApproved(
      ctx as never,
      { id: "u1", status: TeleUserStatus.Active },
      "vi",
    );
    expect(denied).toBe(false);
    expect(replies).toHaveLength(0);
  });

  it("regression: pending user is DENIED with pending message", async () => {
    const { ctx, replies } = mkCtx();
    const denied = await denyIfNotApproved(
      ctx as never,
      { id: "u1", status: TeleUserStatus.Pending },
      "vi",
    );
    expect(denied).toBe(true);
    expect(replies[0]).toMatch(/chờ admin duyệt|pending admin/i);
  });

  it("blocked user is denied with blocked message", async () => {
    const { ctx, replies } = mkCtx();
    const denied = await denyIfNotApproved(
      ctx as never,
      { id: "u1", status: TeleUserStatus.Blocked },
      "en",
    );
    expect(denied).toBe(true);
    expect(replies[0]).toMatch(/blocked/i);
    expect(replies[0]).not.toMatch(/pending/i);
  });

  it("banned user is denied with blocked message (same template)", async () => {
    const { ctx, replies } = mkCtx();
    const denied = await denyIfNotApproved(
      ctx as never,
      { id: "u1", status: TeleUserStatus.Banned },
      "en",
    );
    expect(denied).toBe(true);
    expect(replies[0]).toMatch(/blocked/i);
  });

  it("pending message uses Vietnamese when lang=vi", async () => {
    const { ctx, replies } = mkCtx();
    await denyIfNotApproved(
      ctx as never,
      { id: "u1", status: TeleUserStatus.Pending },
      "vi",
    );
    expect(replies[0]).toContain("chờ");
  });

  it("pending message uses English when lang=en", async () => {
    const { ctx, replies } = mkCtx();
    await denyIfNotApproved(
      ctx as never,
      { id: "u1", status: TeleUserStatus.Pending },
      "en",
    );
    expect(replies[0]).toMatch(/pending admin approval/i);
  });
});
