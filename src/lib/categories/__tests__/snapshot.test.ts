import { describe, it, expect } from "vitest";
import {
  applyCategoryDefaults,
  categoryToSnapshotDefaults,
  type SnapshotDefaults,
  type SnapshotProxyFields,
} from "../snapshot";
import { ProxyType, type ProxyCategory } from "@/types/database";

/**
 * Wave 27 — pin the snapshot logic. The DB trigger
 * (`fn_proxy_snapshot_category_defaults` in mig 059) implements the
 * same rules; an integration test in PR-3 will verify parity by
 * actually running the trigger and comparing.
 *
 * Until then, these JS unit tests are the spec.
 */

const FULL_DEFAULTS: SnapshotDefaults = {
  default_country: "VN",
  default_proxy_type: "http",
  default_isp: "Viettel",
  default_network_type: "isp",
  default_vendor_source: "ProxyVendor",
  default_purchase_price_usd: 1.5,
  default_sale_price_usd: 2.5,
};

function emptyProxy(): SnapshotProxyFields {
  return {
    country: null,
    type: null,
    isp: null,
    network_type: null,
    vendor_label: null,
    cost_usd: null,
    sale_price_usd: null,
  };
}

describe("applyCategoryDefaults", () => {
  it("returns the proxy unchanged when category is null", () => {
    const proxy = emptyProxy();
    expect(applyCategoryDefaults(proxy, null)).toEqual(proxy);
  });

  it("returns the proxy unchanged when category is undefined", () => {
    const proxy = emptyProxy();
    expect(applyCategoryDefaults(proxy, undefined)).toEqual(proxy);
  });

  it("fills every NULL field from defaults", () => {
    const result = applyCategoryDefaults(emptyProxy(), FULL_DEFAULTS);
    expect(result).toEqual({
      country: "VN",
      type: "http",
      isp: "Viettel",
      network_type: "isp",
      vendor_label: "ProxyVendor",
      cost_usd: 1.5,
      sale_price_usd: 2.5,
    });
  });

  it("preserves non-null fields (snapshot semantics — never overwrite)", () => {
    const proxy: SnapshotProxyFields = {
      country: "US",
      type: "https",
      isp: "Comcast",
      network_type: "datacenter_ipv4",
      vendor_label: "OtherVendor",
      cost_usd: 5,
      sale_price_usd: 10,
    };
    expect(applyCategoryDefaults(proxy, FULL_DEFAULTS)).toEqual(proxy);
  });

  it("treats empty string as NULL (bot/CSV may pass '' for unfilled)", () => {
    const proxy: SnapshotProxyFields = {
      ...emptyProxy(),
      country: "",
      isp: "",
      network_type: "",
      vendor_label: "",
    };
    const result = applyCategoryDefaults(proxy, FULL_DEFAULTS);
    expect(result.country).toBe("VN");
    expect(result.isp).toBe("Viettel");
    expect(result.network_type).toBe("isp");
    expect(result.vendor_label).toBe("ProxyVendor");
  });

  it("treats whitespace-only string as NULL", () => {
    const proxy = { ...emptyProxy(), country: "   " };
    const result = applyCategoryDefaults(proxy, FULL_DEFAULTS);
    expect(result.country).toBe("VN");
  });

  it("partial fill: some fields filled, some preserved", () => {
    const proxy: SnapshotProxyFields = {
      country: "US",
      type: null,
      isp: "Override",
      network_type: null,
      vendor_label: null,
      cost_usd: 3,
      sale_price_usd: null,
    };
    const result = applyCategoryDefaults(proxy, FULL_DEFAULTS);
    expect(result.country).toBe("US"); // preserved
    expect(result.type).toBe("http"); // filled
    expect(result.isp).toBe("Override"); // preserved
    expect(result.network_type).toBe("isp"); // filled
    expect(result.vendor_label).toBe("ProxyVendor"); // filled
    expect(result.cost_usd).toBe(3); // preserved
    expect(result.sale_price_usd).toBe(2.5); // filled
  });

  it("does NOT mutate the input", () => {
    const proxy = emptyProxy();
    const before = { ...proxy };
    applyCategoryDefaults(proxy, FULL_DEFAULTS);
    expect(proxy).toEqual(before);
  });

  it("partial defaults: leaves field NULL when default is also NULL", () => {
    const partialDefaults: SnapshotDefaults = {
      default_country: null,
      default_proxy_type: "http",
      default_isp: null,
      default_network_type: null,
      default_vendor_source: null,
      default_purchase_price_usd: null,
      default_sale_price_usd: null,
    };
    const result = applyCategoryDefaults(emptyProxy(), partialDefaults);
    expect(result.country).toBeNull();
    expect(result.type).toBe("http");
    expect(result.isp).toBeNull();
    expect(result.cost_usd).toBeNull();
  });

  it("preserves cost_usd = 0 (zero is NOT empty)", () => {
    const proxy: SnapshotProxyFields = {
      ...emptyProxy(),
      cost_usd: 0,
      sale_price_usd: 0,
    };
    const result = applyCategoryDefaults(proxy, FULL_DEFAULTS);
    // 0 is a legitimate "free" price — not nullish, so preserved.
    expect(result.cost_usd).toBe(0);
    expect(result.sale_price_usd).toBe(0);
  });
});

describe("categoryToSnapshotDefaults", () => {
  it("maps a full ProxyCategory to SnapshotDefaults", () => {
    const cat: ProxyCategory = {
      id: "cat-1",
      name: "Test",
      description: null,
      color: "#fff",
      icon: "folder",
      sort_order: 0,
      is_hidden: false,
      is_system: false,
      proxy_count: 0,
      default_price_usd: null,
      default_country: "VN",
      default_proxy_type: ProxyType.SOCKS5,
      default_isp: "Viettel",
      default_network_type: "mobile",
      default_vendor_source: "ABC",
      default_purchase_price_usd: 1,
      default_sale_price_usd: 2,
      min_stock_alert: 0,
      created_by: null,
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
    };
    expect(categoryToSnapshotDefaults(cat)).toEqual({
      default_country: "VN",
      default_proxy_type: ProxyType.SOCKS5,
      default_isp: "Viettel",
      default_network_type: "mobile",
      default_vendor_source: "ABC",
      default_purchase_price_usd: 1,
      default_sale_price_usd: 2,
    });
  });

  it("handles missing optional fields (undefined → null)", () => {
    const cat: ProxyCategory = {
      id: "cat-1",
      name: "Test",
      description: null,
      color: "#fff",
      icon: "folder",
      sort_order: 0,
      is_hidden: false,
      is_system: false,
      proxy_count: 0,
      default_price_usd: null,
      default_country: null,
      default_proxy_type: null,
      default_isp: null,
      default_network_type: null,
      // default_vendor_source / default_purchase_price_usd / default_sale_price_usd intentionally omitted
      min_stock_alert: 0,
      created_by: null,
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
    };
    const result = categoryToSnapshotDefaults(cat);
    expect(result.default_vendor_source).toBeNull();
    expect(result.default_purchase_price_usd).toBeNull();
    expect(result.default_sale_price_usd).toBeNull();
  });
});
