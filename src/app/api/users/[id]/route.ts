import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { ApiResponse } from "@/types/api";
import type { TeleUser } from "@/types/database";
import { requireAnyRole, requireAdminOrAbove } from "@/lib/auth";
import { logActivity } from "@/lib/logger";
import { UpdateUserSchema } from "@/lib/validations";

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
    const parsed = UpdateUserSchema.safeParse(body);
    if (!parsed.success) {
      const flat = parsed.error.flatten();
      const errorMessage = flat.formErrors.length > 0
        ? flat.formErrors.join("; ")
        : "Validation failed";
      return NextResponse.json(
        { success: false, error: errorMessage, details: flat.fieldErrors } satisfies ApiResponse<never> & { details: unknown },
        { status: 400 }
      );
    }

    // Fetch current values before updating for audit trail
    const { data: currentUser } = await supabase
      .from("tele_users")
      .select("rate_limit_hourly, rate_limit_daily, rate_limit_total, max_proxies, approval_mode")
      .eq("id", id)
      .single();

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };

    // Support restore from trash
    if (parsed.data.is_deleted !== undefined) {
      updateData.is_deleted = parsed.data.is_deleted;
      if (parsed.data.is_deleted === false) {
        updateData.deleted_at = null;
      }
    }
    if (parsed.data.deleted_at !== undefined) updateData.deleted_at = parsed.data.deleted_at;

    // Only copy defined fields from validated data (excluding is_deleted/deleted_at already handled)
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
    ] as const;

    for (const field of allowedFields) {
      if (parsed.data[field] !== undefined) {
        updateData[field] = parsed.data[field];
      }
    }

    // Enforce global caps on per-user rate limits and max_proxies
    if (updateData.rate_limit_total !== undefined || updateData.max_proxies !== undefined) {
      const { data: globalSettings } = await supabase
        .from("settings")
        .select("key, value")
        .in("key", ["global_max_total_requests", "global_max_proxies"]);

      const getGlobalCap = (key: string): number | null => {
        const row = globalSettings?.find((r: { key: string; value: { value?: unknown } }) => r.key === key);
        const val = row?.value?.value;
        return typeof val === "number" && val > 0 ? val : null;
      };

      const globalMaxTotal = getGlobalCap("global_max_total_requests");
      const globalMaxProxies = getGlobalCap("global_max_proxies");

      if (updateData.rate_limit_total !== undefined && globalMaxTotal !== null) {
        if (Number(updateData.rate_limit_total) > globalMaxTotal) {
          updateData.rate_limit_total = globalMaxTotal;
        }
      }
      if (updateData.max_proxies !== undefined && globalMaxProxies !== null) {
        if (Number(updateData.max_proxies) > globalMaxProxies) {
          updateData.max_proxies = globalMaxProxies;
        }
      }
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
      details: {
        ...updateData,
        previous: currentUser ? {
          rate_limit_hourly: currentUser.rate_limit_hourly,
          rate_limit_daily: currentUser.rate_limit_daily,
          rate_limit_total: currentUser.rate_limit_total,
          max_proxies: currentUser.max_proxies,
          approval_mode: currentUser.approval_mode,
        } : null,
      },
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
