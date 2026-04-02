import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import type { ProxyFilters, PaginatedResponse } from "@/types/api";
import type { Proxy } from "@/types/database";
import { requireAnyRole, requireAdminOrAbove } from "@/lib/auth";
import { logActivity } from "@/lib/logger";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { admin, error: authError } = await requireAnyRole(supabase);
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const filters: ProxyFilters = {
      search: searchParams.get("search") || undefined,
      type: (searchParams.get("type") as ProxyFilters["type"]) || undefined,
      status:
        (searchParams.get("status") as ProxyFilters["status"]) || undefined,
      country: searchParams.get("country") || undefined,
      tags: searchParams.get("tags")?.split(",") || undefined,
      page: parseInt(searchParams.get("page") || "1"),
      pageSize: parseInt(searchParams.get("pageSize") || "20"),
      sortBy: searchParams.get("sortBy") || "created_at",
      sortOrder:
        (searchParams.get("sortOrder") as "asc" | "desc") || "desc",
      isDeleted: searchParams.get("isDeleted") === "true",
    };

    let query = supabase
      .from("proxies")
      .select("*", { count: "exact" })
      .eq("is_deleted", filters.isDeleted ?? false);

    if (filters.search) {
      query = query.ilike("host", `%${filters.search}%`);
    }
    if (filters.type) {
      query = query.eq("type", filters.type);
    }
    if (filters.status) {
      query = query.eq("status", filters.status);
    }
    if (filters.country) {
      query = query.eq("country", filters.country);
    }
    if (filters.tags && filters.tags.length > 0) {
      query = query.overlaps("tags", filters.tags);
    }

    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 20;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    query = query
      .order(filters.sortBy ?? "created_at", {
        ascending: filters.sortOrder === "asc",
      })
      .range(from, to);

    const { data, error, count } = await query;

    if (error) throw error;

    const response: PaginatedResponse<Proxy> = {
      data: (data as Proxy[]) ?? [],
      total: count ?? 0,
      page,
      pageSize,
      totalPages: Math.ceil((count ?? 0) / pageSize),
    };

    return NextResponse.json({ success: true, ...response });
  } catch (error) {
    console.error("Proxies list error:", error);
    return NextResponse.json(
      { error: "Failed to fetch proxies" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { admin, error: authError } = await requireAdminOrAbove(supabase);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { host, port, type, username, password, country, city, isp, tags, notes, expires_at } = body;

    if (!host || !port || !type) {
      return NextResponse.json(
        { error: "host, port, and type are required" },
        { status: 400 }
      );
    }

    const insertData = {
      host,
      port: parseInt(port),
      type,
      username: username || null,
      password: password || null,
      country: country || null,
      city: city || null,
      isp: isp || null,
      status: "available" as const,
      tags: tags || null,
      notes: notes || null,
      expires_at: expires_at || null,
      is_deleted: false,
      created_by: admin.id,
    };

    const { data, error } = await supabase
      .from("proxies")
      .insert(insertData)
      .select()
      .single();

    if (error) throw error;

    logActivity({
      actorType: "admin",
      actorId: admin.id,
      action: "proxy.create",
      resourceType: "proxy",
      resourceId: data.id,
      details: { host: data.host, port: data.port, type: data.type },
      ipAddress: request.headers.get("x-forwarded-for") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    }).catch(console.error);

    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (error) {
    console.error("Create proxy error:", error);
    return NextResponse.json(
      { error: "Failed to create proxy" },
      { status: 500 }
    );
  }
}
