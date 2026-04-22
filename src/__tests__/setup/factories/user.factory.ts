export function createTeleUser(overrides: Partial<any> = {}) {
  return {
    id: crypto.randomUUID(),
    telegram_id: Math.floor(Math.random() * 1000000),
    username: "testuser",
    first_name: "Test",
    status: "active",
    approval_mode: "auto",
    max_proxies: 5,
    rate_limit_hourly: 3,
    rate_limit_daily: 10,
    rate_limit_total: 50,
    proxies_used_hourly: 0,
    proxies_used_daily: 0,
    proxies_used_total: 0,
    hourly_reset_at: null,
    daily_reset_at: null,
    language: "en",
    // Default fixture assumes AUP already accepted (most tests don't exercise the
    // AUP gate). Tests that need the gate can override with `aup_accepted_at: null`.
    aup_accepted_at: new Date().toISOString(),
    aup_version: "v1.0",
    is_deleted: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}
