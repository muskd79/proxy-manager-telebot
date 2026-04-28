import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import { requireAnyRole } from "@/lib/auth";

/**
 * Wave 22G — GET /api/categories/[id]/defaults
 *
 * Tiny endpoint returning ONLY the snapshot-prefill triple:
 *   { default_price_usd, default_country, default_proxy_type, default_isp }
 *
 * Used by the proxy create form when admin picks a category — the
 * form prefills the proxy's price/country/type/isp from these
 * defaults. Snapshot semantics: the prefill happens client-side,
 * resulting proxy stores its own values; future category edits
 * don't retroactively change existing proxies.
 *
 * Why a separate endpoint instead of reading from the categories
 * list?
 *   - The list page already loads ~50 categories on mount.
 *   - But the proxy create form might run before the list is
 *     cached (e.g., direct navigation to /proxies/new).
 *   - Cheaper to ship a 4-field response than re-fetch the full
 *     category row.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { error: authError } = await requireAnyRole(supabase);
  if (authError) return authError;

  const { id } = await params;

  const { data, error } = await supabaseAdmin
    .from("proxy_categories")
    .select(
      "id, name, default_price_usd, default_country, default_proxy_type, default_isp, is_hidden",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json(
      { success: false, error: "Category not found" },
      { status: 404 },
    );
  }

  return NextResponse.json({
    success: true,
    data: {
      id: data.id,
      name: data.name,
      default_price_usd: data.default_price_usd,
      default_country: data.default_country,
      default_proxy_type: data.default_proxy_type,
      default_isp: data.default_isp,
      is_hidden: data.is_hidden,
    },
  });
}
