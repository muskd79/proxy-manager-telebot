/**
 * Wave 26-D-2 — zod schemas for the warranty API surface.
 *
 * Kept in a dedicated file so /api/warranty routes + the bot can
 * import the same shapes without dragging the full src/lib/validations.ts
 * (which is already 250+ lines).
 */

import { z } from "zod";

export const WARRANTY_REASON_CODES = [
  "no_connect",
  "slow",
  "ip_blocked",
  "wrong_country",
  "auth_fail",
  "other",
] as const;

/**
 * POST /api/warranty body — bot submits a new claim on a user's behalf.
 *
 * `reason_text` is required when `reason_code === "other"` (CHECK
 * constraint warranty_other_requires_text in mig 057). We mirror it
 * here so the API returns 400 with a clean error instead of letting
 * Postgres reject the insert.
 *
 * Wave 26-D bug hunt v2 [MEDIUM] — `user_id` was previously pulled
 * out of the raw request body in the route handler with manual UUID
 * validation. Moving it into the schema makes the wire contract
 * explicit + reuses zod's UUID checker (matching what we do for
 * proxy_id). The route still verifies the user exists in tele_users
 * (defence-in-depth — schema validates SHAPE, route validates
 * REFERENCE).
 */
export const CreateWarrantyClaimSchema = z
  .object({
    proxy_id: z.string().uuid("proxy_id phải là UUID"),
    user_id: z.string().uuid("user_id phải là UUID"),
    reason_code: z.enum(WARRANTY_REASON_CODES),
    reason_text: z.string().max(2000).optional().nullable(),
  })
  .refine(
    (data) =>
      data.reason_code !== "other" ||
      (data.reason_text != null && data.reason_text.trim().length > 0),
    {
      message: "reason_text bắt buộc khi reason_code = 'other'",
      path: ["reason_text"],
    },
  );

export type CreateWarrantyClaimInput = z.infer<typeof CreateWarrantyClaimSchema>;

/**
 * PATCH /api/warranty/[id] body — admin approves OR rejects a claim.
 *
 * Two valid shapes:
 *   - { action: "approve", also_mark_banned?: boolean }
 *   - { action: "reject", rejection_reason: string }
 *
 * `also_mark_banned` (A7=b) — when true, the original proxy gets
 * `status='banned'` directly instead of `maintenance`. Default false.
 */
export const ApproveWarrantyClaimSchema = z.object({
  action: z.literal("approve"),
  also_mark_banned: z.boolean().optional().default(false),
});

export const RejectWarrantyClaimSchema = z.object({
  action: z.literal("reject"),
  rejection_reason: z
    .string()
    .min(1, "Bắt buộc nhập lý do từ chối")
    .max(2000),
});

export const UpdateWarrantyClaimSchema = z.discriminatedUnion("action", [
  ApproveWarrantyClaimSchema,
  RejectWarrantyClaimSchema,
]);

export type UpdateWarrantyClaimInput = z.infer<typeof UpdateWarrantyClaimSchema>;
