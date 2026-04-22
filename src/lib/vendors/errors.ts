/**
 * Vendor adapter error taxonomy.
 *
 * All adapter methods throw one of these so callers can branch on error
 * type without parsing strings. `VendorError.code` is a short machine
 * identifier; `.statusCode` mirrors HTTP semantics for API responses.
 */

import type { Capability } from "./types";

export type VendorErrorCode =
  | "not_supported"
  | "auth_failed"
  | "rate_limited"
  | "not_found"
  | "insufficient_funds"
  | "invalid_request"
  | "vendor_error"
  | "network_error"
  | "timeout";

export class VendorError extends Error {
  public readonly code: VendorErrorCode;
  public readonly statusCode: number;
  public readonly vendor: string;
  public readonly raw?: unknown;

  constructor(
    vendor: string,
    code: VendorErrorCode,
    message: string,
    statusCode = 500,
    raw?: unknown,
  ) {
    super(message);
    this.name = "VendorError";
    this.code = code;
    this.statusCode = statusCode;
    this.vendor = vendor;
    this.raw = raw;
  }
}

export class NotSupportedError extends VendorError {
  public readonly capability: Capability;
  constructor(vendor: string, capability: Capability) {
    super(vendor, "not_supported", `Vendor ${vendor} does not support ${capability}`, 501);
    this.name = "NotSupportedError";
    this.capability = capability;
  }
}

export class VendorAuthError extends VendorError {
  constructor(vendor: string, raw?: unknown) {
    super(vendor, "auth_failed", `Vendor ${vendor} rejected credentials`, 401, raw);
    this.name = "VendorAuthError";
  }
}

export class VendorRateLimitError extends VendorError {
  public readonly retryAfterMs: number;
  constructor(vendor: string, retryAfterMs: number, raw?: unknown) {
    super(vendor, "rate_limited", `Vendor ${vendor} rate-limited (retry ${retryAfterMs}ms)`, 429, raw);
    this.name = "VendorRateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}
