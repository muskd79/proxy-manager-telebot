import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Wave 22R - POST /api/admins/[id]/disable-2fa tests.
 * Guards: self-target blocked, no-2FA 400, 404, super_admin auth, success path.
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
const mockListFactors = vi.fn();
const mockDeleteFactor = vi.fn();
const mockAdminSignOut = vi.fn();
const mockLogActivity = vi.fn().mockResolvedValue(undefined);
const mockLoginLogsInsert = vi.fn().mockResolvedValue({ error: null });

// Track table-level operations separately
const mockBackupCodesDelete = vi.fn().mockReturnValue({ eq: () => Promise.resolve({ error: null }) });
const mockAdminsUpdate = vi.fn().mockReturnValue({ eq: () => Promise.resolve({ error: null }) });
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
      if (table === "admin_backup_codes") {
        return { delete: () => mockBackupCodesDelete() };
      }
      // admins
      return {
        select: (...args: unknown[]) => mockAdminsSelect(...args),
        update: (...args: unknown[]) => mockAdminsUpdate(...args),
      };
    },
    auth: {
      admin: {
        mfa: {
          listFactors: (...args: unknown[]) => mockListFactors(...args),
          deleteFactor: (...args: unknown[]) => mockDeleteFactor(...args),
        },
        signOut: (...args: unknown[]) => mockAdminSignOut(...args),
      },
    },
  },
}));

import { POST } from "@/app/api/admins/[id]/disable-2fa/route";

function makeRequest(): import("next/server").NextRequest {
  return new Request("http://localhost/api/admins/x/disable-2fa", {
    method: "POST",
    headers: { "x-forwarded-for": "1.2.3.4", "user-agent": "vitest" },
  }) as unknown as import("next/server").NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireSuperAdmin.mockResolvedValue({ admin: SUPER_ADMIN, error: null });
  mockFindAuthUserByEmail.mockResolvedValue({ id: "auth-target-1", email: "target@test.local" });
  mockListFactors.mockResolvedValue({ data: { factors: [{ id: "factor-1" }] } });
  mockDeleteFactor.mockResolvedValue({ data: {}, error: null });
  mockAdminSignOut.mockResolvedValue({ error: null });
  mockBackupCodesDelete.mockReturnValue({ eq: () => Promise.resolve({ error: null }) });
  mockAdminsUpdate.mockReturnValue({ eq: () => Promise.resolve({ error: null }) });

  // Default admins select: target has 2FA enabled
  mockAdminsSelect.mockReturnValue({
    eq: () => ({
      maybeSingle: () =>
        Promise.resolve({
          data: { id: TARGET_ID, email: "target@test.local", totp_enabled_at: "2024-01-01T00:00:00Z" },
        }),
    }),
  });
});

describe("POST /api/admins/[id]/disable-2fa - auth", () => {
  it("returns 403 for non-super_admin", async () => {
    mockRequireSuperAdmin.mockResolvedValueOnce({
      admin: null,
      error: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    });
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: TARGET_ID }) });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/admins/[id]/disable-2fa - self-target guard", () => {
  it("returns 400 with 'Cannot disable own 2FA' for self-target", async () => {
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: SUPER_ADMIN.id }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Cannot disable own 2FA/i);
  });

  it("does NOT call any DB mutation when self-targeting", async () => {
    await POST(makeRequest(), { params: Promise.resolve({ id: SUPER_ADMIN.id }) });
    expect(mockDeleteFactor).not.toHaveBeenCalled();
    expect(mockAdminSignOut).not.toHaveBeenCalled();
  });
});

describe("POST /api/admins/[id]/disable-2fa - 404", () => {
  it("returns 404 when target admin not found", async () => {
    mockAdminsSelect.mockReturnValue({
      eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }),
    });
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "nonexistent" }) });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/admins/[id]/disable-2fa - no 2FA guard", () => {
  it("returns 400 when target admin does not have 2FA enabled", async () => {
    mockAdminsSelect.mockReturnValue({
      eq: () => ({
        maybeSingle: () =>
          Promise.resolve({
            data: { id: TARGET_ID, email: "target@test.local", totp_enabled_at: null },
          }),
      }),
    });
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: TARGET_ID }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/does not have 2FA enabled/i);
  });
});

describe("POST /api/admins/[id]/disable-2fa - success path", () => {
  it("returns 200 on success", async () => {
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: TARGET_ID }) });
    expect(res.status).toBe(200);
  });

  it("calls mfa.deleteFactor for each factor", async () => {
    mockListFactors.mockResolvedValueOnce({
      data: { factors: [{ id: "factor-1" }, { id: "factor-2" }] },
    });
    await POST(makeRequest(), { params: Promise.resolve({ id: TARGET_ID }) });
    expect(mockDeleteFactor).toHaveBeenCalledTimes(2);
  });

  it("calls signOut global to revoke target sessions", async () => {
    await POST(makeRequest(), { params: Promise.resolve({ id: TARGET_ID }) });
    expect(mockAdminSignOut).toHaveBeenCalledWith("auth-target-1", "global");
  });

  it("deletes backup codes and clears admins flags", async () => {
    await POST(makeRequest(), { params: Promise.resolve({ id: TARGET_ID }) });
    expect(mockBackupCodesDelete).toHaveBeenCalled();
    expect(mockAdminsUpdate).toHaveBeenCalledWith({ totp_factor_id: null, totp_enabled_at: null });
  });

  it("writes audit log", async () => {
    await POST(makeRequest(), { params: Promise.resolve({ id: TARGET_ID }) });
    const call = mockLogActivity.mock.calls[0][0] as { action: string };
    expect(call.action).toBe("admin.2fa_force_disabled");
  });
});

describe("POST /api/admins/[id]/disable-2fa - 500 when auth user missing", () => {
  it("returns 500 when no auth.users row for target", async () => {
    mockFindAuthUserByEmail.mockResolvedValueOnce(null);
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: TARGET_ID }) });
    expect(res.status).toBe(500);
  });
});
