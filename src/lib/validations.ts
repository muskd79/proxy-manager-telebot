import { z } from "zod";
import { validatePublicHostLiteral } from "@/lib/security/public-ip";

/** Zod refinement that rejects obvious private/loopback IP literals at parse time. */
const publicHostLiteral = (s: string) => {
  const reason = validatePublicHostLiteral(s);
  return reason === null;
};
const publicHostMessage = "Host resolves to a private or reserved address (SSRF guard)";

// ─── Proxy schemas ───────────────────────────────────────────────

export const CreateProxySchema = z.object({
  host: z
    .string()
    .min(1, "Host is required")
    .max(255)
    .refine(publicHostLiteral, publicHostMessage),
  port: z.coerce.number().int().min(1).max(65535, "Port must be 1-65535"),
  type: z.enum(["http", "https", "socks5"]),
  // Wave 22J → 22K — proxy classification (free text, admin-extensible).
  network_type: z.string().min(1).max(80).nullable().optional(),
  username: z.string().max(255).nullable().optional(),
  password: z.string().max(255).nullable().optional(),
  country: z.string().max(100).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  isp: z.string().max(255).nullable().optional(),
  // Wave 28 — category_id is REQUIRED on create. Pre-Wave-28 the
  // schema accepted nullable | optional; mig 068 made the column
  // NOT NULL and adds a sentinel "Mặc định" that the form auto-
  // selects when admin doesn't pick. The route handler is the
  // last line of defence (Vietnamese error via
  // `lib/categories/enforcement.ts`); the DB column DEFAULT is the
  // safety net.
  category_id: z.string().uuid({ message: "MISSING_CATEGORY" }),
  // Wave 22K — per-proxy purchase metadata (denorm from purchase_lots).
  purchase_date: z.string().nullable().optional(),
  purchase_price_usd: z.coerce.number().finite().min(0).max(1_000_000).nullable().optional(),
  sale_price_usd: z.coerce.number().finite().min(0).max(1_000_000).nullable().optional(),
  vendor_source: z.string().max(200).nullable().optional(),
  // Wave 22C: tags removed in favour of category_id (Wave 22A).
  notes: z.string().max(1000).nullable().optional(),
  expires_at: z
    .string()
    .refine((s) => !s || !Number.isNaN(new Date(s).getTime()), "Invalid date")
    .nullable()
    .optional(),
});

export const UpdateProxySchema = z.object({
  host: z.string().min(1).max(255).refine(publicHostLiteral, publicHostMessage).optional(),
  port: z.coerce.number().int().min(1).max(65535).optional(),
  type: z.enum(["http", "https", "socks5"]).optional(),
  network_type: z.string().min(1).max(80).nullable().optional(),
  username: z.string().max(255).nullable().optional(),
  password: z.string().max(255).nullable().optional(),
  country: z.string().max(100).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  isp: z.string().max(255).nullable().optional(),
  // Wave 28 — explicit null is rejected in the route handler with a
  // friendly Vietnamese 400. We keep `.nullable()` here so the schema
  // PARSES the body (so route can read .data.category_id and route
  // its own error), then enforcement.ts turns null into 400.
  // `.optional()` stays so PATCH bodies that omit the field continue
  // to no-op the column.
  category_id: z.string().uuid().nullable().optional(),
  // Wave 22K — purchase metadata mutable.
  purchase_date: z.string().nullable().optional(),
  purchase_price_usd: z.coerce.number().finite().min(0).max(1_000_000).nullable().optional(),
  sale_price_usd: z.coerce.number().finite().min(0).max(1_000_000).nullable().optional(),
  vendor_source: z.string().max(200).nullable().optional(),
  status: z.enum(["available", "assigned", "maintenance"]).optional(),
  // Wave 22C: tags removed in favour of category_id (Wave 22A).
  notes: z.string().max(1000).nullable().optional(),
  expires_at: z
    .string()
    .refine((s) => !s || !Number.isNaN(new Date(s).getTime()), "Invalid date")
    .nullable()
    .optional(),
  assigned_to: z.string().uuid().nullable().optional(),
  is_deleted: z.boolean().optional(),
  deleted_at: z.string().datetime().nullable().optional(),
});

// ─── Import proxy schemas ────────────────────────────────────────

