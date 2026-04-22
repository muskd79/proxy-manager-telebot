/**
 * IPRoyal adapter.
 *
 * API docs: https://docs.iproyal.com/
 * Auth: `x-access-token` header.
 * Pricing: $0.7-3/GB pay-as-you-go, no monthly commitment.
 * No explicit reseller ban.
 * Synchronous order model for most products.
 *
 * Wave 19 implements `listProducts` (catalog sync for admin UI).
 */

import { BaseAdapter } from "./_base";
import { vendorFetch } from "../http";
import type { Capability, VendorCtx, VendorProductDTO } from "../types";

interface IProyalPricingResponse {
  products: Array<{
    id: string;
    name: string;
    category: string;
    countries?: string[];
    bandwidth_gb?: number;
    price_per_gb_usd: number;
    min_purchase_usd: number;
  }>;
}

export class IProyalAdapter extends BaseAdapter {
  readonly slug = "iproyal";
  readonly capabilities: ReadonlySet<Capability> = new Set<Capability>([
    "listProducts",
    "createOrder",
    "fetchAllocation",
    "rotate",
    "renew",
  ]);

  async listProducts(ctx: VendorCtx): Promise<VendorProductDTO[]> {
    const res = await vendorFetch<IProyalPricingResponse>(
      this.slug,
      `${ctx.baseUrl}/pricing`,
      {
        headers: { "x-access-token": ctx.apiKey },
        signal: ctx.signal,
      },
    );

    return res.data.products.map((p) => ({
      sku: p.id,
      name: p.name,
      type: mapCategory(p.category),
      country: p.countries ?? [],
      bandwidthGb: p.bandwidth_gb ?? null,
      concurrentThreads: null,
      unitPriceUsd: p.price_per_gb_usd,
      billingCycle: "one_off", // pay-as-you-go
      raw: p,
    }));
  }
}

function mapCategory(cat: string): VendorProductDTO["type"] {
  const t = cat.toLowerCase();
  if (t.includes("residential")) return "residential";
  if (t.includes("mobile")) return "mobile";
  if (t.includes("isp") || t.includes("static")) return "isp";
  return "datacenter";
}
