import { describe, it, expect, vi, beforeEach } from "vitest";
import { ActorType } from "@/types/database";

/**
 * Wave 22D regression test — the telegram logActivity adapter.
 *
 * Pre-22D, `src/lib/telegram/logging.ts:logActivity` did its own
 * `supabaseAdmin.from("activity_logs").insert(log)` with no sanitisation
 * and no length cap. A Telegram username with `\n` could forge fake
 * structured rows in log scrapers. The fix: delegate to lib/logger.ts.
 *
 * This test pins the delegation contract:
 *   1. The telegram path must NOT do a direct insert into activity_logs.
 *   2. The snake_case ActivityLogInsert input must adapt correctly to
 *      the camelCase LogActivityParams the core logger expects.
 *   3. Sanitisation applied by core logger flows through automatically.
 */

const mockCoreLogActivity = vi.fn().mockResolvedValue(undefined);
const mockChatInsert = vi.fn().mockResolvedValue({ error: null });

vi.mock("@/lib/logger", () => ({
  logActivity: (...args: unknown[]) => mockCoreLogActivity(...args),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === "chat_messages") {
        return { insert: (...args: unknown[]) => mockChatInsert(...args) };
      }
      // If telegram/logging.ts ever directly hits "activity_logs" again,
      // this throw will surface the regression loud and clear.
      throw new Error(
        `Telegram logActivity must NOT hit table "${table}" directly. ` +
          "Delegate through @/lib/logger:logActivity instead.",
      );
    },
  },
}));

import { logActivity, logChatMessage } from "@/lib/telegram/logging";

describe("Wave 22D — telegram logActivity delegates to core logger", () => {
  beforeEach(() => {
    mockCoreLogActivity.mockClear();
    mockChatInsert.mockClear();
  });

  it("calls @/lib/logger:logActivity, NOT a direct activity_logs insert", async () => {
    await logActivity({
      actor_type: ActorType.Bot,
      actor_id: null,
      action: "user_registered",
      resource_type: "tele_user",
      resource_id: "u1",
      details: { telegram_id: 123, username: "alice" },
      ip_address: null,
      user_agent: null,
    });

    expect(mockCoreLogActivity).toHaveBeenCalledOnce();
  });

  it("adapts snake_case ActivityLogInsert to camelCase LogActivityParams", async () => {
    await logActivity({
      actor_type: ActorType.TeleUser,
      actor_id: "user-uuid-1",
      action: "proxy_revoked",
      resource_type: "proxy",
      resource_id: "proxy-uuid-1",
      details: { reason: "manual" },
      ip_address: "1.2.3.4",
      user_agent: "Telegram/1.0",
    });

    const arg = mockCoreLogActivity.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.actorType).toBe("tele_user");
    expect(arg.actorId).toBe("user-uuid-1");
    expect(arg.action).toBe("proxy_revoked");
    expect(arg.resourceType).toBe("proxy");
    expect(arg.resourceId).toBe("proxy-uuid-1");
    expect(arg.details).toEqual({ reason: "manual" });
    expect(arg.ipAddress).toBe("1.2.3.4");
    expect(arg.userAgent).toBe("Telegram/1.0");
  });

  it("converts null fields to undefined for the core logger", async () => {
    // Core logger's signature uses optional fields; passing literal `null`
    // would land `null` in the DB even when the caller meant "absent".
    await logActivity({
      actor_type: ActorType.Bot,
      actor_id: null,
      action: "system_event",
      resource_type: null,
      resource_id: null,
      details: null,
      ip_address: null,
      user_agent: null,
    });

    const arg = mockCoreLogActivity.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.actorId).toBeUndefined();
    expect(arg.resourceType).toBeUndefined();
    expect(arg.resourceId).toBeUndefined();
    expect(arg.details).toBeUndefined();
    expect(arg.ipAddress).toBeUndefined();
    expect(arg.userAgent).toBeUndefined();
  });

  it("logChatMessage still inserts into chat_messages (NOT delegated)", async () => {
    // chat_messages is the chat history table; user content is the data
    // by design. No sanitisation needed — every row IS user-supplied.
    await logChatMessage(
      "user-1",
      42,
      "inbound" as never,
      "hello world",
      "text" as never,
    );
    expect(mockChatInsert).toHaveBeenCalledOnce();
    expect(mockCoreLogActivity).not.toHaveBeenCalled();
  });
});
