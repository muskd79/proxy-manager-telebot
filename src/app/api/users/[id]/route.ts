import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { ApiResponse } from "@/types/api";
import type { TeleUser } from "@/types/database";
import { requireAnyRole, requireAdminOrAbove, actorLabel } from "@/lib/auth";
import { logActivity } from "@/lib/logger";
import { UpdateUserSchema } from "@/lib/validations";
import { assertSameOrigin } from "@/lib/csrf";

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
  const csrfErr = assertSameOrigin(request);
  if (csrfErr) return csrfErr;

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
      actorDisplayName: actorLabel(admin),
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
  const csrfErr = assertSameOrigin(request);
  if (csrfErr) return csrfErr;

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
      // Wave 26-D bug hunt v2 [HIGH] — reclaim orphan assignments and
      // surface FK violations as a friendly 409.
      //
      // Pre-fix:
      //   - proxies.assigned_to FK is `ON DELETE SET NULL` (mig 001),
      //     so a permanent user delete left every assigned proxy with
      //     status='assigned' but assigned_to=NULL — orphaned and
      //     undistributable. /proxies dashboard showed them as "Đã giao"
      //     forever with no user attached.
      //   - proxy_requests.tele_user_id FK is `ON DELETE RESTRICT`
      //     (mig 046), so deleting a user with ANY request history
      //     errored with a generic 500 + Postgres error message leaking
      //     to the admin UI ("violates foreign key constraint…").
      //
      // Now:
      //   1. First reclaim every proxy assigned to this user — flip
      //      status=available + clear assigned_to/assigned_at so the
      //      inventory comes back to the pool for redistribution.
      //   2. Cancel any PENDING requests by this user so they don't
      //      block the delete (FK on proxy_requests is RESTRICT and
      //      pending requests are not historically meaningful).
      //   3. Attempt the delete. If it still fails with FK 23503,
      //      that's a historical (non-pending) request or chat_message
      //      — preserved by design. Return 409 explaining that hard
      //      delete isn't possible while audit history exists, and
      //      recommend soft-delete instead.

      // Step 1: reclaim assigned proxies (status SET available, clear
      // assigned_to). The FK ON DELETE SET NULL would clear assigned_to
      // for us, but it would NOT flip status — leaving orphans.
      const { data: reclaimed } = await supabase
        .from("proxies")
        .update({
          status: "available",
          assigned_to: null,
          assigned_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("assigned_to", id)
        .eq("status", "assigned")
        .select("id");

      const reclaimedCount = reclaimed?.length ?? 0;

      // Step 2: cancel pending requests (not historical — those are kept).
      // Use the existing `cancelled` status so the request lifecycle stays
      // consistent with the bot's own self-cancel flow.
      const { data: cancelledRequests } = await supabase
        .from("proxy_requests")
        .update({
          status: "cancelled",
          processed_at: new Date().toISOString(),
        })
        .eq("tele_user_id", id)
        .eq("status", "pending")
        .select("id");

      const cancelledCount = cancelledRequests?.length ?? 0;

      // Step 3: attempt the hard delete.
      const { error } = await supabase
        .from("tele_users")
        .delete()
        .eq("id", id);

      if (error) {
        const code = (error as { code?: string }).code;
        if (code === "23503") {
          // FK violation — typically chat_messages or historical
          // (non-pending) proxy_requests with the RESTRICT FK from
          // mig 046. Preserve the audit trail; tell the admin to
          // soft-delete.
          return NextResponse.json(
            {
              success: false,
              error: "fk_violation_user_history",
              message:
                "User này có lịch sử (yêu cầu/chat) cần được giữ lại để audit. Hãy dùng \"xoá mềm\" (chuyển vào thùng rác) thay vì xoá vĩnh viễn — soft-delete giữ nguyên lịch sử và vẫn vô hiệu hoá user.",
              details: {
                reclaimed_proxies: reclaimedCount,
                cancelled_requests: cancelledCount,
              },
            } satisfies ApiResponse<never> & { details: unknown; message: string },
            { status: 409 },
          );
        }
        return NextResponse.json(
          { success: false, error: error.message } satisfies ApiResponse<never>,
          { status: 500 }
        );
      }

      logActivity({
        actorType: "admin",
        actorId: admin.id,
        actorDisplayName: actorLabel(admin),
        action: "user.delete",
        resourceType: "user",
        resourceId: id,
        details: {
          permanent: true,
          reclaimed_proxies: reclaimedCount,
          cancelled_requests: cancelledCount,
        },
        ipAddress: request.headers.get("x-forwarded-for") || undefined,
        userAgent: request.headers.get("user-agent") || undefined,
      }).catch(console.error);

      return NextResponse.json({
        success: true,
        message:
          reclaimedCount > 0 || cancelledCount > 0
            ? `User permanently deleted. Reclaimed ${reclaimedCount} proxy${reclaimedCount === 1 ? "" : "s"}, cancelled ${cancelledCount} pending request${cancelledCount === 1 ? "" : "s"}.`
            : "User permanently deleted",
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
      actorDisplayName: actorLabel(admin),
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
