import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Wave 22R - POST /api/admins/[id]/reset-password tests.
 * Modes: generate vs new_password, auth guards, 404, signOut called.
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
const mockFromAdmins = vi.fn();
const mockAdminUpdateUserById = vi.fn();
const mockAdminSignOut = vi.fn();
const mockFindAuthUserByEmail = vi.fn();
const mockLogActivity = vi.fn().mockResolvedValue(undefined);
const mockLoginLogsInsert = vi.fn().mockResolvedValue({ error: null });
// Wave 26-D bug hunt v2 — activity_logs count for the reset-password
// rate limit. Tests can call .mockReturnValueOnce(N) to simulate N
// prior resets in the trailing 60 minutes.
const mockActivityLogsCount = vi.fn(() => 0);

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
      if (table === "activity_logs") {
        // Wave 26-D bug hunt v2 — reset-password now rate-limits via
        // activity_logs count. Default mock: 0 prior resets so the
        // limit (10/hour) is never hit; individual tests can override
        // mockActivityLogsCount before invoking POST.
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  gte: () => Promise.resolve({ count: mockActivityLogsCount() }),
                }),
              }),
            }),
          }),
        };
      }
      // admins table
      return mockFromAdmins(table);
    },
    auth: {
      admin: {
        updateUserById: (...args: unknown[]) => mockAdminUpdateUserById(...args),
        signOut: (...args: unknown[]) => mockAdminSignOut(...args),
      },
    },
  },
}));

import { POST } from "@/app/api/admins/[id]/reset-password/route";

function makeRequest(body: Record<string, unknown>): import("next/server").NextRequest {
  return new Request("http://localhost/api/admins/x/reset-password", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.4", "user-agent": "vitest" },
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireSuperAdmin.mockResolvedValue({ admin: SUPER_ADMIN, error: null });
  mockFindAuthUserByEmail.mockResolvedValue({ id: "auth-target-1", email: "target@test.local" });
  mockAdminUpdateUserById.mockResolvedValue({ error: null });
  mockAdminSignOut.mockResolvedValue({ error: null });

  // Default admins.from mock: select returns target row, update chains
  mockFromAdmins.mockReturnValue({
    select: () => ({
      eq: () => ({
        maybeSingle: () => Promise.resolve({ data: { id: TARGET_ID, email: "target@test.local" } }),
      }),
    }),
    update: () => ({ eq: () => Promise.resolve({ error: null }) }),
  });
});

describe("POST /api/admins/[id]/reset-password - auth", () => {
  it("returns 403 for non-super_admin (auth error response)", async () => {
    mockRequireSuperAdmin.mockResolvedValueOnce({
      admin: null,
      error: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    });
    const res = await POST(makeRequest({ generate: true }), { params: Promise.resolve({ id: TARGET_ID }) });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/admins/[id]/reset-password - validation", () => {
  it("rejects body with neither generate nor new_password", async () => {
    const res = await POST(makeRequest({}), { params: Promise.resolve({ id: TARGET_ID }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("rejects new_password shorter than 12 chars", async () => {
    const res = await POST(makeRequest({ new_password: "short11" }), { params: Promise.resolve({ id: TARGET_ID }) });
    expect(res.status).toBe(400);
  });

  it("accepts new_password of exactly 12 chars", async () => {
    const res = await POST(makeRequest({ new_password: "123456789012" }), { params: Promise.resolve({ id: TARGET_ID }) });
    expect(res.status).toBe(200);
  });
});

describe("POST /api/admins/[id]/reset-password - 404", () => {
  it("returns 404 when admin row not found", async () => {
    mockFromAdmins.mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }),
    });
    const res = await POST(makeRequest({ generate: true }), { params: Promise.resolve({ id: "nonexistent" }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not found/i);
  });
});

describe("POST /api/admins/[id]/reset-password - generate mode", () => {
  it("returns new_password in response for generate:true", async () => {
    const res = await POST(makeRequest({ generate: true }), { params: Promise.resolve({ id: TARGET_ID }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.new_password).toBeDefined();
    expect(typeof body.new_password).toBe("string");
    expect(body.new_password.length).toBeGreaterThan(0);
  });

  it("calls signOut global on success", async () => {
    await POST(makeRequest({ generate: true }), { params: Promise.resolve({ id: TARGET_ID }) });
    expect(mockAdminSignOut).toHaveBeenCalledWith("auth-target-1", "global");
  });
});

describe("POST /api/admins/[id]/reset-password - set mode", () => {
  it("does NOT echo new_password back when caller sets it explicitly", async () => {
    const res = await POST(makeRequest({ new_password: "ExplicitPass123" }), { params: Promise.resolve({ id: TARGET_ID }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.new_password).toBeUndefined();
  });

  it("calls updateUserById with the supplied password", async () => {
    await POST(makeRequest({ new_password: "SuppliedPass123" }), { params: Promise.resolve({ id: TARGET_ID }) });
    expect(mockAdminUpdateUserById).toHaveBeenCalledWith("auth-target-1", { password: "SuppliedPass123" });
  });

  it("calls signOut global on success", async () => {
    await POST(makeRequest({ new_password: "SecurePass12345" }), { params: Promise.resolve({ id: TARGET_ID }) });
    expect(mockAdminSignOut).toHaveBeenCalledWith("auth-target-1", "global");
  });
});

describe("POST /api/admins/[id]/reset-password - 500 when auth user missing", () => {
  it("returns 500 when findAuthUserByEmail returns null", async () => {
    mockFindAuthUserByEmail.mockResolvedValueOnce(null);
    const res = await POST(makeRequest({ generate: true }), { params: Promise.resolve({ id: TARGET_ID }) });
    expect(res.status).toBe(500);
  });
});
