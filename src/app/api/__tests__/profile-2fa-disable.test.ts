import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAdmin = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "admin@test.local",
  full_name: "Test Admin",
  role: "admin" as const,
  is_active: true,
};

const mockRequireAuth = vi.fn();
const mockSignInWithPassword = vi.fn();
const mockThrowawaySignOut = vi.fn().mockResolvedValue(undefined);
const mockListFactors = vi.fn();
const mockUnenroll = vi.fn();
const mockLogActivity = vi.fn().mockResolvedValue(undefined);
const mockLoginLogsInsert = vi.fn().mockResolvedValue({ error: null });
const mockAdminsUpdate = vi.fn().mockReturnValue({ eq: () => Promise.resolve({ error: null }) });
const mockBackupCodesDelete = vi.fn().mockReturnValue({ eq: () => Promise.resolve({ error: null }) });

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: (...args: unknown[]) => mockSignInWithPassword(...args),
      signOut: () => mockThrowawaySignOut(),
    },
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      mfa: {
        listFactors: (...args: unknown[]) => mockListFactors(...args),
        unenroll: (...args: unknown[]) => mockUnenroll(...args),
      },
    },
  })),
}));

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
    actorLabel: (a: { email: string }) => a.email,
  };
});

vi.mock("@/lib/logger", () => ({ logActivity: (...args: unknown[]) => mockLogActivity(...args) }));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === "admin_login_logs") return { insert: (...args: unknown[]) => mockLoginLogsInsert(...args) };
      if (table === "admin_backup_codes") return { delete: () => mockBackupCodesDelete() };
      return { update: (...args: unknown[]) => mockAdminsUpdate(...args) };
    },
  },
}));

import { POST } from "@/app/api/profile/2fa/disable/route";

function makeRequest(body: Record<string, unknown>): import("next/server").NextRequest {
  return new Request("http://localhost/api/profile/2fa/disable", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.4", "user-agent": "vitest" },
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ admin: mockAdmin, error: null });
  mockSignInWithPassword.mockResolvedValue({ data: { user: { id: "auth-1" } }, error: null });
  mockListFactors.mockResolvedValue({ data: { totp: [{ id: "factor-1" }] } });
  mockUnenroll.mockResolvedValue({ data: {}, error: null });
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key-test";
});

describe("POST /api/profile/2fa/disable - validation", () => {
  it("rejects missing current_password", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/profile/2fa/disable - wrong password", () => {
  it("returns 401 and writes audit when current_password is wrong", async () => {
    mockSignInWithPassword.mockResolvedValueOnce({ data: { user: null }, error: { message: "Invalid credentials" } });
    const res = await POST(makeRequest({ current_password: "wrongpass" }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/incorrect/i);
    const auditCall = mockLogActivity.mock.calls[0][0] as { action: string; details?: { reason?: string } };
    expect(auditCall.action).toBe("profile.2fa_disable_failed");
    expect(auditCall.details?.reason).toBe("wrong_current_password");
  });

  it("does NOT unenroll factors when password wrong", async () => {
    mockSignInWithPassword.mockResolvedValueOnce({ data: { user: null }, error: { message: "bad" } });
    await POST(makeRequest({ current_password: "wrong" }));
    expect(mockUnenroll).not.toHaveBeenCalled();
  });
});

describe("POST /api/profile/2fa/disable - success", () => {
  it("returns 200 on success", async () => {
    const res = await POST(makeRequest({ current_password: "CorrectPass123" }));
    expect(res.status).toBe(200);
  });

  it("unenrolls all TOTP factors", async () => {
    mockListFactors.mockResolvedValueOnce({ data: { totp: [{ id: "f1" }, { id: "f2" }] } });
    await POST(makeRequest({ current_password: "CorrectPass123" }));
    expect(mockUnenroll).toHaveBeenCalledTimes(2);
  });

  it("deletes backup codes and clears admins flags", async () => {
    await POST(makeRequest({ current_password: "CorrectPass123" }));
    expect(mockBackupCodesDelete).toHaveBeenCalled();
    expect(mockAdminsUpdate).toHaveBeenCalledWith({ totp_factor_id: null, totp_enabled_at: null });
  });

  it("writes profile.2fa_disabled audit log", async () => {
    await POST(makeRequest({ current_password: "CorrectPass123" }));
    const hit = mockLogActivity.mock.calls.find(
      (c: unknown[]) => (c[0] as { action: string }).action === "profile.2fa_disabled",
    );
    expect(hit).toBeDefined();
  });
});
