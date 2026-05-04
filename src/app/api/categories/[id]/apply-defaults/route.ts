/**
 * Wave 27 — POST /api/categories/[id]/apply-defaults
 *
 * Admin-driven retroactive backfill of category defaults onto
 * existing proxies in the category.
 *
 * Body: `{ mode: "only_null" | "force" }`
 *   - `only_null` — fill blank fields only, never overwrite admin's
 *     manual edits. Safe.
 *   - `force` — overwrite EVERY proxy in the category. Destructive;
 *     UI must show a confirm dialog with affected count.
 *
 * The RPC `apply_category_defaults_retroactively` does the heavy
 * lifting + writes an audit log entry. Returns affected row count.
 *
 * Auth: requireAdminOrAbove (NOT viewer). Mutation endpoint.
 * CSRF: assertSameOrigin.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireAdminOrAbove } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/csrf";
import { captureError } from "@/lib/error-tracking";
import { isUuid } from "@/lib/uuid";
import { applyCategoryDefaultsRetroactively } from "@/lib/categories/repository";
import type { ApiResponse } from "@/types/api";

const ApplyDefaultsSchema = z.object({
  mode: z.enum(["only_null", "force"]),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrfErr = assertSameOrigin(request);
  if (csrfErr) return csrfErr;

  const supabase = await createClient();
  const { error: authError } = await requireAdminOrAbove(supabase);
  if (authError) return authError;

  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json(
      { success: false, error: "Invalid category id" } satisfies ApiResponse<never>,
      { status: 400 },
    );
  }

  try {
    const body = await request.json();
    const parsed = ApplyDefaultsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Validation failed",
          message: parsed.error.issues.map((i) => i.message).join("; "),
        } satisfies ApiResponse<never>,
        { status: 400 },
      );
    }

    const { data, error } = await applyCategoryDefaultsRetroactively(supabase, {
      categoryId: id,
      mode: parsed.data.mode,
    });

    if (error) {
      // Discriminate forbidden / not-found vs generic
      if (error.message === "category_not_found") {
        return NextResponse.json(
          { success: false, error: "Category not found" } satisfies ApiResponse<never>,
          { status: 404 },
        );
      }
      if (error.message === "forbidden") {
        return NextResponse.json(
          { success: false, error: "Forbidden" } satisfies ApiResponse<never>,
          { status: 403 },
        );
      }
      captureError(new Error(error.message), {
        source: "api.categories.apply_defaults.rpc",
        extra: { categoryId: id, code: error.code },
      });
      return NextResponse.json(
        {
          success: false,
          error: "Failed to apply defaults",
        } satisfies ApiResponse<never>,
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        success: true,
        data,
        message:
          parsed.data.mode === "only_null"
            ? `Đã áp dụng default cho ${data?.affected ?? 0} proxy chưa có giá trị.`
            : `Đã ghi đè default cho ${data?.affected ?? 0} proxy.`,
      } satisfies ApiResponse<typeof data> & { message: string },
    );
  } catch (err) {
    captureError(err, {
      source: "api.categories.apply_defaults.unexpected",
      extra: { categoryId: id },
    });
    return NextResponse.json(
      { success: false, error: "Internal server error" } satisfies ApiResponse<never>,
      { status: 500 },
    );
  }
}
