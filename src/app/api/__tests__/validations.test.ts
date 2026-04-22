import { describe, it, expect } from "vitest";
import {
  CreateProxySchema,
  UpdateProxySchema,
  ImportProxiesSchema,
  CheckProxiesSchema,
  TagRenameSchema,
  TagDeleteSchema,
  TagActionSchema,
  CreateRequestSchema,
  UpdateRequestSchema,
  SendChatMessageSchema,
  CreateUserSchema,
  UpdateUserSchema,
  UpdateSettingsSchema,
  UpdateAdminRoleSchema,
  ToggleAdminActiveSchema,
  TestBotConnectionSchema,
  SettingsPutSchema,
  InviteAdminSchema,
  SettingsPostSchema,
} from "@/lib/validations";

// ─── CreateProxySchema ──────────────────────────────────────────

describe("CreateProxySchema", () => {
  const validProxy = {
    // TEST-NET-3 — public, reserved for docs, passes SSRF refinement.
    host: "203.0.113.1",
    port: 8080,
    type: "http" as const,
  };

  it("accepts valid minimal proxy data", () => {
    const result = CreateProxySchema.safeParse(validProxy);
    expect(result.success).toBe(true);
  });

  it("accepts valid proxy with all optional fields", () => {
    const full = {
      ...validProxy,
      username: "user1",
      password: "pass1",
      country: "US",
      city: "New York",
      isp: "Comcast",
      tags: ["fast", "us"],
      notes: "Test proxy",
      expires_at: "2026-12-31T23:59:59Z",
    };
    const result = CreateProxySchema.safeParse(full);
    expect(result.success).toBe(true);
  });

  it("rejects empty host", () => {
    const result = CreateProxySchema.safeParse({ ...validProxy, host: "" });
    expect(result.success).toBe(false);
  });

  it("rejects missing host", () => {
    const { host, ...noHost } = validProxy;
    const result = CreateProxySchema.safeParse(noHost);
    expect(result.success).toBe(false);
  });

  it("rejects host longer than 255 chars", () => {
    const result = CreateProxySchema.safeParse({ ...validProxy, host: "a".repeat(256) });
    expect(result.success).toBe(false);
  });

  it("accepts port = 1 (minimum)", () => {
    const result = CreateProxySchema.safeParse({ ...validProxy, port: 1 });
    expect(result.success).toBe(true);
  });

  it("accepts port = 65535 (maximum)", () => {
    const result = CreateProxySchema.safeParse({ ...validProxy, port: 65535 });
    expect(result.success).toBe(true);
  });

  it("rejects port = 0", () => {
    const result = CreateProxySchema.safeParse({ ...validProxy, port: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects port = 65536", () => {
    const result = CreateProxySchema.safeParse({ ...validProxy, port: 65536 });
    expect(result.success).toBe(false);
  });

  it("rejects negative port", () => {
    const result = CreateProxySchema.safeParse({ ...validProxy, port: -1 });
    expect(result.success).toBe(false);
  });

  it("coerces string port to number", () => {
    const result = CreateProxySchema.safeParse({ ...validProxy, port: "443" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.port).toBe(443);
    }
  });

  it("rejects non-numeric port string", () => {
    const result = CreateProxySchema.safeParse({ ...validProxy, port: "abc" });
    expect(result.success).toBe(false);
  });

  it("accepts type http", () => {
    expect(CreateProxySchema.safeParse({ ...validProxy, type: "http" }).success).toBe(true);
  });

  it("accepts type https", () => {
    expect(CreateProxySchema.safeParse({ ...validProxy, type: "https" }).success).toBe(true);
  });

  it("accepts type socks5", () => {
    expect(CreateProxySchema.safeParse({ ...validProxy, type: "socks5" }).success).toBe(true);
  });

  it("rejects invalid type", () => {
    expect(CreateProxySchema.safeParse({ ...validProxy, type: "ftp" }).success).toBe(false);
  });

  it("accepts null optional fields", () => {
    const result = CreateProxySchema.safeParse({
      ...validProxy,
      username: null,
      password: null,
      country: null,
      tags: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects tags array with more than 20 items", () => {
    const tags = Array.from({ length: 21 }, (_, i) => `tag${i}`);
    const result = CreateProxySchema.safeParse({ ...validProxy, tags });
    expect(result.success).toBe(false);
  });

  it("rejects tag string longer than 50 chars", () => {
    const result = CreateProxySchema.safeParse({ ...validProxy, tags: ["a".repeat(51)] });
    expect(result.success).toBe(false);
  });

  it("rejects notes longer than 1000 chars", () => {
    const result = CreateProxySchema.safeParse({ ...validProxy, notes: "x".repeat(1001) });
    expect(result.success).toBe(false);
  });

  it("rejects invalid expires_at datetime", () => {
    const result = CreateProxySchema.safeParse({ ...validProxy, expires_at: "not-a-date" });
    expect(result.success).toBe(false);
  });
});

// ─── UpdateProxySchema ──────────────────────────────────────────

describe("UpdateProxySchema", () => {
  it("accepts empty object (all fields optional)", () => {
    const result = UpdateProxySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts partial update with host only", () => {
    const result = UpdateProxySchema.safeParse({ host: "new-host.com" });
    expect(result.success).toBe(true);
  });

  it("accepts valid status values", () => {
    for (const status of ["available", "assigned", "maintenance"]) {
      expect(UpdateProxySchema.safeParse({ status }).success).toBe(true);
    }
  });

  it("rejects invalid status", () => {
    expect(UpdateProxySchema.safeParse({ status: "deleted" }).success).toBe(false);
  });

  it("accepts valid assigned_to UUID", () => {
    const result = UpdateProxySchema.safeParse({ assigned_to: "550e8400-e29b-41d4-a716-446655440000" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid assigned_to (not UUID)", () => {
    const result = UpdateProxySchema.safeParse({ assigned_to: "not-a-uuid" });
    expect(result.success).toBe(false);
  });

  it("accepts is_deleted boolean", () => {
    expect(UpdateProxySchema.safeParse({ is_deleted: true }).success).toBe(true);
    expect(UpdateProxySchema.safeParse({ is_deleted: false }).success).toBe(true);
  });
});

// ─── ImportProxiesSchema ────────────────────────────────────────

describe("ImportProxiesSchema", () => {
  const validRow = { host: "1.2.3.4", port: 8080 };

  it("accepts valid import with one proxy", () => {
    const result = ImportProxiesSchema.safeParse({ proxies: [validRow] });
    expect(result.success).toBe(true);
  });

  it("rejects empty proxies array", () => {
    const result = ImportProxiesSchema.safeParse({ proxies: [] });
    expect(result.success).toBe(false);
  });

  it("rejects more than 10000 proxies", () => {
    const proxies = Array.from({ length: 10001 }, () => validRow);
    const result = ImportProxiesSchema.safeParse({ proxies });
    expect(result.success).toBe(false);
  });

  it("accepts optional global type override", () => {
    const result = ImportProxiesSchema.safeParse({ proxies: [validRow], type: "socks5" });
    expect(result.success).toBe(true);
  });
});

// ─── CheckProxiesSchema ─────────────────────────────────────────

describe("CheckProxiesSchema", () => {
  const uuid = "550e8400-e29b-41d4-a716-446655440000";

  it("accepts array of valid UUIDs", () => {
    const result = CheckProxiesSchema.safeParse({ ids: [uuid] });
    expect(result.success).toBe(true);
  });

  it("rejects empty ids array", () => {
    const result = CheckProxiesSchema.safeParse({ ids: [] });
    expect(result.success).toBe(false);
  });

  it("rejects non-UUID strings", () => {
    const result = CheckProxiesSchema.safeParse({ ids: ["not-a-uuid"] });
    expect(result.success).toBe(false);
  });

  it("rejects more than 500 ids", () => {
    const ids = Array.from({ length: 501 }, () => uuid);
    const result = CheckProxiesSchema.safeParse({ ids });
    expect(result.success).toBe(false);
  });
});

// ─── TagActionSchema ────────────────────────────────────────────

describe("TagActionSchema", () => {
  it("accepts valid rename action", () => {
    const result = TagActionSchema.safeParse({ action: "rename", from: "old", to: "new" });
    expect(result.success).toBe(true);
  });

  it("accepts valid delete action", () => {
    const result = TagActionSchema.safeParse({ action: "delete", tag: "obsolete" });
    expect(result.success).toBe(true);
  });

  it("rejects rename with empty from", () => {
    const result = TagRenameSchema.safeParse({ action: "rename", from: "", to: "new" });
    expect(result.success).toBe(false);
  });

  it("rejects rename with empty to", () => {
    const result = TagRenameSchema.safeParse({ action: "rename", from: "old", to: "" });
    expect(result.success).toBe(false);
  });

  it("rejects delete with empty tag", () => {
    const result = TagDeleteSchema.safeParse({ action: "delete", tag: "" });
    expect(result.success).toBe(false);
  });

  it("rejects tag longer than 50 chars", () => {
    const result = TagDeleteSchema.safeParse({ action: "delete", tag: "t".repeat(51) });
    expect(result.success).toBe(false);
  });
});

// ─── CreateRequestSchema ────────────────────────────────────────

describe("CreateRequestSchema", () => {
  const uuid = "550e8400-e29b-41d4-a716-446655440000";

  it("accepts valid request with UUID tele_user_id", () => {
    const result = CreateRequestSchema.safeParse({ tele_user_id: uuid });
    expect(result.success).toBe(true);
  });

  it("rejects non-UUID tele_user_id", () => {
    const result = CreateRequestSchema.safeParse({ tele_user_id: "abc" });
    expect(result.success).toBe(false);
  });

  it("accepts optional proxy_type", () => {
    const result = CreateRequestSchema.safeParse({ tele_user_id: uuid, proxy_type: "socks5" });
    expect(result.success).toBe(true);
  });

  it("accepts optional approval_mode", () => {
    const result = CreateRequestSchema.safeParse({ tele_user_id: uuid, approval_mode: "auto" });
    expect(result.success).toBe(true);
  });
});

// ─── UpdateRequestSchema ────────────────────────────────────────

describe("UpdateRequestSchema", () => {
  it("accepts valid status update", () => {
    for (const status of ["approved", "rejected", "cancelled"]) {
      expect(UpdateRequestSchema.safeParse({ status }).success).toBe(true);
    }
  });

  it("rejects invalid status", () => {
    expect(UpdateRequestSchema.safeParse({ status: "pending" }).success).toBe(false);
  });

  it("rejects rejected_reason over 500 chars", () => {
    expect(UpdateRequestSchema.safeParse({ rejected_reason: "r".repeat(501) }).success).toBe(false);
  });
});

// ─── SendChatMessageSchema ──────────────────────────────────────

describe("SendChatMessageSchema", () => {
  const uuid = "550e8400-e29b-41d4-a716-446655440000";

  it("accepts valid message", () => {
    const result = SendChatMessageSchema.safeParse({ tele_user_id: uuid, message: "Hello" });
    expect(result.success).toBe(true);
  });

  it("rejects empty message", () => {
    const result = SendChatMessageSchema.safeParse({ tele_user_id: uuid, message: "" });
    expect(result.success).toBe(false);
  });

  it("rejects message over 4096 chars", () => {
    const result = SendChatMessageSchema.safeParse({ tele_user_id: uuid, message: "m".repeat(4097) });
    expect(result.success).toBe(false);
  });
});

// ─── CreateUserSchema ───────────────────────────────────────────

describe("CreateUserSchema", () => {
  it("accepts valid user with telegram_id", () => {
    const result = CreateUserSchema.safeParse({ telegram_id: 12345 });
    expect(result.success).toBe(true);
  });

  it("coerces string telegram_id to number", () => {
    const result = CreateUserSchema.safeParse({ telegram_id: "12345" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.telegram_id).toBe(12345);
  });

  it("rejects negative telegram_id", () => {
    expect(CreateUserSchema.safeParse({ telegram_id: -1 }).success).toBe(false);
  });

  it("rejects zero telegram_id", () => {
    expect(CreateUserSchema.safeParse({ telegram_id: 0 }).success).toBe(false);
  });

  it("accepts optional fields", () => {
    const result = CreateUserSchema.safeParse({
      telegram_id: 12345,
      username: "testuser",
      first_name: "Test",
      status: "active",
      max_proxies: 5,
    });
    expect(result.success).toBe(true);
  });

  it("rejects max_proxies over 1000", () => {
    expect(CreateUserSchema.safeParse({ telegram_id: 1, max_proxies: 1001 }).success).toBe(false);
  });

  it("rejects invalid status value", () => {
    expect(CreateUserSchema.safeParse({ telegram_id: 1, status: "suspended" }).success).toBe(false);
  });
});

// ─── SettingsPutSchema ──────────────────────────────────────────

describe("SettingsPutSchema", () => {
  it("accepts update_settings action with non-empty settings", () => {
    const result = SettingsPutSchema.safeParse({
      action: "update_settings",
      settings: { key: "value" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects update_settings with empty settings", () => {
    const result = SettingsPutSchema.safeParse({
      action: "update_settings",
      settings: {},
    });
    expect(result.success).toBe(false);
  });

  it("accepts update_admin_role with valid UUID and role", () => {
    const result = SettingsPutSchema.safeParse({
      action: "update_admin_role",
      adminId: "550e8400-e29b-41d4-a716-446655440000",
      role: "admin",
    });
    expect(result.success).toBe(true);
  });

  it("rejects update_admin_role with invalid UUID", () => {
    const result = SettingsPutSchema.safeParse({
      action: "update_admin_role",
      adminId: "not-uuid",
      role: "admin",
    });
    expect(result.success).toBe(false);
  });

  it("accepts toggle_admin_active action", () => {
    const result = SettingsPutSchema.safeParse({
      action: "toggle_admin_active",
      adminId: "550e8400-e29b-41d4-a716-446655440000",
      is_active: false,
    });
    expect(result.success).toBe(true);
  });

  it("accepts test_bot_connection action", () => {
    const result = SettingsPutSchema.safeParse({ action: "test_bot_connection" });
    expect(result.success).toBe(true);
  });

  it("rejects unknown action", () => {
    const result = SettingsPutSchema.safeParse({ action: "unknown_action" });
    expect(result.success).toBe(false);
  });
});

// ─── SettingsPostSchema (InviteAdmin) ───────────────────────────

describe("SettingsPostSchema", () => {
  it("accepts invite_admin with valid email", () => {
    const result = SettingsPostSchema.safeParse({
      action: "invite_admin",
      email: "admin@example.com",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invite_admin with invalid email", () => {
    const result = SettingsPostSchema.safeParse({
      action: "invite_admin",
      email: "not-an-email",
    });
    expect(result.success).toBe(false);
  });

  it("accepts invite_admin with optional role", () => {
    const result = SettingsPostSchema.safeParse({
      action: "invite_admin",
      email: "admin@example.com",
      role: "viewer",
    });
    expect(result.success).toBe(true);
  });

  it("rejects email longer than 255 chars", () => {
    const result = SettingsPostSchema.safeParse({
      action: "invite_admin",
      email: "a".repeat(250) + "@b.com",
    });
    expect(result.success).toBe(false);
  });
});
