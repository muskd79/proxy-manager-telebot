/**
 * Evomi reseller adapter.
 *
 * API docs: https://proxy-docs.evomi.com/reseller-guide-integration
 * Auth: `X-API-KEY` header (or `?apikey=` query param, header preferred).
 * Base URL: https://reseller.evomi.com/v2
 *
 * Reseller policy: reseller program explicitly permitted; the
 * researcher flagged this as GREEN for resale. No explicit idempotency
 * key header — the adapter MUST attach `client_reference = vendor_order.id`
 * in the order body so the pre-flight GET can dedup a retry.
 *
 * Current endpoints implemented:
 *   listProducts       -> GET /reseller/sub_users/isp/stock?username=X
 *   createOrder        -> POST /reseller/sub_users/isp/create_order
 *   fetchAllocation    -> GET /reseller/sub_users/isp/active_packages?username=X
 *   renew              -> POST /reseller/sub_users/isp/renew_package
 *   cancel             -> POST /reseller/sub_users/isp/end_subscription
 *   getUsage           -> GET /reseller/subusers/{username}/usage
 *
 * Known gaps (Wave 20B stubs → Wave 20C enriches):
 *   - Evomi scopes every reseller call to a `subuser_username`. The
 *     adapter uses a hard-coded default from the vendor metadata; a
 *     future wave will wire per-admin subusers.
 *   - Pre-flight GET for idempotency is NOT YET wired (Wave 20B scope
 *     creates the order; Wave 20C adds the dedup step).
 */

import { BaseAdapter } from "./_base";
import { vendorFetch } from "../http";
import type {
  Capability,
  VendorCtx,
  VendorProductDTO,
  CreateOrderReq,
  OrderResult,
  AllocationDTO,
  UsageDTO,
  DateRange,
} from "../types";

interface EvomiStockResponse {
  stock: Array<{
    country: string;
    city?: string;
    isp?: string;
    shared_type?: "dedicated" | "shared";
    is_virgin?: boolean;
    available_ips: number;
    price_per_month_usd: number;
  }>;
}

interface EvomiCreateOrderResponse {
  packageId: string;
  status: "active" | "pending" | "failed";
  ips?: Array<{
    ip: string;
    port: number;
    username: string;
    password: string;
    country?: string;
  }>;
}

interface EvomiActivePackagesResponse {
  packages: Array<{
    packageId: string;
    ips: Array<{
      ip: string;
      port: number;
      username: string;
      password: string;
      country?: string;
    }>;
    expires_at: string;
    is_virgin: boolean;
    shared_type: string;
  }>;
}

interface EvomiUsageResponse {
  usage: Array<{
    bucket_start: string;
    bucket_end: string;
    bandwidth_bytes: number;
    request_count: number;
  }>;
}

const EVOMI_SUBUSER = process.env.EVOMI_RESELLER_SUBUSER ?? "default";

export class EvomiAdapter extends BaseAdapter {
  readonly slug = "evomi";
  readonly capabilities: ReadonlySet<Capability> = new Set<Capability>([
    "listProducts",
    "createOrder",
    "fetchAllocation",
    "renew",
    "cancel",
    "getUsage",
  ]);

  async listProducts(ctx: VendorCtx): Promise<VendorProductDTO[]> {
    const res = await vendorFetch<EvomiStockResponse>(
      this.slug,
      `${ctx.baseUrl}/reseller/sub_users/isp/stock?username=${encodeURIComponent(EVOMI_SUBUSER)}`,
      { headers: headersFor(ctx), signal: ctx.signal },
    );

    return res.data.stock.map((s, i) => {
      const sku = [s.country, s.city ?? "", s.isp ?? "", s.shared_type ?? "dedicated", s.is_virgin ? "virgin" : "aged"]
        .filter(Boolean)
        .join(":") || `sku_${i}`;
      return {
        sku,
        name: `${s.country}${s.city ? " / " + s.city : ""}${s.isp ? " (" + s.isp + ")" : ""}`,
        type: "isp",
        country: [s.country],
        bandwidthGb: null,
        concurrentThreads: null,
        unitPriceUsd: s.price_per_month_usd,
        billingCycle: "monthly",
        raw: s,
      };
    });
  }

