export function createAdmin(overrides: Partial<any> = {}) {
  return {
    id: crypto.randomUUID(),
    email: `admin-${Math.floor(Math.random() * 10000)}@test.com`,
    full_name: "Test Admin",
    role: "admin",
    is_active: true,
    telegram_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}
