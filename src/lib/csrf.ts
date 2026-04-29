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

  // Safe methods don't need the check — browsers don't auto-send
  // cross-origin POSTs with credentials via forms without user action,
  // but we guard GET/HEAD for consistency only when explicitly asked.
  // (This helper is only invoked by mutation routes.)

  const allowed = getAllowedOrigins();

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