  async createOrder(ctx: VendorCtx, req: CreateOrderReq): Promise<OrderResult> {
    // Parse sku pieces back out: "country:city:isp:shared_type:aged_flag"
    const parts = req.productSku.split(":");
    const [country, city, isp, sharedType, virginFlag] = parts;

    const body = {
      username: EVOMI_SUBUSER,
      months: 1,
      country,
      city: city || undefined,
      isp: isp || undefined,
      numberOfIPs: Math.max(3, req.quantity), // Evomi requires min 3
      sharedType: sharedType || "dedicated",
      isVirgin: virginFlag === "virgin",
      highConcurrency: false,
      client_reference: req.idempotencyKey, // dedup marker for pre-flight GET
    };

    const res = await vendorFetch<EvomiCreateOrderResponse>(
      this.slug,
      `${ctx.baseUrl}/reseller/sub_users/isp/create_order`,
      {
        method: "POST",
        headers: headersFor(ctx),
        body,
        signal: ctx.signal,
      },
    );

    const pkg = res.data;

    // Synchronous: Evomi returns the IPs inline when status=active.
    if (pkg.status === "active" && pkg.ips && pkg.ips.length > 0) {
      return {
        kind: "sync",
        vendorOrderRef: pkg.packageId,
        allocations: pkg.ips.map((ip) => ({
          vendorAllocationRef: `${pkg.packageId}:${ip.ip}:${ip.port}`,
          host: ip.ip,
          port: ip.port,
          username: ip.username,
          password: ip.password,
          type: "http", // Evomi ISP is HTTP-compatible
          country: ip.country ?? country,
          rotationUrl: null,
          stickySessionId: null,
        })),
      };
    }

    // Pending: return async, poll in 60s.
    return {
      kind: "async",
      vendorOrderRef: pkg.packageId,
      pollAfter: new Date(Date.now() + 60_000),
    };
  }

  async fetchAllocation(
    ctx: VendorCtx,
    vendorOrderRef: string,
  ): Promise<AllocationDTO[]> {
    const res = await vendorFetch<EvomiActivePackagesResponse>(
      this.slug,
      `${ctx.baseUrl}/reseller/sub_users/isp/active_packages?username=${encodeURIComponent(EVOMI_SUBUSER)}`,
      { headers: headersFor(ctx), signal: ctx.signal },
    );

    const pkg = res.data.packages.find((p) => p.packageId === vendorOrderRef);
    if (!pkg) return [];

    return pkg.ips.map((ip) => ({
      vendorAllocationRef: `${pkg.packageId}:${ip.ip}:${ip.port}`,
      host: ip.ip,
      port: ip.port,
      username: ip.username,
      password: ip.password,
      type: "http",
      country: ip.country ?? null,
      rotationUrl: null,
      stickySessionId: null,
    }));
  }

  async renew(ctx: VendorCtx, vendorOrderRef: string): Promise<OrderResult> {
    await vendorFetch<{ status: string }>(
      this.slug,
      `${ctx.baseUrl}/reseller/sub_users/isp/renew_package`,
      {
        method: "POST",
        headers: headersFor(ctx),
        body: { username: EVOMI_SUBUSER, packageId: vendorOrderRef },
        signal: ctx.signal,
      },
    );
    // Evomi extends in place; re-fetch to get the refreshed IPs + expiry.
    const allocations = await this.fetchAllocation(ctx, vendorOrderRef);
    return {
      kind: "sync",
      vendorOrderRef,
      allocations,
    };
  }

  async cancel(ctx: VendorCtx, vendorOrderRef: string): Promise<void> {
    await vendorFetch<{ status: string; refund_usd: number }>(
      this.slug,
      `${ctx.baseUrl}/reseller/sub_users/isp/end_subscription`,
      {
        method: "POST",
        headers: headersFor(ctx),
        body: { packageId: vendorOrderRef },
        signal: ctx.signal,
      },
    );
  }

  async getUsage(
    ctx: VendorCtx,
    _vendorOrderRef: string,
    _range: DateRange,
  ): Promise<UsageDTO[]> {
    // Evomi reseller usage is per subuser, not per package. Return all buckets
    // for the subuser; caller filters by range if finer detail is needed.
    const res = await vendorFetch<EvomiUsageResponse>(
      this.slug,
      `${ctx.baseUrl}/reseller/subusers/${encodeURIComponent(EVOMI_SUBUSER)}/usage`,
      { headers: headersFor(ctx), signal: ctx.signal },
    );

    return res.data.usage.map((u) => ({
      bucketStart: new Date(u.bucket_start),
      bucketEnd: new Date(u.bucket_end),
      bandwidthBytes: u.bandwidth_bytes,
      requestCount: u.request_count,
    }));
  }
}

function headersFor(ctx: VendorCtx): Record<string, string> {
  return { "X-API-KEY": ctx.apiKey };
}
