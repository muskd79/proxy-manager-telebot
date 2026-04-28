import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Wave 22R - POST /api/profile/2fa/enroll tests.
 * Guards: already-verified factor returns 409; clean up unverified; success path.
 */

const mockAdmin = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "admin@test.local",
  full_name: "Test Admin",
  role: "admin" as const,
  is_active: true,
};

const mockRequireAuth = vi.fn();
const mockListFactors = vi.fn();
const mockUnenroll = vi.fn();
const mockEnroll = vi.fn();
const mockLogActivity = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      mfa: {
        listFactors: (...args: unknown[]) => mockListFactors(...args),
        unenroll: (...args: unknown[]) => mockUnenroll(...args),
        enroll: (...args: unknown[]) => mockEnroll(...args),
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

vi.mock("@/lib/logger", () => ({
  logActivity: (...args: unknown[]) => mockLogActivity(...args),
}));

import { POST } from "@/app/api/profile/2fa/enroll/route";

function makeRequest(): import("next/server").NextRequest {
  return new Request("http://localhost/api/profile/2fa/enroll", {
    method: "POST",
    headers: { "x-forwarded-for": "1.2.3.4", "user-agent": "vitest" },
  }) as unknown as import("next/server").NextRequest;
}

const ENROLL_SUCCESS = {
  data: {
    id: "factor-new-1",
    totp: {
      qr_code: "data:image/png;base64,abc",
      secret: "JBSWY3DPEHPK3PXP",
      uri: "otpauth://totp/test",
    },
  },
  error: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ admin: mockAdmin, error: null });
  mockListFactors.mockResolvedValue({ data: { totp: [] } });
  mockEnroll.mockResolvedValue(ENROLL_SUCCESS);
  mockUnenroll.mockResolvedValue({ data: {}, error: null });
});

describe("POST /api/profile/2fa/enroll - auth", () => {
  it("returns auth error when not authenticated", async () => {
    mockRequireAuth.mockResolvedValueOnce({
      admin: null,
      error: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    });
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
  });
});

describe("POST /api/profile/2fa/enroll - already verified guard", () => {
  it("returns 409 when verified factor already exists", async () => {
    mockListFactors.mockResolvedValueOnce({
      data: { totp: [{ id: "existing-factor", status: "verified" }] },
    });
    const res = await POST(makeRequest());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/already enabled/i);
    expect(body.existing_factor_id).toBe("existing-factor");
  });

  it("does NOT call enroll when verified factor exists", async () => {
    mockListFactors.mockResolvedValueOnce({
      data: { totp: [{ id: "existing-factor", status: "verified" }] },
    });
    await POST(makeRequest());
    expect(mockEnroll).not.toHaveBeenCalled();
  });
});

describe("POST /api/profile/2fa/enroll - unverified cleanup", () => {
  it("unenrolls existing unverified factors before enrolling", async () => {
    mockListFactors.mockResolvedValueOnce({
      data: { totp: [{ id: "stale-factor", status: "unverified" }] },
    });
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockUnenroll).toHaveBeenCalledWith({ factorId: "stale-factor" });
  });
});

describe("POST /api/profile/2fa/enroll - success", () => {
  it("returns 200 with factor_id, qr_code, secret, uri", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.factor_id).toBe("factor-new-1");
    expect(body.data.qr_code).toBeDefined();
    expect(body.data.secret).toBeDefined();
    expect(body.data.uri).toBeDefined();
  });

  it("writes audit log on success", async () => {
    await POST(makeRequest());
    const call = mockLogActivity.mock.calls[0][0] as { action: string };
    expect(call.action).toBe("profile.2fa_enroll_started");
  });
});

describe("POST /api/profile/2fa/enroll - enroll failure", () => {
  it("returns 500 when mfa.enroll fails", async () => {
    mockEnroll.mockResolvedValueOnce({ data: null, error: { message: "enroll error" } });
    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
  });
});
