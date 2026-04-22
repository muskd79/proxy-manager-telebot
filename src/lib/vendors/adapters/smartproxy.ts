/**
 * Smartproxy / Decodo adapter.
 *
 * API docs: https://help.smartproxy.com/docs/api
 * Auth: Basic auth (username:password) or API key via `Authorization` header.
 * Pricing: $3-8.5/GB, min $75. Subscription-based.
 * No explicit reseller ban.
 * Async order model for bulk purchases (>10 IPs) — Wave 20 handles polling.
 *
 * Wave 19 implements `listProducts` (catalog sync for admin UI).
 */

import { BaseAdapter } from "./_base";
import { vendorFetch } from "../http";
import type { Capability, VendorCtx, VendorProductDTO } from "../types";

interface SmartproxySubscriptionsResponse {
  subscriptions: Array<{
    id: string;
    name: string;
    service_type: string;
    countries: string[];
    traffic_gb: number;
    price_usd: number;
    period: "monthly" | "weekly" | "daily";
  }>;
}

export class SmartproxyAdapter extends BaseAdapter {
  readonly slug = "smartproxy";
  readonly capabilities: ReadonlySet<Capability> = new Set<Capability>([
    "listProducts",
    "createOrder",
    "fetchAllocation",
    "renew",
    "getUsage",
  ]);

  async listProducts(ctx: VendorCtx): Promise<VendorProductDTO[]> {
    const res = await vendorFetch<SmartproxySubscriptionsResponse>(
      this.slug,
      `${ctx.baseUrl}/v2/subscriptions`,
      {
        headers: { authorization: `Bearer ${ctx.apiKey}` },
        signal: ctx.signal,
      },
    );

    return res.data.subscriptions.map((s) => ({
      sku: s.id,
      name: s.name,
      type: mapType(s.service_type),
      country: s.countries ?? [],
      bandwidthGb: s.traffic_gb,
      concurrentThreads: null,
      unitPriceUsd: s.traffic_gb > 0 ? s.price_usd / s.traffic_gb : s.price_usd,
      billingCycle: s.period,
      raw: s,
    }));
  }
}

function mapType(serviceType: string): VendorProductDTO["type"] {
  const t = serviceType.toLowerCase();
  if (t.includes("residential")) return "residential";
  if (t.includes("mobile")) return "mobile";
  if (t.includes("isp") || t.includes("dedicated")) return "isp";
  return "datacenter";
}
