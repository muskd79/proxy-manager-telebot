import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import type { Proxy, ProxyUpdate } from "@/types/database";
import { ProxyStatus } from "@/types/database";
import { requireAnyRole, requireAdminOrAbove, actorLabel } from "@/lib/auth";
import { logActivity } from "@/lib/logger";
import { UpdateProxySchema } from "@/lib/validations";
import { proxyMachine } from "@/lib/state-machine/proxy";
import { assertSameOrigin } from "@/lib/csrf";
import { normalizeNetworkType } from "@/lib/proxy-labels";

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
  const csrfErr = assertSameOrigin(request);
  if (csrfErr) return csrfErr;

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
      // Wave 22C: tags removed.
      notes,
      expires_at,
      assigned_to,
      // Wave 26-B (gap 1.3) — surface the purchase metadata fields.
      // The schema already validated them; pre-fix the route silently
      // dropped them on edit, so admins editing a proxy via Sửa
      // couldn't change vendor/price/category/network_type. Now the
      // route maps the API field names to their DB column names
      // (mirror of import/route.ts).
      network_type,
      category_id,
      purchase_date,
      purchase_price_usd,
      sale_price_usd,
      vendor_source,
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

    // Phase 1C (B-009) — atomic state-machine guard.
    // Pre-fix: SELECT current status (line 103) → check canTransition
    // (line 110) → UPDATE (line 141) had a TOCTOU window between
    // SELECT and UPDATE. Two admins editing concurrently could both
    // pass canTransition then both UPDATE → final state can be
    // illegal (banned→available bypassing maintenance).
    //
    // Fix: still validate canTransition up-front for UX (so we can
    // return 409 with a meaningful message), THEN add an atomic
    // `.eq("status", currentStatus)` to the UPDATE so the row is
    // only modified when its status hasn't changed in between.
    let expectedCurrentStatus: ProxyStatus | undefined;
    if (status !== undefined) {
      const { data: currentProxy } = await supabase
        .from("proxies")
        .select("status")
        .eq("id", id)
        .single();
      const currentStatus = currentProxy?.status as ProxyStatus | undefined;
      if (currentStatus && status !== currentStatus) {
        if (!proxyMachine.canTransition(currentStatus, status as ProxyStatus)) {
          return NextResponse.json(
            {
              success: false,
              error: `Invalid proxy transition: ${currentStatus} -> ${status}`,
            },
            { status: 409 },
          );
        }
      }
      expectedCurrentStatus = currentStatus;
    }

    if (host !== undefined) updateData.host = host;
    if (port !== undefined) updateData.port = port;
    if (type !== undefined) updateData.type = type;
    if (username !== undefined) updateData.username = username || null;
    if (password !== undefined) updateData.password = password || null;
    if (country !== undefined) updateData.country = country || null;
    if (city !== undefined) updateData.city = city || null;
    if (isp !== undefined) updateData.isp = isp || null;
    if (status !== undefined) updateData.status = status;
    // Wave 22C: tags update removed.
    if (notes !== undefined) updateData.notes = notes || null;
    if (expires_at !== undefined) updateData.expires_at = expires_at || null;
    if (assigned_to !== undefined) {
      updateData.assigned_to = assigned_to || null;
      if (assigned_to) {
        updateData.assigned_at = new Date().toISOString();
      }
    }
    // Wave 26-B (gap 1.3) — apply the purchase metadata + category +
    // network_type fields. API name → DB column mapping mirrors
    // import/route.ts: vendor_source → vendor_label,
    // purchase_price_usd → cost_usd. The other names are 1-to-1.
    // Wave 26-C — normalise on PATCH too. If admin types `IPv4` in the
    // edit form, we still write canonical `datacenter_ipv4` to DB.
    //
    // Wave 26-D bug hunt v2 [HIGH] — reject unknown network_type values
    // instead of silently storing NULL. Empty string still means "clear
    // the classification" (legitimate); a truthy unknown value is a typo
    // or stale UI option that should surface as a validation error.
    if (network_type !== undefined) {
      const truthy = typeof network_type === "string" && network_type.trim().length > 0;
      const canonical = normalizeNetworkType(network_type);
      if (truthy && !canonical) {
        return NextResponse.json(
          {
            success: false,
            error: `Unrecognised network_type: ${network_type}. Use one of: isp, datacenter_ipv4, datacenter_ipv6, residential, mobile, static_residential.`,
          },
          { status: 400 },
        );
      }
      updateData.network_type = canonical;
    }
    if (category_id !== undefined) updateData.category_id = category_id || null;
    if (purchase_date !== undefined) updateData.purchase_date = purchase_date || null;
    if (purchase_price_usd !== undefined) updateData.cost_usd = purchase_price_usd ?? null;
    if (sale_price_usd !== undefined) updateData.sale_price_usd = sale_price_usd ?? null;
    if (vendor_source !== undefined) updateData.vendor_label = vendor_source || null;

    let updateQuery = supabase
      .from("proxies")
      .update(updateData)
      .eq("id", id);
    // Phase 1C — atomic guard: only UPDATE if status hasn't changed.
    if (expectedCurrentStatus !== undefined) {
      updateQuery = updateQuery.eq("status", expectedCurrentStatus);
    }
    const { data, error } = await updateQuery.select().maybeSingle();

    if (error) throw error;
    if (!data) {
      // Phase 1C — concurrent change detected: another admin (or a
      // cron job) flipped the proxy's status between our read and
      // our write. Tell the caller to refresh and retry.
      return NextResponse.json(
        {
          success: false,
          error: "Proxy state changed concurrently. Please refresh and try again.",
        },
        { status: 409 },
      );
    }

    logActivity({
      actorType: "admin",
      actorId: admin.id,
      actorDisplayName: actorLabel(admin),
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
  const csrfErr = assertSameOrigin(request);
  if (csrfErr) return csrfErr;

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

      if (error) {
        // Wave 26-D bug hunt v2 [Debugger #1] — surface FK violation
        // (warranty_claims.proxy_id ON DELETE RESTRICT) as a friendly
        // 409 instead of a generic 500. Pre-fix admin saw "Xoá vĩnh
        // viễn thất bại" with no clue why.
        const code = (error as { code?: string }).code;
        if (code === "23503") {
          return NextResponse.json(
            {
              success: false,
              error: "fk_violation_warranty_claim",
              message:
                "Proxy này đang được tham chiếu bởi yêu cầu bảo hành (warranty_claims). Hãy xoá yêu cầu bảo hành liên quan trước khi xoá vĩnh viễn proxy.",
            },
            { status: 409 },
          );
        }
        throw error;
      }

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
      actorDisplayName: actorLabel(admin),
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
