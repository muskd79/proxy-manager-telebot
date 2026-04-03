export function createProxyRequest(overrides: Partial<any> = {}) {
  return {
    id: crypto.randomUUID(),
    tele_user_id: crypto.randomUUID(),
    proxy_type: "http",
    quantity: 1,
    status: "pending",
    approved_by: null,
    rejected_reason: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

export function createProxyRequests(
  count: number,
  overrides: Partial<any> = {}
) {
  return Array.from({ length: count }, () => createProxyRequest(overrides));
}
