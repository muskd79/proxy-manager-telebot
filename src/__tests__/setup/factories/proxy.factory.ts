export function createProxy(overrides: Partial<any> = {}) {
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
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

export function createProxies(count: number, overrides: Partial<any> = {}) {
  return Array.from({ length: count }, () => createProxy(overrides));
}
