/**
 * Vendor adapter layer — shared types.
 *
 * Each integrated proxy provider (Webshare, Smartproxy, IPRoyal, …) implements
 * `VendorAdapter` below. The adapter layer sits between our app and the raw
 * vendor HTTP APIs so the rest of the codebase sees one normalized surface.
 *
 * Design decisions:
 * - `capabilities` is a Set, not a boolean per method. Callers check
 *   `adapter.capabilities.has("rotate")` before invoking; adapters that lack
 *   the capability still export the method but throw `NotSupportedError` if
 *   called directly. This lets TypeScript keep a uniform interface while the
 *   UI hides unsupported actions.
 * - `OrderResult` is tri-modal: some vendors return allocations synchronously
 *   (Webshare), some are async poll-based (Smartproxy), some push via webhook
 *   (Oxylabs). A single shape handles all three without branching callers.
 * - Idempotency keys are REQUIRED in `CreateOrderReq`; the DB enforces uniqueness
 *   via `vendor_orders.idempotency_key UNIQUE` so a retry is safe.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type Capability =
  | "listProducts"
  | "createOrder"
  | "fetchAllocation"
  | "healthCheck"
  | "rotate"
  | "renew"
  | "cancel"
  | "getUsage"
  | "webhook";

export interface VendorCtx {
  /** Plaintext API key for the current call. Fetched via decrypt_vendor_cred RPC. */
  apiKey: string;
  /** Base URL from the vendors table. */
  baseUrl: string;
  /** Supabase admin client (service role) in case the adapter needs to persist raw responses. */
  supabase: SupabaseClient;
  /** Abort signal wired to an outer request deadline. */
  signal?: AbortSignal;
  /** Vendor row ID for logging/correlation. */
  vendorId: string;
}

export interface VendorProductDTO {
  sku: string;
  name: string;
  type: "residential" | "datacenter" | "mobile" | "isp";
  country: string[];
  bandwidthGb: number | null;
  concurrentThreads: number | null;
  unitPriceUsd: number;
  billingCycle: "one_off" | "daily" | "weekly" | "monthly";
  raw: unknown;
}

export interface CreateOrderReq {
  productSku: string;
  quantity: number;
  /** UUIDv7 from the client; DB has UNIQUE on this column. */
  idempotencyKey: string;
  metadata?: Record<string, string>;
}

export interface AllocationDTO {
  vendorAllocationRef: string;
  host: string;
  port: number;
  username: string | null;
  password: string | null;
  type: "http" | "https" | "socks5";
  country: string | null;
  rotationUrl: string | null;
  stickySessionId: string | null;
}

export type OrderResult =
  | { kind: "sync"; vendorOrderRef: string; allocations: AllocationDTO[] }
  | { kind: "async"; vendorOrderRef: string; pollAfter: Date }
  | { kind: "webhook"; vendorOrderRef: string; expiresAt: Date };

export interface HealthReport {
  status: "healthy" | "degraded" | "dead";
  latencyMs?: number;
  message?: string;
}

export interface RotateResult {
  newAllocationRef: string;
  rotatedAt: Date;
}

export interface UsageDTO {
  bucketStart: Date;
  bucketEnd: Date;
  bandwidthBytes: number;
  requestCount: number;
}

export interface WebhookEnvelope {
  eventId: string;
  eventType: string;
  vendorOrderRef: string | null;
  payload: unknown;
}

export interface DateRange {
  from: Date;
  to: Date;
}

export interface VendorAdapter {
  readonly slug: string;
  readonly capabilities: ReadonlySet<Capability>;

  listProducts(ctx: VendorCtx): Promise<VendorProductDTO[]>;
  createOrder(ctx: VendorCtx, req: CreateOrderReq): Promise<OrderResult>;
  fetchAllocation(ctx: VendorCtx, vendorOrderRef: string): Promise<AllocationDTO[]>;
  healthCheck(ctx: VendorCtx, allocationRef: string): Promise<HealthReport>;
  rotate(ctx: VendorCtx, allocationRef?: string): Promise<RotateResult>;
  renew(ctx: VendorCtx, vendorOrderRef: string): Promise<OrderResult>;
  cancel(ctx: VendorCtx, vendorOrderRef: string): Promise<void>;
  getUsage(ctx: VendorCtx, vendorOrderRef: string, range: DateRange): Promise<UsageDTO[]>;
  verifyWebhook?(raw: string, headers: Headers): WebhookEnvelope;
}
