import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import type { Proxy, ProxyUpdate } from "@/types/database";
import { requireAnyRole, requireAdminOrAbove } from "@/lib/auth";
import { logActivity } from "@/lib/logger";
import { UpdateProxySchema } from "@/lib/validations";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { admin, error: authError } = await requireAnyRole(supabase);
  if (authError) return authError;

  const { id } = await params;

  try {
    const { data, error } = await supabase
      .from("proxies")
      .select("*")
      .eq("id", id)
      .single();

    if (error) throw error;
    if (!data) {
      return NextResponse.json({ success: false, error: "Proxy not found" }, { status: 404 });
    }

    // Strip sensitive fields for viewer role
    if (admin.role === "viewer") {
      const { password, ...sanitized } = data;
      return NextResponse.json({ success: true, data: sanitized });
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("Get proxy error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch proxy" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { admin, error: authError } = await requireAdminOrAbove(supabase);
  if (authError) return authError;

  const { id } = await params;

  try {
    const body = await request.json();
    const parsed = UpdateProxySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const {
      host,
      port,
      type,
      username,
      password,
      country,
      city,
      isp,
      status,
      tags,
      notes,
      expires_at,
      assigned_to,
    } = parsed.data;

    const updateData: ProxyUpdate = {};

    // Support restore from trash
    if (parsed.data.is_deleted !== undefined) {
      updateData.is_deleted = parsed.data.is_deleted;
      if (parsed.data.is_deleted === false) {
        updateData.deleted_at = null;
      }
    }
    if (parsed.data.deleted_at !== undefined) updateData.deleted_at = parsed.data.deleted_at;

    if (host !== undefined) updateData.host = host;
    if (port !== undefined) updateData.port = port;
    if (type !== undefined) updateData.type = type;
    if (username !== undefined) updateData.username = username || null;
    if (password !== undefined) updateData.password = password || null;
    if (country !== undefined) updateData.country = country || null;
    if (city !== undefined) updateData.city = city || null;
    if (isp !== undefined) updateData.isp = isp || null;
    if (status !== undefined) updateData.status = status;
    if (tags !== undefined) updateData.tags = tags;
    if (notes !== undefined) updateData.notes = notes || null;
    if (expires_at !== undefined) updateData.expires_at = expires_at || null;
    if (assigned_to !== undefined) {
      updateData.assigned_to = assigned_to || null;
      if (assigned_to) {
        updateData.assigned_at = new Date().toISOString();
      }
    }

    const { data, error } = await supabase
      .from("proxies")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    logActivity({
      actorType: "admin",
      actorId: admin.id,
      action: "proxy.update",
      resourceType: "proxy",
      resourceId: id,
      details: updateData,
      ipAddress: request.headers.get("x-forwarded-for") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    }).catch(console.error);

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("Update proxy error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update proxy" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { admin, error: authError } = await requireAdminOrAbove(supabase);
  if (authError) return authError;

  const { id } = await params;

  try {
    // Check exists first
    const { data: existing } = await supabase
      .from("proxies")
      .select("id")
      .eq("id", id)
      .single();

    if (!existing) {
      return NextResponse.json({ success: false, error: "Proxy not found" }, { status: 404 });
    }

    const permanent = request.nextUrl.searchParams.get("permanent") === "true";

    if (permanent) {
      // Hard delete
      const { error } = await supabase
        .from("proxies")
        .delete()
        .eq("id", id);

      if (error) throw error;

      logActivity({
        actorType: "admin",
        actorId: admin.id,
        action: "proxy.delete",
        resourceType: "proxy",
        resourceId: id,
        details: { permanent: true },
        ipAddress: request.headers.get("x-forwarded-for") || undefined,
        userAgent: request.headers.get("user-agent") || undefined,
      }).catch(console.error);

      return NextResponse.json({ success: true, message: "Proxy permanently deleted" });
    }

    // Soft delete
    const { data, error } = await supabase
      .from("proxies")
      .update({ is_deleted: true, deleted_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    logActivity({
      actorType: "admin",
      actorId: admin.id,
      action: "proxy.delete",
      resourceType: "proxy",
      resourceId: id,
      details: { permanent: false },
      ipAddress: request.headers.get("x-forwarded-for") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    }).catch(console.error);

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("Delete proxy error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete proxy" },
      { status: 500 }
    );
  }
}
