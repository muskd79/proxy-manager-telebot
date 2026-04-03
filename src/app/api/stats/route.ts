import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { requireAnyRole } from "@/lib/auth";

let statsCache: { data: unknown; timestamp: number } | null = null;
const CACHE_TTL = 30_000; // 30 seconds

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { admin, error: authError } = await requireAnyRole(supabase);
  if (authError) return authError;

  // Return cached if fresh
  if (statsCache && Date.now() - statsCache.timestamp < CACHE_TTL) {
    return NextResponse.json({ success: true, data: statsCache.data });
  }

  try {
    const { data, error } = await supabase.rpc("get_dashboard_stats");
    if (error) throw error;

    statsCache = { data, timestamp: Date.now() };
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("Stats error:", error);
    return NextResponse.json({ success: false, error: "Failed to fetch stats" }, { status: 500 });
  }
}
