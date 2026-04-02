import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import type { LogFilters, PaginatedResponse } from "@/types/api";
import type { ActivityLog } from "@/types/database";
import { requireAnyRole } from "@/lib/auth";

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
      page: parseInt(searchParams.get("page") || "1"),
      pageSize: parseInt(searchParams.get("pageSize") || "25"),
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
      // Search in details JSONB - cast to text for ilike search
      query = query.ilike("details::text" as string, `%${filters.search}%`);
    }

    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 25;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    query = query
      .order(filters.sortBy ?? "created_at", {
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
      { error: "Failed to fetch logs" },
      { status: 500 }
    );
  }
}