const ImportProxyRowSchema = z.object({
  host: z.string().min(1).max(255).refine(publicHostLiteral, publicHostMessage),
  port: z.coerce.number().int().min(1).max(65535),
  type: z.enum(["http", "https", "socks5"]).optional(),
  username: z.string().max(255).optional(),
  password: z.string().max(255).optional(),
  country: z.string().max(100).optional(),
  isp: z.string().max(255).optional(),
  line: z.number().int().optional(),
  // Wave 27 bug hunt v7 [debugger #5, MEDIUM] — cap raw line at 500
  // chars. Pre-fix: no .max() → admin (or direct API caller) could
  // submit 10,000 rows × 100KB raw = ~1GB JSON body that bloated
  // memory before Next.js's 4MB body limit kicked in. 500 chars
  // covers a typical CSV line with 10x safety margin.
  raw: z.string().max(500).optional(),
});

export const ImportProxiesSchema = z.object({
  proxies: z.array(ImportProxyRowSchema).min(1, "proxies array must not be empty").max(10000, "Maximum 10,000 proxies per import"),
  type: z.enum(["http", "https", "socks5"]).optional(),
  country: z.string().max(100).optional(),
  // Wave 22C: tags removed → category_id. Wave 22G/I: bulk assignment.
  category_id: z.string().uuid().nullable().optional(),
  notes: z.string().max(1000).optional(),
  isp: z.string().max(255).optional(),
  // Wave 22K — bulk-applied to every imported row.
  network_type: z.string().min(1).max(80).optional(),
  vendor_source: z.string().max(200).optional(),
  purchase_date: z.string().optional(),
  expires_at: z.string().optional(),
  purchase_price_usd: z.coerce.number().finite().min(0).max(1_000_000).optional(),
  sale_price_usd: z.coerce.number().finite().min(0).max(1_000_000).optional(),
});

// ─── Proxy health check ─────────────────────────────────────────

export const CheckProxiesSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, "ids array is required").max(500),
});

// ─── Tag management ──────────────────────────────────────────────

export const TagRenameSchema = z.object({
  action: z.literal("rename"),
  from: z.string().min(1, "from is required").max(50),
  to: z.string().min(1, "to is required").max(50),
});

export const TagDeleteSchema = z.object({
  action: z.literal("delete"),
  tag: z.string().min(1, "tag is required").max(50),
});

export const TagActionSchema = z.discriminatedUnion("action", [
  TagRenameSchema,
  TagDeleteSchema,
]);

// ─── Request schemas ─────────────────────────────────────────────

export const CreateRequestSchema = z.object({
  tele_user_id: z.string().uuid("tele_user_id is required"),
  proxy_type: z.enum(["http", "https", "socks5"]).nullable().optional(),
  country: z.string().max(100).nullable().optional(),
  approval_mode: z.enum(["manual", "auto"]).optional(),
});

export const UpdateRequestSchema = z.object({
  status: z.enum(["approved", "rejected", "cancelled"]).optional(),
  proxy_id: z.string().uuid().nullable().optional(),
  rejected_reason: z.string().max(500).nullable().optional(),
  auto_assign: z.boolean().optional(),
  is_deleted: z.boolean().optional(),
  deleted_at: z.string().datetime().nullable().optional(),
});

// ─── Chat schemas ────────────────────────────────────────────────

export const SendChatMessageSchema = z.object({
  tele_user_id: z.string().uuid("tele_user_id is required"),
  message: z.string().min(1, "message is required").max(4096),
});

// ─── User schemas ────────────────────────────────────────────────

export const CreateUserSchema = z.object({
  telegram_id: z.coerce.number().int().positive("telegram_id is required"),
  username: z.string().max(255).nullable().optional(),
  first_name: z.string().max(255).nullable().optional(),
  last_name: z.string().max(255).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  status: z.enum(["active", "banned", "limited"]).optional(),
  approval_mode: z.enum(["manual", "auto"]).optional(),
  max_proxies: z.coerce.number().int().min(0).max(1000).optional(),
  rate_limit_hourly: z.coerce.number().int().min(0).max(10000).optional(),
  rate_limit_daily: z.coerce.number().int().min(0).max(100000).optional(),
  rate_limit_total: z.coerce.number().int().min(0).max(1000000).optional(),
});

