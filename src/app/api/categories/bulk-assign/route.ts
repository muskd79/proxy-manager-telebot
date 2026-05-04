import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrAbove, actorLabel } from "@/lib/auth";
import { logActivity } from "@/lib/logger";
import { assertSameOrigin } from "@/lib/csrf";
import { AssignProxiesToCategorySchema } from "@/lib/validations";

/**
 * POST /api/categories/bulk-assign
 *
 * Bulk-reassign N proxies to a category. Used by the /proxies admin
 * page when admin selects rows + picks a category from a dropdown.
 * Setting category_id=null moves rows to "uncategorised".
 *
 * The trigger fn_proxy_categories_recount handles per-category counter
 * adjustments automatically.
 */
export async function POST(request: NextRequest) {
  const csrfErr = assertSameOrigin(request);
  if (csrfErr) return csrfErr;

  const supabase = await createClient();
  const { admin, error: authError } = await requireAdminOrAbove(supabase);
  if (authError) return authError;

  try {
    const body = await request.json();
    const parsed = AssignProxiesToCategorySchema.safeParse(body);
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

    // Wave 27 bug hunt v6 [debugger #2, HIGH] — use the user-scoped
    // `supabase` client (already authed via requireAdminOrAbove) so any
    // RLS policy on `proxies` or the RPC's own `is_admin()` checks
    // continue to apply. Pre-fix used `supabaseAdmin` which bypasses
    // RLS entirely — fine today but a silent foot-gun if RLS is
    // tightened later.
    const { data, error } = await supabase.rpc(
      "assign_proxies_to_category",
      {
        p_proxy_ids: parsed.data.proxy_ids,
        p_category_id: parsed.data.category_id,
      },
    );

    if (error) {
      console.error("bulk-assign RPC error:", error.message);
      return NextResponse.json(
        { success: false, error: "Bulk assign failed" },
        { status: 500 },
      );
    }

    const result = data as { ok: boolean; updated?: number; error?: string };
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error ?? "Bulk assign rejected" },
        { status: 400 },
      );
    }

    logActivity({
      actorType: "admin",
      actorId: admin.id,
      actorDisplayName: actorLabel(admin),
      action: "category.bulk_assign",
      resourceType: "proxy_category",
      resourceId: parsed.data.category_id ?? undefined,
      details: { count: parsed.data.proxy_ids.length },
      ipAddress: request.headers.get("x-forwarded-for") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    }).catch(() => {});

    return NextResponse.json({ success: true, data: { updated: result.updated } });
  } catch (err) {
    console.error("bulk-assign POST unexpected:", err instanceof Error ? err.message : String(err));
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
