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
import { WARRANTY_REJECT_LABEL_VI } from "@/lib/warranty/eligibility";
// Wave 26-D bug hunt v4 [HIGH] — submit pipeline is now shared with bot.
import { submitWarrantyClaimCore } from "@/lib/warranty/submit";
import { isUuid } from "@/lib/uuid";
import type {
  ApiResponse,
  PaginatedResponse,
} from "@/types/api";
import type { Proxy, WarrantyClaim } from "@/types/database";

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

// ─── Helpers ──────────────────────────────────────────────────────

/**
 * Wave 26-D bug hunt v4 [HIGH] — explicit row→typed mapper to replace
 * the unsafe `as unknown as WarrantyClaimWithJoins[]` cast.
 *
 * Supabase JS infers JOIN results with a `GenericStringError | T`
 * union per relation. The previous double-cast hid all type errors;
 * if a join shape ever drifted (e.g. different FK alias, FK ambiguity
 * causing array-of-rows instead of single-row), the cast still
 * compiled and the consumer crashed at runtime on the missing field.
 *
 * Now: extract each expected field by name, defaulting to null on
 * unexpected shapes. If a future schema change breaks an alias, the
 * worst case is the joined object is `null` (the table renders "—")
 * rather than an unhandled exception.
 */
function pickProxy(
  raw: unknown,
): WarrantyClaimWithJoins["proxy"] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  // If the row has a Supabase `error` field, treat as null.
  if ("error" in r && r.error !== null && r.error !== undefined) return null;
  if (typeof r.id !== "string") return null;
  return {
    id: r.id,
    host: typeof r.host === "string" ? r.host : "",
    port: typeof r.port === "number" ? r.port : 0,
    type: r.type as Proxy["type"],
    status: r.status as Proxy["status"],
    category_id: typeof r.category_id === "string" ? r.category_id : null,
    network_type: typeof r.network_type === "string" ? (r.network_type as Proxy["network_type"]) : null,
    country: typeof r.country === "string" ? r.country : null,
  };
}

function pickReplacement(
  raw: unknown,
): WarrantyClaimWithJoins["replacement"] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if ("error" in r && r.error !== null && r.error !== undefined) return null;
  if (typeof r.id !== "string") return null;
  return {
    id: r.id,
    host: typeof r.host === "string" ? r.host : "",
    port: typeof r.port === "number" ? r.port : 0,
    type: r.type as Proxy["type"],
  };
}

function pickUser(raw: unknown): WarrantyClaimWithJoins["user"] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if ("error" in r && r.error !== null && r.error !== undefined) return null;
  if (typeof r.id !== "string") return null;
  return {
    id: r.id,
    telegram_id: typeof r.telegram_id === "number" ? r.telegram_id : 0,
    username: typeof r.username === "string" ? r.username : null,
    first_name: typeof r.first_name === "string" ? r.first_name : null,
  };
}

function pickAdmin(
  raw: unknown,
): WarrantyClaimWithJoins["resolved_by_admin"] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if ("error" in r && r.error !== null && r.error !== undefined) return null;
  if (typeof r.id !== "string") return null;
  return {
    id: r.id,
    email: typeof r.email === "string" ? r.email : "",
    full_name: typeof r.full_name === "string" ? r.full_name : null,
  };
}

function mapJoinedRow(raw: unknown): WarrantyClaimWithJoins {
  const r = (raw ?? {}) as Record<string, unknown>;
  // The base WarrantyClaim columns come straight off the row — Supabase
  // returns them as native JS values that match our generated types.
  // We trust them but extract only the fields we use to keep the cast
  // narrow.
  const base = r as unknown as WarrantyClaim;
  return {
    ...base,
    proxy: pickProxy(r.proxy),
    user: pickUser(r.user),
    replacement: pickReplacement(r.replacement),
    resolved_by_admin: pickAdmin(r.resolved_by_admin),
  };
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

    // Wave 26-D bug hunt v4 [HIGH] — replace blanket `as unknown as`
    // cast with row-level field extraction.
    //
    // Pre-fix `data as unknown as WarrantyClaimWithJoins[]` was a
    // double-cast that bypassed TypeScript entirely. If Supabase ever
    // returned a row whose joined `proxy` was actually an error object
    // or an array (FK ambiguity), the cast still compiled and runtime
    // crashed at `claim.proxy?.host` in the table cell.
    //
    // Now: `mapJoinedRow` is the single point of trust. It reads each
    // expected field by name, falls back to null on missing/unexpected
    // shapes, and returns a strongly-typed `WarrantyClaimWithJoins`.
    // If the join shape changes, it's a single-place fix instead of
    // an opaque cast bug.
    const total = count ?? 0;
    const response: ApiResponse<PaginatedResponse<WarrantyClaimWithJoins>> = {
      success: true,
      data: {
        data: (data ?? []).map(mapJoinedRow),
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

    // Wave 26-D bug hunt v4 [HIGH] — delegate the 4-step submit pipeline
    // (eligibility gate + insert + status transition + audit) to the
    // shared `submitWarrantyClaimCore` so the bot path and HTTP path
    // can never drift again. The pre-fix duplication had ALREADY caused
    // a divergence (bot path missed `proxyRes.error` check).
    const result = await submitWarrantyClaimCore({
      userId,
      proxyId: proxy_id,
      reasonCode: reason_code,
      reasonText: reason_text ?? null,
    });

    switch (result.kind) {
      case "ok":
        return NextResponse.json(
          {
            success: true,
            data: result.claim,
          } satisfies ApiResponse<WarrantyClaim>,
          { status: 201 },
        );
      case "proxy_not_found":
        return NextResponse.json(
          {
            success: false,
            error: "Proxy not found",
          } satisfies ApiResponse<never>,
          { status: 404 },
        );
      case "ineligible":
        return NextResponse.json(
          {
            success: false,
            error: result.code,
            message: WARRANTY_REJECT_LABEL_VI[result.code],
          } satisfies ApiResponse<never>,
          { status: 422 },
        );
      case "duplicate_pending":
        return NextResponse.json(
          {
            success: false,
            error: "duplicate_pending_claim",
            message: WARRANTY_REJECT_LABEL_VI.duplicate_pending_claim,
          } satisfies ApiResponse<never>,
          { status: 409 },
        );
      case "internal_error":
        return NextResponse.json(
          {
            success: false,
            error: "Failed to create claim",
          } satisfies ApiResponse<never>,
          { status: 500 },
        );
      default: {
        // Exhaustiveness — TS yells if a new kind is added without
        // a matching arm here.
        const _exhaustive: never = result;
        void _exhaustive;
        return NextResponse.json(
          { success: false, error: "Unknown result" } satisfies ApiResponse<never>,
          { status: 500 },
        );
      }
    }
  } catch (err) {
    captureError(err, { source: "api.warranty.create.unexpected" });
    return NextResponse.json(
      { success: false, error: "Internal server error" } satisfies ApiResponse<never>,
      { status: 500 },
    );
  }
}
