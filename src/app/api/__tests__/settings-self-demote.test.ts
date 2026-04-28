import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Wave 22D-3 regression test — settings self-demote/deactivate guards.
 *
 * Bug pre-22D-3: a super_admin could PUT
 *   { action: "update_admin_role", adminId: <own id>, role: "viewer" }
 * and lock themselves out. Same with
 *   { action: "toggle_admin_active", adminId: <own id>, is_active: false }.
 *
 * The fix: explicit self-target check in the route. These tests pin
 * the guard so any future refactor that drops it fails loudly.
 */

const mockUpdate = vi.fn();
const mockEq = vi.fn().mockResolvedValue({ error: null });

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>(
    "@/lib/auth",
  );
  return {
    ...actual,
    requireSuperAdmin: vi.fn(),
  };
});

vi.mock("@/lib/logger", () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    auth: {
      admin: {
        listUsers: vi.fn().mockResolvedValue({ data: { users: [] } }),
        signOut: vi.fn(),
      },
    },
  },
}));

import { PUT } from "@/app/api/settings/route";
import { createClient } from "@/lib/supabase/server";
import { requireSuperAdmin } from "@/lib/auth";

const SUPER_ADMIN = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "super@example.com",
  full_name: "Super Admin",
  role: "super_admin" as const,
  is_active: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdate.mockReturnValue({ eq: mockEq });
  mockEq.mockResolvedValue({ error: null });
  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
    from: () => ({ update: mockUpdate }),
  });
  (requireSuperAdmin as ReturnType<typeof vi.fn>).mockResolvedValue({
    admin: SUPER_ADMIN,
    error: null,
  });
});

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

describe("PUT /api/settings — Wave 22D-3 self-target guards", () => {
  it("rejects update_admin_role when adminId === own id", async () => {
    const res = await PUT(
      makeRequest({
        action: "update_admin_role",
        adminId: SUPER_ADMIN.id,
        role: "viewer",
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/own role/i);
    // Critical: the DB update must NOT have run.
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("allows update_admin_role for OTHER admin id (regression — guard not over-broad)", async () => {
    const res = await PUT(
      makeRequest({
        action: "update_admin_role",
        adminId: "00000000-0000-4000-8000-000000000099",
        role: "viewer",
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(mockUpdate).toHaveBeenCalledOnce();
  });

  it("rejects toggle_admin_active when deactivating self", async () => {
    const res = await PUT(
      makeRequest({
        action: "toggle_admin_active",
        adminId: SUPER_ADMIN.id,
        is_active: false,
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/deactivate your own/i);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("allows toggle_admin_active=true on self (re-activating yourself never locks out)", async () => {
    // Edge case: this branch is logically dead (you're already active
    // if you got past requireSuperAdmin), but the guard MUST allow it
    // — reactivating yourself is a no-op, not a footgun.
    const res = await PUT(
      makeRequest({
        action: "toggle_admin_active",
        adminId: SUPER_ADMIN.id,
        is_active: true,
      }),
    );
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledOnce();
  });

  it("allows toggle_admin_active=false on OTHER admin (guard not over-broad)", async () => {
    const res = await PUT(
      makeRequest({
        action: "toggle_admin_active",
        adminId: "00000000-0000-4000-8000-000000000099",
        is_active: false,
      }),
    );
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledOnce();
  });
});
