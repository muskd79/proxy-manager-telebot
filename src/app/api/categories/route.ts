import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { requireAnyRole, requireAdminOrAbove } from "@/lib/auth";
import { logActivity } from "@/lib/logger";
import { assertSameOrigin } from "@/lib/csrf";
import { CreateCategorySchema } from "@/lib/validations";
import type { ProxyCategory } from "@/types/database";

/**
 * GET /api/categories
 * List all proxy categories. Read-only — any role.
 * Sorted by sort_order then name.
 *
 * Query params:
 *   ?include_hidden=1 — include rows with is_hidden=true (admin filter UI)
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { error: authError } = await requireAnyRole(supabase);
  if (authError) return authError;

  const includeHidden = request.nextUrl.searchParams.get("include_hidden") === "1";

  try {
    let q = supabase
      .from("proxy_categories")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (!includeHidden) q = q.eq("is_hidden", false);

    const { data, error } = await q;
    if (error) {
      console.error("categories list error:", error.message);
      return NextResponse.json(
        { success: false, error: "Failed to list categories" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      data: (data ?? []) as ProxyCategory[],
    });
  } catch (err) {
    console.error("categories GET unexpected:", err instanceof Error ? err.message : String(err));
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/categories
 * Create a new proxy category. Admin+ only. CSRF-protected.
 *
 * Body: CreateCategorySchema (name + optional color/icon/sort_order/...)
 */
export async function POST(request: NextRequest) {
  const csrfErr = assertSameOrigin(request);
  if (csrfErr) return csrfErr;

  const supabase = await createClient();
  const { admin, error: authError } = await requireAdminOrAbove(supabase);
  if (authError) return authError;

  try {
    const body = await request.json();
    const parsed = CreateCategorySchema.safeParse(body);
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

    const { data, error } = await supabase
      .from("proxy_categories")
      .insert({
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        color: parsed.data.color ?? "purple",
        icon: parsed.data.icon ?? "tag",
        sort_order: parsed.data.sort_order ?? 0,
        default_price_usd: parsed.data.default_price_usd ?? null,
        min_stock_alert: parsed.data.min_stock_alert ?? 0,
        created_by: admin.id,
      })
      .select()
      .single();

    if (error) {
      // 23505 = unique_violation (lower(name) already exists)
      const code = (error as { code?: string }).code;
      if (code === "23505") {
        return NextResponse.json(
          { success: false, error: "A category with that name already exists" },
          { status: 409 },
        );
      }
      console.error("categories create error:", error.message);
      return NextResponse.json(
        { success: false, error: "Failed to create category" },
        { status: 500 },
      );
    }

    logActivity({
      actorType: "admin",
      actorId: admin.id,
      action: "category.create",
      resourceType: "proxy_category",
      resourceId: data.id,
      details: { name: parsed.data.name },
      ipAddress: request.headers.get("x-forwarded-for") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    }).catch((e) => console.error("category.create log failed:", e instanceof Error ? e.message : String(e)));

    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (err) {
    console.error("categories POST unexpected:", err instanceof Error ? err.message : String(err));
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
