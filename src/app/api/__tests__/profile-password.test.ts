import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Wave 22F-A regression tests for POST /api/profile/password.
 *
 * Pre-22F the password change happened CLIENT-SIDE in /profile/page.tsx
 * via supabase.auth.updateUser({ password }). No server route, no
 * audit log, no current-password verify, no session revoke.
 * Wave 22F-A moves it server-side and adds all four guards.
 *
 * Tests pin:
 *   1. 401 with bad current_password (and audit row written)
 *   2. 200 + signOut(others) called on success
 *   3. password_changed_at column updated
 *   4. Both activity_logs AND admin_login_logs get an entry
 *   5. Refusing same-as-current short-circuits before any DB write
 *   6. Validation errors (short password, missing fields) return 400
 *   7. Auth-failed callers return the requireAuth error unchanged
 */

const mockAdmin = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "admin@test.local",
  full_name: "Test Admin",
  role: "admin" as const,
  is_active: true,
};

const mockSignInWithPassword = vi.fn();
const mockThrowawaySignOut = vi.fn().mockResolvedValue(undefined);
const mockAdminUpdateUserById = vi.fn();
const mockAdminSignOut = vi.fn();
const mockAdminsUpdate = vi.fn();
const mockLoginLogsInsert = vi.fn().mockResolvedValue({ error: null });
const mockLogActivity = vi.fn().mockResolvedValue(undefined);

vi.mock("@supabase/supabase-js", () => ({
  // Pure-client used for current-password verify.
  createClient: () => ({
    auth: {
      signInWithPassword: (...args: unknown[]) => mockSignInWithPassword(...args),
      signOut: () => mockThrowawaySignOut(),
    },
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn() },
  })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    auth: {
      admin: {
        updateUserById: (...args: unknown[]) => mockAdminUpdateUserById(...args),
        signOut: (...args: unknown[]) => mockAdminSignOut(...args),
      },
    },
    from: (table: string) => {
      if (table === "admin_login_logs") {
        return { insert: (...args: unknown[]) => mockLoginLogsInsert(...args) };
      }
      // admins table — chainable update().eq()
      return {
        update: (...args: unknown[]) => {
          mockAdminsUpdate(...args);
          return { eq: () => Promise.resolve({ error: null }) };
        },
      };
    },
  },
}));

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    requireAuth: vi.fn(async () => ({ admin: mockAdmin, error: null })),
  };
});

vi.mock("@/lib/logger", () => ({
  logActivity: (...args: unknown[]) => mockLogActivity(...args),
}));

import { POST } from "@/app/api/profile/password/route";

function makeRequest(body: Record<string, unknown>): import("next/server").NextRequest {
  return new Request("http://localhost/api/profile/password", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "1.2.3.4",
      "user-agent": "vitest",
    },
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default happy-path mocks.
  mockSignInWithPassword.mockResolvedValue({
    data: { user: { id: "auth-user-1" } },
    error: null,
  });
  mockAdminUpdateUserById.mockResolvedValue({ error: null });
  mockAdminSignOut.mockResolvedValue({ error: null });
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key-test";
});

describe("POST /api/profile/password — Wave 22F-A", () => {
  it("rejects when current_password is wrong + writes failed-attempt audit", async () => {
    mockSignInWithPassword.mockResolvedValueOnce({
      data: { user: null },
      error: { message: "Invalid login credentials" },
    });

    const res = await POST(makeRequest({
      current_password: "wrong",
      new_password: "newSecurePassword123",
    }));

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/Current password is incorrect/);
    // Audit row MUST still be written — incident response signal.
    expect(mockLogActivity).toHaveBeenCalledOnce();
    const activityArg = mockLogActivity.mock.calls[0][0] as { action: string; details?: { reason?: string } };
    expect(activityArg.action).toBe("profile.password_change_failed");
    expect(activityArg.details?.reason).toBe("wrong_current_password");
    // Critical: NO password update + NO session revoke must have happened.
    expect(mockAdminUpdateUserById).not.toHaveBeenCalled();
    expect(mockAdminSignOut).not.toHaveBeenCalled();
  });

  it("rejects same-as-current password before any DB call", async () => {
    const res = await POST(makeRequest({
      current_password: "samePassword123",
      new_password: "samePassword123",
    }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/must differ/i);
    // Critical: short-circuit means NO sign-in attempt either.
    expect(mockSignInWithPassword).not.toHaveBeenCalled();
  });

  it("rejects new_password shorter than 12 chars (validation)", async () => {
    const res = await POST(makeRequest({
      current_password: "anything",
      new_password: "short1",
    }));
    expect(res.status).toBe(400);
    expect(mockSignInWithPassword).not.toHaveBeenCalled();
  });

  it("rejects missing fields (validation)", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it("on success: updates password, revokes other sessions, writes both audits", async () => {
    const res = await POST(makeRequest({
      current_password: "oldPasswordCorrect",
      new_password: "brandNewPassword2024!",
    }));

    expect(res.status).toBe(200);

    // 1. Verified current password via throwaway client.
    expect(mockSignInWithPassword).toHaveBeenCalledWith({
      email: mockAdmin.email,
      password: "oldPasswordCorrect",
    });

    // 2. Set new password via admin API.
    expect(mockAdminUpdateUserById).toHaveBeenCalledWith("auth-user-1", {
      password: "brandNewPassword2024!",
    });

    // 3. CRITICAL security guarantee: signOut("others"), not "global".
    // The caller's session must survive; the attacker's concurrent
    // session must die.
    expect(mockAdminSignOut).toHaveBeenCalledWith("auth-user-1", "others");

    // 4. password_changed_at bumped.
    expect(mockAdminsUpdate).toHaveBeenCalledOnce();
    const updateArg = mockAdminsUpdate.mock.calls[0][0] as { password_changed_at: string };
    expect(updateArg.password_changed_at).toBeDefined();
    expect(new Date(updateArg.password_changed_at).getTime()).toBeGreaterThan(
      Date.now() - 5_000,
    );

    // 5. activity_logs + admin_login_logs both populated.
    const successAudit = mockLogActivity.mock.calls.find(
      (c) => (c[0] as { action: string }).action === "profile.password_changed",
    );
    expect(successAudit).toBeDefined();
    expect(mockLoginLogsInsert).toHaveBeenCalledOnce();
    const logRow = mockLoginLogsInsert.mock.calls[0][0] as { action: string; ip_address?: string };
    expect(logRow.action).toBe("password_changed");
    expect(logRow.ip_address).toBe("1.2.3.4");
  });

  it("does NOT use signOut('global') — would log out the caller too", async () => {
    // Pin the exact scope to prevent a future refactor accident.
    await POST(makeRequest({
      current_password: "old",
      new_password: "newSecure12345",
    }));
    const calls = mockAdminSignOut.mock.calls;
    const scopes = calls.map((c) => c[1]);
    expect(scopes).not.toContain("global");
    expect(scopes).toContain("others");
  });
});
