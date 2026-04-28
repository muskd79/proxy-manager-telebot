import { createClient } from "@/lib/supabase/server";
import { createClient as createPureClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, actorLabel } from "@/lib/auth";
import { logActivity } from "@/lib/logger";
import { generateBackupCodes } from "@/lib/backup-codes";
import { z } from "zod";

/**
 * Wave 22F-B — POST /api/profile/2fa/backup-codes/regenerate
 *
 * Wipe existing backup codes and issue 8 fresh ones. Used when:
 *   - User loses the original codes
 *   - User suspects the codes were exposed
 *   - User wants to rotate periodically
 *
 * Security: requires current password. Even with a hijacked session,
 * an attacker shouldn't be able to silently issue new codes (which
 * would let them later disable 2FA via the recovery flow).
 *
 * 2FA must already be enabled — otherwise we have nothing to back up.
 */
const RegenerateSchema = z.object({
  current_password: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { admin, error: authError } = await requireAuth(supabase);
  if (authError) return authError;

  const parsed = RegenerateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "current_password required" },
      { status: 400 },
    );
  }

  // Confirm 2FA is enabled (admins.totp_enabled_at is set).
  const { data: row } = await supabaseAdmin
    .from("admins")
    .select("totp_enabled_at")
    .eq("id", admin.id)
    .single();

  if (!row?.totp_enabled_at) {
    return NextResponse.json(
      {
        success: false,
        error: "2FA is not enabled — enroll first before generating codes",
      },
      { status: 400 },
    );
  }

  // Verify current password (same throwaway pattern).
  const throwaway = createPureClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { data: signInData, error: signInError } =
    await throwaway.auth.signInWithPassword({
      email: admin.email,
      password: parsed.data.current_password,
    });

  if (signInError || !signInData.user) {
    return NextResponse.json(
      { success: false, error: "Current password is incorrect" },
      { status: 401 },
    );
  }
  await throwaway.auth.signOut().catch(() => undefined);

  // Wipe existing codes.
  await supabaseAdmin
    .from("admin_backup_codes")
    .delete()
    .eq("admin_id", admin.id);

  // Generate 8 fresh.
  const codes = generateBackupCodes(8);
  const { error: insertError } = await supabaseAdmin
    .from("admin_backup_codes")
    .insert(
      codes.map((c) => ({
        admin_id: admin.id,
        code_hash: c.code_hash,
        salt: c.salt,
      })),
    );

  if (insertError) {
    console.error("backup-codes regenerate insert failed:", insertError.message);
    return NextResponse.json(
      { success: false, error: "Failed to issue new codes" },
      { status: 500 },
    );
  }

  await logActivity({
    actorType: "admin",
    actorId: admin.id,
    actorDisplayName: actorLabel(admin),
    action: "profile.backup_codes_regenerated",
    resourceType: "admin",
    resourceId: admin.id,
    ipAddress: request.headers.get("x-forwarded-for") || undefined,
    userAgent: request.headers.get("user-agent") || undefined,
  });

  return NextResponse.json({
    success: true,
    message: "Backup codes regenerated. Save these — old codes are now invalid.",
    data: { backup_codes: codes.map((c) => c.code) },
  });
}
