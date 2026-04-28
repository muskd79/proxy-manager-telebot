import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Wave 22D regression tests for the unified activity_logs writer.
 *
 * Q1 from security-reviewer (HIGH): pre-22D, src/lib/telegram/logging.ts
 * had its own `logActivity` that did `supabaseAdmin.from("activity_logs")
 * .insert(log)` raw — no sanitisation, no length cap. A user-controlled
 * Telegram username `"\nERROR actor_type=admin"` could forge a structured
 * row in any line-oriented log scraper.
 *
 * Wave 22D unifies both paths through `lib/logger.ts:logActivity` which
 * sanitises CR/LF/TAB and caps each string at 1024 chars. These tests
 * pin that contract — any future PR that re-introduces the raw insert
 * pattern fails them.
 */

const mockInsert = vi.fn().mockResolvedValue({ error: null });
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: () => ({ insert: (...args: unknown[]) => mockInsert(...args) }),
  },
}));

import { logActivity } from "@/lib/logger";

describe("logActivity sanitisation (Wave 22D Q1 regression)", () => {
  beforeEach(() => {
    mockInsert.mockClear();
  });

  it("strips \\n / \\r / \\t from string fields in details", async () => {
    await logActivity({
      actorType: "tele_user",
      action: "test_action",
      details: {
        username: "\nERROR actor_type=admin\r\naction=delete_all\t",
        reason: "ok",
      },
    });

    expect(mockInsert).toHaveBeenCalledOnce();
    const inserted = mockInsert.mock.calls[0][0] as {
      details: { username: string; reason: string };
    };
    expect(inserted.details.username).not.toMatch(/[\r\n\t]/);
    expect(inserted.details.username).toBe(
      " ERROR actor_type=admin  action=delete_all ",
    );
    expect(inserted.details.reason).toBe("ok");
  });

  it("strips control chars from ipAddress and userAgent", async () => {
    await logActivity({
      actorType: "admin",
      action: "test",
      ipAddress: "1.2.3.4\nfake_action=evil",
      userAgent: "curl/7\r\ninjected",
    });
    const inserted = mockInsert.mock.calls[0][0] as {
      ip_address: string;
      user_agent: string;
    };
    expect(inserted.ip_address).not.toMatch(/[\r\n\t]/);
    expect(inserted.user_agent).not.toMatch(/[\r\n\t]/);
  });

  it("caps each string at 1024 chars (per-string, not total payload)", async () => {
    const huge = "a".repeat(5000);
    await logActivity({
      actorType: "tele_user",
      action: "test",
      details: { username: huge, other: huge },
    });
    const inserted = mockInsert.mock.calls[0][0] as {
      details: { username: string; other: string };
    };
    expect(inserted.details.username.length).toBe(1024);
    expect(inserted.details.other.length).toBe(1024);
  });

  it("recursively sanitises nested objects + arrays", async () => {
    await logActivity({
      actorType: "system",
      action: "test",
      details: {
        nested: { key: "evil\nvalue" },
        list: ["safe", "evil\nentry"],
      },
    });
    const inserted = mockInsert.mock.calls[0][0] as {
      details: {
        nested: { key: string };
        list: string[];
      };
    };
    expect(inserted.details.nested.key).not.toMatch(/[\r\n]/);
    expect(inserted.details.list[1]).not.toMatch(/[\r\n]/);
  });

  it("preserves non-string primitives unchanged", async () => {
    await logActivity({
      actorType: "system",
      action: "test",
      details: { count: 42, active: true, ratio: 1.5, none: null },
    });
    const inserted = mockInsert.mock.calls[0][0] as {
      details: { count: number; active: boolean; ratio: number; none: null };
    };
    expect(inserted.details.count).toBe(42);
    expect(inserted.details.active).toBe(true);
    expect(inserted.details.ratio).toBe(1.5);
    expect(inserted.details.none).toBeNull();
  });

  it("Wave 22D: writes actorDisplayName when provided (mig 032)", async () => {
    await logActivity({
      actorType: "admin",
      actorId: "u1",
      actorDisplayName: "Bob the Admin",
      action: "test",
    });
    const inserted = mockInsert.mock.calls[0][0] as {
      actor_display_name: string | null;
    };
    expect(inserted.actor_display_name).toBe("Bob the Admin");
  });

  it("sanitises actorDisplayName too (cannot forge name with \\n)", async () => {
    await logActivity({
      actorType: "tele_user",
      actorDisplayName: "Bob\nERROR=critical",
      action: "test",
    });
    const inserted = mockInsert.mock.calls[0][0] as {
      actor_display_name: string;
    };
    expect(inserted.actor_display_name).not.toMatch(/[\r\n\t]/);
  });

  it("actor_display_name defaults to null when not provided", async () => {
    await logActivity({ actorType: "system", action: "test" });
    const inserted = mockInsert.mock.calls[0][0] as {
      actor_display_name: string | null;
    };
    expect(inserted.actor_display_name).toBeNull();
  });
});
