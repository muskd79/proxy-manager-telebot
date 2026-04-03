import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import type { ProxyFilters, PaginatedResponse } from "@/types/api";
import type { Proxy } from "@/types/database";
import { requireAnyRole, requireAdminOrAbove } from "@/lib/auth";
import { logActivity } from "@/lib/logger";
import { CreateProxySchema } from "@/lib/validations";
import { captureError } from "@/lib/error-tracking";

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
      page: Math.max(1, parseInt(searchParams.get("page") || "1") || 1),
      pageSize: Math.max(1, Math.min(parseInt(searchParams.get("pageSize") || "20") || 20, 500)),
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

    const isp = searchParams.get("isp");
    if (isp) {
      query = query.ilike("isp", `%${isp}%`);
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

    // Strip sensitive fields for viewer role
    let responseData = (data as Proxy[]) ?? [];
    if (admin.role === "viewer") {
      responseData = responseData.map((p) => {
        const { password, ...rest } = p;
        return rest;
      }) as Proxy[];
    }

    const response: PaginatedResponse<Proxy> = {
      data: responseData,
      total: count ?? 0,
      page,
      pageSize,
      totalPages: Math.ceil((count ?? 0) / pageSize),
    };

    return NextResponse.json({ success: true, ...response });
  } catch (error) {
    captureError(error, { source: "api.proxies.list", extra: { adminId: admin?.id } });
    return NextResponse.json(
      { success: false, error: "Failed to fetch proxies" },
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
    const parsed = CreateProxySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { host, port, type, username, password, country, city, isp, tags, notes, expires_at } = parsed.data;

    const insertData = {
      host,
      port,
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
    }).catch((err) => captureError(err, { source: "api.proxies.create.log", extra: { adminId: admin.id } }));

    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (error) {
    captureError(error, { source: "api.proxies.create", extra: { adminId: admin?.id } });
    return NextResponse.json(
      { success: false, error: "Failed to create proxy" },
      { status: 500 }
    );
  }
}
