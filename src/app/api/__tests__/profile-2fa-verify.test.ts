import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAdmin = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "admin@test.local",
  full_name: "Test Admin",
  role: "admin" as const,
  is_active: true,
};

const mockRequireAuth = vi.fn();
const mockChallengeAndVerify = vi.fn();
const mockLogActivity = vi.fn().mockResolvedValue(undefined);
const mockLoginLogsInsert = vi.fn().mockResolvedValue({ error: null });
const mockAdminsUpdate = vi.fn().mockReturnValue({ eq: () => Promise.resolve({ error: null }) });
const mockBackupCodesSelect = vi.fn();
const mockBackupCodesInsert = vi.fn().mockResolvedValue({ error: null });

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      mfa: {
        challengeAndVerify: (...args: unknown[]) => mockChallengeAndVerify(...args),
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

vi.mock("@/lib/backup-codes", () => ({
  generateBackupCodes: (count: number) =>
    Array.from({ length: count }, (_: unknown, i: number) => ({
      code: "FAKE-CODE-" + String(i).padStart(2, "0"),
      salt: "fakesalt" + i,
      code_hash: "fakehash" + i,
    })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === "admin_login_logs") {
        return { insert: (...args: unknown[]) => mockLoginLogsInsert(...args) };
      }
      if (table === "admin_backup_codes") {
        return {
          select: (...args: unknown[]) => mockBackupCodesSelect(...args),
          insert: (...args: unknown[]) => mockBackupCodesInsert(...args),
        };
      }
      return { update: (...args: unknown[]) => mockAdminsUpdate(...args) };
    },
  },
}));

import { POST } from "@/app/api/profile/2fa/verify/route";

function makeRequest(body: Record<string, unknown>): import("next/server").NextRequest {
  return new Request("http://localhost/api/profile/2fa/verify", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.4", "user-agent": "vitest" },
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

const VALID_FACTOR_ID = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ admin: mockAdmin, error: null });
  mockChallengeAndVerify.mockResolvedValue({ error: null });
  mockBackupCodesSelect.mockReturnValue({
    eq: () => ({ is: () => ({ limit: () => Promise.resolve({ data: [] }) }) }),
  });
});

describe("POST /api/profile/2fa/verify - validation", () => {
  it("rejects missing factor_id", async () => {
    const res = await POST(makeRequest({ code: "123456" }));
    expect(res.status).toBe(400);
  });
  it("rejects non-6-digit code", async () => {
    const res = await POST(makeRequest({ factor_id: VALID_FACTOR_ID, code: "abc" }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/profile/2fa/verify - invalid code", () => {
  it("returns 401 on invalid TOTP code and writes audit", async () => {
    mockChallengeAndVerify.mockResolvedValueOnce({ error: { message: "Invalid TOTP code" } });
    const res = await POST(makeRequest({ factor_id: VALID_FACTOR_ID, code: "000000" }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/Invalid TOTP code/i);
    const auditCall = mockLogActivity.mock.calls[0][0] as { action: string };
    expect(auditCall.action).toBe("profile.2fa_verify_failed");
  });
});

describe("POST /api/profile/2fa/verify - success", () => {
  it("returns 200 with 8 backup codes", async () => {
    const res = await POST(makeRequest({ factor_id: VALID_FACTOR_ID, code: "123456" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.backup_codes).toHaveLength(8);
  });
  it("updates admins.totp_factor_id", async () => {
    await POST(makeRequest({ factor_id: VALID_FACTOR_ID, code: "123456" }));
    expect(mockAdminsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ totp_factor_id: VALID_FACTOR_ID }),
    );
  });
  it("does NOT insert backup codes if they already exist (idempotent)", async () => {
    mockBackupCodesSelect.mockReturnValue({
      eq: () => ({ is: () => ({ limit: () => Promise.resolve({ data: [{ id: "x" }] }) }) }),
    });
    const res = await POST(makeRequest({ factor_id: VALID_FACTOR_ID, code: "123456" }));
    const body = await res.json();
    expect(mockBackupCodesInsert).not.toHaveBeenCalled();
    expect(body.data.backup_codes_already_existed).toBe(true);
  });
  it("writes profile.2fa_enabled audit log", async () => {
    await POST(makeRequest({ factor_id: VALID_FACTOR_ID, code: "123456" }));
    const hit = mockLogActivity.mock.calls.find(
      (c: unknown[]) => (c[0] as { action: string }).action === "profile.2fa_enabled",
    );
    expect(hit).toBeDefined();
  });
});
