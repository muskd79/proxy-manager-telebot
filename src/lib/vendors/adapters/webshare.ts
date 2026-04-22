/**
 * Webshare adapter.
 *
 * API docs: https://apidocs.webshare.io/
 * Auth: `Authorization: Token <API_KEY>` header.
 * No explicit reseller ban in ToS (as of 2025-2026 research).
 * Synchronous order model: creating an order returns proxies immediately.
 *
 * Wave 19 implements `listProducts` (catalog sync for admin UI). Order/renew
 * flows land in Wave 20.
 */

import { BaseAdapter } from "./_base";
import { vendorFetch } from "../http";
import type { Capability, VendorCtx, VendorProductDTO } from "../types";

interface WebshareProductsResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: Array<{
    id: number;
    name: string;
    proxy_type: string;
    number_of_proxies: number;
    subnet_countries: string[];
    price_per_month_usd: string;
    max_concurrent_requests?: number;
  }>;
}

export class WebshareAdapter extends BaseAdapter {
  readonly slug = "webshare";
  readonly capabilities: ReadonlySet<Capability> = new Set<Capability>([
    "listProducts",
    "createOrder",
    "fetchAllocation",
    "renew",
    "cancel",
    "getUsage",
  ]);

  async listProducts(ctx: VendorCtx): Promise<VendorProductDTO[]> {
    const res = await vendorFetch<WebshareProductsResponse>(
      this.slug,
      `${ctx.baseUrl}/api/v2/plans/`,
      {
        headers: { authorization: `Token ${ctx.apiKey}` },
        signal: ctx.signal,
      },
    );

    return res.data.results.map((p) => ({
      sku: String(p.id),
      name: p.name,
      type: mapProxyType(p.proxy_type),
      country: p.subnet_countries ?? [],
      bandwidthGb: null, // Webshare plans are per-proxy, not per-GB
      concurrentThreads: p.max_concurrent_requests ?? null,
      unitPriceUsd: parseFloat(p.price_per_month_usd) / Math.max(p.number_of_proxies, 1),
      billingCycle: "monthly",
      raw: p,
    }));
  }
}

function mapProxyType(vendorType: string): VendorProductDTO["type"] {
  const t = vendorType.toLowerCase();
  if (t.includes("residential")) return "residential";
  if (t.includes("mobile")) return "mobile";
  if (t.includes("isp")) return "isp";
  return "datacenter";
}
