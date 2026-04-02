-- Additional indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_tele_users_username ON tele_users(username) WHERE username IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_proxy_requests_requested_at ON proxy_requests(requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_proxy_requests_processed_at ON proxy_requests(processed_at DESC) WHERE processed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_proxies_expires_at ON proxies(expires_at) WHERE expires_at IS NOT NULL AND is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_activity_logs_action ON activity_logs(action);
