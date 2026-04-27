import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { requireAnyRole, requireAdminOrAbove } from "@/lib/auth";
import { logActivity } from "@/lib/logger";
import { assertSameOrigin } from "@/lib/csrf";
import { UpdateCategorySchema } from "@/lib/validations";

/**
 * GET /api/categories/[id]
 * Single category. Read-only — any role.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { error: authError } = await requireAnyRole(supabase);
  if (authError) return authError;

  const { id } = await params;

  const { data, error } = await supabase
    .from("proxy_categories")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json(
      { success: false, error: "Category not found" },
      { status: 404 },
    );
  }
  return NextResponse.json({ success: true, data });
}

/**
 * PATCH /api/categories/[id]
 * Update a category. Admin+ only. CSRF-protected.
 *
 * Note: changing `proxy_count` is rejected — that field is trigger-
 * maintained from proxies inserts/updates/deletes.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrfErr = assertSameOrigin(request);
  if (csrfErr) return csrfErr;

  const supabase = await createClient();
  const { admin, error: authError } = await requireAdminOrAbove(supabase);
  if (authError) return authError;

  const { id } = await params;

  try {
    const body = await request.json();
    const parsed = UpdateCategorySchema.safeParse(body);
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
      .update(parsed.data)
      .eq("id", id)
      .select()
      .single();

    if (error || !data) {
      const code = (error as { code?: string } | null)?.code;
      if (code === "23505") {
        return NextResponse.json(
          { success: false, error: "A category with that name already exists" },
          { status: 409 },
        );
      }
      return NextResponse.json(
        { success: false, error: "Category not found" },
        { status: 404 },
      );
    }

    logActivity({
      actorType: "admin",
      actorId: admin.id,
      action: "category.update",
      resourceType: "proxy_category",
      resourceId: id,
      details: { fields: Object.keys(parsed.data) },
      ipAddress: request.headers.get("x-forwarded-for") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    }).catch(() => {});

    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error("category PATCH unexpected:", err instanceof Error ? err.message : String(err));
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/categories/[id]
 * Delete a category. Admin+ only. CSRF-protected.
 *
 * Side effects: proxies.category_id → NULL on every proxy in this
 * category (FK has ON DELETE SET NULL). Trigger-recount handles the
 * counter cleanup automatically.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrfErr = assertSameOrigin(request);
  if (csrfErr) return csrfErr;

  const supabase = await createClient();
  const { admin, error: authError } = await requireAdminOrAbove(supabase);
  if (authError) return authError;

  const { id } = await params;

  const { error } = await supabase
    .from("proxy_categories")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json(
      { success: false, error: "Failed to delete category" },
      { status: 500 },
    );
  }

  logActivity({
    actorType: "admin",
    actorId: admin.id,
    action: "category.delete",
    resourceType: "proxy_category",
    resourceId: id,
    ipAddress: request.headers.get("x-forwarded-for") || undefined,
    userAgent: request.headers.get("user-agent") || undefined,
  }).catch(() => {});

  return NextResponse.json({ success: true });
}
