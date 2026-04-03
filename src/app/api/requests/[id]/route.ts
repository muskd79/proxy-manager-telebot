import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { ApiResponse } from "@/types/api";
import type { ProxyRequest } from "@/types/database";
import { requireAnyRole, requireAdminOrAbove } from "@/lib/auth";
import { logActivity } from "@/lib/logger";

async function sendTelegramMessage(chatId: number, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token === "placeholder:token") return;

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
      }),
    });
  } catch (err) {
    console.error("Failed to send Telegram notification:", err);
  }
}

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
      .from("proxy_requests")
      .select(
        "*, tele_user:tele_users(id, username, first_name, last_name, telegram_id), admin:admins!proxy_requests_approved_by_fkey(full_name, email), proxy:proxies(id, host, port, type, country)"
      )
      .eq("id", id)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { success: false, error: "Request not found" } satisfies ApiResponse<never>,
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: data as unknown as ProxyRequest,
    } satisfies ApiResponse<ProxyRequest>);
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
    const { status, proxy_id, rejected_reason, auto_assign } = body;

    // Get the current request
    const { data: currentRequest, error: fetchError } = await supabase
      .from("proxy_requests")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchError || !currentRequest) {
      return NextResponse.json(
        { success: false, error: "Request not found" } satisfies ApiResponse<never>,
        { status: 404 }
      );
    }

    const updateData: Record<string, unknown> = {};

    // Support restore from trash
    if (body.is_deleted !== undefined) {
      updateData.is_deleted = body.is_deleted;
      if (body.is_deleted === false) {
        updateData.deleted_at = null;
      }
    }
    if (body.deleted_at !== undefined) updateData.deleted_at = body.deleted_at;

    if (status === "approved") {
      let assignProxyId = proxy_id;

      // Auto-assign: find an available proxy matching request criteria
      if (auto_assign && !assignProxyId) {
        let proxyQuery = supabase
          .from("proxies")
          .select("id")
          .eq("status", "available")
          .eq("is_deleted", false);

        if (currentRequest.proxy_type) {
          proxyQuery = proxyQuery.eq("type", currentRequest.proxy_type);
        }
        if (currentRequest.country) {
          proxyQuery = proxyQuery.eq("country", currentRequest.country);
        }

        const { data: availableProxy } = await proxyQuery.limit(1).single();
        if (availableProxy) {
          assignProxyId = availableProxy.id;
        } else {
          return NextResponse.json(
            { success: false, error: "No matching proxy available for auto-assign" } satisfies ApiResponse<never>,
            { status: 400 }
          );
        }
      }

      if (!assignProxyId) {
        return NextResponse.json(
          { success: false, error: "proxy_id is required for approval" } satisfies ApiResponse<never>,
          { status: 400 }
        );
      }

      // Atomic proxy assignment via RPC (prevents race conditions)
      const { data: rpcResult, error: rpcError } = await supabase.rpc("safe_assign_proxy", {
        p_request_id: id,
        p_proxy_id: assignProxyId,
        p_admin_id: admin.id,
      });

      if (rpcError || !rpcResult?.success) {
        return NextResponse.json(
          { success: false, error: rpcResult?.error || rpcError?.message || "Failed to assign proxy" } satisfies ApiResponse<never>,
          { status: 409 }
        );
      }

      // RPC already updated proxy and request, skip the generic update below
      // Log activity
      logActivity({
        actorType: "admin",
        actorId: admin.id,
        action: "request.approve",
        resourceType: "request",
        resourceId: id,
        details: {
          status: "approved",
          proxyId: assignProxyId,
        },
        ipAddress: request.headers.get("x-forwarded-for") || undefined,
        userAgent: request.headers.get("user-agent") || undefined,
      }).catch(console.error);

      // Notify user via Telegram with proxy details from RPC result
      try {
        const { data: teleUser } = await supabase
          .from("tele_users")
          .select("telegram_id")
          .eq("id", rpcResult.tele_user_id)
          .single();

        if (teleUser?.telegram_id && rpcResult.proxy) {
          const proxy = rpcResult.proxy;

          // Detect user language for notification
          const { data: teleUserFull } = await supabase
            .from("tele_users")
            .select("language")
            .eq("id", rpcResult.tele_user_id)
            .single();
          const lang = (teleUserFull?.language as string) || "en";

          const notifyText = lang === "vi"
            ? `[OK] Proxy đã được cấp!\n\n\`${proxy.host}:${proxy.port}:${proxy.username ?? ""}:${proxy.password ?? ""}\`\n\nLoại: ${proxy.type.toUpperCase()}`
            : `[OK] Proxy assigned!\n\n\`${proxy.host}:${proxy.port}:${proxy.username ?? ""}:${proxy.password ?? ""}\`\n\nType: ${proxy.type.toUpperCase()}`;

          await sendTelegramMessage(teleUser.telegram_id, notifyText);

          // Log outgoing message in chat_messages
          await supabase.from("chat_messages").insert({
            tele_user_id: rpcResult.tele_user_id,
            telegram_message_id: null,
            direction: "outgoing",
            message_text: notifyText,
            message_type: "text",
            raw_data: null,
          });
        }
      } catch (notifyErr) {
        console.error("Failed to notify user via Telegram:", notifyErr);
      }

      // Re-fetch the updated request for response
      const { data: updatedRequest } = await supabase
        .from("proxy_requests")
        .select()
        .eq("id", id)
        .single();

      return NextResponse.json({
        success: true,
        data: updatedRequest,
        message: "Request approved",
      } satisfies ApiResponse<ProxyRequest>);
    } else if (status === "rejected") {
      updateData.status = "rejected";
      updateData.rejected_reason = rejected_reason || null;
      updateData.approved_by = admin.id;
      updateData.processed_at = new Date().toISOString();
    } else if (status === "cancelled") {
      updateData.status = "cancelled";
      updateData.processed_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from("proxy_requests")
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

    // Log activity for reject/cancel (approve is handled above via early return)
    if (status === "rejected") {
      logActivity({
        actorType: "admin",
        actorId: admin.id,
        action: "request.reject",
        resourceType: "request",
        resourceId: id,
        details: {
          status,
          rejectedReason: rejected_reason || undefined,
        },
        ipAddress: request.headers.get("x-forwarded-for") || undefined,
        userAgent: request.headers.get("user-agent") || undefined,
      }).catch(console.error);
    }

    // Notify user via Telegram (reject only; approve handled above)
    if (status === "rejected") {
      try {
        const { data: teleUser } = await supabase
          .from("tele_users")
          .select("telegram_id, language")
          .eq("id", currentRequest.tele_user_id)
          .single();

        if (teleUser?.telegram_id) {
          const lang = teleUser?.language || "en";
          const notifyText = lang === "vi"
            ? `[X] Yeu cau proxy bi tu choi.\nLy do: ${rejected_reason || "Khong ro"}`
            : `[X] Proxy request rejected.\nReason: ${rejected_reason || "Not specified"}`;

          await sendTelegramMessage(teleUser.telegram_id, notifyText);

          // Log outgoing message in chat_messages
          await supabase.from("chat_messages").insert({
            tele_user_id: currentRequest.tele_user_id,
            telegram_message_id: null,
            direction: "outgoing",
            message_text: notifyText,
            message_type: "text",
            raw_data: null,
          });
        }
      } catch (notifyErr) {
        console.error("Failed to notify user via Telegram:", notifyErr);
      }
    }

    return NextResponse.json({
      success: true,
      data,
      message: `Request ${status}`,
    } satisfies ApiResponse<ProxyRequest>);
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
      .from("proxy_requests")
      .select("id")
      .eq("id", id)
      .single();

    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Request not found" } satisfies ApiResponse<never>,
        { status: 404 }
      );
    }

    const permanent = request.nextUrl.searchParams.get("permanent") === "true";

    if (permanent) {
      // Hard delete
      const { error } = await supabase
        .from("proxy_requests")
        .delete()
        .eq("id", id);

      if (error) {
        return NextResponse.json(
          { success: false, error: error.message } satisfies ApiResponse<never>,
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        message: "Request permanently deleted",
      } satisfies ApiResponse<never>);
    }

    // Soft delete
    const { error } = await supabase
      .from("proxy_requests")
      .update({
        status: "cancelled",
        is_deleted: true,
        deleted_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message } satisfies ApiResponse<never>,
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Request cancelled",
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
