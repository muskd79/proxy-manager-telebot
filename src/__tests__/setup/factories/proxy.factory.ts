export function createProxy(overrides: Partial<Record<string, unknown>> = {}) {
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
    is_deleted: false,
    assigned_to: null,
    expires_at: null,
    created_at: now,
    updated_at: now,
    // ─── Wave 21A inventory columns ───
    // Wave 22S: purchase_lot_id removed (mig 040 dropped purchase_lots table)
    purchase_date: now,
    vendor_label: null,
    cost_usd: null,
    sale_price_usd: null,
    geo_country_iso: null,
    distribute_count: 0,
    last_distributed_at: null,
    // Wave 22G: cascade hide
    hidden: false,
    // Wave 22J: proxy classification (free text)
    network_type: null,
    ...overrides,
  };
}

export function createProxies(count: number, overrides: Partial<Record<string, unknown>> = {}) {
  return Array.from({ length: count }, () => createProxy(overrides));
}
