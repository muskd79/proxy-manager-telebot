export function createProxy(overrides: Partial<any> = {}) {
  return {
    id: crypto.randomUUID(),
    host: `192.168.1.${Math.floor(Math.random() * 255)}`,
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
