-- ============================================================
-- 002_create_indexes.sql
-- Create performance indexes for proxy-manager-telebot
-- ============================================================

-- proxies
CREATE INDEX idx_proxies_status
    ON proxies (status)
    WHERE is_deleted = false;

CREATE INDEX idx_proxies_type_status
    ON proxies (type, status)
    WHERE is_deleted = false;

CREATE INDEX idx_proxies_assigned_to
    ON proxies (assigned_to)
    WHERE assigned_to IS NOT NULL;

CREATE INDEX idx_proxies_country
    ON proxies (country);

-- tele_users
CREATE INDEX idx_tele_users_telegram_id
    ON tele_users (telegram_id);

CREATE INDEX idx_tele_users_status
    ON tele_users (status)
    WHERE is_deleted = false;

-- proxy_requests
CREATE INDEX idx_requests_status
    ON proxy_requests (status);

CREATE INDEX idx_requests_tele_user
    ON proxy_requests (tele_user_id);

-- chat_messages
CREATE INDEX idx_chat_tele_user
    ON chat_messages (tele_user_id, created_at DESC);

-- activity_logs
CREATE INDEX idx_logs_actor
    ON activity_logs (actor_type, actor_id);

CREATE INDEX idx_logs_resource
    ON activity_logs (resource_type, resource_id);

CREATE INDEX idx_logs_created
    ON activity_logs (created_at DESC);
