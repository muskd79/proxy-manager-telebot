/**
 * Shared HTTP client for vendor adapters.
 *
 * - Enforces a 30s default timeout.
 * - Maps HTTP status codes to VendorError subclasses (401 -> VendorAuthError,
 *   429 -> VendorRateLimitError, 5xx -> VendorError code=vendor_error).
 * - Attaches the vendor slug to every error for easy log grep.
 * - Never throws generic errors — always VendorError subclasses — so the
 *   outer saga can rely on `err instanceof VendorError` in its retry logic.
 *
 * Does NOT implement retries. Retry is the saga's job; retrying inside the
 * HTTP layer masks idempotency bugs and makes debugging painful.
 */

import {
  VendorAuthError,
  VendorError,
  VendorRateLimitError,
} from "./errors";

export interface VendorFetchOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface VendorFetchResult<T> {
  ok: true;
  status: number;
  data: T;
}

/**
 * Issue an HTTP request to a vendor. Returns parsed JSON on 2xx,
 * throws a VendorError subclass otherwise.
 */
export async function vendorFetch<T>(
  vendor: string,
  url: string,
  opts: VendorFetchOptions = {},
): Promise<VendorFetchResult<T>> {
  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  // Chain the outer signal into ours so an outer cancel aborts the vendor call.
  opts.signal?.addEventListener("abort", () => controller.abort(), { once: true });

  try {
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...(opts.headers ?? {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });

    const text = await res.text();
    const parsed: unknown = text ? safeJsonParse(text) : null;

    if (res.status === 401 || res.status === 403) {
      throw new VendorAuthError(vendor, parsed);
    }
    if (res.status === 429) {
      const retryAfter = res.headers.get("retry-after");
      const retryMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 60_000;
      throw new VendorRateLimitError(vendor, retryMs, parsed);
    }
    if (res.status === 404) {
      throw new VendorError(vendor, "not_found", `${vendor} 404 at ${url}`, 404, parsed);
    }
    if (res.status >= 400 && res.status < 500) {
      throw new VendorError(
        vendor,
        "invalid_request",
        `${vendor} ${res.status} at ${url}: ${extractErrorMsg(parsed)}`,
        res.status,
        parsed,
      );
    }
    if (res.status >= 500) {
      throw new VendorError(
        vendor,
        "vendor_error",
        `${vendor} ${res.status} at ${url}`,
        res.status,
        parsed,
      );
    }

    return { ok: true, status: res.status, data: parsed as T };
  } catch (err) {
    if (err instanceof VendorError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new VendorError(vendor, "timeout", `${vendor} timed out after ${timeoutMs}ms`, 504);
    }
    throw new VendorError(
      vendor,
      "network_error",
      err instanceof Error ? err.message : String(err),
      502,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw_text: text };
  }
}

function extractErrorMsg(parsed: unknown): string {
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.error === "string") return obj.error;
    if (typeof obj.message === "string") return obj.message;
    if (typeof obj.detail === "string") return obj.detail;
  }
  return "(no detail)";
}
