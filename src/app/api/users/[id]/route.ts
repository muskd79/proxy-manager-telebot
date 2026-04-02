import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { ApiResponse } from "@/types/api";
import type { TeleUser } from "@/types/database";
import { requireAnyRole, requireAdminOrAbove } from "@/lib/auth";
import { logActivity } from "@/lib/logger";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const { admin, error: authError } = await requireAnyRole(supabase);
    if (authError) return authError;

    const { data, error } = await supabase
      .from("tele_users")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { success: false, error: "User not found" } satisfies ApiResponse<never>,
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data,
    } satisfies ApiResponse<TeleUser>);
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Internal server error",
      } satisfies ApiResponse<never>,
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const { admin, error: authError } = await requireAdminOrAbove(supabase);
    if (authError) return authError;

    const body = await request.json();

    // Only allow updating specific fields
    const allowedFields = [
      "status",
      "approval_mode",
      "max_proxies",
      "rate_limit_hourly",
      "rate_limit_daily",
      "rate_limit_total",
      "notes",
      "username",
      "first_name",
      "last_name",
      "phone",
      "language",
    ];

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };

    // Support restore from trash
    if (body.is_deleted !== undefined) {
      updateData.is_deleted = body.is_deleted;
      if (body.is_deleted === false) {
        updateData.deleted_at = null;
      }
    }
    if (body.deleted_at !== undefined) updateData.deleted_at = body.deleted_at;

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field];
      }
    }

    // Validate numeric fields
    if (updateData.max_proxies !== undefined && (typeof updateData.max_proxies !== "number" || updateData.max_proxies < 0 || (updateData.max_proxies as number) > 1000)) {
      return NextResponse.json(
        { success: false, error: "max_proxies must be 0-1000" } satisfies ApiResponse<never>,
        { status: 400 }
      );
    }
    if (updateData.rate_limit_hourly !== undefined && (typeof updateData.rate_limit_hourly !== "number" || updateData.rate_limit_hourly < 0 || (updateData.rate_limit_hourly as number) > 10000)) {
      return NextResponse.json(
        { success: false, error: "rate_limit_hourly must be 0-10000" } satisfies ApiResponse<never>,
        { status: 400 }
      );
    }
    if (updateData.rate_limit_daily !== undefined && (typeof updateData.rate_limit_daily !== "number" || updateData.rate_limit_daily < 0 || (updateData.rate_limit_daily as number) > 100000)) {
      return NextResponse.json(
        { success: false, error: "rate_limit_daily must be 0-100000" } satisfies ApiResponse<never>,
        { status: 400 }
      );
    }
    if (updateData.rate_limit_total !== undefined && (typeof updateData.rate_limit_total !== "number" || updateData.rate_limit_total < 0 || (updateData.rate_limit_total as number) > 1000000)) {
      return NextResponse.json(
        { success: false, error: "rate_limit_total must be 0-1000000" } satisfies ApiResponse<never>,
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("tele_users")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message } satisfies ApiResponse<never>,
        { status: 500 }
      );
    }

    logActivity({
      actorType: "admin",
      actorId: admin.id,
      action: "user.update",
      resourceType: "user",
      resourceId: id,
      details: updateData,
      ipAddress: request.headers.get("x-forwarded-for") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    }).catch(console.error);

    return NextResponse.json({
      success: true,
      data,
      message: "User updated",
    } satisfies ApiResponse<TeleUser>);
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Internal server error",
      } satisfies ApiResponse<never>,
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const { admin, error: authError } = await requireAdminOrAbove(supabase);
    if (authError) return authError;

    // Check exists first
    const { data: existing } = await supabase
      .from("tele_users")
      .select("id")
      .eq("id", id)
      .single();

    if (!existing) {
      return NextResponse.json(
        { success: false, error: "User not found" } satisfies ApiResponse<never>,
        { status: 404 }
      );
    }

    const permanent = request.nextUrl.searchParams.get("permanent") === "true";

    if (permanent) {
      // Hard delete
      const { error } = await supabase
        .from("tele_users")
        .delete()
        .eq("id", id);

      if (error) {
        return NextResponse.json(
          { success: false, error: error.message } satisfies ApiResponse<never>,
          { status: 500 }
        );
      }

      logActivity({
        actorType: "admin",
        actorId: admin.id,
        action: "user.delete",
        resourceType: "user",
        resourceId: id,
        details: { permanent: true },
        ipAddress: request.headers.get("x-forwarded-for") || undefined,
        userAgent: request.headers.get("user-agent") || undefined,
      }).catch(console.error);

      return NextResponse.json({
        success: true,
        message: "User permanently deleted",
      } satisfies ApiResponse<never>);
    }

    // Soft delete
    const { error } = await supabase
      .from("tele_users")
      .update({
        is_deleted: true,
        deleted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message } satisfies ApiResponse<never>,
        { status: 500 }
      );
    }

    logActivity({
      actorType: "admin",
      actorId: admin.id,
      action: "user.delete",
      resourceType: "user",
      resourceId: id,
      details: { permanent: false },
      ipAddress: request.headers.get("x-forwarded-for") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    }).catch(console.error);

    return NextResponse.json({
      success: true,
      message: "User deleted",
    } satisfies ApiResponse<never>);
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Internal server error",
      } satisfies ApiResponse<never>,
      { status: 500 }
    );
  }
}
