/**
 * Wave 27 — GET /api/categories/dashboard
 *
 * Returns the rich per-category breakdown used by the card grid:
 * status counts, live/die sub-breakdowns (6h TTL), money totals.
 *
 * Single RPC call delegated to `lib/categories/repository.ts` so the
 * route file stays a thin auth-then-delegate shim. No business logic
 * here.
 *
 * Auth: requireAnyRole — any authenticated admin (super_admin/admin/
 * viewer) can read this. Viewer role STILL sees the data — the cards
 * are read-only inventory views, not credentials. Sensitive
 * passwords are not in this RPC's output.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAnyRole } from "@/lib/auth";
import { getCategoryDashboard } from "@/lib/categories/repository";
import { captureError } from "@/lib/error-tracking";
import type { ApiResponse } from "@/types/api";
import type { CategoryDashboardRow } from "@/lib/categories/types";

export async function GET() {
  const supabase = await createClient();
  const { error: authError } = await requireAnyRole(supabase);
  if (authError) return authError;

  try {
    const { data, error } = await getCategoryDashboard(supabase);
    if (error) {
      captureError(new Error(error.message), {
        source: "api.categories.dashboard.rpc",
        extra: { code: error.code },
      });
      return NextResponse.json(
        {
          success: false,
          error: "Failed to load category dashboard",
        } satisfies ApiResponse<never>,
        { status: 500 },
      );
    }
    return NextResponse.json(
      {
        success: true,
        data: data ?? [],
      } satisfies ApiResponse<CategoryDashboardRow[]>,
    );
  } catch (err) {
    captureError(err, { source: "api.categories.dashboard.unexpected" });
    return NextResponse.json(
      { success: false, error: "Internal server error" } satisfies ApiResponse<never>,
      { status: 500 },
    );
  }
}
