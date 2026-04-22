import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// ─── Mocks must be set up before importing route ────────────────

const mockAdmin = {
  id: "admin-uuid-1",
  email: "admin@example.com",
  full_name: "Admin User",
  role: "admin",
  is_active: true,
};

const mockViewer = {
  id: "viewer-uuid-1",
  email: "viewer@example.com",
  full_name: "Viewer User",
  role: "viewer",
  is_active: true,
};

// Build a chainable mock for supabase query builder
function createChainMock(resolvedValue: { data: any; error: any; count?: number | null }) {
  const chain: any = {};
  const methods = ["select", "eq", "ilike", "overlaps", "order", "range", "insert", "single"];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  // The final awaitable - make the chain thenable
  chain.then = (resolve: any) => resolve(resolvedValue);
  return chain;
}

let mockQueryChain: any;
let mockInsertChain: any;

const mockSupabase = {
  from: vi.fn(),
  auth: { getUser: vi.fn() },
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => mockSupabase),
}));

vi.mock("@/lib/logger", () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));

// Mock auth functions - these will be configured per-test
const mockRequireAnyRole = vi.fn();
const mockRequireAdminOrAbove = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireAnyRole: (...args: any[]) => mockRequireAnyRole(...args),
  requireAdminOrAbove: (...args: any[]) => mockRequireAdminOrAbove(...args),
}));

// Import route handlers after mocks
import { GET, POST } from "@/app/api/proxies/route";

// ─── Helpers ────────────────────────────────────────────────────

function createMockRequest(options: {
  method?: string;
  url?: string;
  body?: unknown;
  headers?: Record<string, string>;
}) {
  const {
    method = "GET",
    url = "http://localhost/api/proxies",
    body,
    headers = {},
  } = options;
  return new NextRequest(url, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: { "content-type": "application/json", ...headers },
  });
}

const sampleProxy = {
  id: "proxy-uuid-1",
  host: "203.0.113.1",
  port: 8080,
  type: "http",
  username: "user",
  password: "secret123",
  country: "US",
  city: "NYC",
  isp: null,
  status: "available",
  tags: ["fast"],
  notes: null,
  expires_at: null,
  assigned_to: null,
  is_deleted: false,
  created_by: "admin-uuid-1",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  deleted_at: null,
  last_checked_at: null,
  last_check_status: null,
  last_check_latency: null,
};

// ─── GET /api/proxies ───────────────────────────────────────────

describe("GET /api/proxies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryChain = createChainMock({ data: [sampleProxy], error: null, count: 1 });
    mockSupabase.from.mockReturnValue(mockQueryChain);
  });

  it("returns paginated proxies for authenticated admin", async () => {
    mockRequireAnyRole.mockResolvedValue({ admin: mockAdmin, error: null });

    const req = createMockRequest({ url: "http://localhost/api/proxies" });
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.page).toBe(1);
    expect(body.total).toBe(1);
  });

  it("returns 401 when not authenticated", async () => {
    mockRequireAnyRole.mockResolvedValue({
      admin: null,
      error: NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }),
    });

    const req = createMockRequest({});
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("strips password field for viewer role", async () => {
    mockRequireAnyRole.mockResolvedValue({ admin: mockViewer, error: null });

    const req = createMockRequest({});
    const res = await GET(req);
    const body = await res.json();

    expect(body.success).toBe(true);
    // Password should be stripped for viewer
    for (const proxy of body.data) {
      expect(proxy).not.toHaveProperty("password");
    }
  });

  it("does not strip password for admin role", async () => {
    mockRequireAnyRole.mockResolvedValue({ admin: mockAdmin, error: null });

    const req = createMockRequest({});
    const res = await GET(req);
    const body = await res.json();

    expect(body.data[0].password).toBe("secret123");
  });

  it("uses search param for host filtering", async () => {
    mockRequireAnyRole.mockResolvedValue({ admin: mockAdmin, error: null });

    const req = createMockRequest({ url: "http://localhost/api/proxies?search=192.168" });
    await GET(req);

    // Verify ilike was called (search filter)
    expect(mockQueryChain.ilike).toHaveBeenCalled();
  });

  it("uses type filter", async () => {
    mockRequireAnyRole.mockResolvedValue({ admin: mockAdmin, error: null });

    const req = createMockRequest({ url: "http://localhost/api/proxies?type=socks5" });
    await GET(req);

    // eq should be called for type filter (in addition to is_deleted)
    expect(mockQueryChain.eq).toHaveBeenCalled();
  });

  it("clamps pageSize to maximum 500", async () => {
    mockRequireAnyRole.mockResolvedValue({ admin: mockAdmin, error: null });

    const req = createMockRequest({ url: "http://localhost/api/proxies?pageSize=9999" });
    const res = await GET(req);
    const body = await res.json();

    expect(body.pageSize).toBe(500);
  });

  it("defaults page to 1 and pageSize to 20", async () => {
    mockRequireAnyRole.mockResolvedValue({ admin: mockAdmin, error: null });

    const req = createMockRequest({});
    const res = await GET(req);
    const body = await res.json();

    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(20);
  });

  it("returns 500 on supabase error", async () => {
    mockRequireAnyRole.mockResolvedValue({ admin: mockAdmin, error: null });
    const errorChain = createChainMock({ data: null, error: new Error("DB error"), count: null });
    mockSupabase.from.mockReturnValue(errorChain);

    const req = createMockRequest({});
    const res = await GET(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
  });
});

