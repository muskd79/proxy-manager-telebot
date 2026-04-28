import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrAbove } from "@/lib/auth";
import { detectProxy, geoIpLookup } from "@/lib/proxy-detect";
import { z } from "zod";
import dns from "dns/promises";

/**
 * Wave 22G — POST /api/proxies/probe
 *
 * Auto-detect endpoint. Given { host, port }, returns:
 *   - alive boolean
 *   - type (http | https | socks5 | null)
 *   - speed_ms
 *   - country + country_code + isp (via ipwho.is)
 *   - per-protocol probe diagnostics (debug-friendly)
 *
 * Used by the proxy create form's "Probe & autofill" button so the
 * admin doesn't have to manually figure out HTTP vs SOCKS5 or look
 * up the country.
 *
 * Rate limit: this hits an external public IP per probe (3 TCP
 * sockets) + an external API. Admin-only (requireAdminOrAbove) so
 * the abuse surface is small. If admins ever need bulk-probe, add
 * an explicit batch endpoint with concurrency caps.
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

  // Run detection + geoip in parallel. detectProxy already does its
  // own SSRF guard via assertPublicHost; we resolve the IP here too
  // so geoIpLookup can hit ipwho.is with the actual address.
  const [detect, ip] = await Promise.all([
    detectProxy(host, port),
    resolveIp(host),
  ]);

  // Skip GeoIP if the host couldn't be resolved (probe will have
  // failed too via SSRF guard).
  const geo = ip ? await geoIpLookup(ip) : {
    country: null,
    country_code: null,
    isp: null,
    source: null as null,
  };

  return NextResponse.json({
    success: true,
    data: {
      alive: detect.alive,
      type: detect.type,
      speed_ms: detect.speed_ms,
      ssrf_blocked: detect.ssrf_blocked,
      ssrf_reason: detect.ssrf_reason,
      country: geo.country,
      country_code: geo.country_code,
      isp: geo.isp,
      geo_source: geo.source,
      probes: detect.probes,
      resolved_ip: ip,
    },
  });
}

async function resolveIp(host: string): Promise<string | null> {
  // If host is already an IP, return as-is.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return host;
  try {
    const records = await dns.lookup(host, { family: 0 });
    return records.address ?? null;
  } catch {
    return null;
  }
}
