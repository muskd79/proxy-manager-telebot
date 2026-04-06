import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createCronRequest(secret?: string) {
  const headers: Record<string, string> = {};
  if (secret) headers["authorization"] = `Bearer ${secret}`;
  return new NextRequest("http://localhost/api/cron/test", { headers });
}

// ---------------------------------------------------------------------------
// Shared mock state - tracks every chained call made on supabaseAdmin
// ---------------------------------------------------------------------------

let chainState: {
  table: string;
  operation: string;
  args: unknown[];
  filters: Array<{ method: string; args: unknown[] }>;
};

function resetChain() {
  chainState = { table: "", operation: "", args: [], filters: [] };
}

// Return values that tests can configure per-call
let mockReturnValue: unknown = { data: null, error: null, count: null };
const mockReturnQueue: unknown[] = [];

function queueReturn(val: unknown) {
  mockReturnQueue.push(val);
}

function resolveReturn() {
  if (mockReturnQueue.length > 0) return mockReturnQueue.shift();
  return mockReturnValue;
}

// Track calls for assertions
const dbCalls: Array<{
  table: string;
  operation: string;
  filters: Array<{ method: string; args: unknown[] }>;
}> = [];

function buildChain(): Record<string, (...args: unknown[]) => unknown> {
  const chain: Record<string, (...args: unknown[]) => unknown> = {};
  const terminal = () => {
    dbCalls.push({
      table: chainState.table,
      operation: chainState.operation,
      filters: [...chainState.filters],
    });
    return Promise.resolve(resolveReturn());
  };

  const methods = [
    "select",
    "update",
    "delete",
    "insert",
    "upsert",
    "eq",
    "neq",
    "lt",
    "lte",
    "gt",
    "gte",
    "in",
    "not",
    "is",
    "order",
    "limit",
    "single",
    "maybeSingle",
  ];

  for (const m of methods) {
    chain[m] = (...args: unknown[]) => {
      if (["select", "update", "delete", "insert", "upsert"].includes(m)) {
        chainState.operation = m;
        chainState.args = args;
      }
      chainState.filters.push({ method: m, args });

      // Terminal methods resolve immediately
      if (m === "single" || m === "maybeSingle") {
        return terminal();
      }
      // For everything else, also make it thenable so awaiting works
      const proxy = { ...chain, then: (res: (v: unknown) => void, rej: (e: unknown) => void) => terminal().then(res, rej) };
      return proxy;
    };
  }

  return chain;
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      resetChain();
      chainState.table = table;
      return buildChain();
    },
  },
}));

