import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Wave 22F-C regression tests for DELETE /api/admins/[id].
 *
 * Two CRITICAL safety guards must hold:
 *   1. Cannot delete self — even super_admin (use the soft
 *      deactivate flow if you really want to leave; another
 *      super_admin should hard-delete).
 *   2. Cannot delete the LAST active super_admin — would lock
 *      everyone out of super-admin-only routes (settings, admins,
 *      etc.). Must promote another admin to super_admin first.
 *
 * These guards are tested via mock-driven scenarios. Bypassing
 * them would put production at risk of permanent admin lockout.
 */

const SUPER_ADMIN = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "super@test.local",
  full_name: "The Super",
  role: "super_admin" as const,
  is_active: true,
};

const OTHER_SUPER_ADMIN_ID = "00000000-0000-4000-8000-000000000002";
const REGULAR_ADMIN_ID = "00000000-0000-4000-8000-000000000003";

const mockMaybeSingle = vi.fn();
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockDelete = vi.fn();
const mockListUsers = vi.fn();
const mockDeleteUser = vi.fn();
const mockLogActivity = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({})),
}));

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    requireSuperAdmin: vi.fn(async () => ({
      admin: SUPER_ADMIN,
      error: null,
    })),
  };
});

vi.mock("@/lib/logger", () => ({
  logActivity: (...args: unknown[]) => mockLogActivity(...args),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: () => ({
      select: (...args: unknown[]) => mockSelect(...args),
      delete: () => ({
        eq: (...args: unknown[]) => mockDelete(...args),
      }),
    }),
    auth: {
      admin: {
        listUsers: (...args: unknown[]) => mockListUsers(...args),
        deleteUser: (...args: unknown[]) => mockDeleteUser(...args),
      },
    },
  },
}));

import { DELETE } from "@/app/api/admins/[id]/route";

function makeRequest(): import("next/server").NextRequest {
  return new Request("http://localhost/api/admins/x", {
    method: "DELETE",
    headers: {
      "x-forwarded-for": "1.2.3.4",
      "user-agent": "vitest",
    },
  }) as unknown as import("next/server").NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();

  // Default chain shapes — each test overrides as needed.
  mockSelect.mockReturnValue({
    eq: () => ({
      maybeSingle: mockMaybeSingle,
      // For the "count super_admins" select(..., { head: true })
      // case, the chain ends at .eq() returning a Promise. We
      // override per-test with mockSelect.mockImplementation.
    }),
  });

  mockDelete.mockResolvedValue({ error: null });
  mockListUsers.mockResolvedValue({
    data: { users: [{ id: "auth-1", email: "victim@test.local" }] },
  });
  mockDeleteUser.mockResolvedValue({ error: null });
  mockEq.mockResolvedValue({ error: null });
});

describe("DELETE /api/admins/[id] — Wave 22F-C self-target guard", () => {
  it("rejects self-delete with 400 + clear error message", async () => {
    const res = await DELETE(makeRequest(), {
      params: Promise.resolve({ id: SUPER_ADMIN.id }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/own account/i);

    // Critical: NO DB delete should have occurred.
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockDeleteUser).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/admins/[id] — Wave 22F-C last-super-admin guard", () => {
  it("rejects deleting the LAST active super_admin (count=1)", async () => {
    // First select() returns the target row (super_admin).
    // Second select() returns the count.
    let callCount = 0;
    mockSelect.mockImplementation((columns, opts) => {
      callCount++;
      if (callCount === 1) {
        // Lookup target by id
        return {
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: { role: "super_admin", email: "victim@test.local" },
              }),
          }),
        };
      }
      // Count active super_admins — head:true returns count only
      if (opts?.head && opts?.count === "exact") {
        return {
          eq: () => ({
            eq: () => Promise.resolve({ count: 1, error: null }),
          }),
        };
      }
      return { eq: () => ({ maybeSingle: vi.fn() }) };
    });

    const res = await DELETE(makeRequest(), {
      params: Promise.resolve({ id: OTHER_SUPER_ADMIN_ID }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/last active super_admin/i);
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockDeleteUser).not.toHaveBeenCalled();
  });

  it("ALLOWS deleting a super_admin when count >= 2", async () => {
    let callCount = 0;
    mockSelect.mockImplementation((columns, opts) => {
      callCount++;
      if (callCount === 1) {
        return {
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: { role: "super_admin", email: "victim@test.local" },
              }),
          }),
        };
      }
      if (opts?.head && opts?.count === "exact") {
        return {
          eq: () => ({
            eq: () => Promise.resolve({ count: 3, error: null }),
          }),
        };
      }
      return { eq: () => ({ maybeSingle: vi.fn() }) };
    });

    const res = await DELETE(makeRequest(), {
      params: Promise.resolve({ id: OTHER_SUPER_ADMIN_ID }),
    });

    expect(res.status).toBe(200);
    expect(mockDelete).toHaveBeenCalled();
    expect(mockDeleteUser).toHaveBeenCalledWith("auth-1");
  });

  it("ALLOWS deleting a regular admin (no last-super-admin check)", async () => {
    mockSelect.mockReturnValue({
      eq: () => ({
        maybeSingle: () =>
          Promise.resolve({
            data: { role: "admin", email: "regular@test.local" },
          }),
      }),
    });

    const res = await DELETE(makeRequest(), {
      params: Promise.resolve({ id: REGULAR_ADMIN_ID }),
    });

    expect(res.status).toBe(200);
    expect(mockDelete).toHaveBeenCalled();
  });
});

describe("DELETE /api/admins/[id] — 404 when target missing", () => {
  it("returns 404 when admin row doesn't exist", async () => {
    mockSelect.mockReturnValue({
      eq: () => ({
        maybeSingle: () => Promise.resolve({ data: null }),
      }),
    });

    const res = await DELETE(makeRequest(), {
      params: Promise.resolve({ id: REGULAR_ADMIN_ID }),
    });
    expect(res.status).toBe(404);
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
