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
const mockLogActivity = vi.fn().mockResolvedValue(undefined);
const mockAdminsSelect = vi.fn();
const mockBackupCodesDelete = vi.fn().mockReturnValue({ eq: () => Promise.resolve({ error: null }) });
const mockBackupCodesInsert = vi.fn().mockResolvedValue({ error: null });

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: (...args: unknown[]) => mockSignInWithPassword(...args),
      signOut: () => mockThrowawaySignOut(),
    },
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({})),
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

vi.mock("@/lib/backup-codes", () => ({
  generateBackupCodes: (count: number) =>
    Array.from({ length: count }, (_: unknown, i: number) => ({
      code: "FAKE-" + i,
      salt: "salt" + i,
      code_hash: "hash" + i,
    })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === "admin_backup_codes") {
        return {
          delete: () => mockBackupCodesDelete(),
          insert: (...args: unknown[]) => mockBackupCodesInsert(...args),
        };
      }
      // admins table
      return { select: (...args: unknown[]) => mockAdminsSelect(...args) };
    },
  },
}));

import { POST } from "@/app/api/profile/2fa/backup-codes/regenerate/route";

function makeRequest(body: Record<string, unknown>): import("next/server").NextRequest {
  return new Request("http://localhost/api/profile/2fa/backup-codes/regenerate", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.4" },
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ admin: mockAdmin, error: null });
  mockSignInWithPassword.mockResolvedValue({ data: { user: { id: "auth-1" } }, error: null });
  // Default: 2FA is enabled
  mockAdminsSelect.mockReturnValue({
    eq: () => ({ single: () => Promise.resolve({ data: { totp_enabled_at: "2024-01-01T00:00:00Z" } }) }),
  });
  mockBackupCodesInsert.mockResolvedValue({ error: null });
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key-test";
});

describe("POST /api/profile/2fa/backup-codes/regenerate - validation", () => {
  it("rejects missing current_password", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/profile/2fa/backup-codes/regenerate - 2FA not enabled", () => {
  it("returns 400 when 2FA is not enabled", async () => {
    mockAdminsSelect.mockReturnValue({
      eq: () => ({ single: () => Promise.resolve({ data: { totp_enabled_at: null } }) }),
    });
    const res = await POST(makeRequest({ current_password: "Pass123456" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/not enabled/i);
  });
});

describe("POST /api/profile/2fa/backup-codes/regenerate - wrong password", () => {
  it("returns 401 when password is wrong", async () => {
    mockSignInWithPassword.mockResolvedValueOnce({ data: { user: null }, error: { message: "bad" } });
    const res = await POST(makeRequest({ current_password: "wrongpass" }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/incorrect/i);
  });
});

describe("POST /api/profile/2fa/backup-codes/regenerate - success", () => {
  it("returns 200 with 8 fresh backup codes", async () => {
    const res = await POST(makeRequest({ current_password: "CorrectPass123" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.backup_codes).toHaveLength(8);
  });

  it("deletes old codes before inserting new ones", async () => {
    await POST(makeRequest({ current_password: "CorrectPass123" }));
    expect(mockBackupCodesDelete).toHaveBeenCalled();
    expect(mockBackupCodesInsert).toHaveBeenCalled();
  });

  it("writes backup_codes_regenerated audit log", async () => {
    await POST(makeRequest({ current_password: "CorrectPass123" }));
    const hit = mockLogActivity.mock.calls.find(
      (c: unknown[]) => (c[0] as { action: string }).action === "profile.backup_codes_regenerated",
    );
    expect(hit).toBeDefined();
  });
});
