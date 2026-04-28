/**
 * Shared types + Zod schema for the lot-import API payload.
 *
 * Used by both:
 *   - the import wizard client (validates before POST)
 *   - the API route (validates incoming body)
 *   - the import_lot RPC (matches the JSONB shape it expects)
 *
 * Keep this file dependency-light so the wizard client doesn't pull
 * server-only modules.
 */

import { z } from "zod";
import { validatePublicHostLiteral } from "@/lib/security/public-ip";

const publicHostLiteral = (s: string) => validatePublicHostLiteral(s) === null;

const UUID_V7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const ProxyImportRowSchema = z.object({
  host: z
    .string()
    .min(1)
    .max(253)
    .refine(publicHostLiteral, "Host resolves to private/reserved address"),
  port: z.coerce.number().int().min(1).max(65535),
  type: z.enum(["http", "https", "socks5"]).default("http"),
  username: z.string().max(255).optional().nullable(),
  password: z.string().max(255).optional().nullable(),
  country: z.string().max(100).optional().nullable(),
  isp: z.string().max(255).optional().nullable(),
  // Wave 22C: tags removed in favour of category_id (Wave 22A).
  notes: z.string().max(1000).optional().nullable(),
  /** Per-row override; falls back to lot.expiry_date in the RPC. */
  expires_at: z.string().datetime().optional().nullable(),
});

export const LotMetadataSchema = z
  .object({
    vendor_label: z
      .string()
      .min(1, "vendor_label is required")
      .max(120),
    purchase_date: z.string().datetime().optional(),
    expiry_date: z.string().datetime().optional().nullable(),
    total_cost_usd: z.coerce.number().min(0).max(1_000_000).optional().nullable(),
    currency: z
      .string()
      .length(3, "currency must be ISO 4217 alpha-3")
      .default("USD")
      .optional(),
    source_file_name: z.string().max(255).optional().nullable(),
    batch_reference: z.string().max(120).optional().nullable(),
    notes: z.string().max(2000).optional().nullable(),
  })
  .strict();

export const ImportLotPayloadSchema = z
  .object({
    idempotency_key: z
      .string()
      .regex(UUID_V7_RE, "idempotency_key must be UUIDv7"),
    lot: LotMetadataSchema,
    proxies: z
      .array(ProxyImportRowSchema)
      .min(1, "Must import at least 1 proxy")
      .max(1000, "Maximum 1000 proxies per import"),
  })
  .strict();

export type ProxyImportRow = z.infer<typeof ProxyImportRowSchema>;
export type LotMetadata = z.infer<typeof LotMetadataSchema>;
export type ImportLotPayload = z.infer<typeof ImportLotPayloadSchema>;

export interface ImportLotResult {
  success: true;
  deduplicated: boolean;
  lot_id: string;
  inserted_proxies: number;
  updated_proxies: number;
  total_proxies: number;
}
