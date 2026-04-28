import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAdminOrAbove, actorLabel } from "@/lib/auth";
import { logActivity } from "@/lib/logger";
import { assertSameOrigin } from "@/lib/csrf";
import { z } from "zod";
import { ProxyStatus } from "@/types/database";

/**
 * POST /api/proxies/bulk-edit
 *
 * Wave 22E-3 — atomic bulk edit via the safe_bulk_edit_proxies RPC.
 *
 * Pre-Wave-22E-3 (HIGH bug B2): the route did a 3-step pattern (SELECT
 * statuses, app-side proxyMachine guard, UPDATE). Two concurrent admins
 * could both pass the guard with different "current" statuses, then
 * both UPDATE — producing illegal final states (banned -> available
 * without going through maintenance). This was a HIGH-severity race
 * flagged by code-reviewer.
 *
 * Now: ONE RPC call. The state-machine guard runs inside the same
 * transaction as the UPDATE so concurrent edits are serialised by the
 * row locks the UPDATE acquires. Either all rows transition legally
 * or the RPC returns 409 with `invalid_count` and ZERO rows change.
 *
 * Idempotency: re-submitting the same payload after a 409 still
 * returns 409 — caller must change their request, not retry.
 */

const BulkEditSchema = z
  .object({
    ids: z.array(z.string().uuid()).min(1).max(5000),
    updates: z
      .object({
        status: z.nativeEnum(ProxyStatus).optional(),
        extend_expiry_days: z.coerce.number().int().min(-3650).max(3650).optional(),
        tags_add: z.array(z.string().max(50)).max(20).optional(),
        tags_remove: z.array(z.string().max(50)).max(20).optional(),
        notes: z.string().max(2000).nullable().optional(),
        is_deleted: z.boolean().optional(),
      })
      .strict()
      .refine(
        (u) =>
          u.status !== undefined ||
          u.extend_expiry_days !== undefined ||
          (u.tags_add && u.tags_add.length > 0) ||
          (u.tags_remove && u.tags_remove.length > 0) ||
          u.notes !== undefined ||
          u.is_deleted !== undefined,
        { message: "At least one update field is required" },
      ),
  })
  .strict();

interface BulkEditResult {
  ok: boolean;
  updated?: number;
  invalid_count?: number;
  requested_status?: string;
  error?: string;
}

export async function POST(request: NextRequest) {
  const csrfErr = assertSameOrigin(request);
  if (csrfErr) return csrfErr;

  const supabase = await createClient();
  const { admin, error: authError } = await requireAdminOrAbove(supabase);
  if (authError) return authError;

  try {
    const body = await request.json();
    const parsed = BulkEditSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Validation failed",
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }

    const { ids, updates } = parsed.data;

    // Single atomic RPC call. The guard + UPDATE happen in one DB
    // transaction so concurrent bulk edits cannot interleave.
    const { data, error } = await supabaseAdmin.rpc("safe_bulk_edit_proxies", {
      p_ids: ids,
      p_status: updates.status ?? null,
      p_is_deleted: updates.is_deleted ?? null,
      p_notes: updates.notes ?? null,
      p_extend_days: updates.extend_expiry_days ?? null,
      p_tags_add: updates.tags_add ?? null,
      p_tags_remove: updates.tags_remove ?? null,
    });

    if (error) {
      console.error("safe_bulk_edit_proxies RPC error:", error.message);
      return NextResponse.json(
        { success: false, error: "Bulk edit failed" },
        { status: 500 },
      );
    }

    const result = data as BulkEditResult;

    if (!result.ok) {
      // Status transition rejected — surface 409 with invalid_count.
      if (result.error === "invalid_status_transition") {
        return NextResponse.json(
          {
            success: false,
            error: `Bulk status change rejected: ${result.invalid_count} rows cannot transition to ${result.requested_status}`,
            invalid_count: result.invalid_count,
          },
          { status: 409 },
        );
      }
      return NextResponse.json(
        { success: false, error: result.error ?? "Bulk edit rejected" },
        { status: 400 },
      );
    }

    logActivity({
      actorType: "admin",
      actorId: admin.id,
      actorDisplayName: actorLabel(admin),
      action: "proxy.bulk_edit",
      resourceType: "proxy",
      details: {
        count: ids.length,
        updated: result.updated,
        updates,
      },
      ipAddress: request.headers.get("x-forwarded-for") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    }).catch((e) =>
      console.error(
        "proxy.bulk_edit log failed:",
        e instanceof Error ? e.message : String(e),
      ),
    );

    return NextResponse.json({
      success: true,
      data: { requested: ids.length, updated: result.updated ?? 0 },
    });
  } catch (err) {
    console.error("bulk-edit POST unexpected:", err instanceof Error ? err.message : String(err));
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
