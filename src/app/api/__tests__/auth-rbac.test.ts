import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import {
  getAdmin,
  requireAuth,
  requireRole,
  requireAnyRole,
  requireAdminOrAbove,
  requireSuperAdmin,
  canWrite,
  canManageAdmins,
  canManageSettings,
  verifyCronSecret,
} from "@/lib/auth";
import type { AdminInfo, Role } from "@/lib/auth";

// ─── Helpers ────────────────────────────────────────────────────

function createMockSupabase(admin: AdminInfo | null) {
  const singleResult = admin
    ? { data: admin, error: null }
    : { data: null, error: { message: "not found" } };

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: admin ? { email: admin.email } : null,
        },
      }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue(singleResult),
          }),
        }),
      }),
    }),
  } as any;
}

const superAdmin: AdminInfo = {
  id: "sa-id",
  email: "super@example.com",
  full_name: "Super Admin",
  role: "super_admin",
  is_active: true,
};

const admin: AdminInfo = {
  id: "a-id",
  email: "admin@example.com",
  full_name: "Admin",
  role: "admin",
  is_active: true,
};

const viewer: AdminInfo = {
  id: "v-id",
  email: "viewer@example.com",
  full_name: "Viewer",
  role: "viewer",
  is_active: true,
};

function createMockRequest(options: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
}) {
  const {
    method = "GET",
    url = "http://localhost/api/test",
    headers = {},
  } = options;
  return new NextRequest(url, { method, headers });
}

// ─── getAdmin ───────────────────────────────────────────────────

describe("getAdmin", () => {
  it("returns admin info when user exists and is active", async () => {
    const sb = createMockSupabase(admin);
    const result = await getAdmin(sb);
    expect(result).toEqual(admin);
  });

  it("returns null when no user is authenticated", async () => {
    const sb = createMockSupabase(null);
    const result = await getAdmin(sb);
    expect(result).toBeNull();
  });
});

// ─── requireAuth ────────────────────────────────────────────────

describe("requireAuth", () => {
  it("returns admin when authenticated", async () => {
    const sb = createMockSupabase(admin);
    const result = await requireAuth(sb);
    expect(result.admin).toEqual(admin);
    expect(result.error).toBeNull();
  });

  it("returns 401 error when not authenticated", async () => {
    const sb = createMockSupabase(null);
    const result = await requireAuth(sb);
    expect(result.admin).toBeNull();
    expect(result.error).toBeInstanceOf(NextResponse);
    const body = await result.error!.json();
    expect(body.error).toBe("Unauthorized");
    expect(result.error!.status).toBe(401);
  });
});

// ─── requireRole ────────────────────────────────────────────────

describe("requireRole", () => {
  it("allows user with matching role", async () => {
    const sb = createMockSupabase(admin);
    const result = await requireRole(sb, ["admin"]);
    expect(result.admin).toEqual(admin);
    expect(result.error).toBeNull();
  });

  it("allows user when role is in allowed list", async () => {
    const sb = createMockSupabase(viewer);
    const result = await requireRole(sb, ["viewer", "admin"]);
    expect(result.admin).toEqual(viewer);
    expect(result.error).toBeNull();
  });

  it("returns 403 when role not in allowed list", async () => {
    const sb = createMockSupabase(viewer);
    const result = await requireRole(sb, ["super_admin", "admin"]);
    expect(result.admin).toBeNull();
    expect(result.error).toBeInstanceOf(NextResponse);
    const body = await result.error!.json();
    expect(body.error).toBe("Forbidden: insufficient permissions");
    expect(result.error!.status).toBe(403);
  });

  it("returns 401 when user not authenticated", async () => {
    const sb = createMockSupabase(null);
    const result = await requireRole(sb, ["admin"]);
    expect(result.admin).toBeNull();
    expect(result.error!.status).toBe(401);
  });
});

// ─── requireAnyRole ─────────────────────────────────────────────

describe("requireAnyRole", () => {
  it("allows super_admin", async () => {
    const sb = createMockSupabase(superAdmin);
    const result = await requireAnyRole(sb);
    expect(result.admin).toEqual(superAdmin);
  });

  it("allows admin", async () => {
    const sb = createMockSupabase(admin);
    const result = await requireAnyRole(sb);
    expect(result.admin).toEqual(admin);
  });

  it("allows viewer", async () => {
    const sb = createMockSupabase(viewer);
    const result = await requireAnyRole(sb);
    expect(result.admin).toEqual(viewer);
  });

  it("rejects unauthenticated", async () => {
    const sb = createMockSupabase(null);
    const result = await requireAnyRole(sb);
    expect(result.error!.status).toBe(401);
  });
});

