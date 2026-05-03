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
    // Wave 25-pre4 (Pass 7.A) — AUP fields removed (DB columns dropped
    // in migration 052). The AUP gate was retired in Wave 23C-fix.
    // Wave 25-pre4 (Pass 3.2 + 7.4) — milestone columns added in
    // migration 053. Default to "first proxy already happened" + "start
    // notification already fired" so test fixtures don't accidentally
    // trigger the delight footer or admin notification path.
    first_proxy_at: new Date(Date.now() - 86_400_000).toISOString(),
    first_start_notified_at: new Date(Date.now() - 86_400_000).toISOString(),
    is_deleted: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}
