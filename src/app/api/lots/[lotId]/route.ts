import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { requireAnyRole } from "@/lib/auth";

/**
 * GET /api/lots/[lotId]
 * Single lot summary + first 50 proxies for the detail card.
 * Read-only — any role.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ lotId: string }> },
) {
  const supabase = await createClient();
  const { error: authError } = await requireAnyRole(supabase);
  if (authError) return authError;

  const { lotId } = await params;

  try {
    const { data: lot, error: lotErr } = await supabase
      .from("purchase_lots")
      .select("*")
      .eq("id", lotId)
      .single();

    if (lotErr || !lot) {
      return NextResponse.json(
        { success: false, error: "Lot not found" },
        { status: 404 },
      );
    }

    const { data: proxies, count } = await supabase
      .from("proxies")
      .select(
        "id, host, port, type, country, status, expires_at, speed_ms, last_check_status, distribute_count, assigned_to",
        { count: "estimated" },
      )
      .eq("purchase_lot_id", lotId)
      .eq("is_deleted", false)
      .order("expires_at", { ascending: true, nullsFirst: false })
      .limit(50);

    return NextResponse.json({
      success: true,
      data: {
        lot,
        proxies: proxies ?? [],
        proxy_total: count ?? 0,
      },
    });
  } catch (err) {
    console.error("lot detail GET unexpected:", err instanceof Error ? err.message : String(err));
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