export const UpdateUserSchema = z.object({
  status: z.enum(["active", "banned", "limited"]).optional(),
  approval_mode: z.enum(["manual", "auto"]).optional(),
  max_proxies: z.coerce.number().int().min(0).max(1000).optional(),
  rate_limit_hourly: z.coerce.number().int().min(0).max(10000).optional(),
  rate_limit_daily: z.coerce.number().int().min(0).max(100000).optional(),
  rate_limit_total: z.coerce.number().int().min(0).max(1000000).optional(),
  notes: z.string().max(2000).nullable().optional(),
  username: z.string().max(255).nullable().optional(),
  first_name: z.string().max(255).nullable().optional(),
  last_name: z.string().max(255).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  language: z.enum(["en", "vi"]).optional(),
  is_deleted: z.boolean().optional(),
  deleted_at: z.string().datetime().nullable().optional(),
}).refine(
  (data) => {
    // If both hourly and daily are set, hourly must be <= daily
    if (data.rate_limit_hourly !== undefined && data.rate_limit_daily !== undefined) {
      if (data.rate_limit_hourly > data.rate_limit_daily) return false;
    }
    // If both daily and total are set, daily must be <= total
    if (data.rate_limit_daily !== undefined && data.rate_limit_total !== undefined) {
      if (data.rate_limit_daily > data.rate_limit_total) return false;
    }
    return true;
  },
  { message: "Rate limits must follow hierarchy: hourly \u2264 daily \u2264 total" }
);

// ─── Category schemas (Wave 22A) ─────────────────────────────────

// Wave 22J → 22K — proxy classification: free text (admin-extensible).
// 80-char cap matches mig 038 CHECK constraint.
const NetworkTypeText = z.string().min(1).max(80);

export const CreateCategorySchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).nullable().optional(),
  color: z.string().min(1).max(30).default("purple"),
  icon: z.string().min(1).max(50).default("folder"),
  sort_order: z.coerce.number().int().min(0).max(999_999).optional(),
  default_price_usd: z.coerce.number().finite().min(0).max(1_000_000).nullable().optional(),
  min_stock_alert: z.coerce.number().int().min(0).optional(),
  // Wave 22G — rich-category defaults snapshot to new proxies in this group.
  default_country: z.string().min(2).max(64).nullable().optional(),
  default_proxy_type: z.enum(["http", "https", "socks5"]).nullable().optional(),
  default_isp: z.string().min(1).max(200).nullable().optional(),
  // Wave 22J → 22K — proxy classification default (free text).
  default_network_type: NetworkTypeText.nullable().optional(),
  // Wave 22K — purchase metadata defaults.
  default_vendor_source: z.string().min(1).max(200).nullable().optional(),
  default_purchase_price_usd: z.coerce.number().finite().min(0).max(1_000_000).nullable().optional(),
  default_sale_price_usd: z.coerce.number().finite().min(0).max(1_000_000).nullable().optional(),
});

export const UpdateCategorySchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  color: z.string().min(1).max(30).optional(),
  icon: z.string().min(1).max(50).optional(),
  sort_order: z.coerce.number().int().min(0).max(999_999).optional(),
  is_hidden: z.boolean().optional(),
  default_price_usd: z.coerce.number().finite().min(0).max(1_000_000).nullable().optional(),
  min_stock_alert: z.coerce.number().int().min(0).optional(),
  // Wave 22G — admin can edit defaults; only NEW proxies pick them up
  // (snapshot semantics — existing proxies untouched).
  default_country: z.string().min(2).max(64).nullable().optional(),
  default_proxy_type: z.enum(["http", "https", "socks5"]).nullable().optional(),
  default_isp: z.string().min(1).max(200).nullable().optional(),
  default_network_type: NetworkTypeText.nullable().optional(),
  // Wave 22K — purchase metadata defaults.
  default_vendor_source: z.string().min(1).max(200).nullable().optional(),
  default_purchase_price_usd: z.coerce.number().finite().min(0).max(1_000_000).nullable().optional(),
  default_sale_price_usd: z.coerce.number().finite().min(0).max(1_000_000).nullable().optional(),
});

export const ReorderCategoriesSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  sort_orders: z.array(z.coerce.number().int().min(0)).min(1).max(500),
}).refine((d) => d.ids.length === d.sort_orders.length, {
  message: "ids and sort_orders must have the same length",
});

