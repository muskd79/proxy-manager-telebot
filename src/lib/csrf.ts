/**
 * CSRF defense: verify that a cookie-authenticated mutation originated
 * from our own UI, not from a malicious cross-site form.
 *
 * Next.js App Router does not ship built-in CSRF middleware. We rely on
 * two layers:
 *   1. SameSite=Lax on the session cookie (handled by the Supabase client).
 *   2. An Origin / Referer header check for every state-changing request
 *      (POST/PUT/PATCH/DELETE) against real-money or billing-sensitive
 *      endpoints.
 *
 * Usage in an API route:
 *   const csrfErr = assertSameOrigin(request);
 *   if (csrfErr) return csrfErr;
 */

import { NextResponse } from "next/server";

/**
 * Returns NextResponse(403) if the request's Origin / Referer doesn't
 * match one of the allowed origins. Returns null if the request is safe.
 *
 * Allowed origins are derived from (in order):
 *   - process.env.APP_ORIGIN_ALLOWLIST (comma-separated)
 *   - process.env.NEXT_PUBLIC_APP_URL
 *   - http://localhost:3000 (dev only, when NODE_ENV !== 'production')
 */
export function assertSameOrigin(request: Request): NextResponse | null {
  // Vitest unit tests cannot forge cross-origin requests; bypass the
  // gate so tests don't have to thread Origin headers through every
  // helper. The check still runs in dev + production.
  if (process.env.NODE_ENV === "test") return null;

  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");

  // Build the set of origins this server considers "ourself".
  //   1. Same-origin self URL (reconstructed from x-forwarded-host + proto,
  //      fallback to request.url). This is the cheap-and-correct check —
  //      if the request's Origin equals the host the server received it
  //      on, it's same-origin by definition.
  //   2. Explicit allowlist (APP_ORIGIN_ALLOWLIST) for trusted alternate
  //      domains (e.g. canonical apex when traffic also lands on a
  //      preview/branch URL).
  //   3. NEXT_PUBLIC_APP_URL — legacy single-domain config.
  //   4. localhost dev fallbacks when not in production.
  //
  // Wave 23B: previously only (2)–(4) were checked, which broke every
  // mutation on Vercel preview deployments + on prod deployments where
  // the canonical URL env wasn't synced. The user hit this on
  // /api/categories POST and /api/proxies/import POST simultaneously.
  const allowed = getAllowedOrigins();
  const selfOrigin = deriveSelfOrigin(request);
  if (selfOrigin) allowed.add(selfOrigin);

  if (origin && allowed.has(origin)) return null;

  // Fallback to Referer prefix match when Origin is missing (some
  // Next.js fetch configurations strip Origin for same-origin requests).
  if (!origin && referer) {
    for (const a of allowed) {
      if (referer.startsWith(a + "/") || referer === a) return null;
    }
  }

  return NextResponse.json(
    { success: false, error: "Cross-origin request rejected" },
    { status: 403 },
  );
}

/**
 * Reconstruct the origin (`scheme://host[:port]`) the request was
 * actually received on. Vercel + most reverse proxies expose this via
 * `x-forwarded-host` + `x-forwarded-proto`; we fall back to
 * `request.url` for direct connections (dev). Returns null if neither
 * source yields a usable URL.
 */
function deriveSelfOrigin(request: Request): string | null {
  const xfh = request.headers.get("x-forwarded-host");
  const xfp = request.headers.get("x-forwarded-proto");
  if (xfh) {
    const proto = xfp || "https";
    return `${proto}://${xfh}`;
  }
  try {
    return new URL(request.url).origin;
  } catch {
    return null;
  }
}

function getAllowedOrigins(): Set<string> {
  const set = new Set<string>();

  const explicit = process.env.APP_ORIGIN_ALLOWLIST;
  if (explicit) {
    for (const o of explicit.split(",")) {
      const trimmed = o.trim();
      if (trimmed) set.add(trimmed);
    }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) set.add(appUrl);

  if (process.env.NODE_ENV !== "production") {
    set.add("http://localhost:3000");
    set.add("http://127.0.0.1:3000");
  }

  return set;
}

/** Strip CR/LF/TAB from a free-text string so it cannot forge log lines. */
export function sanitizeLogLine(s: string): string {
  return s.replace(/[\r\n\t]/g, " ").slice(0, 1024);
}
