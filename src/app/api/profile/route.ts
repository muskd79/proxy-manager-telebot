import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { z } from "zod";

const UpdateProfileSchema = z.object({
  telegram_id: z.coerce.number().int().positive().nullable().optional(),
  full_name: z.string().max(100).nullable().optional(),
});

export async function GET() {
  const supabase = await createClient();
  const { admin, error: authError } = await requireAuth(supabase);
  if (authError) return authError;

  return NextResponse.json({ success: true, data: admin });
}

export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const { admin, error: authError } = await requireAuth(supabase);
  if (authError) return authError;

  const body = await request.json();
  const parsed = UpdateProfileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid input",
        details: parsed.error.flatten().fieldErrors,
      },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("admins")
    .update(parsed.data)
    .eq("id", admin.id)
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      // unique violation
      return NextResponse.json(
        {
          success: false,
          error: "This Telegram ID is already used by another admin",
        },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { success: false, error: "Failed to update profile" },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, data });
}
