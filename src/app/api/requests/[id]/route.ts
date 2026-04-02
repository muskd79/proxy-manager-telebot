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

      // Update the proxy to assigned status
      await supabase
        .from("proxies")
        .update({
          status: "assigned",
          assigned_to: currentRequest.tele_user_id,
          assigned_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", assignProxyId);

      updateData.status = "approved";
      updateData.proxy_id = assignProxyId;
      updateData.approved_by = admin.id;
      updateData.processed_at = new Date().toISOString();
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

    // Log activity for approve/reject
    if (status === "approved" || status === "rejected") {
      logActivity({
        actorType: "admin",
        actorId: admin.id,
        action: status === "approved" ? "request.approve" : "request.reject",
        resourceType: "request",
        resourceId: id,
        details: {
          status,
          proxyId: updateData.proxy_id || undefined,
          rejectedReason: rejected_reason || undefined,
        },
        ipAddress: request.headers.get("x-forwarded-for") || undefined,
        userAgent: request.headers.get("user-agent") || undefined,
      }).catch(console.error);
    }

    // Notify user via Telegram
    try {
      const { data: teleUser } = await supabase
        .from("tele_users")
        .select("telegram_id")
        .eq("id", currentRequest.tele_user_id)
        .single();

      if (teleUser?.telegram_id) {
        let notifyText = "";

        if (status === "approved" && updateData.proxy_id) {
          const { data: proxy } = await supabase
            .from("proxies")
            .select("host, port, type, username, password")
            .eq("id", updateData.proxy_id)
            .single();

          if (proxy) {
            notifyText = [
              "\u2705 Proxy \u0111\u00E3 \u0111\u01B0\u1EE3c c\u1EA5p!",
              "",
              `Host: \`${proxy.host}\``,
              `Port: \`${proxy.port}\``,
              `Type: \`${proxy.type}\``,
              `User: \`${proxy.username ?? "N/A"}\``,
              `Pass: \`${proxy.password ?? "N/A"}\``,
            ].join("\n");
          }
        } else if (status === "rejected") {
          notifyText = `\u274C Y\u00EAu c\u1EA7u proxy b\u1ECB t\u1EEB ch\u1ED1i.\nL\u00FD do: ${rejected_reason || "Kh\u00F4ng r\u00F5"}`;
        }

        if (notifyText) {
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
      }
    } catch (notifyErr) {
      console.error("Failed to notify user via Telegram:", notifyErr);
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
