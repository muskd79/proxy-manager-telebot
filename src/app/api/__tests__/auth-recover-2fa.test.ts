import { describe, it, expect, vi, beforeEach } from "vitest";
const mockLogActivity = vi.fn().mockResolvedValue(undefined);
const mockLoginLogsInsert = vi.fn().mockResolvedValue({ error: null });
const mockAdminsSelect = vi.fn();
const mockBackupCodesSelect = vi.fn();
const mockBackupCodesUpdate = vi.fn()
  .mockReturnValue({ eq: () => Promise.resolve({ error: null }) });
const mockAdminsUpdate = vi.fn()
  .mockReturnValue({ eq: () => Promise.resolve({ error: null }) });
const mockSignInWithPassword = vi.fn();
const mockFindAuthUserByEmail = vi.fn();
const mockListFactors = vi.fn();
const mockDeleteFactor = vi.fn();
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: {
    signInWithPassword: (...a: unknown[]) => mockSignInWithPassword(...a),
    signOut: () => Promise.resolve(undefined),
  } }),
}));
vi.mock("@/lib/auth-helpers", () => ({
  findAuthUserByEmail: (...a: unknown[]) => mockFindAuthUserByEmail(...a),
}));
vi.mock("@/lib/logger", () => ({
  logActivity: (...a: unknown[]) => mockLogActivity(...a),
}));
vi.mock("@/lib/backup-codes", () => ({
  normaliseBackupInput: (s: string) => s.toUpperCase().replace(/[^A-Z2-9]/g, ""),
  verifyBackupCode: (c: string, _: string, h: string) => h === "VALID_HASH_" + c,
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: (t: string) => {
    if (t === "admin_login_logs")
      return { insert: (...a: unknown[]) => mockLoginLogsInsert(...a) };
    if (t === "admin_backup_codes")
      return {
        select: (...a: unknown[]) => mockBackupCodesSelect(...a),
        update: (...a: unknown[]) => mockBackupCodesUpdate(...a),
      };
    if (t === "admins")
      return {
        select: (...a: unknown[]) => mockAdminsSelect(...a),
        update: (...a: unknown[]) => mockAdminsUpdate(...a),
      };
    return {};
  }, auth: { admin: { mfa: {
    listFactors: (...a: unknown[]) => mockListFactors(...a),
    deleteFactor: (...a: unknown[]) => mockDeleteFactor(...a),
  } } } },
}));
import { POST } from "@/app/api/auth/recover-2fa/route";
function makeRequest(b: Record<string, unknown>): import("next/server").NextRequest {
  return new Request("http://localhost/api/auth/recover-2fa", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.4" },
    body: JSON.stringify(b),
  }) as unknown as import("next/server").NextRequest;
}
const GOOD_EMAIL = "admin@test.local";
const GOOD_PASSWORD = "CorrectPass123";
const GOOD_BACKUP_CODE = "ABCD-2345-EFGH";
const GOOD_BACKUP_NORMALISED = "ABCD2345EFGH";
const ADMIN_ROW = { id: "00000000-0000-4000-8000-000000000001",
  email: GOOD_EMAIL, full_name: "Test Admin",
  totp_enabled_at: "2024-01-01T00:00:00Z" };
const CODE_ROW = { id: "code-row-1",
  code_hash: "VALID_HASH_" + GOOD_BACKUP_NORMALISED,
  salt: "somesalt", used_at: null };