vi.mock("@/lib/telegram/send", () => ({
  sendTelegramMessage: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("@/lib/proxy-checker", () => ({
  checkProxy: vi.fn(),
}));

vi.mock("@/lib/constants", () => ({
  HEALTH_CHECK_CONCURRENCY: 50,
  HEALTH_CHECK_CRON_BATCH_SIZE: 2000,
  TRASH_AUTO_CLEAN_DAYS: 30,
}));

// Stub environment
vi.stubEnv("CRON_SECRET", "test-cron-secret");

// Lazy imports (after mocks are wired)
async function importHealthCheck() {
  return (await import("@/app/api/cron/health-check/route")).GET;
}
async function importCleanup() {
  return (await import("@/app/api/cron/cleanup/route")).GET;
}
async function importExpireProxies() {
  return (await import("@/app/api/cron/expire-proxies/route")).GET;
}
async function importExpireRequests() {
  return (await import("@/app/api/cron/expire-requests/route")).GET;
}
async function importExpiryWarning() {
  return (await import("@/app/api/cron/expiry-warning/route")).GET;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  dbCalls.length = 0;
  mockReturnQueue.length = 0;
  mockReturnValue = { data: null, error: null, count: null };
});

// ===== AUTH (verifyCronSecret) =============================================

describe("verifyCronSecret (shared auth for all cron routes)", () => {
  it("rejects request with missing authorization header", async () => {
    const GET = await importHealthCheck();
    const req = createCronRequest(); // no secret
    const res = await GET(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it("rejects request with wrong cron secret", async () => {
    const GET = await importHealthCheck();
    const req = createCronRequest("wrong-secret");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns 500 when CRON_SECRET env is not set", async () => {
    const originalSecret = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    try {
      const GET = await importHealthCheck();
      const req = createCronRequest("anything");
      const res = await GET(req);
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toContain("misconfigured");
    } finally {
      process.env.CRON_SECRET = originalSecret;
    }
  });

  it("allows request with correct cron secret", async () => {
    mockReturnValue = { data: [], error: null };
    const GET = await importHealthCheck();
    const req = createCronRequest("test-cron-secret");
    const res = await GET(req);
    expect(res.status).toBe(200);
  });
});

// ===== HEALTH CHECK ========================================================

describe("GET /api/cron/health-check", () => {
  let GET: Awaited<ReturnType<typeof importHealthCheck>>;

  beforeEach(async () => {
    GET = await importHealthCheck();
  });

  it("returns 0 checked when no proxies exist", async () => {
    mockReturnValue = { data: [], error: null };
    const res = await GET(createCronRequest("test-cron-secret"));
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ checked: 0, alive: 0, dead: 0 });
  });

  it("returns 0 checked when query errors", async () => {
    mockReturnValue = { data: null, error: { message: "db error" } };
    const res = await GET(createCronRequest("test-cron-secret"));
    const body = await res.json();
    expect(body.data.checked).toBe(0);
  });

  it("correctly counts alive proxies", async () => {
    const { checkProxy } = await import("@/lib/proxy-checker");
    const mockCheck = vi.mocked(checkProxy);
    mockCheck.mockResolvedValue({ alive: true, speed_ms: 42 });

    // First call returns proxy list, subsequent calls are updates
    queueReturn({
      data: [
        { id: "p1", host: "1.1.1.1", port: 8080, type: "http" },
        { id: "p2", host: "2.2.2.2", port: 8080, type: "socks5" },
      ],
      error: null,
    });

    const res = await GET(createCronRequest("test-cron-secret"));
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.checked).toBe(2);
    expect(body.data.alive).toBe(2);
    expect(body.data.dead).toBe(0);
    expect(mockCheck).toHaveBeenCalledTimes(2);
  });

  it("correctly counts dead proxies and batch-updates them", async () => {
    const { checkProxy } = await import("@/lib/proxy-checker");
    const mockCheck = vi.mocked(checkProxy);
    mockCheck.mockResolvedValue({ alive: false, speed_ms: 0 });

    queueReturn({
      data: [
        { id: "p1", host: "1.1.1.1", port: 8080, type: "http" },
        { id: "p2", host: "2.2.2.2", port: 443, type: "https" },
      ],
      error: null,
    });

    const res = await GET(createCronRequest("test-cron-secret"));
    const body = await res.json();

    expect(body.data.alive).toBe(0);
    expect(body.data.dead).toBe(2);

    // Should have a batch update call for dead proxies
    const updateCalls = dbCalls.filter(
      (c) => c.table === "proxies" && c.operation === "update"
    );
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("handles mixed alive and dead proxies", async () => {
    const { checkProxy } = await import("@/lib/proxy-checker");
    const mockCheck = vi.mocked(checkProxy);
    mockCheck
      .mockResolvedValueOnce({ alive: true, speed_ms: 50 })
      .mockResolvedValueOnce({ alive: false, speed_ms: 0 })
      .mockResolvedValueOnce({ alive: true, speed_ms: 120 });

    queueReturn({
      data: [
        { id: "p1", host: "1.1.1.1", port: 80, type: "http" },
        { id: "p2", host: "2.2.2.2", port: 80, type: "http" },
        { id: "p3", host: "3.3.3.3", port: 80, type: "socks5" },
      ],
      error: null,
    });

    const res = await GET(createCronRequest("test-cron-secret"));
    const body = await res.json();

    expect(body.data.checked).toBe(3);
    expect(body.data.alive).toBe(2);
    expect(body.data.dead).toBe(1);
  });

  it("handles checkProxy throwing errors gracefully", async () => {
    const { checkProxy } = await import("@/lib/proxy-checker");
    const mockCheck = vi.mocked(checkProxy);
    mockCheck.mockRejectedValue(new Error("connection refused"));

    queueReturn({
      data: [{ id: "p1", host: "1.1.1.1", port: 80, type: "http" }],
      error: null,
    });

    const res = await GET(createCronRequest("test-cron-secret"));
    const body = await res.json();

    // Thrown errors are caught and treated as dead
    expect(body.data.dead).toBe(1);
    expect(body.data.alive).toBe(0);
  });
});

// ===== CLEANUP =============================================================

describe("GET /api/cron/cleanup", () => {
  let GET: Awaited<ReturnType<typeof importCleanup>>;

  beforeEach(async () => {
    GET = await importCleanup();
  });

  it("rejects unauthorized requests", async () => {
    const res = await GET(createCronRequest("bad-secret"));
    expect(res.status).toBe(401);
  });

  it("deletes trashed proxies older than TRASH_AUTO_CLEAN_DAYS", async () => {
    // 5 calls: proxies, tele_users, proxy_requests, activity_logs, chat_messages
    queueReturn({ count: 3, error: null }); // proxies
    queueReturn({ count: 0, error: null }); // users
    queueReturn({ count: 0, error: null }); // requests
    queueReturn({ count: 0, error: null }); // logs
    queueReturn({ count: 0, error: null }); // chats

    const res = await GET(createCronRequest("test-cron-secret"));
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.deletedProxies).toBe(3);

    const proxiesDelete = dbCalls.find(
      (c) => c.table === "proxies" && c.operation === "delete"
    );
    expect(proxiesDelete).toBeDefined();
  });

  it("deletes trashed users older than cutoff", async () => {
    queueReturn({ count: 0, error: null });
    queueReturn({ count: 5, error: null }); // users
    queueReturn({ count: 0, error: null });
    queueReturn({ count: 0, error: null });
    queueReturn({ count: 0, error: null });

    const res = await GET(createCronRequest("test-cron-secret"));
    const body = await res.json();

    expect(body.data.deletedUsers).toBe(5);
  });

  it("deletes trashed requests older than cutoff", async () => {
    queueReturn({ count: 0, error: null });
    queueReturn({ count: 0, error: null });
    queueReturn({ count: 7, error: null }); // requests
    queueReturn({ count: 0, error: null });
    queueReturn({ count: 0, error: null });

    const res = await GET(createCronRequest("test-cron-secret"));
    const body = await res.json();

    expect(body.data.deletedRequests).toBe(7);
  });

  it("deletes activity logs older than 90 days", async () => {
    queueReturn({ count: 0, error: null });
    queueReturn({ count: 0, error: null });
    queueReturn({ count: 0, error: null });
    queueReturn({ count: 42, error: null }); // logs
    queueReturn({ count: 0, error: null });

    const res = await GET(createCronRequest("test-cron-secret"));
    const body = await res.json();

    expect(body.data.deletedLogs).toBe(42);
  });

  it("deletes chat messages older than 90 days", async () => {
    queueReturn({ count: 0, error: null });
    queueReturn({ count: 0, error: null });
    queueReturn({ count: 0, error: null });
    queueReturn({ count: 0, error: null });
    queueReturn({ count: 10, error: null }); // chats

    const res = await GET(createCronRequest("test-cron-secret"));
    const body = await res.json();

    expect(body.data.deletedChats).toBe(10);
  });

  it("returns correct combined counts", async () => {
    queueReturn({ count: 2, error: null });
    queueReturn({ count: 1, error: null });
    queueReturn({ count: 3, error: null });
    queueReturn({ count: 10, error: null });
    queueReturn({ count: 5, error: null });

    const res = await GET(createCronRequest("test-cron-secret"));
    const body = await res.json();

    expect(body.data).toMatchObject({
      deletedProxies: 2,
      deletedUsers: 1,
      deletedRequests: 3,
      deletedLogs: 10,
      deletedChats: 5,
    });
    expect(body.data.cutoffDate).toBeDefined();
  });

  it("handles null counts gracefully (defaults to 0)", async () => {
    queueReturn({ count: null, error: null });
    queueReturn({ count: null, error: null });
    queueReturn({ count: null, error: null });
    queueReturn({ count: null, error: null });
    queueReturn({ count: null, error: null });

    const res = await GET(createCronRequest("test-cron-secret"));
    const body = await res.json();

    expect(body.data.deletedProxies).toBe(0);
    expect(body.data.deletedUsers).toBe(0);
    expect(body.data.deletedRequests).toBe(0);
    expect(body.data.deletedLogs).toBe(0);
    expect(body.data.deletedChats).toBe(0);
  });
});

// ===== EXPIRE PROXIES ======================================================

describe("GET /api/cron/expire-proxies", () => {
  let GET: Awaited<ReturnType<typeof importExpireProxies>>;

  beforeEach(async () => {
    GET = await importExpireProxies();
  });

  it("rejects unauthorized requests", async () => {
    const res = await GET(createCronRequest());
    expect(res.status).toBe(401);
  });

  it("returns 0 expired when no expired proxies found", async () => {
    mockReturnValue = { data: [], error: null };
    const res = await GET(createCronRequest("test-cron-secret"));
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.expired).toBe(0);
  });

  it("returns 0 expired when query returns null data", async () => {
    mockReturnValue = { data: null, error: null };
    const res = await GET(createCronRequest("test-cron-secret"));
    const body = await res.json();
    expect(body.data.expired).toBe(0);
  });

  it("revokes expired proxies and sets status to expired", async () => {
    const { sendTelegramMessage } = await import("@/lib/telegram/send");

    // First call: fetch expired proxies
    queueReturn({
      data: [
        {
          id: "px1",
          assigned_to: "user1",
          host: "1.1.1.1",
          port: 8080,
          type: "http",
          expires_at: "2024-01-01T00:00:00Z",
        },
      ],
      error: null,
    });
    // Update proxy
    queueReturn({ data: null, error: null });
    // Fetch user for notification
    queueReturn({
      data: { telegram_id: 12345, language: "en" },
      error: null,
    });

    const res = await GET(createCronRequest("test-cron-secret"));
    const body = await res.json();

    expect(body.data.expired).toBe(1);

    // Verify proxy update call happened
    const updateCall = dbCalls.find(
      (c) => c.table === "proxies" && c.operation === "update"
    );
    expect(updateCall).toBeDefined();

    // Verify telegram notification
    expect(sendTelegramMessage).toHaveBeenCalledWith(
      12345,
      expect.stringContaining("1.1.1.1:8080")
    );
  });

  it("sends Vietnamese notification when user language is vi", async () => {
    const { sendTelegramMessage } = await import("@/lib/telegram/send");

    queueReturn({
      data: [
        {
          id: "px1",
          assigned_to: "user1",
          host: "1.1.1.1",
          port: 8080,
          type: "socks5",
          expires_at: "2024-01-01T00:00:00Z",
        },
      ],
      error: null,
    });
    queueReturn({ data: null, error: null });
    queueReturn({
      data: { telegram_id: 99999, language: "vi" },
      error: null,
    });

    await GET(createCronRequest("test-cron-secret"));

    expect(sendTelegramMessage).toHaveBeenCalledWith(
      99999,
      expect.stringContaining("het han")
    );
  });

  it("skips notification when proxy has no assigned_to", async () => {
    const { sendTelegramMessage } = await import("@/lib/telegram/send");

    queueReturn({
      data: [
        {
          id: "px1",
          assigned_to: null,
          host: "1.1.1.1",
          port: 80,
          type: "http",
          expires_at: "2024-01-01T00:00:00Z",
        },
      ],
      error: null,
    });
    queueReturn({ data: null, error: null });

    const res = await GET(createCronRequest("test-cron-secret"));
    const body = await res.json();

    expect(body.data.expired).toBe(1);
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });

  it("handles telegram send failure gracefully (does not throw)", async () => {
    const { sendTelegramMessage } = await import("@/lib/telegram/send");
    vi.mocked(sendTelegramMessage).mockRejectedValueOnce(
      new Error("Telegram API down")
    );

    queueReturn({
      data: [
        {
          id: "px1",
          assigned_to: "user1",
          host: "1.1.1.1",
          port: 80,
          type: "http",
          expires_at: "2024-01-01T00:00:00Z",
        },
      ],
      error: null,
    });
    queueReturn({ data: null, error: null });
    queueReturn({
      data: { telegram_id: 12345, language: "en" },
      error: null,
    });

    // Should not throw even though sendTelegramMessage rejects
    const res = await GET(createCronRequest("test-cron-secret"));
    expect(res.status).toBe(200);
  });
});

// ===== EXPIRE REQUESTS =====================================================

describe("GET /api/cron/expire-requests", () => {
  let GET: Awaited<ReturnType<typeof importExpireRequests>>;

  beforeEach(async () => {
    GET = await importExpireRequests();
  });

  it("rejects unauthorized requests", async () => {
    const res = await GET(createCronRequest("wrong"));
    expect(res.status).toBe(401);
  });

  it("returns 0 expired when no old pending requests exist", async () => {
    mockReturnValue = { data: [], error: null };
    const res = await GET(createCronRequest("test-cron-secret"));
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.expired).toBe(0);
  });

  it("returns 0 expired when data is null", async () => {
    mockReturnValue = { data: null, error: null };
    const res = await GET(createCronRequest("test-cron-secret"));
    const body = await res.json();
    expect(body.data.expired).toBe(0);
  });

  it("expires pending requests older than 7 days and notifies users", async () => {
    const { sendTelegramMessage } = await import("@/lib/telegram/send");

    queueReturn({
      data: [
        {
          id: "req1",
          tele_user_id: "u1",
          proxy_type: "http",
          tele_users: { telegram_id: 11111, language: "en" },
        },
        {
          id: "req2",
          tele_user_id: "u2",
          proxy_type: "socks5",
          tele_users: { telegram_id: 22222, language: "vi" },
        },
      ],
      error: null,
    });
    // Batch update call
    queueReturn({ data: null, error: null });

    const res = await GET(createCronRequest("test-cron-secret"));
    const body = await res.json();

    expect(body.data.expired).toBe(2);
    expect(body.data.notified).toBe(2);
    expect(sendTelegramMessage).toHaveBeenCalledTimes(2);
  });

  it("sends English notification for expired request", async () => {
    const { sendTelegramMessage } = await import("@/lib/telegram/send");

    queueReturn({
      data: [
        {
          id: "req1",
          tele_user_id: "u1",
          proxy_type: "http",
          tele_users: { telegram_id: 11111, language: "en" },
        },
      ],
      error: null,
    });
    queueReturn({ data: null, error: null });

    await GET(createCronRequest("test-cron-secret"));

    expect(sendTelegramMessage).toHaveBeenCalledWith(
      11111,
      expect.stringContaining("expired after 7 days")
    );
  });

  it("sends Vietnamese notification for expired request", async () => {
    const { sendTelegramMessage } = await import("@/lib/telegram/send");

    queueReturn({
      data: [
        {
          id: "req1",
          tele_user_id: "u1",
          proxy_type: "socks5",
          tele_users: { telegram_id: 22222, language: "vi" },
        },
      ],
      error: null,
    });
    queueReturn({ data: null, error: null });

    await GET(createCronRequest("test-cron-secret"));

    expect(sendTelegramMessage).toHaveBeenCalledWith(
      22222,
      expect.stringContaining("het han sau 7 ngay")
    );
  });

  it("skips notification when user has no telegram_id", async () => {
    const { sendTelegramMessage } = await import("@/lib/telegram/send");

    queueReturn({
      data: [
        {
          id: "req1",
          tele_user_id: "u1",
          proxy_type: "http",
          tele_users: { telegram_id: null, language: "en" },
        },
      ],
      error: null,
    });
    queueReturn({ data: null, error: null });

    const res = await GET(createCronRequest("test-cron-secret"));
    const body = await res.json();

    expect(body.data.expired).toBe(1);
    expect(body.data.notified).toBe(0);
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });

  it("handles telegram failure gracefully during notification", async () => {
    const { sendTelegramMessage } = await import("@/lib/telegram/send");
    vi.mocked(sendTelegramMessage).mockRejectedValueOnce(
      new Error("network error")
    );

    queueReturn({
      data: [
        {
          id: "req1",
          tele_user_id: "u1",
          proxy_type: "http",
          tele_users: { telegram_id: 11111, language: "en" },
        },
      ],
      error: null,
    });
    queueReturn({ data: null, error: null });

    // Should not throw
    const res = await GET(createCronRequest("test-cron-secret"));
    expect(res.status).toBe(200);
  });
});

// ===== EXPIRY WARNING ======================================================

describe("GET /api/cron/expiry-warning", () => {
  let GET: Awaited<ReturnType<typeof importExpiryWarning>>;

  beforeEach(async () => {
    GET = await importExpiryWarning();
  });

  it("rejects unauthorized requests", async () => {
    const res = await GET(createCronRequest());
    expect(res.status).toBe(401);
  });

  it("returns 0 warned when no proxies are expiring soon", async () => {
    mockReturnValue = { data: [], error: null };
    const res = await GET(createCronRequest("test-cron-secret"));
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.warned).toBe(0);
  });

  it("returns 0 warned when data is null", async () => {
    mockReturnValue = { data: null, error: null };
    const res = await GET(createCronRequest("test-cron-secret"));
    const body = await res.json();
    expect(body.data.warned).toBe(0);
  });

  it("sends warning to user with proxy expiring within 3 days", async () => {
    const { sendTelegramMessage } = await import("@/lib/telegram/send");
    vi.mocked(sendTelegramMessage).mockResolvedValue({ success: true });

    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    queueReturn({
      data: [
        {
          id: "px1",
          host: "10.0.0.1",
          port: 3128,
          type: "http",
          assigned_to: "user1",
          expires_at: tomorrow,
        },
      ],
      error: null,
    });
    // User lookup
    queueReturn({
      data: { telegram_id: 55555, language: "en" },
      error: null,
    });

    const res = await GET(createCronRequest("test-cron-secret"));
    const body = await res.json();

    expect(body.data.warned).toBe(1);
    expect(sendTelegramMessage).toHaveBeenCalledWith(
      55555,
      expect.stringContaining("expiring soon")
    );
  });

  it("sends Vietnamese warning when user language is vi", async () => {
    const { sendTelegramMessage } = await import("@/lib/telegram/send");
    vi.mocked(sendTelegramMessage).mockResolvedValue({ success: true });

    const twoDaysLater = new Date(
      Date.now() + 2 * 24 * 60 * 60 * 1000
    ).toISOString();

    queueReturn({
      data: [
        {
          id: "px1",
          host: "10.0.0.1",
          port: 3128,
          type: "socks5",
          assigned_to: "user1",
          expires_at: twoDaysLater,
        },
      ],
      error: null,
    });
    queueReturn({
      data: { telegram_id: 55555, language: "vi" },
      error: null,
    });

    await GET(createCronRequest("test-cron-secret"));

    expect(sendTelegramMessage).toHaveBeenCalledWith(
      55555,
      expect.stringContaining("sap het han")
    );
  });

  it("skips proxies with no assigned_to", async () => {
    const { sendTelegramMessage } = await import("@/lib/telegram/send");

    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    queueReturn({
      data: [
        {
          id: "px1",
          host: "10.0.0.1",
          port: 3128,
          type: "http",
          assigned_to: null,
          expires_at: tomorrow,
        },
      ],
      error: null,
    });

    const res = await GET(createCronRequest("test-cron-secret"));
    const body = await res.json();

    expect(body.data.warned).toBe(0);
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });

  it("skips when user lookup returns null", async () => {
    const { sendTelegramMessage } = await import("@/lib/telegram/send");

    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    queueReturn({
      data: [
        {
          id: "px1",
          host: "10.0.0.1",
          port: 3128,
          type: "http",
          assigned_to: "user1",
          expires_at: tomorrow,
        },
      ],
      error: null,
    });
    queueReturn({ data: null, error: { message: "not found" } });

    const res = await GET(createCronRequest("test-cron-secret"));
    const body = await res.json();

    expect(body.data.warned).toBe(0);
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });

  it("does not count failed send as warned", async () => {
    const { sendTelegramMessage } = await import("@/lib/telegram/send");
    vi.mocked(sendTelegramMessage).mockResolvedValueOnce({
      success: false,
      error: "blocked by user",
    });

    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    queueReturn({
      data: [
        {
          id: "px1",
          host: "10.0.0.1",
          port: 3128,
          type: "http",
          assigned_to: "user1",
          expires_at: tomorrow,
        },
      ],
      error: null,
    });
    queueReturn({
      data: { telegram_id: 55555, language: "en" },
      error: null,
    });

    const res = await GET(createCronRequest("test-cron-secret"));
    const body = await res.json();

    // success: false means warned should not increment
    expect(body.data.warned).toBe(0);
  });

  it("handles sendTelegramMessage throwing and does not crash", async () => {
    const { sendTelegramMessage } = await import("@/lib/telegram/send");
    vi.mocked(sendTelegramMessage).mockRejectedValueOnce(
      new Error("network failure")
    );

    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    queueReturn({
      data: [
        {
          id: "px1",
          host: "10.0.0.1",
          port: 3128,
          type: "http",
          assigned_to: "user1",
          expires_at: tomorrow,
        },
      ],
      error: null,
    });
    queueReturn({
      data: { telegram_id: 55555, language: "en" },
      error: null,
    });

    // Should not throw
    const res = await GET(createCronRequest("test-cron-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.warned).toBe(0);
  });
});
