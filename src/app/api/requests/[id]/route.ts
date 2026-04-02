import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { ApiResponse } from "@/types/api";
import type { ProxyRequest } from "@/types/database";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" } satisfies ApiResponse<never>,
        { status: 401 }
      );
    }

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

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" } satisfies ApiResponse<never>,
        { status: 401 }
      );
    }

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

      // Get admin record for the current user
      const { data: adminData } = await supabase
        .from("admins")
        .select("id")
        .eq("id", user.id)
        .single();

      updateData.status = "approved";
      updateData.proxy_id = assignProxyId;
      updateData.approved_by = adminData?.id || null;
      updateData.processed_at = new Date().toISOString();
    } else if (status === "rejected") {
      // Get admin record
      const { data: adminData } = await supabase
        .from("admins")
        .select("id")
        .eq("id", user.id)
        .single();

      updateData.status = "rejected";
      updateData.rejected_reason = rejected_reason || null;
      updateData.approved_by = adminData?.id || null;
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
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" } satisfies ApiResponse<never>,
        { status: 401 }
      );
    }

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