beforeEach(() => {
  vi.clearAllMocks();
  mockSignInWithPassword.mockResolvedValue({ data: { user: { id: "auth-1" } }, error: null });
  mockFindAuthUserByEmail.mockResolvedValue({ id: "auth-1", email: GOOD_EMAIL });
  mockListFactors.mockResolvedValue({ data: { factors: [] } });
  mockDeleteFactor.mockResolvedValue({ data: {}, error: null });
  mockAdminsSelect.mockReturnValue({
    eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: ADMIN_ROW }) }) }),
  });
  mockBackupCodesSelect.mockReturnValue({
    eq: () => ({ is: () => Promise.resolve({ data: [CODE_ROW] }) }),
  });
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key-test";
});
describe("POST /api/auth/recover-2fa - validation", () => {
  it("rejects missing fields", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });
  it("rejects invalid email", async () => {
    const res = await POST(makeRequest({
      email: "notanemail", current_password: "pass", backup_code: "code",
    }));
    expect(res.status).toBe(400);
  });
});
describe("POST /api/auth/recover-2fa - wrong email", () => {
  it("returns 401 when admin not found", async () => {
    mockAdminsSelect.mockReturnValue({
      eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }),
    });
    const res = await POST(makeRequest({
      email: "noone@test.local", current_password: GOOD_PASSWORD, backup_code: GOOD_BACKUP_CODE,
    }));
    expect(res.status).toBe(401);
    expect(mockLoginLogsInsert).toHaveBeenCalled();
    const lr = mockLoginLogsInsert.mock.calls[0][0] as { details?: { reason?: string } };
    expect(lr.details?.reason).toBe("recover_2fa_no_admin");
  });
});
describe("POST /api/auth/recover-2fa - no 2FA on account", () => {
  it("returns 400 when admin has no 2FA enabled", async () => {
    mockAdminsSelect.mockReturnValue({
      eq: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({
            data: { ...ADMIN_ROW, totp_enabled_at: null },
          }),
        }),
      }),
    });
    const res = await POST(makeRequest({
      email: GOOD_EMAIL, current_password: GOOD_PASSWORD, backup_code: GOOD_BACKUP_CODE,
    }));
    expect(res.status).toBe(400);
  });
});
describe("POST /api/auth/recover-2fa - wrong password", () => {
  it("returns 401 and writes login log", async () => {
    mockSignInWithPassword.mockResolvedValueOnce({
      data: { user: null }, error: { message: "bad" },
    });
    const res = await POST(makeRequest({
      email: GOOD_EMAIL, current_password: "wrongpass", backup_code: GOOD_BACKUP_CODE,
    }));
    expect(res.status).toBe(401);
    const lr = mockLoginLogsInsert.mock.calls[0][0] as { details?: { reason?: string } };
    expect(lr.details?.reason).toBe("recover_2fa_wrong_password");
  });
});
describe("POST /api/auth/recover-2fa - invalid backup code", () => {
  it("returns 401 and writes audit log", async () => {
    mockBackupCodesSelect.mockReturnValue({
      eq: () => ({
        is: () => Promise.resolve({
          data: [{ id: "c1", code_hash: "WRONG_HASH", salt: "s", used_at: null }],
        }),
      }),
    });
    const res = await POST(makeRequest({
      email: GOOD_EMAIL, current_password: GOOD_PASSWORD, backup_code: GOOD_BACKUP_CODE,
    }));
    expect(res.status).toBe(401);
    const hit = mockLogActivity.mock.calls.find(
      (c: unknown[]) => (c[0] as { details?: { reason?: string } }).details?.reason
        === "invalid_backup_code",
    );
    expect(hit).toBeDefined();
  });
});
describe("POST /api/auth/recover-2fa - success", () => {
  it("returns 200 when all 3 factors correct", async () => {
    const res = await POST(makeRequest({
      email: GOOD_EMAIL, current_password: GOOD_PASSWORD, backup_code: GOOD_BACKUP_CODE,
    }));
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });
  it("marks backup code used_at", async () => {
    await POST(makeRequest({
      email: GOOD_EMAIL, current_password: GOOD_PASSWORD, backup_code: GOOD_BACKUP_CODE,
    }));
    const arg = mockBackupCodesUpdate.mock.calls[0][0] as { used_at?: string };
    expect(arg.used_at).toBeDefined();
  });
  it("clears admins.totp_factor_id and totp_enabled_at", async () => {
    await POST(makeRequest({
      email: GOOD_EMAIL, current_password: GOOD_PASSWORD, backup_code: GOOD_BACKUP_CODE,
    }));
    expect(mockAdminsUpdate)
      .toHaveBeenCalledWith({ totp_factor_id: null, totp_enabled_at: null });
  });
  it("writes auth.recover_2fa_success audit log", async () => {
    await POST(makeRequest({
      email: GOOD_EMAIL, current_password: GOOD_PASSWORD, backup_code: GOOD_BACKUP_CODE,
    }));
    const hit = mockLogActivity.mock.calls.find(
      (c: unknown[]) => (c[0] as { action: string }).action
        === "auth.recover_2fa_success",
    );
    expect(hit).toBeDefined();
  });
});