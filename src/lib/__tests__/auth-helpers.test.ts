import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Wave 22L (Phase 1 — C1 fix) regression tests for findAuthUserByEmail.
 *
 * Pre-22L bug: 5 routes called listUsers() without pagination params,
 * silently returning only 50 users. When auth.users grew past 50,
 * admins on page 2+ were "missing" → routes returned 500.
 *
 * Pin behaviour:
 *   1. Found on page 1 — returns immediately (no extra page calls)
 *   2. Found on page 3 — keeps paginating until found
 *   3. Not found anywhere — returns null after the safety cap
 *   4. Empty page — stops pagination
 */

const mockListUsers = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    auth: { admin: { listUsers: (...args: unknown[]) => mockListUsers(...args) } },
  },
}));

import { findAuthUserByEmail } from "@/lib/auth-helpers";

beforeEach(() => {
  mockListUsers.mockReset();
});

describe("findAuthUserByEmail — Wave 22L C1 fix", () => {
  it("finds user on page 1 — single API call", async () => {
    mockListUsers.mockResolvedValueOnce({
      data: { users: [{ id: "u1", email: "alice@example.com" }] },
      error: null,
    });
    const result = await findAuthUserByEmail("alice@example.com");
    expect(result?.id).toBe("u1");
    expect(mockListUsers).toHaveBeenCalledTimes(1);
    expect(mockListUsers).toHaveBeenCalledWith({ page: 1, perPage: 1000 });
  });

  it("paginates through 3 pages to find a user (THIS IS THE BUG FIX)", async () => {
    // Pre-22L: would return null after page 1 because no `page` param.
    // Wave 22L: paginates until found.
    const fullPage = (i: number) =>
      Array.from({ length: 1000 }, (_, j) => ({
        id: `u-p${i}-${j}`,
        email: `user-p${i}-${j}@example.com`,
      }));

    mockListUsers
      .mockResolvedValueOnce({ data: { users: fullPage(1) }, error: null })
      .mockResolvedValueOnce({ data: { users: fullPage(2) }, error: null })
      .mockResolvedValueOnce({
        data: { users: [{ id: "target", email: "target@example.com" }] },
        error: null,
      });

    const result = await findAuthUserByEmail("target@example.com");
    expect(result?.id).toBe("target");
    expect(mockListUsers).toHaveBeenCalledTimes(3);
  });

  it("case-insensitive email match", async () => {
    mockListUsers.mockResolvedValueOnce({
      data: { users: [{ id: "u1", email: "Alice@Example.com" }] },
      error: null,
    });
    const result = await findAuthUserByEmail("alice@example.com");
    expect(result?.id).toBe("u1");
  });

  it("returns null when not found across all pages", async () => {
    mockListUsers.mockResolvedValueOnce({
      data: { users: [{ id: "u1", email: "other@example.com" }] },
      error: null,
    });
    const result = await findAuthUserByEmail("missing@example.com");
    // First page has fewer than 1000 → stop after 1 call.
    expect(result).toBeNull();
    expect(mockListUsers).toHaveBeenCalledTimes(1);
  });

  it("stops paginating on empty page", async () => {
    mockListUsers
      .mockResolvedValueOnce({
        data: { users: Array.from({ length: 1000 }, (_, i) => ({ id: `u${i}`, email: `u${i}@x.com` })) },
        error: null,
      })
      .mockResolvedValueOnce({ data: { users: [] }, error: null });
    const result = await findAuthUserByEmail("missing@example.com");
    expect(result).toBeNull();
    expect(mockListUsers).toHaveBeenCalledTimes(2);
  });

  it("returns null on listUsers error (and logs)", async () => {
    mockListUsers.mockResolvedValueOnce({
      data: null,
      error: { message: "Auth API down" },
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await findAuthUserByEmail("any@example.com");
    expect(result).toBeNull();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
