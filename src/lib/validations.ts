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
  username: z.string().max(255).nullable().optional(),
  password: z.string().max(255).nullable().optional(),
  country: z.string().max(100).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  isp: z.string().max(255).nullable().optional(),
  // Wave 22C: tags removed in favour of category_id (Wave 22A).
  notes: z.string().max(1000).nullable().optional(),
  expires_at: z.string().datetime().nullable().optional(),
});

export const UpdateProxySchema = z.object({
  host: z.string().min(1).max(255).refine(publicHostLiteral, publicHostMessage).optional(),
  port: z.coerce.number().int().min(1).max(65535).optional(),
  type: z.enum(["http", "https", "socks5"]).optional(),
  username: z.string().max(255).nullable().optional(),
  password: z.string().max(255).nullable().optional(),
  country: z.string().max(100).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  isp: z.string().max(255).nullable().optional(),
  status: z.enum(["available", "assigned", "maintenance"]).optional(),
  // Wave 22C: tags removed in favour of category_id (Wave 22A).
  notes: z.string().max(1000).nullable().optional(),
  expires_at: z.string().datetime().nullable().optional(),
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
  line: z.number().int().optional(),
  raw: z.string().optional(),
});

export const ImportProxiesSchema = z.object({
  proxies: z.array(ImportProxyRowSchema).min(1, "proxies array must not be empty").max(10000, "Maximum 10,000 proxies per import"),
  type: z.enum(["http", "https", "socks5"]).optional(),
  country: z.string().max(100).optional(),
  // Wave 22C: tags removed in favour of category_id (Wave 22A).
  notes: z.string().max(1000).optional(),
  isp: z.string().max(255).optional(),
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

export const CreateCategorySchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).nullable().optional(),
  color: z.string().min(1).max(30).default("purple"),
  icon: z.string().min(1).max(50).default("folder"),
  sort_order: z.coerce.number().int().min(0).max(999_999).optional(),
  default_price_usd: z.coerce.number().min(0).max(1_000_000).nullable().optional(),
  min_stock_alert: z.coerce.number().int().min(0).optional(),
  // Wave 22G — rich-category defaults snapshot to new proxies in this group.
  default_country: z.string().min(2).max(64).nullable().optional(),
  default_proxy_type: z.enum(["http", "https", "socks5"]).nullable().optional(),
  default_isp: z.string().min(1).max(200).nullable().optional(),
});

export const UpdateCategorySchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  color: z.string().min(1).max(30).optional(),
  icon: z.string().min(1).max(50).optional(),
  sort_order: z.coerce.number().int().min(0).max(999_999).optional(),
  is_hidden: z.boolean().optional(),
  default_price_usd: z.coerce.number().min(0).max(1_000_000).nullable().optional(),
  min_stock_alert: z.coerce.number().int().min(0).optional(),
  // Wave 22G — admin can edit defaults; only NEW proxies pick them up
  // (snapshot semantics — existing proxies untouched).
  default_country: z.string().min(2).max(64).nullable().optional(),
  default_proxy_type: z.enum(["http", "https", "socks5"]).nullable().optional(),
  default_isp: z.string().min(1).max(200).nullable().optional(),
});

export const ReorderCategoriesSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  sort_orders: z.array(z.coerce.number().int().min(0)).min(1).max(500),
}).refine((d) => d.ids.length === d.sort_orders.length, {
  message: "ids and sort_orders must have the same length",
});

export const AssignProxiesToCategorySchema = z.object({
  proxy_ids: z.array(z.string().uuid()).min(1).max(5000),
  category_id: z.string().uuid().nullable(),
});

// ─── Settings schemas ────────────────────────────────────────────

export const UpdateSettingsSchema = z.object({
  action: z.literal("update_settings"),
  settings: z.record(z.string(), z.unknown()).refine((s) => Object.keys(s).length > 0, "settings must not be empty"),
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
