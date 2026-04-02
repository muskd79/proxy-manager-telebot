import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import type { Proxy, ProxyUpdate } from "@/types/database";
import { requireAnyRole, requireAdminOrAbove } from "@/lib/auth";

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
      return NextResponse.json({ error: "Proxy not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("Get proxy error:", error);
    return NextResponse.json(
      { error: "Failed to fetch proxy" },
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
    } = body;

    const updateData: ProxyUpdate = {};
    if (host !== undefined) updateData.host = host;
    if (port !== undefined) updateData.port = parseInt(String(port));
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

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("Update proxy error:", error);
    return NextResponse.json(
      { error: "Failed to update proxy" },
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
    // Soft delete
    const { data, error } = await supabase
      .from("proxies")
      .update({ is_deleted: true, deleted_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("Delete proxy error:", error);
    return NextResponse.json(
      { error: "Failed to delete proxy" },
      { status: 500 }
    );
  }
}
