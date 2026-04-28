import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrAbove } from "@/lib/auth";
import { detectProxy } from "@/lib/proxy-detect";
import { z } from "zod";
import dns from "dns/promises";

/**
 * Wave 22G + 22H — POST /api/proxies/probe
 *
 * Single-proxy auto-detect. Returns:
 *   - alive boolean
 *   - type (http | https | socks5 | null)
 *   - speed_ms
 *   - per-protocol probe diagnostics
 *   - resolved_ip (post-SSRF-pin)
 *
 * Wave 22H privacy guarantee: NO EXTERNAL CALLS.
 *   - The 3 protocol probes open TCP sockets directly to the
 *     proxy from our server. No 3rd-party services touched.
 *   - GeoIP (country/ISP) was REMOVED in Wave 22H. Country and
 *     ISP must come from category default (Wave 22G) or admin
 *     manual entry. See lib/proxy-detect.ts for rationale.
 *
 * For bulk probes (1000-proxy import), use /api/proxies/probe-batch
 * which has concurrency caps.
 */

const ProbeSchema = z.object({
  host: z.string().min(1).max(253),
  port: z.coerce.number().int().min(1).max(65535),
});

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { error: authError } = await requireAdminOrAbove(supabase);
  if (authError) return authError;

  const parsed = ProbeSchema.safeParse(await request.json());
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

  const { host, port } = parsed.data;

  // Resolve IP for diagnostic display only (NO external lookup).
  const [detect, ip] = await Promise.all([
    detectProxy(host, port),
    resolveIp(host),
  ]);

  return NextResponse.json({
    success: true,
    data: {
      alive: detect.alive,
      type: detect.type,
      speed_ms: detect.speed_ms,
      ssrf_blocked: detect.ssrf_blocked,
      ssrf_reason: detect.ssrf_reason,
      // Wave 22H: country/ISP intentionally null. Use category
      // default (Wave 22G) or manual entry.
      country: null,
      country_code: null,
      isp: null,
      probes: detect.probes,
      resolved_ip: ip,
    },
  });
}

async function resolveIp(host: string): Promise<string | null> {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return host;
  try {
    const records = await dns.lookup(host, { family: 0 });
    return records.address ?? null;
  } catch {
    return null;
  }
}
