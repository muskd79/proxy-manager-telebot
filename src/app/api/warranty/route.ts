/**
 * Wave 26-D-2 — /api/warranty route handlers.
 *
 *   GET  — admin lists warranty claims with rich filtering (mirror of
 *          /api/requests pattern). Supports filter by status, date
 *          range, proxy_id, reason_code, has_replacement, and resolved_by.
 *   POST — bot submits a new claim on user's behalf. Service-role
 *          authenticated (bot has its own auth path); requires
 *          telegram_id resolution to map to tele_user.
 *
 * The web admin UI doesn't directly POST to this endpoint — only the
 * Telegram bot does (user-side flow). Admin actions go through
 * /api/warranty/[id] PATCH.
 */

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAnyRole } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/csrf";
import { captureError } from "@/lib/error-tracking";
import { CreateWarrantyClaimSchema } from "@/lib/validations/warranty";
import { checkWarrantyEligibility, WARRANTY_REJECT_LABEL_VI } from "@/lib/warranty/eligibility";
import { loadWarrantySettings } from "@/lib/warranty/settings";
import { logProxyEvent } from "@/lib/warranty/events";
import { isUuid } from "@/lib/uuid";
import type {
  ApiResponse,
  PaginatedResponse,
} from "@/types/api";
import type {
  Proxy,
  WarrantyClaim,
  WarrantyClaimStatus,
  WarrantyReasonCode,
} from "@/types/database";

const PAGE_MAX = 100;

interface WarrantyClaimWithJoins extends WarrantyClaim {
  proxy?: Pick<Proxy, "id" | "host" | "port" | "type" | "status" | "category_id" | "network_type" | "country"> | null;
  user?: {
    id: string;
    telegram_id: number;
    username: string | null;
    first_name: string | null;
  } | null;
  replacement?: Pick<Proxy, "id" | "host" | "port" | "type"> | null;
  resolved_by_admin?: {
    id: string;
    email: string;
    full_name: string | null;
  } | null;
}

