import { z } from "zod";
import {
  ProxyType,
  ProxyStatus,
  TeleUserStatus,
  ApprovalMode,
  RequestStatus,
} from "@/types/database";

// ----------------------
// Proxy validation
// ----------------------

export const proxySchema = z.object({
  host: z
    .string()
    .min(1, "Host is required")
    .refine(
      (val) => {
        // IPv4
        const ipv4 =
          /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
        // Domain name
        const domain = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
        return ipv4.test(val) || domain.test(val);
      },
      { message: "Must be a valid IP address or domain name" }
    ),
  port: z
    .number()
    .int()
    .min(1, "Port must be at least 1")
    .max(65535, "Port must be at most 65535"),
  type: z.nativeEnum(ProxyType),
  username: z.string().nullable().optional(),
  password: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  isp: z.string().nullable().optional(),
  status: z.nativeEnum(ProxyStatus).optional(),
  speed_ms: z.number().int().positive().nullable().optional(),
  expires_at: z.string().nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  notes: z.string().nullable().optional(),
});

export type ProxyInput = z.infer<typeof proxySchema>;

// ----------------------
// Import proxy format: host:port:user:pass or host:port
// ----------------------

export const importProxySchema = z.object({
  raw: z.string().min(1, "Proxy string is required"),
  type: z.nativeEnum(ProxyType).optional(),
  country: z.string().nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
});

export function parseProxyString(
  raw: string
): { host: string; port: number; username?: string; password?: string } | null {
  const parts = raw.trim().split(":");
  if (parts.length < 2) return null;

  const host = parts[0];
  const port = parseInt(parts[1], 10);

  if (isNaN(port) || port < 1 || port > 65535) return null;

  const result: {
    host: string;
    port: number;
    username?: string;
    password?: string;
  } = { host, port };

  if (parts.length >= 4) {
    result.username = parts[2];
    result.password = parts[3];
  } else if (parts.length === 3) {
    result.username = parts[2];
  }

  return result;
}

// ----------------------
// Telegram user validation
// ----------------------

export const teleUserSchema = z.object({
  telegram_id: z.number().int().positive("Telegram ID must be positive"),
  username: z.string().nullable().optional(),
  first_name: z.string().nullable().optional(),
  last_name: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  status: z.nativeEnum(TeleUserStatus).optional(),
  approval_mode: z.nativeEnum(ApprovalMode).optional(),
  max_proxies: z.number().int().min(0).optional(),
  rate_limit_hourly: z.number().int().min(0).optional(),
  rate_limit_daily: z.number().int().min(0).optional(),
  rate_limit_total: z.number().int().min(0).optional(),
  language: z.string().min(2).max(5).optional(),
  notes: z.string().nullable().optional(),
});

export type TeleUserInput = z.infer<typeof teleUserSchema>;

// ----------------------
// Proxy request validation
// ----------------------

export const requestSchema = z.object({
  tele_user_id: z.string().uuid("Invalid user ID"),
  proxy_type: z.nativeEnum(ProxyType).nullable().optional(),
  country: z.string().nullable().optional(),
  status: z.nativeEnum(RequestStatus).optional(),
  rejected_reason: z.string().nullable().optional(),
});

export type RequestInput = z.infer<typeof requestSchema>;

// ----------------------
// Settings validation
// ----------------------

export const settingsSchema = z.object({
  key: z
    .string()
    .min(1, "Key is required")
    .regex(
      /^[a-z][a-z0-9_.]*$/,
      "Key must start with a letter and contain only lowercase letters, numbers, dots, and underscores"
    ),
  value: z.record(z.string(), z.unknown()),
  description: z.string().nullable().optional(),
});

export type SettingsInput = z.infer<typeof settingsSchema>;