// ─── POST /api/proxies ──────────────────────────────────────────

describe("POST /api/proxies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsertChain = createChainMock({ data: { ...sampleProxy, id: "new-proxy-uuid" }, error: null });
    mockSupabase.from.mockReturnValue(mockInsertChain);
  });

  it("creates proxy with valid data and returns 201", async () => {
    mockRequireAdminOrAbove.mockResolvedValue({ admin: mockAdmin, error: null });

    const req = createMockRequest({
      method: "POST",
      body: { host: "203.0.113.2", port: 3128, type: "http" },
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
  });

  it("returns 401 when not authenticated", async () => {
    mockRequireAdminOrAbove.mockResolvedValue({
      admin: null,
      error: NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }),
    });

    const req = createMockRequest({
      method: "POST",
      body: { host: "203.0.113.2", port: 3128, type: "http" },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 403 when viewer tries to create", async () => {
    mockRequireAdminOrAbove.mockResolvedValue({
      admin: null,
      error: NextResponse.json({ success: false, error: "Forbidden: insufficient permissions" }, { status: 403 }),
    });

    const req = createMockRequest({
      method: "POST",
      body: { host: "203.0.113.2", port: 3128, type: "http" },
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("returns 400 for invalid body (missing host)", async () => {
    mockRequireAdminOrAbove.mockResolvedValue({ admin: mockAdmin, error: null });

    const req = createMockRequest({
      method: "POST",
      body: { port: 3128, type: "http" },
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toBe("Validation failed");
  });

  it("returns 400 for invalid port", async () => {
    mockRequireAdminOrAbove.mockResolvedValue({ admin: mockAdmin, error: null });

    const req = createMockRequest({
      method: "POST",
      body: { host: "203.0.113.2", port: 70000, type: "http" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid type", async () => {
    mockRequireAdminOrAbove.mockResolvedValue({ admin: mockAdmin, error: null });

    const req = createMockRequest({
      method: "POST",
      body: { host: "203.0.113.2", port: 8080, type: "ftp" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("passes optional fields correctly", async () => {
    mockRequireAdminOrAbove.mockResolvedValue({ admin: mockAdmin, error: null });

    const req = createMockRequest({
      method: "POST",
      body: {
        host: "203.0.113.2",
        port: 8080,
        type: "socks5",
        username: "proxyuser",
        password: "proxypass",
        country: "VN",
        tags: ["premium"],
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(201);

    // Verify insert was called on supabase
    expect(mockSupabase.from).toHaveBeenCalledWith("proxies");
    expect(mockInsertChain.insert).toHaveBeenCalled();
  });

  it("returns 500 on supabase insert error", async () => {
    mockRequireAdminOrAbove.mockResolvedValue({ admin: mockAdmin, error: null });
    const errorChain = createChainMock({ data: null, error: new Error("Insert failed") });
    mockSupabase.from.mockReturnValue(errorChain);

    const req = createMockRequest({
      method: "POST",
      body: { host: "203.0.113.2", port: 3128, type: "http" },
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
  });
});
