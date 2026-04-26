import { describe, it, expect } from "vitest";
import {
  ImportLotPayloadSchema,
  ProxyImportRowSchema,
  LotMetadataSchema,
} from "../import-payload";
import { uuidv7 } from "@/lib/uuid7";

describe("ProxyImportRowSchema", () => {
  it("accepts a public IP literal", () => {
    const r = ProxyImportRowSchema.safeParse({
      host: "203.0.113.1",
      port: 8080,
      type: "http",
    });
    expect(r.success).toBe(true);
  });

  it("rejects RFC1918 private IP (Wave 18A SSRF guard regression)", () => {
    const r = ProxyImportRowSchema.safeParse({
      host: "10.0.0.1",
      port: 8080,
    });
    expect(r.success).toBe(false);
  });

  it("rejects loopback (Wave 18A SSRF regression)", () => {
    const r = ProxyImportRowSchema.safeParse({
      host: "127.0.0.1",
      port: 8080,
    });
    expect(r.success).toBe(false);
  });

  it("rejects link-local AWS metadata (Wave 18A SSRF regression)", () => {
    const r = ProxyImportRowSchema.safeParse({
      host: "169.254.169.254",
      port: 80,
    });
    expect(r.success).toBe(false);
  });

  it("rejects port out of range", () => {
    expect(
      ProxyImportRowSchema.safeParse({ host: "203.0.113.1", port: 0 }).success,
    ).toBe(false);
    expect(
      ProxyImportRowSchema.safeParse({ host: "203.0.113.1", port: 70_000 }).success,
    ).toBe(false);
  });

  it("defaults type to http", () => {
    const r = ProxyImportRowSchema.parse({ host: "203.0.113.1", port: 8080 });
    expect(r.type).toBe("http");
  });
});

describe("LotMetadataSchema", () => {
  it("accepts minimal valid lot", () => {
    const r = LotMetadataSchema.safeParse({ vendor_label: "Proxy-Seller" });
    expect(r.success).toBe(true);
  });

  it("rejects missing vendor_label", () => {
    const r = LotMetadataSchema.safeParse({});
    expect(r.success).toBe(false);
  });

  it("rejects vendor_label > 120 chars", () => {
    const r = LotMetadataSchema.safeParse({ vendor_label: "x".repeat(121) });
    expect(r.success).toBe(false);
  });

  it("rejects non-3-char currency", () => {
    const r = LotMetadataSchema.safeParse({
      vendor_label: "Test",
      currency: "USDOLLAR",
    });
    expect(r.success).toBe(false);
  });
});

describe("ImportLotPayloadSchema", () => {
  it("accepts a complete payload", () => {
    const r = ImportLotPayloadSchema.safeParse({
      idempotency_key: uuidv7(),
      lot: {
        vendor_label: "Proxy-Seller",
        purchase_date: new Date().toISOString(),
        expiry_date: new Date(Date.now() + 30 * 86400_000).toISOString(),
        total_cost_usd: 85,
        currency: "USD",
      },
      proxies: [
        { host: "203.0.113.1", port: 8080, type: "http" },
        { host: "203.0.113.2", port: 8080, type: "http" },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("rejects empty proxies array", () => {
    const r = ImportLotPayloadSchema.safeParse({
      idempotency_key: uuidv7(),
      lot: { vendor_label: "X" },
      proxies: [],
    });
    expect(r.success).toBe(false);
  });

  it("rejects > 1000 proxies", () => {
    const proxies = Array.from({ length: 1001 }, (_, i) => ({
      host: `203.0.113.${i % 255}`,
      port: 8080 + i,
      type: "http" as const,
    }));
    const r = ImportLotPayloadSchema.safeParse({
      idempotency_key: uuidv7(),
      lot: { vendor_label: "X" },
      proxies,
    });
    expect(r.success).toBe(false);
  });

  it("rejects non-UUIDv7 idempotency_key (must be time-ordered)", () => {
    const r = ImportLotPayloadSchema.safeParse({
      idempotency_key: "00000000-0000-4000-8000-000000000000", // v4
      lot: { vendor_label: "X" },
      proxies: [{ host: "203.0.113.1", port: 8080, type: "http" }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects unknown top-level keys (strict schema)", () => {
    const r = ImportLotPayloadSchema.safeParse({
      idempotency_key: uuidv7(),
      lot: { vendor_label: "X" },
      proxies: [{ host: "203.0.113.1", port: 8080, type: "http" }],
      malicious: "extra-field",
    });
    expect(r.success).toBe(false);
  });
});
