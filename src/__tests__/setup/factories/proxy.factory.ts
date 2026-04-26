export function createProxy(overrides: Partial<any> = {}) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    // TEST-NET-3 (RFC 5737) — reserved for documentation/examples; passes SSRF guard.
    host: `203.0.113.${Math.floor(Math.random() * 255)}`,
    port: 8080,
    type: "http",
    status: "available",
    username: "testuser",
    password: "testpass",
    country: "US",
    isp: "TestISP",
    tags: [],
    is_deleted: false,
    assigned_to: null,
    expires_at: null,
    created_at: now,
    updated_at: now,
    // ─── Wave 21A inventory columns ───
    purchase_date: now,
    vendor_label: null,
    cost_usd: null,
    purchase_lot_id: null,
    geo_country_iso: null,
    distribute_count: 0,
    last_distributed_at: null,
    ...overrides,
  };
}

export function createPurchaseLot(overrides: Partial<any> = {}) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    vendor_label: "TestVendor",
    purchase_date: now,
    expiry_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    total_cost_usd: 50,
    currency: "USD",
    source_file_name: "test.csv",
    batch_reference: null,
    notes: null,
    proxy_count: 0,
    parent_lot_id: null,
    last_alert_24h_at: null,
    last_alert_7d_at: null,
    last_alert_30d_at: null,
    created_by: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

export function createProxies(count: number, overrides: Partial<any> = {}) {
  return Array.from({ length: count }, () => createProxy(overrides));
}
