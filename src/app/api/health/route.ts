import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function GET() {
  try {
    // Check Supabase connectivity
    const { error } = await supabaseAdmin.from("settings").select("key").limit(1);

    return NextResponse.json({
      status: error ? "degraded" : "healthy",
      timestamp: new Date().toISOString(),
      services: {
        database: error ? "error" : "ok",
      },
    });
  } catch {
    return NextResponse.json(
      { status: "unhealthy", timestamp: new Date().toISOString() },
      { status: 503 }
    );
  }
}
