import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrAbove, actorLabel } from "@/lib/auth";
import { logActivity } from "@/lib/logger";
import { assertSameOrigin } from "@/lib/csrf";
import { ReorderCategoriesSchema } from "@/lib/validations";

/**
 * POST /api/categories/reorder
 *
 * Atomic drag-reorder for the categories list. Body:
 *   { ids: UUID[], sort_orders: number[] } — same length, ids[i] gets sort_orders[i].
 *
 * Calls the SECURITY DEFINER RPC `reorder_proxy_categories_atomic` which
 * does all updates in one transaction. Without atomicity, a mid-flight
 * failure would leave the categories list in a half-reordered state.
 */
export async function POST(request: NextRequest) {
  const csrfErr = assertSameOrigin(request);
  if (csrfErr) return csrfErr;

  const supabase = await createClient();
  const { admin, error: authError } = await requireAdminOrAbove(supabase);
  if (authError) return authError;

  try {
    const body = await request.json();
    const parsed = ReorderCategoriesSchema.safeParse(body);
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

    const { data, error } = await supabaseAdmin.rpc(
      "reorder_proxy_categories_atomic",
      {
        p_category_ids: parsed.data.ids,
        p_sort_orders: parsed.data.sort_orders,
      },
    );
    if (error) {
      console.error("reorder RPC error:", error.message);
      return NextResponse.json(
        { success: false, error: "Reorder failed" },
        { status: 500 },
      );
    }

    const result = data as { ok: boolean; updated?: number; error?: string };
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error ?? "Reorder rejected" },
        { status: 400 },
      );
    }

    logActivity({
      actorType: "admin",
      actorId: admin.id,
      actorDisplayName: actorLabel(admin),
      action: "category.reorder",
      resourceType: "proxy_category",
      details: { count: parsed.data.ids.length },
      ipAddress: request.headers.get("x-forwarded-for") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    }).catch(() => {});

    return NextResponse.json({ success: true, data: { updated: result.updated } });
  } catch (err) {
    console.error("reorder POST unexpected:", err instanceof Error ? err.message : String(err));
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
