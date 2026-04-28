import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import type { LogFilters, PaginatedResponse } from "@/types/api";
import type { ActivityLog } from "@/types/database";
import { requireAnyRole } from "@/lib/auth";
import { LOGS_SORT, safeSort } from "@/lib/sort-allowlist";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { admin, error: authError } = await requireAnyRole(supabase);
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const filters: LogFilters = {
      search: searchParams.get("search") || undefined,
      actorType:
        (searchParams.get("actorType") as LogFilters["actorType"]) || undefined,
      actorId: searchParams.get("actorId") || undefined,
      action: searchParams.get("action") || undefined,
      resourceType: searchParams.get("resourceType") || undefined,
      dateFrom: searchParams.get("dateFrom") || undefined,
      dateTo: searchParams.get("dateTo") || undefined,
      page: Math.max(1, parseInt(searchParams.get("page") || "1") || 1),
      pageSize: Math.max(1, Math.min(parseInt(searchParams.get("pageSize") || "25") || 25, 500)),
      sortBy: searchParams.get("sortBy") || "created_at",
      sortOrder:
        (searchParams.get("sortOrder") as "asc" | "desc") || "desc",
    };

    let query = supabase.from("activity_logs").select("*", { count: "exact" });

    if (filters.actorType) {
      query = query.eq("actor_type", filters.actorType);
    }
    if (filters.actorId) {
      query = query.eq("actor_id", filters.actorId);
    }
    if (filters.action) {
      // Support comma-separated actions
      const actions = filters.action.split(",").map((a) => a.trim());
      if (actions.length > 1) {
        query = query.in("action", actions);
      } else {
        query = query.eq("action", filters.action);
      }
    }
    if (filters.resourceType) {
      query = query.eq("resource_type", filters.resourceType);
    }
    if (filters.dateFrom) {
      query = query.gte("created_at", `${filters.dateFrom}T00:00:00`);
    }
    if (filters.dateTo) {
      query = query.lte("created_at", `${filters.dateTo}T23:59:59`);
    }
    if (filters.search) {
      // Wave 22D BUG FIX: pre-22D code did `.ilike("details::text", ...)`
      // which silently failed — Supabase JS does NOT interpret `::text`
      // casts inside the column-name parameter, so the filter was
      // either dropped or returned a swallowed PostgREST error.
      //
      // Mig 032 added a generated tsvector column `search_text` over
      // the most-searched details fields (reason, username, proxy_id,
      // host, tele_user_id) plus action/resource_type/resource_id, with
      // a GIN index for sub-millisecond full-text lookups even at 10M+
      // rows. We use `websearch` mode so the operator can pass natural
      // queries like `proxy_id "abc-123"` without escaping.
      query = query.textSearch("search_text", filters.search, {
        type: "websearch",
        config: "simple",
      });
    }

    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 25;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    // Wave 22D-3 SECURITY FIX: sortBy from LOGS_SORT allowlist (see
    // lib/sort-allowlist.ts for rationale).
    const safeSortBy = safeSort(LOGS_SORT, filters.sortBy);
    query = query
      .order(safeSortBy, {
        ascending: filters.sortOrder === "asc",
      })
      .range(from, to);

    const { data, error, count } = await query;

    if (error) throw error;

    const response: PaginatedResponse<ActivityLog> = {
      data: (data as ActivityLog[]) ?? [],
      total: count ?? 0,
      page,
      pageSize,
      totalPages: Math.ceil((count ?? 0) / pageSize),
    };

    return NextResponse.json({ success: true, ...response });
  } catch (error) {
    console.error("Logs list error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch logs" },
      { status: 500 }
    );
  }
}
