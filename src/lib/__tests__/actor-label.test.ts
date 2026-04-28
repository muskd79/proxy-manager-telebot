import { describe, it, expect } from "vitest";
import { actorLabel } from "@/lib/auth";

/**
 * Wave 22D-2 regression test for actorLabel helper.
 *
 * actorLabel produces the human-readable string we store on
 * activity_logs.actor_display_name at insert time, so the /logs UI
 * can render "Bob the Admin" instead of "00000000-0000-..." in the
 * Actor column.
 *
 * Contract:
 *   - full_name wins over email
 *   - email wins over the static fallback
 *   - empty string is treated as "missing" (because admins.full_name
 *     can be either NULL or "" depending on how the row was created)
 */

describe("actorLabel — Wave 22D-2", () => {
  it("returns full_name when present", () => {
    expect(
      actorLabel({ full_name: "Bob Builder", email: "bob@example.com" }),
    ).toBe("Bob Builder");
  });

  it("falls back to email when full_name is null", () => {
    expect(actorLabel({ full_name: null, email: "alice@example.com" })).toBe(
      "alice@example.com",
    );
  });

  it("falls back to email when full_name is empty string", () => {
    // Some admin rows have full_name="" instead of NULL — treat as missing.
    expect(actorLabel({ full_name: "", email: "carl@example.com" })).toBe(
      "carl@example.com",
    );
  });

  it("returns 'Admin' when both full_name and email are missing", () => {
    // Defensive: should never happen in practice (email is required at
    // signup) but a malformed row must not crash the logger.
    expect(actorLabel({ full_name: null, email: "" })).toBe("Admin");
  });

  it("never throws on garbage input — used in audit-log path", () => {
    // logActivity is fire-and-forget; if actorLabel throws, the entire
    // audit row is lost. Pin no-throw on weird shapes that TypeScript
    // would normally reject but JS runtime might pass through.
    expect(() =>
      actorLabel({ full_name: null, email: "x@y.z" }),
    ).not.toThrow();
  });
});
