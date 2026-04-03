import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { RequestFilters, PaginatedResponse, ApiResponse } from "@/types/api";
import type { ProxyRequest, RequestStatus, ProxyType } from "@/types/database";
import { requireAnyRole, requireAdminOrAbove } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    const { admin, error: authError } = await requireAnyRole(supabase);
    if (authError) return authError;

    const searchParams = request.nextUrl.searchParams;
    const filters: RequestFilters = {
      search: searchParams.get("search") || undefined,
      status: (searchParams.get("status") as RequestStatus) || undefined,
      teleUserId: searchParams.get("teleUserId") || undefined,
      proxyType: (searchParams.get("proxyType") as ProxyType) || undefined,
      country: searchParams.get("country") || undefined,
      dateFrom: searchParams.get("dateFrom") || undefined,
      dateTo: searchParams.get("dateTo") || undefined,
      isDeleted: searchParams.get("isDeleted") === "true",
      page: Number(searchParams.get("page")) || 1,
      pageSize: Number(searchParams.get("pageSize")) || 20,
      sortBy: searchParams.get("sortBy") || "requested_at",
      sortOrder: (searchParams.get("sortOrder") as "asc" | "desc") || "desc",
    };

    const page = filters.page!;
    const pageSize = Math.min(filters.pageSize!, 100);
    const offset = (page - 1) * pageSize;

    let query = supabase
      .from("proxy_requests")
      .select(
        "*, tele_user:tele_users(id, username, first_name, last_name, telegram_id), admin:admins!proxy_requests_approved_by_fkey(full_name, email), proxy:proxies(id, host, port, type)",
        { count: "exact" }
      )
      .eq("is_deleted", filters.isDeleted ?? false);

    if (filters.status) {
      const statuses = filters.status.split(",").map(s => s.trim()).filter(Boolean);
      if (statuses.length === 1) {
        query = query.eq("status", statuses[0]);
      } else if (statuses.length > 1) {
        query = query.in("status", statuses);
      }
    }

    if (filters.teleUserId) {
      query = query.eq("tele_user_id", filters.teleUserId);
    }

    if (filters.proxyType) {
      query = query.eq("proxy_type", filters.proxyType);
    }

    if (filters.country) {
      query = query.eq("country", filters.country);
    }

    if (filters.dateFrom) {
      query = query.gte("requested_at", filters.dateFrom);
    }

    if (filters.dateTo) {
      query = query.lte("requested_at", filters.dateTo);
    }

    query = query
      .order(filters.sortBy || "requested_at", {
        ascending: filters.sortOrder === "asc",
      })
      .range(offset, offset + pageSize - 1);

    const { data, error, count } = await query;

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message } satisfies ApiResponse<never>,
        { status: 500 }
      );
    }

    const total = count ?? 0;
    const response: ApiResponse<PaginatedResponse<ProxyRequest>> = {
      success: true,
      data: {
        data: (data as unknown as ProxyRequest[]) ?? [],
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    };

    return NextResponse.json(response);
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

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    const { admin, error: authError } = await requireAdminOrAbove(supabase);
    if (authError) return authError;

    const body = await request.json();
    const { tele_user_id, proxy_type, country, approval_mode } = body;

    if (!tele_user_id) {
      return NextResponse.json(
        { success: false, error: "tele_user_id is required" } satisfies ApiResponse<never>,
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("proxy_requests")
      .insert({
        tele_user_id,
        proxy_type: proxy_type || null,
        country: country || null,
        status: "pending",
        approval_mode: approval_mode || "manual",
        requested_at: new Date().toISOString(),
        is_deleted: false,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message } satisfies ApiResponse<never>,
        { status: 500 }
      );
    }

    return NextResponse.json(
      { success: true, data, message: "Request created" } satisfies ApiResponse<ProxyRequest>,
      { status: 201 }
    );
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