// ─── GET /api/warranty (admin list with filters) ──────────────────────
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { error: authError } = await requireAnyRole(supabase);
  if (authError) return authError;

  try {
    const sp = request.nextUrl.searchParams;

    // Filters
    const statusParam = sp.get("status"); // comma-separated allowed (mirror /requests)
    const dateFrom = sp.get("dateFrom") || undefined;
    const dateTo = sp.get("dateTo") || undefined;
    const reasonCode = sp.get("reasonCode") || undefined;
    const hasReplacement = sp.get("hasReplacement"); // "true" / "false" / null
    const resolvedBy = sp.get("resolvedBy") || undefined;
    const search = sp.get("search") || undefined;
    const proxyIdFilter = sp.get("proxyId") || undefined;
    const userIdFilter = sp.get("userId") || undefined;

    const page = Math.max(1, Number(sp.get("page")) || 1);
    const pageSize = Math.max(1, Math.min(Number(sp.get("pageSize")) || 20, PAGE_MAX));
    const offset = (page - 1) * pageSize;

    let q = supabase
      .from("warranty_claims")
      .select(
        "*, " +
          "proxy:proxies!warranty_claims_proxy_id_fkey(id,host,port,type,status,category_id,network_type,country), " +
          "user:tele_users!warranty_claims_user_id_fkey(id,telegram_id,username,first_name), " +
          "replacement:proxies!warranty_claims_replacement_proxy_id_fkey(id,host,port,type), " +
          "resolved_by_admin:admins!warranty_claims_resolved_by_fkey(id,email,full_name)",
        { count: "exact" },
      );

    if (statusParam) {
      const statuses = statusParam.split(",").map((s) => s.trim()).filter(Boolean);
      if (statuses.length === 1) {
        q = q.eq("status", statuses[0]);
      } else if (statuses.length > 1) {
        q = q.in("status", statuses);
      }
    }
    if (dateFrom) q = q.gte("created_at", `${dateFrom}T00:00:00Z`);
    if (dateTo) q = q.lte("created_at", `${dateTo}T23:59:59Z`);
    if (reasonCode) q = q.eq("reason_code", reasonCode);
    if (hasReplacement === "true") q = q.not("replacement_proxy_id", "is", null);
    if (hasReplacement === "false") q = q.is("replacement_proxy_id", null);
    if (resolvedBy && isUuid(resolvedBy)) {
      q = q.eq("resolved_by", resolvedBy);
    }
    if (proxyIdFilter && isUuid(proxyIdFilter)) {
      q = q.eq("proxy_id", proxyIdFilter);
    }
    if (userIdFilter && isUuid(userIdFilter)) {
      q = q.eq("user_id", userIdFilter);
    }
    if (search) {
      // Wave 26-D bug hunt [HIGH-1] — sanitize before string-interpolating
      // into PostgREST .or() filter. PostgREST treats `,`, `(`, `)`, `.`
      // as filter syntax separators; admin-typed garbage could escape
      // and either bypass other filters or trip a server-side parse
      // error. Pre-fix: search="x," allowed manipulating the filter
      // tree.
      // Strategy: strip every PostgREST-meaningful char + cap length.
      const safeSearch = search
        .replace(/[,()*%\\]/g, " ")
        .trim()
        .slice(0, 100);
      if (safeSearch.length >= 2) {
        q = q.or(
          `reason_text.ilike.%${safeSearch}%,rejection_reason.ilike.%${safeSearch}%`,
        );
      }
    }

    const { data, error, count } = await q
      .order("created_at", { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (error) {
      captureError(error, { source: "api.warranty.list" });
      return NextResponse.json(
        { success: false, error: error.message } satisfies ApiResponse<never>,
        { status: 500 },
      );
    }

    const total = count ?? 0;
    const response: ApiResponse<PaginatedResponse<WarrantyClaimWithJoins>> = {
      success: true,
      data: {
        // Supabase JS infers union with GenericStringError on JOIN
        // queries. Double-cast keeps the public API contract clean
        // without polluting the join chain with type guards.
        data: (data as unknown as WarrantyClaimWithJoins[]) ?? [],
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    };
    return NextResponse.json(response);
  } catch (err) {
    captureError(err, { source: "api.warranty.list.unexpected" });
    return NextResponse.json(
      { success: false, error: "Internal server error" } satisfies ApiResponse<never>,
      { status: 500 },
    );
  }
}

// ─── POST /api/warranty — bot submits a claim on user's behalf ────────
//
// Auth path: this route is called by the Telegram bot's webhook handler,
// NOT by the admin web UI. It uses the bot service-role token to bypass
// RLS and uses x-bot-secret header for additional defence (not just any
// service-role caller can submit).
export async function POST(request: NextRequest) {
  // Wave 26-D bug hunt v3 [HIGH] — order: bot-secret FIRST, CSRF SECOND.
  //
  // Pre-fix: `assertSameOrigin(request)` ran before the x-bot-secret
  // check. Server-to-server calls (the Telegram bot's Node process)
  // have NO `Origin` header, so assertSameOrigin returned 403 for every
  // legitimate bot POST — warranty submissions over the HTTP boundary
  // would silently fail with no audit. The in-process bot bypassed
  // this by writing the row directly via `submitWarrantyClaim` in
  // src/lib/telegram/commands/warranty.ts, so the bug never surfaced
  // — but external bot deployments (future use case) would have been
  // blocked.
  //
  // Now: x-bot-secret IS the credential for this path. If it's
  // present + valid, we trust the caller and skip CSRF. If it's
  // absent or wrong, we 401 and don't waste cycles on the same-origin
  // check (which couldn't have helped anyway).
  //
  // Wave 26-D bug hunt [P0-1, security C2] — timing-safe comparison.
  // Pre-fix: `botSecret !== expected` allowed a timing oracle that
  // could leak the secret one char at a time. Now use Node's
  // crypto.timingSafeEqual which runs in constant time.
  const botSecret = request.headers.get("x-bot-secret");
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!botSecret || !expected) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" } satisfies ApiResponse<never>,
      { status: 401 },
    );
  }
  const a = Buffer.from(botSecret);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" } satisfies ApiResponse<never>,
      { status: 401 },
    );
  }
  // Bot secret valid — bypass CSRF (server-to-server caller, no Origin).

  try {
    const body = await request.json();
    const parsed = CreateWarrantyClaimSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Validation failed",
          message: parsed.error.issues.map((i) => i.message).join("; "),
        } satisfies ApiResponse<never>,
        { status: 400 },
      );
    }

    // Wave 26-D bug hunt v2 [MEDIUM] — `user_id` is now part of the
    // schema (was previously pulled out of raw body separately). Schema
    // already enforced UUID shape; the tele_users existence check below
    // remains as defence-in-depth (a leaked bot secret could still
    // submit claims for any well-formed but unknown UUID).
    const { proxy_id, user_id: userId, reason_code, reason_text } = parsed.data;

    const userRes = await supabaseAdmin
      .from("tele_users")
      .select("id")
      .eq("id", userId)
      .eq("is_deleted", false)
      .maybeSingle();
    if (userRes.error || !userRes.data) {
      return NextResponse.json(
        { success: false, error: "User not found" } satisfies ApiResponse<never>,
        { status: 404 },
      );
    }

    // Fetch the proxy + user's claims (full set within 30 days) +
    // settings for the eligibility gate.
    //
    // Wave 26-D bug hunt [HIGH-3, security H3] — drop the .limit(50)
    // that pre-fix truncated the eligibility gate's view. With a
    // raised max_per_30d, a user with 50+ historical claims could
    // bypass the cap silently. Scope query to last 30 days only —
    // older claims don't matter for any of the 3 caps (pending,
    // 30d cap, cooldown all live in the trailing 30d window).
    const sinceIso = new Date(
      Date.now() - 30 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const [proxyRes, claimsRes, settings] = await Promise.all([
      supabaseAdmin.from("proxies").select("*").eq("id", proxy_id).single(),
      supabaseAdmin
        .from("warranty_claims")
        .select("id, proxy_id, status, created_at")
        .eq("user_id", userId)
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false }),
      loadWarrantySettings(),
    ]);

    if (proxyRes.error || !proxyRes.data) {
      return NextResponse.json(
        { success: false, error: "Proxy not found" } satisfies ApiResponse<never>,
        { status: 404 },
      );
    }

    // Run the eligibility gate.
    const eligibility = checkWarrantyEligibility({
      proxy: proxyRes.data as Proxy,
      userId,
      userClaims: claimsRes.data ?? [],
      settings,
    });
    if (!eligibility.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: eligibility.code,
          message: WARRANTY_REJECT_LABEL_VI[eligibility.code],
        } satisfies ApiResponse<never>,
        { status: 422 },
      );
    }

    // Insert claim + atomic state transition on the proxy.
    // Wave 26-D — transaction would be ideal but Supabase JS doesn't
    // expose a transaction primitive directly. We do the 2 writes
    // sequentially and roll back the proxy update if claim insert
    // fails. The reverse (claim succeeded but proxy update failed)
    // is rare (FK constraint already passed) and would leave a
    // pending claim with status_changed event — admin can resolve.
    const { data: claim, error: claimErr } = await supabaseAdmin
      .from("warranty_claims")
      .insert({
        proxy_id,
        user_id: userId,
        reason_code,
        reason_text: reason_text ?? null,
        status: "pending" as WarrantyClaimStatus,
      })
      .select("*")
      .single();

    if (claimErr || !claim) {
      // Wave 26-D bug hunt [HIGH-1, debugger #1] — partial UNIQUE
      // index in mig 058 raises 23505 (unique_violation) when two
      // simultaneous taps both try to insert pending claims for the
      // same (user, proxy). Translate to 409 with a friendly message
      // instead of a generic 500.
      const code = (claimErr as { code?: string } | null)?.code;
      if (code === "23505") {
        return NextResponse.json(
          {
            success: false,
            error: "duplicate_pending_claim",
            message: WARRANTY_REJECT_LABEL_VI.duplicate_pending_claim,
          } satisfies ApiResponse<never>,
          { status: 409 },
        );
      }
      captureError(claimErr ?? new Error("Claim insert returned no row"), {
        source: "api.warranty.create.insert",
        extra: { proxy_id, userId, reason_code },
      });
      return NextResponse.json(
        { success: false, error: "Failed to create claim" } satisfies ApiResponse<never>,
        { status: 500 },
      );
    }

    // Transition proxy.status assigned → reported_broken.
    const { error: statusErr } = await supabaseAdmin
      .from("proxies")
      .update({ status: "reported_broken" })
      .eq("id", proxy_id)
      .eq("status", "assigned"); // optimistic guard

    if (statusErr) {
      captureError(statusErr, {
        source: "api.warranty.create.status_transition",
        extra: { proxy_id, claim_id: claim.id },
      });
      // Don't fail the request — claim is in. Admin can resolve.
    }

    // Audit event — reported_broken. Best-effort.
    await logProxyEvent({
      proxy_id,
      event_type: "reported_broken",
      actor_type: "tele_user",
      actor_id: userId,
      related_user_id: userId,
      details: {
        reason_code,
        reason_text: reason_text ?? null,
        claim_id: claim.id,
      },
    });

    return NextResponse.json(
      { success: true, data: claim as WarrantyClaim } satisfies ApiResponse<WarrantyClaim>,
      { status: 201 },
    );
  } catch (err) {
    captureError(err, { source: "api.warranty.create.unexpected" });
    return NextResponse.json(
      { success: false, error: "Internal server error" } satisfies ApiResponse<never>,
      { status: 500 },
    );
  }
}