export const AssignProxiesToCategorySchema = z.object({
  proxy_ids: z.array(z.string().uuid()).min(1).max(5000),
  // Wave 28 — bulk re-assign no longer accepts `null`. To "remove" a
  // category, admin must explicitly pick the "Mặc định" sentinel.
  // The `.uuid()` validator rejects null at parse time; the route
  // handler also calls `assertCategoryNotUnassigned` for a friendlier
  // Vietnamese error than Zod's stock message.
  category_id: z.string().uuid({ message: "MISSING_CATEGORY" }),
});

// ─── Settings schemas ────────────────────────────────────────────

/**
 * Wave 26-D bug hunt v2 [HIGH] — settings DoS hardening.
 *
 * Pre-fix: SettingsPutSchema accepted `settings: Record<string, unknown>`
 * with NO per-key bounds. A super_admin (or anyone who hijacked a
 * super_admin cookie via XSS) could PUT
 *   { global_max_total_requests: 999_999_999 }
 * which the route then mass-applied to every non-deleted tele_user
 * row (line 141-151 of /api/settings). That UPDATE on a 50k-user
 * table is a textbook DoS: minutes of write lock + WAL pressure +
 * realtime fanout to every subscribed dashboard.
 *
 * Defence-in-depth: bound every KNOWN integer setting at parse time.
 * Unknown keys still pass through as `unknown` (admins occasionally
 * stash one-off feature flags here), but the four mass-update keys
 * are now hard-capped at 100k each — a number high enough for any
 * legitimate operator and low enough that the worst-case mass UPDATE
 * touches at most that count of rows.
 *
 * Floor is 0 (zero is a legitimate "disable" sentinel — many code
 * paths treat 0 as unlimited or off; we don't impose a stricter
 * minimum to avoid breaking those).
 */
const KNOWN_INT_SETTING_BOUNDS: Record<string, { max: number }> = {
  global_max_proxies: { max: 100_000 },
  global_max_total_requests: { max: 100_000 },
  default_rate_limit_hourly: { max: 100_000 },
  default_rate_limit_daily: { max: 100_000 },
  default_rate_limit_total: { max: 100_000 },
  default_max_proxies: { max: 100_000 },
  warranty_window_hours: { max: 24 * 30 }, // max 30-day warranty window
  warranty_max_claims_per_24h: { max: 1_000 },
  warranty_min_account_age_days: { max: 365 },
};

export const UpdateSettingsSchema = z.object({
  action: z.literal("update_settings"),
  settings: z
    .record(z.string(), z.unknown())
    .refine((s) => Object.keys(s).length > 0, "settings must not be empty")
    .refine(
      (s) => {
        // Validate known integer settings have safe bounds.
        for (const [key, bounds] of Object.entries(KNOWN_INT_SETTING_BOUNDS)) {
          if (s[key] === undefined || s[key] === null) continue;
          const raw = s[key];
          // Coerce to number — accept "42" too (the form serialises
          // numeric inputs as strings sometimes).
          const n = typeof raw === "number" ? raw : Number(raw);
          if (!Number.isFinite(n)) return false;
          if (!Number.isInteger(n)) return false;
          if (n < 0) return false;
          if (n > bounds.max) return false;
        }
        return true;
      },
      {
        message: `One or more numeric settings are out of bounds. Valid range: 0..${100_000} for limits / counts.`,
      },
    ),
  applyToExisting: z.boolean().optional(),
});

export const UpdateAdminRoleSchema = z.object({
  action: z.literal("update_admin_role"),
  adminId: z.string().uuid("adminId is required"),
  role: z.enum(["super_admin", "admin", "viewer"]),
});

export const ToggleAdminActiveSchema = z.object({
  action: z.literal("toggle_admin_active"),
  adminId: z.string().uuid("adminId is required"),
  is_active: z.boolean(),
});

export const TestBotConnectionSchema = z.object({
  action: z.literal("test_bot_connection"),
});

export const SettingsPutSchema = z.discriminatedUnion("action", [
  UpdateSettingsSchema,
  UpdateAdminRoleSchema,
  ToggleAdminActiveSchema,
  TestBotConnectionSchema,
]);

export const InviteAdminSchema = z.object({
  action: z.literal("invite_admin"),
  email: z.string().email("Valid email is required").max(255),
  role: z.enum(["super_admin", "admin", "viewer"]).optional(),
});

export const SettingsPostSchema = z.discriminatedUnion("action", [
  InviteAdminSchema,
]);
