import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user?.email) {
      return NextResponse.json({ success: false }, { status: 401 });
    }

    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "unknown";

    // Update last_login_at and last_login_ip
    await supabaseAdmin
      .from("admins")
      .update({
        last_login_at: new Date().toISOString(),
        last_login_ip: ip,
      })
      .eq("email", user.email);

    // Atomically increment login_count
    const { error: rpcError } = await supabaseAdmin
      .rpc("increment_login_count" as never, { p_email: user.email } as never);
    if (rpcError) {
      console.error("Failed to increment login count:", rpcError);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Login tracking error:", error);
    // Don't fail the response - tracking is best-effort
    return NextResponse.json({ success: true });
  }
}
