import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { UserFilters, PaginatedResponse, ApiResponse } from "@/types/api";
import type { TeleUser, TeleUserStatus } from "@/types/database";
import { requireAnyRole, requireAdminOrAbove } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    const { admin, error: authError } = await requireAnyRole(supabase);
    if (authError) return authError;

    const searchParams = request.nextUrl.searchParams;
    const filters: UserFilters = {
      search: searchParams.get("search") || undefined,
      status: (searchParams.get("status") as TeleUserStatus) || undefined,
      isDeleted: searchParams.get("isDeleted") === "true",
      page: Number(searchParams.get("page")) || 1,
      pageSize: Number(searchParams.get("pageSize")) || 20,
      sortBy: searchParams.get("sortBy") || "created_at",
      sortOrder: (searchParams.get("sortOrder") as "asc" | "desc") || "desc",
    };

    const page = filters.page!;
    const pageSize = Math.min(filters.pageSize!, 100);
    const offset = (page - 1) * pageSize;

    let query = supabase
      .from("tele_users")
      .select("*", { count: "exact" })
      .eq("is_deleted", filters.isDeleted ?? false);

    if (filters.search) {
      query = query.or(
        `username.ilike.%${filters.search}%,first_name.ilike.%${filters.search}%,last_name.ilike.%${filters.search}%,telegram_id.eq.${isNaN(Number(filters.search)) ? 0 : Number(filters.search)}`
      );
    }

    if (filters.status) {
      query = query.eq("status", filters.status);
    }

    query = query
      .order(filters.sortBy || "created_at", {
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
    const response: ApiResponse<PaginatedResponse<TeleUser>> = {
      success: true,
      data: {
        data: data ?? [],
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

    const { telegram_id, username, first_name, last_name, phone, status, approval_mode, max_proxies, rate_limit_hourly, rate_limit_daily, rate_limit_total } = body;

    if (!telegram_id) {
      return NextResponse.json(
        { success: false, error: "telegram_id is required" } satisfies ApiResponse<never>,
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("tele_users")
      .insert({
        telegram_id,
        username: username || null,
        first_name: first_name || null,
        last_name: last_name || null,
        phone: phone || null,
        status: status || "active",
        approval_mode: approval_mode || "manual",
        max_proxies: max_proxies ?? 5,
        rate_limit_hourly: rate_limit_hourly ?? 10,
        rate_limit_daily: rate_limit_daily ?? 50,
        rate_limit_total: rate_limit_total ?? 500,
        proxies_used_hourly: 0,
        proxies_used_daily: 0,
        proxies_used_total: 0,
        language: "en",
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
      { success: true, data, message: "User created" } satisfies ApiResponse<TeleUser>,
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
