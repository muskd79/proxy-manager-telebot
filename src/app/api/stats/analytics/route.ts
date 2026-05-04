import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { requireAnyRole } from "@/lib/auth";

interface AnalyticsRow {
  date: string;
  [key: string]: unknown;
}

// Wave 27 bug hunt v8 [debugger #5, MEDIUM] — locale-safe formatter.
// Pre-fix: `toLocaleDateString("en-US", …)` silently falls back to the
// runtime's default locale on Node builds without full ICU (the slim
// `node:full-icu` dataset isn't bundled on every Vercel runtime). Output
// drifts to host locale → dashboard chart axes show non-English labels.
// `Intl.DateTimeFormat` constructor throws on missing locale data, which
// we can detect and degrade to ISO `YYYY-MM-DD` instead of corrupting
// the chart silently.
function buildDateFormatter(): (iso: string) => string {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
    });
    return (iso: string) => fmt.format(new Date(iso));
  } catch {
    // ICU data missing — degrade to ISO. Better than silent drift.
    return (iso: string) => iso.slice(0, 10);
  }
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { admin, error: authError } = await requireAnyRole(supabase);
  if (authError) return authError;

  try {
    const { data, error } = await supabase.rpc("get_analytics", { p_days: 14 });
    if (error) throw error;

    const formatDate = buildDateFormatter();

    // Format dates for display
    const formatted = ((data ?? []) as AnalyticsRow[]).map((d) => ({
      ...d,
      date: formatDate(d.date),
    }));

    return NextResponse.json(
      { success: true, data: formatted },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
        },
      }
    );
  } catch (error) {
    console.error("Analytics error:", error);
    return NextResponse.json({ success: false, error: "Failed to fetch analytics" }, { status: 500 });
  }
}