// ─── requireAdminOrAbove ────────────────────────────────────────

describe("requireAdminOrAbove", () => {
  it("allows super_admin", async () => {
    const sb = createMockSupabase(superAdmin);
    const result = await requireAdminOrAbove(sb);
    expect(result.admin).toEqual(superAdmin);
  });

  it("allows admin", async () => {
    const sb = createMockSupabase(admin);
    const result = await requireAdminOrAbove(sb);
    expect(result.admin).toEqual(admin);
  });

  it("rejects viewer with 403", async () => {
    const sb = createMockSupabase(viewer);
    const result = await requireAdminOrAbove(sb);
    expect(result.error!.status).toBe(403);
  });
});

// ─── requireSuperAdmin ──────────────────────────────────────────

describe("requireSuperAdmin", () => {
  it("allows super_admin", async () => {
    const sb = createMockSupabase(superAdmin);
    const result = await requireSuperAdmin(sb);
    expect(result.admin).toEqual(superAdmin);
  });

  it("rejects admin with 403", async () => {
    const sb = createMockSupabase(admin);
    const result = await requireSuperAdmin(sb);
    expect(result.error!.status).toBe(403);
  });

  it("rejects viewer with 403", async () => {
    const sb = createMockSupabase(viewer);
    const result = await requireSuperAdmin(sb);
    expect(result.error!.status).toBe(403);
  });
});

// ─── canWrite ───────────────────────────────────────────────────

describe("canWrite", () => {
  it("returns true for super_admin", () => {
    expect(canWrite("super_admin")).toBe(true);
  });

  it("returns true for admin", () => {
    expect(canWrite("admin")).toBe(true);
  });

  it("returns false for viewer", () => {
    expect(canWrite("viewer")).toBe(false);
  });
});

// ─── canManageAdmins ────────────────────────────────────────────

describe("canManageAdmins", () => {
  it("returns true for super_admin", () => {
    expect(canManageAdmins("super_admin")).toBe(true);
  });

  it("returns false for admin", () => {
    expect(canManageAdmins("admin")).toBe(false);
  });

  it("returns false for viewer", () => {
    expect(canManageAdmins("viewer")).toBe(false);
  });
});

// ─── canManageSettings ──────────────────────────────────────────

describe("canManageSettings", () => {
  it("returns true for super_admin", () => {
    expect(canManageSettings("super_admin")).toBe(true);
  });

  it("returns false for admin", () => {
    expect(canManageSettings("admin")).toBe(false);
  });

  it("returns false for viewer", () => {
    expect(canManageSettings("viewer")).toBe(false);
  });
});

// ─── verifyCronSecret ───────────────────────────────────────────

describe("verifyCronSecret", () => {
  const CRON_SECRET = "test-cron-secret-value";

  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
  });

  it("returns null (valid) when correct secret provided", () => {
    const req = createMockRequest({
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });
    const result = verifyCronSecret(req);
    expect(result).toBeNull();
  });

  it("returns 401 when wrong secret provided", () => {
    const req = createMockRequest({
      headers: { authorization: "Bearer wrong-secret" },
    });
    const result = verifyCronSecret(req);
    expect(result).toBeInstanceOf(NextResponse);
    expect(result!.status).toBe(401);
  });

  it("returns 401 when no authorization header", () => {
    const req = createMockRequest({});
    const result = verifyCronSecret(req);
    expect(result).toBeInstanceOf(NextResponse);
    expect(result!.status).toBe(401);
  });

  it("returns 401 when authorization header has wrong format", () => {
    const req = createMockRequest({
      headers: { authorization: CRON_SECRET },
    });
    const result = verifyCronSecret(req);
    expect(result).toBeInstanceOf(NextResponse);
    expect(result!.status).toBe(401);
  });

  it("returns 500 when CRON_SECRET is not configured", () => {
    vi.stubEnv("CRON_SECRET", "");
    const req = createMockRequest({
      headers: { authorization: "Bearer something" },
    });
    const result = verifyCronSecret(req);
    expect(result).toBeInstanceOf(NextResponse);
    expect(result!.status).toBe(500);
  });
});
