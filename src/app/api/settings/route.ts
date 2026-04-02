import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { admin, error: authError } = await requireSuperAdmin(supabase);
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type");

    if (type === "admins") {
      // List all admins
      const { data, error } = await supabase
        .from("admins")
        .select("*")
        .order("created_at", { ascending: true });

      if (error) throw error;
      return NextResponse.json({ success: true, data });
    }

    // List all settings
    const { data, error } = await supabase
      .from("settings")
      .select("*")
      .order("key", { ascending: true });

    if (error) throw error;
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("Settings fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch settings" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const { admin, error: authError } = await requireSuperAdmin(supabase);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { action } = body;

    if (action === "update_settings") {
      const { settings } = body as {
        settings: Record<string, unknown>;
      };

      // Upsert each setting
      for (const [key, value] of Object.entries(settings)) {
        await supabase.from("settings").upsert(
          {
            key,
            value: { value } as Record<string, unknown>,
            updated_by: admin.id,
          },
          { onConflict: "key" }
        );
      }

      return NextResponse.json({ success: true });
    }

    if (action === "update_admin_role") {
      const { adminId, role } = body;
      const { error } = await supabase
        .from("admins")
        .update({ role, updated_at: new Date().toISOString() })
        .eq("id", adminId);

      if (error) throw error;
      return NextResponse.json({ success: true });
    }

    if (action === "toggle_admin_active") {
      const { adminId, is_active } = body;
      const { error } = await supabase
        .from("admins")
        .update({ is_active, updated_at: new Date().toISOString() })
        .eq("id", adminId);

      if (error) throw error;
      return NextResponse.json({ success: true });
    }

    if (action === "test_bot_connection") {
      try {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (!token) {
          return NextResponse.json({
            success: true,
            connected: false,
            error: "Bot token not configured",
          });
        }

        const res = await fetch(
          `https://api.telegram.org/bot${token}/getMe`
        );
        const result = await res.json();

        return NextResponse.json({
          success: true,
          connected: result.ok === true,
          bot: result.ok ? result.result : null,
        });
      } catch {
        return NextResponse.json({
          success: true,
          connected: false,
        });
      }
    }

    return NextResponse.json(
      { error: "Unknown action" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Settings update error:", error);
    return NextResponse.json(
      { error: "Failed to update settings" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { admin, error: authError } = await requireSuperAdmin(supabase);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { action } = body;

    if (action === "invite_admin") {
      const { email, role } = body;

      // Check if admin already exists
      const { data: existing } = await supabase
        .from("admins")
        .select("id")
        .eq("email", email)
        .single();

      if (existing) {
        return NextResponse.json(
          { error: "Admin with this email already exists" },
          { status: 400 }
        );
      }

      // Create admin record (auth user will be created on first login)
      const { error } = await supabase.from("admins").insert({
        email,
        role: role || "admin",
        is_active: true,
        language: "en",
        full_name: null,
      });

      if (error) throw error;

      return NextResponse.json({ success: true }, { status: 201 });
    }

    return NextResponse.json(
      { error: "Unknown action" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Settings POST error:", error);
    return NextResponse.json(
      { error: "Failed to process request" },
      { status: 500 }
    );
  }
}
