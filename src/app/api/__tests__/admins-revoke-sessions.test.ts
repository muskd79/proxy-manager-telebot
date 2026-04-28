import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Wave 22R - POST /api/admins/[id]/revoke-sessions tests.
 */

const SUPER_ADMIN = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "super@test.local",
  full_name: "The Super",
  role: "super_admin" as const,
  is_active: true,
};
const TARGET_ID = "00000000-0000-4000-8000-000000000099";

const mockRequireSuperAdmin = vi.fn();
const mockFindAuthUserByEmail = vi.fn();
const mockAdminSignOut = vi.fn();
const mockLogActivity = vi.fn().mockResolvedValue(undefined);
const mockLoginLogsInsert = vi.fn().mockResolvedValue({ error: null });
const mockAdminsSelect = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({})),
}));

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    requireSuperAdmin: (...args: unknown[]) => mockRequireSuperAdmin(...args),
    actorLabel: (a: { email: string }) => a.email,
  };
});

vi.mock("@/lib/auth-helpers", () => ({
  findAuthUserByEmail: (...args: unknown[]) => mockFindAuthUserByEmail(...args),
}));

vi.mock("@/lib/logger", () => ({
  logActivity: (...args: unknown[]) => mockLogActivity(...args),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === "admin_login_logs") {
        return { insert: (...args: unknown[]) => mockLoginLogsInsert(...args) };
      }
      return {
        select: (...args: unknown[]) => mockAdminsSelect(...args),
      };
    },
    auth: {
      admin: {
        signOut: (...args: unknown[]) => mockAdminSignOut(...args),
      },
    },
  },
}));

import { POST } from "@/app/api/admins/[id]/revoke-sessions/route";

function makeRequest(): import("next/server").NextRequest {
  return new Request("http://localhost/api/admins/x/revoke-sessions", {
    method: "POST",
    headers: { "x-forwarded-for": "1.2.3.4", "user-agent": "vitest" },
  }) as unknown as import("next/server").NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireSuperAdmin.mockResolvedValue({ admin: SUPER_ADMIN, error: null });
  mockFindAuthUserByEmail.mockResolvedValue({ id: "auth-target-1", email: "target@test.local" });
  mockAdminSignOut.mockResolvedValue({ error: null });

  mockAdminsSelect.mockReturnValue({
    eq: () => ({
      maybeSingle: () =>
        Promise.resolve({ data: { id: TARGET_ID, email: "target@test.local" } }),
    }),
  });
});

describe("POST /api/admins/[id]/revoke-sessions - auth", () => {
  it("returns 403 for non-super_admin", async () => {
    mockRequireSuperAdmin.mockResolvedValueOnce({
      admin: null,
      error: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    });
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: TARGET_ID }) });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/admins/[id]/revoke-sessions - 404", () => {
  it("returns 404 when target admin not found", async () => {
    mockAdminsSelect.mockReturnValue({
      eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }),
    });
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "nonexistent" }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not found/i);
  });
});

describe("POST /api/admins/[id]/revoke-sessions - 500 when auth user missing", () => {
  it("returns 500 when no auth.users row found", async () => {
    mockFindAuthUserByEmail.mockResolvedValueOnce(null);
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: TARGET_ID }) });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/sessions cannot be revoked/i);
  });
});

describe("POST /api/admins/[id]/revoke-sessions - success", () => {
  it("returns 200 and calls signOut global", async () => {
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: TARGET_ID }) });
    expect(res.status).toBe(200);
    expect(mockAdminSignOut).toHaveBeenCalledWith("auth-target-1", "global");
  });

  it("writes audit log with action admin.sessions_force_revoked", async () => {
    await POST(makeRequest(), { params: Promise.resolve({ id: TARGET_ID }) });
    const call = mockLogActivity.mock.calls[0][0] as { action: string };
    expect(call.action).toBe("admin.sessions_force_revoked");
  });

  it("returns 500 when signOut itself errors", async () => {
    mockAdminSignOut.mockResolvedValueOnce({ error: { message: "signout failed" } });
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: TARGET_ID }) });
    expect(res.status).toBe(500);
  });
});
