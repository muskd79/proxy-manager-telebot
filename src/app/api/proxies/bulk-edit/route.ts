import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAdminOrAbove } from "@/lib/auth";
import { logActivity } from "@/lib/logger";
import { assertSameOrigin } from "@/lib/csrf";
import { z } from "zod";
import { proxyMachine } from "@/lib/state-machine/proxy";
import { ProxyStatus } from "@/types/database";

/**
 * POST /api/proxies/bulk-edit
 *
 * Replaces the per-row PUT loop in src/components/proxies/proxy-bulk-edit.tsx
 * (was N sequential HTTP calls = 30s for 1000 rows). Single SQL UPDATE
 * with WHERE id = ANY($1) finishes in milliseconds at 10k scale.
 *
 * Supported updates (all optional, any combination):
 *   - status:        new status; ALL selected rows must currently be in a
 *                    state that legally transitions to the target per
 *                    proxyMachine. If even one row's transition is invalid
 *                    the whole bulk fails (atomic).
 *   - extend_expiry_days: adds N days to expires_at (NULL becomes
 *                    `now + N days`).
 *   - tags_add / tags_remove: array merge / difference; uses
 *                    array_append / array_remove inside an SQL UPDATE.
 *   - notes:         overwrite. (No partial-merge semantics; admin can
 *                    paste the new full text.)
 *   - is_deleted:    soft-delete or restore.
 *
 * Body shape:
 *   { ids: string[] (max 5000),  -- the rows to update
 *     updates: { status?, extend_expiry_days?, tags_add?, tags_remove?,
 *                notes?, is_deleted? } }
 *
 * Idempotency: client may resubmit. The status-machine guard rejects an
 * already-applied transition (e.g. banned -> banned passes; banned ->
 * available fails). Tag merges are idempotent by definition.
 *
 * Audit: emits ONE activity_logs entry per bulk action with the count
 * + updates applied + filter keys (so audit table stays compact at scale).
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

    // 1. Status-machine guard: fetch current statuses for all rows and
    //    verify every transition is legal before issuing the UPDATE.
    if (updates.status) {
      const { data: rows, error } = await supabaseAdmin
        .from("proxies")
        .select("id, status")
        .in("id", ids);
      if (error || !rows) {
        return NextResponse.json(
          { success: false, error: "Failed to load current statuses" },
          { status: 500 },
        );
      }
      const invalidTransitions = rows
        .filter((r) => r.status !== updates.status)
        .filter(
          (r) =>
            !proxyMachine.canTransition(
              r.status as ProxyStatus,
              updates.status as ProxyStatus,
            ),
        );
      if (invalidTransitions.length > 0) {
        return NextResponse.json(
          {
            success: false,
            error: `Bulk status change rejected: ${invalidTransitions.length} rows cannot transition to ${updates.status}`,
            invalid_count: invalidTransitions.length,
          },
          { status: 409 },
        );
      }
    }

    // 2. Build the update payload.
    //    - status, notes, is_deleted are direct sets.
    //    - extend_expiry_days needs an SQL expression — done via RPC.
    //    - tags_add / tags_remove also via RPC (array ops).
    //    For Wave 21C MVP, the simple direct sets go via supabase.from().update();
    //    expiry-extend + tag merges fall through to a SECURITY DEFINER RPC
    //    in a follow-up migration. Here we apply only the direct sets and
    //    return a clear error if expiry/tags ops are requested.
    const directUpdates: Record<string, unknown> = {};
    if (updates.status !== undefined) directUpdates.status = updates.status;
    if (updates.notes !== undefined) directUpdates.notes = updates.notes;
    if (updates.is_deleted !== undefined) {
      directUpdates.is_deleted = updates.is_deleted;
      directUpdates.deleted_at = updates.is_deleted ? new Date().toISOString() : null;
    }

    let updatedCount = 0;
    if (Object.keys(directUpdates).length > 0) {
      const { error, count } = await supabaseAdmin
        .from("proxies")
        .update(directUpdates, { count: "exact" })
        .in("id", ids);
      if (error) {
        console.error("bulk-edit update error:", error.message);
        return NextResponse.json(
          { success: false, error: "Bulk update failed" },
          { status: 500 },
        );
      }
      updatedCount = count ?? 0;
    }

    // 3. Tag + expiry ops via RPC (Wave 21C migration adds bulk_proxy_ops).
    //    Detected at the schema layer; if requested but RPC absent, return a
    //    clear actionable error rather than silently dropping.
    if (
      updates.extend_expiry_days !== undefined ||
      (updates.tags_add && updates.tags_add.length > 0) ||
      (updates.tags_remove && updates.tags_remove.length > 0)
    ) {
      const { data, error } = await supabaseAdmin.rpc("bulk_proxy_ops", {
        p_ids: ids,
        p_extend_days: updates.extend_expiry_days ?? null,
        p_tags_add: updates.tags_add ?? null,
        p_tags_remove: updates.tags_remove ?? null,
      });
      if (error) {
        console.error("bulk_proxy_ops RPC error:", error.message);
        return NextResponse.json(
          { success: false, error: "Bulk tag/expiry op failed", details: error.message },
          { status: 500 },
        );
      }
      const rpcResult = data as { updated: number } | null;
      updatedCount = Math.max(updatedCount, rpcResult?.updated ?? 0);
    }

    logActivity({
      actorType: "admin",
      actorId: admin.id,
      action: "proxy.bulk_edit",
      resourceType: "proxy",
      details: {
        count: ids.length,
        updated: updatedCount,
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
      data: { requested: ids.length, updated: updatedCount },
    });
  } catch (err) {
    console.error("bulk-edit POST unexpected:", err instanceof Error ? err.message : String(err));
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
