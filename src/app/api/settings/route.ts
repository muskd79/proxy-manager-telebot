import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin, actorLabel } from "@/lib/auth";
import { logActivity } from "@/lib/logger";
import { SettingsPutSchema, SettingsPostSchema } from "@/lib/validations";

/**
 * Setting keys that are secrets and must NEVER be stored in the settings
 * table (they are readable by every viewer-role admin via RLS). These keys
 * are served exclusively from environment variables. The API filters them
 * out of GET responses and rejects them in PUT updates.
 */
const SECRET_SETTING_KEYS = new Set<string>([
  "telegram_bot_token",
  "telegram_webhook_secret",
]);

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

    // List all settings. Exclude secret keys — they live in env vars only.
    const { data, error } = await supabase
      .from("settings")
      .select("*")
      .order("key", { ascending: true });

    if (error) throw error;
    const filtered = (data ?? []).filter(
      (row: { key: string }) => !SECRET_SETTING_KEYS.has(row.key),
    );
    return NextResponse.json({ success: true, data: filtered });
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

      // Reject any attempt to write secret keys to the DB. Admins must
      // configure these via Vercel env vars; persisting them in a
      // viewer-readable table is the exact vector we're closing.
      const attemptedSecrets = Object.keys(settings).filter((k) =>
        SECRET_SETTING_KEYS.has(k),
      );
      if (attemptedSecrets.length > 0) {
        return NextResponse.json(
          {
            success: false,
            error: `Refusing to store secret keys in settings: ${attemptedSecrets.join(", ")}. Configure via environment variables instead.`,
          },
          { status: 400 },
        );
      }

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

      // If global_max_total_requests changed, retrofit existing users
      if (settings.global_max_total_requests !== undefined) {
        const newGlobalMax = Number(settings.global_max_total_requests);
        if (newGlobalMax > 0) {
          // Cap all users whose rate_limit_total exceeds the new global max
          await supabase
            .from("tele_users")
            .update({ rate_limit_total: newGlobalMax })
            .gt("rate_limit_total", newGlobalMax)
            .eq("is_deleted", false);
        }
      }

      // Similarly for global_max_proxies
      if (settings.global_max_proxies !== undefined) {
        const newGlobalMax = Number(settings.global_max_proxies);
        if (newGlobalMax > 0) {
          await supabase
            .from("tele_users")
            .update({ max_proxies: newGlobalMax })
            .gt("max_proxies", newGlobalMax)
            .eq("is_deleted", false);
        }
      }

      logActivity({
        actorType: "admin",
        actorId: admin.id,
        actorDisplayName: actorLabel(admin),
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
      // Wave 22D-3 SECURITY FIX: prevent self-demotion lockout. A
      // super_admin who demotes themselves to viewer cannot reach
      // the settings UI to undo it. Block the operation explicitly.
      // The "last super_admin standing" check would also be valid
      // but is harder to make race-safe; self-target alone covers
      // the immediate footgun.
      if (adminId === admin.id) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Cannot change your own role — ask another super_admin to demote you",
          },
          { status: 400 },
        );
      }
      const { error } = await supabase
        .from("admins")
        .update({ role, updated_at: new Date().toISOString() })
        .eq("id", adminId);

      if (error) throw error;
      return NextResponse.json({ success: true });
    }

    if (action === "toggle_admin_active") {
      const { adminId, is_active } = parsed.data;
      // Wave 22D-3 SECURITY FIX: prevent self-deactivation lockout.
      // Same logic as update_admin_role above — blocking is_active=false
      // on self avoids the footgun where a super_admin disables their
      // own account and cannot recover.
      if (adminId === admin.id && is_active === false) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Cannot deactivate your own account — ask another super_admin",
          },
          { status: 400 },
        );
      }
      const { error } = await supabase
        .from("admins")
        .update({ is_active, updated_at: new Date().toISOString() })
        .eq("id", adminId);

      if (error) throw error;

      // Revoke all sessions when deactivating an admin
      if (!is_active) {
        try {
          const { data: adminRecord } = await supabase
            .from("admins")
            .select("email")
            .eq("id", adminId)
            .single();

          if (adminRecord?.email) {
            // Wave 22L (C1 fix) — paginated lookup; pre-22L returned only
            // 50 users so deactivation didn't kill sessions for admins
            // on page 2+.
            const { findAuthUserByEmail } = await import("@/lib/auth-helpers");
            const authUser = await findAuthUserByEmail(adminRecord.email);
            if (authUser) {
              await supabaseAdmin.auth.admin.signOut(authUser.id, "global");
            }
          }
        } catch (sessionErr) {
          // Log but don't fail the deactivation
          console.error("Failed to revoke sessions:", sessionErr);
        }
      }

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

      // Create Supabase auth user and send invite email
      const { error: authError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${process.env.NEXT_PUBLIC_APP_URL || "https://proxy-manager-telebot.vercel.app"}/login`,
      });

      if (authError) {
        // If user already exists in auth but not in admins table, proceed to create admin record
        if (!authError.message.includes("already been registered")) {
          return NextResponse.json(
            { success: false, error: `Failed to invite: ${authError.message}` },
            { status: 400 }
          );
        }
      }

      // Create admin record
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
