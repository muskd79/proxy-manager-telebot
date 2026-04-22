/**
 * Base class for vendor adapters. Provides default NotSupportedError throws
 * for any capability a subclass doesn't override. Subclasses implement only
 * the methods relevant to their vendor's API surface; the rest still exist
 * (uniform interface) but throw if invoked by accident.
 */

import type {
  VendorAdapter,
  Capability,
  VendorCtx,
  VendorProductDTO,
  CreateOrderReq,
  OrderResult,
  AllocationDTO,
  HealthReport,
  RotateResult,
  UsageDTO,
  DateRange,
  WebhookEnvelope,
} from "../types";
import { NotSupportedError } from "../errors";

export abstract class BaseAdapter implements VendorAdapter {
  abstract readonly slug: string;
  abstract readonly capabilities: ReadonlySet<Capability>;

  async listProducts(_ctx: VendorCtx): Promise<VendorProductDTO[]> {
    throw new NotSupportedError(this.slug, "listProducts");
  }
  async createOrder(_ctx: VendorCtx, _req: CreateOrderReq): Promise<OrderResult> {
    throw new NotSupportedError(this.slug, "createOrder");
  }
  async fetchAllocation(_ctx: VendorCtx, _ref: string): Promise<AllocationDTO[]> {
    throw new NotSupportedError(this.slug, "fetchAllocation");
  }
  async healthCheck(_ctx: VendorCtx, _ref: string): Promise<HealthReport> {
    throw new NotSupportedError(this.slug, "healthCheck");
  }
  async rotate(_ctx: VendorCtx, _ref?: string): Promise<RotateResult> {
    throw new NotSupportedError(this.slug, "rotate");
  }
  async renew(_ctx: VendorCtx, _ref: string): Promise<OrderResult> {
    throw new NotSupportedError(this.slug, "renew");
  }
  async cancel(_ctx: VendorCtx, _ref: string): Promise<void> {
    throw new NotSupportedError(this.slug, "cancel");
  }
  async getUsage(_ctx: VendorCtx, _ref: string, _range: DateRange): Promise<UsageDTO[]> {
    throw new NotSupportedError(this.slug, "getUsage");
  }
  verifyWebhook?(_raw: string, _headers: Headers): WebhookEnvelope;
}
