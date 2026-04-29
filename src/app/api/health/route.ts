import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireAnyRole } from "@/lib/auth";

/**
 * Wave 23A — minimal-by-default health check.
 *
 * Pre-fix: this endpoint was unauthenticated and exposed DB connectivity
 * status to anyone. Useful for uptime monitors but also lets attackers
 * confirm the DB layer is reachable when probing.
 *
 * Post-fix: unauthenticated callers see only `{ status: "ok" }` (enough
 * for load-balancer probes). Authenticated admins see the full
 * service-status block as before.
 */
export async function GET(_request: NextRequest) {
  const supabase = await createClient();
  const { error: authError } = await requireAnyRole(supabase);
  const isAdmin = !authError;

  try {
    const { error } = await supabaseAdmin.from("settings").select("key").limit(1);

    if (!isAdmin) {
      return NextResponse.json({
        status: error ? "degraded" : "ok",
      });
    }

    return NextResponse.json({
      status: error ? "degraded" : "healthy",
      timestamp: new Date().toISOString(),
      services: {
        database: error ? "error" : "ok",
      },
    });
  } catch {
    return NextResponse.json(
      isAdmin
        ? { status: "unhealthy", timestamp: new Date().toISOString() }
        : { status: "unhealthy" },
      { status: 503 }
    );
  }
}
