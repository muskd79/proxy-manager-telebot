import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import type { ProxyFilters, PaginatedResponse } from "@/types/api";
import type { Proxy } from "@/types/database";
import { requireAnyRole, requireAdminOrAbove, actorLabel } from "@/lib/auth";
import { logActivity } from "@/lib/logger";
import { CreateProxySchema } from "@/lib/validations";
import { captureError } from "@/lib/error-tracking";
import { PROXIES_SORT, safeSort } from "@/lib/sort-allowlist";
import { assertSameOrigin } from "@/lib/csrf";

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
      // Wave 22C: tags filter removed. Use ?category_id=X (Wave 22A).
      page: Math.max(1, parseInt(searchParams.get("page") || "1") || 1),
      pageSize: Math.max(1, Math.min(parseInt(searchParams.get("pageSize") || "20") || 20, 500)),
      sortBy: searchParams.get("sortBy") || "created_at",
      sortOrder:
        (searchParams.get("sortOrder") as "asc" | "desc") || "desc",
      isDeleted: searchParams.get("isDeleted") === "true",
    };

    // Wave 21C perf at 10k+ scale:
    // count: "exact" forces a full COUNT(*) on every list call. With
    // 10k+ rows + dynamic filters, that's the dominant query cost. Use
    // "estimated" when ANY filter is applied (the user is drilling down,
    // total count is approximate anyway), and "exact" only on the
    // unfiltered top-of-funnel "list everything" query where the badge
    // is meaningful. Cursor-paginated requests skip count entirely.
    const cursorDate = searchParams.get("cursor");
    // Wave 22S — lot_id removed (purchase_lots dropped in mig 040).
    const categoryId = searchParams.get("category_id"); // Wave 22A
    const expiringWithin = searchParams.get("expiring_within"); // hours
    const vendorLabel = searchParams.get("vendor_label");

    const hasFilter =
      !!(filters.search || filters.type || filters.status || filters.country
        || categoryId || expiringWithin || vendorLabel);
    const countMode: "exact" | "estimated" | undefined = cursorDate
      ? undefined
      : hasFilter
        ? "estimated"
        : "exact";

    let query = supabase
      .from("proxies")
      .select("*", countMode ? { count: countMode } : {})
      .eq("is_deleted", filters.isDeleted ?? false);

    if (filters.search) {
      query = query.ilike("host", `%${filters.search}%`);
    }
    if (filters.type) {
      query = query.eq("type", filters.type);
    }
    // Wave 22Z + 22AB — synthetic statuses overlay the DB enum.
    //   "hidden":         filter-only; matches proxies.hidden=true
    //                     (cascade trigger keeps this in sync with
    //                     category.is_hidden, so one column covers
    //                     manual + cascade hide).
    //   "expiring_soon":  derived; expires_at in (NOW, NOW+3d].
    //                     Excludes banned + hidden so the bucket is
    //                     actionable (admin sees only proxies they
    //                     can renew or reassign).
    //   real enum:        normal status equality + default hide guard.
    if (filters.status === "hidden") {
      query = query.eq("hidden", true);
    } else if (filters.status === "expiring_soon") {
      const now = new Date().toISOString();
      const threeDays = new Date(Date.now() + 3 * 86_400_000).toISOString();
      query = query
        .not("expires_at", "is", null)
        .gt("expires_at", now)
        .lte("expires_at", threeDays)
        .neq("status", "banned");
    } else if (filters.status) {
      query = query.eq("status", filters.status);
    }
    if (filters.country) {
      query = query.eq("country", filters.country);
    }

    // Wave 22J — phân loại proxy (network_type)
    const networkType = searchParams.get("networkType") || searchParams.get("network_type");
    if (networkType) {
      query = query.eq("network_type", networkType);
    }

    // Wave 22J → 22L (CRITICAL FIX C3) — Hạn dùng filter (derived).
    //
    // Pre-22L bug: `valid` mapped to `> NOW()+7d` — proxy còn 6 ngày
    // bị ẩn khỏi list. Comment ghi đúng "valid = NULL OR > NOW()"
    // nhưng code sai. User filter "Còn hạn" thấy ít proxy hơn thực
    // tế → đếm sai inventory → có nguy cơ giao thiếu proxy.
    //
    // Wave 22L correct semantics (matches the badge logic in
    // lib/proxy-labels.ts:deriveExpiryStatus):
    //   never          : expires_at IS NULL
    //   expired        : expires_at <= NOW()  (must be non-null)
    //   expiring_soon  : NOW() < expires_at <= NOW()+7d
    //   valid          : expires_at > NOW()+7d  OR  expires_at IS NULL
    const expiryStatus = searchParams.get("expiryStatus") || searchParams.get("expiry_status");
    if (expiryStatus) {
      const now = new Date().toISOString();
      const sevenD = new Date(Date.now() + 7 * 86_400_000).toISOString();
      if (expiryStatus === "expired") {
        query = query.not("expires_at", "is", null).lte("expires_at", now);
      } else if (expiryStatus === "expiring_soon") {
        query = query.gt("expires_at", now).lte("expires_at", sevenD);
      } else if (expiryStatus === "valid") {
        query = query.or(`expires_at.is.null,expires_at.gt.${sevenD}`);
      } else if (expiryStatus === "never") {
        query = query.is("expires_at", null);
      }
    }

    // Wave 22G — cascade hide (default off; admin explicitly opts in
    // to see hidden rows from /proxies?include_hidden=true).
    // Wave 22Z + 22AB — when status branches to a synthetic value
    // ("hidden" or "expiring_soon") that already enforces hidden
    // explicitly, skip this default guard so we don't emit a
    // contradictory predicate.
    const includeHidden = searchParams.get("include_hidden") === "true";
    const skipDefaultHideGuard =
      filters.status === "hidden" || filters.status === "expiring_soon";
    if (!includeHidden && !skipDefaultHideGuard) {
      query = query.eq("hidden", false);
    }
    // expiring_soon also needs to exclude hidden rows (they're not
    // actionable). Apply explicitly here so the bucket is clean.
    if (filters.status === "expiring_soon") {
      query = query.eq("hidden", false);
    }

    // Wave 22C: tags filter removed (Wave 22A categories supersede it).
    // Wave 22S: lot_id filter removed (purchase_lots dropped in mig 040).
    // Wave 22A: filter by category — drives `/proxies?category_id=X` from
    // /categories. Uses idx_proxies_category_id (mig 028).
    if (categoryId) {
      query = query.eq("category_id", categoryId);
    }
    // Wave 21C: filter by free-text vendor label.
    if (vendorLabel) {
      query = query.eq("vendor_label", vendorLabel);
    }
    // Wave 21C: "Expiring within N hours" quick chip. Uses
    // idx_proxies_expiry_vendor (Wave 21A index).
    if (expiringWithin) {
      const hours = Math.max(1, Math.min(parseInt(expiringWithin, 10) || 24, 24 * 90));
      const horizon = new Date(Date.now() + hours * 3600_000).toISOString();
      query = query.lt("expires_at", horizon).gte("expires_at", new Date().toISOString());
    }

    // Wave 22Y — ?isp= filter dropped (column removed from UI). API
    // still accepts the field on POST/PUT for backward-compat with
    // existing imports/scripts; just no longer queryable here.

    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 20;
    // cursorDate already pulled from searchParams above (Wave 21C)

    // Wave 22D-3 SECURITY FIX: sortBy must be from PROXIES_SORT allowlist;
    // unvalidated input let attackers reach unintended columns or trigger
    // schema-leaking 500 responses (raw error.message returned to client).
    const safeSortBy = safeSort(PROXIES_SORT, filters.sortBy);
    query = query.order(safeSortBy, {
      ascending: filters.sortOrder === "asc",
    });

    if (cursorDate) {
      // Cursor-based pagination: O(1) performance for large datasets
      if (filters.sortOrder === "asc") {
        query = query.gt("created_at", cursorDate);
      } else {
        query = query.lt("created_at", cursorDate);
      }
      query = query.limit(pageSize);
    } else {
      // Offset-based pagination (backward compatible)
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      query = query.range(from, to);
    }

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

    // Build next cursor from last item for cursor-based pagination
    const nextCursor =
      responseData.length === pageSize
        ? responseData[responseData.length - 1]?.created_at ?? null
        : null;

    const response: PaginatedResponse<Proxy> & { nextCursor?: string | null } = {
      data: responseData,
      total: count ?? 0,
      page: cursorDate ? 0 : page,
      pageSize,
      totalPages: cursorDate ? 0 : Math.ceil((count ?? 0) / pageSize),
      ...(cursorDate !== null && cursorDate !== undefined ? { nextCursor } : {}),
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
  const csrfErr = assertSameOrigin(request);
  if (csrfErr) return csrfErr;

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

    // Wave 22C: tags removed. Wave 23B: persist category_id from single-add form.
    const { host, port, type, network_type, username, password, country, city, isp, category_id, notes, expires_at } = parsed.data;

    const insertData = {
      host,
      port,
      type,
      network_type: network_type || null,
      username: username || null,
      password: password || null,
      country: country || null,
      city: city || null,
      isp: isp || null,
      category_id: category_id || null,
      status: "available" as const,
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
      actorDisplayName: actorLabel(admin),
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
