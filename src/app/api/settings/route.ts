import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth";
import { logActivity } from "@/lib/logger";
import { SettingsPutSchema, SettingsPostSchema } from "@/lib/validations";

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
      { success: false, error: "Failed to fetch settings" },
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
    const parsed = SettingsPutSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { action } = parsed.data;

    if (action === "update_settings") {
      const { settings, applyToExisting } = parsed.data;

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

      // Bulk-update all existing non-deleted users with current defaults
      if (applyToExisting) {
        const updatePayload: Record<string, unknown> = {};
        if (settings.default_rate_limit_hourly !== undefined) {
          updatePayload.rate_limit_hourly = Number(settings.default_rate_limit_hourly);
        }
        if (settings.default_rate_limit_daily !== undefined) {
          updatePayload.rate_limit_daily = Number(settings.default_rate_limit_daily);
        }
        if (settings.default_rate_limit_total !== undefined) {
          updatePayload.rate_limit_total = Number(settings.default_rate_limit_total);
        }
        if (settings.global_max_proxies !== undefined) {
          updatePayload.max_proxies = Number(settings.global_max_proxies);
        } else if (settings.default_max_proxies !== undefined) {
          updatePayload.max_proxies = Number(settings.default_max_proxies);
        }
        if (settings.default_approval_mode !== undefined) {
          updatePayload.approval_mode = String(settings.default_approval_mode);
        }

        if (Object.keys(updatePayload).length > 0) {
          await supabase
            .from("tele_users")
            .update(updatePayload)
            .eq("is_deleted", false);
        }
      }

      logActivity({
        actorType: "admin",
        actorId: admin.id,
        action: "settings.update",
        resourceType: "settings",
        details: { keys: Object.keys(settings), applyToExisting: !!applyToExisting },
        ipAddress: request.headers.get("x-forwarded-for") || undefined,
        userAgent: request.headers.get("user-agent") || undefined,
      }).catch(console.error);

      return NextResponse.json({ success: true });
    }

    if (action === "update_admin_role") {
      const { adminId, role } = parsed.data;
      const { error } = await supabase
        .from("admins")
        .update({ role, updated_at: new Date().toISOString() })
        .eq("id", adminId);

      if (error) throw error;
      return NextResponse.json({ success: true });
    }

    if (action === "toggle_admin_active") {
      const { adminId, is_active } = parsed.data;
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
      { success: false, error: "Unknown action" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Settings update error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update settings" },
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
    const parsed = SettingsPostSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { action } = parsed.data;

    if (action === "invite_admin") {
      const { email, role } = parsed.data;

      // Check if admin already exists
      const { data: existing } = await supabase
        .from("admins")
        .select("id")
        .eq("email", email)
        .single();

      if (existing) {
        return NextResponse.json(
          { success: false, error: "Admin with this email already exists" },
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
      { success: false, error: "Unknown action" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Settings POST error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to process request" },
      { status: 500 }
    );
  }
}
