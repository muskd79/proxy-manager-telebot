import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrAbove } from "@/lib/auth";
import { detectProxy, type ProxyDetectResult } from "@/lib/proxy-detect";
import { assertSameOrigin } from "@/lib/csrf";
// Wave 28-F [HIGH, audit #4] — pre-Zod SSRF guard. Pre-fix the schema
// only validated host shape; the runtime check inside detectProxy()
// would set ssrf_blocked=true but a `speed_ms` value still leaked,
// usable as a timing oracle to fingerprint internal services. Now
// rejected at parse-time so the request never reaches detectProxy()
// for obvious private literals.
import { validatePublicHostLiteral } from "@/lib/security/public-ip";
import { z } from "zod";

/**
 * Wave 22H — POST /api/proxies/probe-batch
 *
 * Bulk auto-detect for the import wizard. Accepts up to 1000
 * { host, port } pairs and returns a probe result for each.
 *
 * Concurrency design:
 *   - The naive approach (Promise.all on all 1000) opens 3000
 *     concurrent sockets (3 protocol probes × 1000 hosts) which
 *     exhausts file descriptors on the Lambda host and floods the
 *     network egress.
 *   - We process in waves of MAX_CONCURRENT_HOSTS hosts. Each host
 *     itself fires 3 sockets internally; total simultaneous
 *     sockets = MAX × 3.
 *   - 50 × 3 = 150 sockets in flight. Tested on Vercel hobby tier;
 *     stays well under the FD limit while keeping wall-clock
 *     reasonable (1000 hosts × 5s timeout / 50 parallel ≈ 100s
 *     worst case for all-dead; <30s typical for mostly-alive).
 *
 * The endpoint streams results back? No — for simplicity in this
 * wave, we wait for all probes and return as one JSON. UI shows
 * a "Probing N proxies, please wait..." spinner. If wall-clock
 * becomes a real issue at 1000-scale, a Wave 22I could switch to
 * Server-Sent Events / streaming JSON.
 *
 * Privacy: identical TCP-only probe as the single-host endpoint —
 * NO external GeoIP calls (Wave 22H removed those). Admin's
 * proxy IPs never leave our server.
 *
 * Rate limit: admin-only via requireAdminOrAbove. Each batch
 * costs ~150 sockets × N seconds. The 1000-row cap + 5s timeout
 * prevents a single call from running >2 minutes.
 */

const MAX_CONCURRENT_HOSTS = 50;
const MAX_BATCH_SIZE = 1000;

const ProbeBatchSchema = z.object({
  proxies: z
    .array(
      z.object({
        // Wave 28-F [HIGH] — refine rejects private/loopback/link-local
        // literals at parse time so the row never reaches detectProxy()
        // and can't leak a timing-oracle speed_ms.
        host: z
          .string()
          .min(1)
          .max(253)
          .refine(
            (s) => validatePublicHostLiteral(s) === null,
            { message: "Host resolves to a private or reserved address (SSRF guard)" },
          ),
        port: z.coerce.number().int().min(1).max(65535),
        // Allow caller to pass back a per-row tag (e.g., line number
        // from the import wizard) so they can correlate the result
        // with the source row without relying on order.
        ref: z.string().max(64).optional(),
      }),
    )
    .min(1)
    .max(MAX_BATCH_SIZE),
});

interface BatchProbeResult {
  ref?: string;
  host: string;
  port: number;
  alive: boolean;
  type: "http" | "https" | "socks5" | null;
  speed_ms: number;
  ssrf_blocked?: boolean;
}

export async function POST(request: NextRequest) {
  const csrfErr = assertSameOrigin(request);
  if (csrfErr) return csrfErr;

  const supabase = await createClient();
  const { error: authError } = await requireAdminOrAbove(supabase);
  if (authError) return authError;

  const parsed = ProbeBatchSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: "Validation failed",
        details: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  const { proxies } = parsed.data;
  const results: BatchProbeResult[] = [];

  // Process in waves to bound concurrency. Each wave waits for all
  // its in-flight probes to finish before starting the next.
  for (let i = 0; i < proxies.length; i += MAX_CONCURRENT_HOSTS) {
    const batch = proxies.slice(i, i + MAX_CONCURRENT_HOSTS);
    const batchResults = await Promise.all(
      batch.map(async (p) => {
        const detect: ProxyDetectResult = await detectProxy(p.host, p.port);
        return {
          ref: p.ref,
          host: p.host,
          port: p.port,
          alive: detect.alive,
          type: detect.type,
          // Wave 28-F [HIGH] — zero out speed_ms when ssrf_blocked.
          // Pre-fix the response leaked the actual probe timing even
          // for blocked hosts, usable as a timing oracle to
          // fingerprint internal services. Now: 0 on block.
          speed_ms: detect.ssrf_blocked ? 0 : detect.speed_ms,
          ssrf_blocked: detect.ssrf_blocked,
        } satisfies BatchProbeResult;
      }),
    );
    results.push(...batchResults);
  }

  // Summary stats so the UI can render "245 SOCKS5, 612 HTTP, 87
  // HTTPS, 56 dead" without re-iterating client-side.
  const summary = {
    total: results.length,
    alive: 0,
    dead: 0,
    by_type: { http: 0, https: 0, socks5: 0 } as Record<
      "http" | "https" | "socks5",
      number
    >,
  };
  for (const r of results) {
    if (r.alive) {
      summary.alive++;
      if (r.type) summary.by_type[r.type]++;
    } else {
      summary.dead++;
    }
  }

  return NextResponse.json({
    success: true,
    data: { results, summary },
  });
}
