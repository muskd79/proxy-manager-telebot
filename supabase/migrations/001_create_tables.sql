-- ============================================================
-- 001_create_tables.sql
-- Create all ENUM types and tables for proxy-manager-telebot
-- ============================================================

-- ----------------------
-- ENUM types
-- ----------------------
CREATE TYPE admin_role AS ENUM ('super_admin', 'admin', 'viewer');

CREATE TYPE proxy_type AS ENUM ('http', 'https', 'socks5');

CREATE TYPE proxy_status AS ENUM ('available', 'assigned', 'expired', 'banned', 'maintenance');

CREATE TYPE tele_user_status AS ENUM ('active', 'blocked', 'pending', 'banned');

CREATE TYPE approval_mode AS ENUM ('auto', 'manual');

CREATE TYPE request_status AS ENUM ('pending', 'approved', 'rejected', 'auto_approved', 'expired', 'cancelled');

CREATE TYPE message_direction AS ENUM ('incoming', 'outgoing');

CREATE TYPE message_type AS ENUM ('text', 'command', 'callback', 'photo', 'document', 'system');

CREATE TYPE actor_type AS ENUM ('admin', 'tele_user', 'system', 'bot');

-- ----------------------
-- admins
-- ----------------------
CREATE TABLE admins (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email       TEXT UNIQUE NOT NULL,
    full_name   TEXT,
    role        admin_role NOT NULL DEFAULT 'admin',
    is_active   BOOLEAN NOT NULL DEFAULT true,
    language    TEXT NOT NULL DEFAULT 'vi',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------
-- tele_users (created before proxies so FK can reference it)
-- ----------------------
CREATE TABLE tele_users (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    telegram_id         BIGINT UNIQUE NOT NULL,
    username            TEXT,
    first_name          TEXT,
    last_name           TEXT,
    phone               TEXT,
    status              tele_user_status NOT NULL DEFAULT 'pending',
    approval_mode       approval_mode NOT NULL DEFAULT 'manual',
    max_proxies         INTEGER NOT NULL DEFAULT 1,
    rate_limit_hourly   INTEGER NOT NULL DEFAULT 5,
    rate_limit_daily    INTEGER NOT NULL DEFAULT 20,
    rate_limit_total    INTEGER NOT NULL DEFAULT 100,
    proxies_used_hourly INTEGER NOT NULL DEFAULT 0,
    proxies_used_daily  INTEGER NOT NULL DEFAULT 0,
    proxies_used_total  INTEGER NOT NULL DEFAULT 0,
    hourly_reset_at     TIMESTAMPTZ,
    daily_reset_at      TIMESTAMPTZ,
    language            TEXT NOT NULL DEFAULT 'vi',
    notes               TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    deleted_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------
-- proxies
-- ----------------------
CREATE TABLE proxies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    host            TEXT NOT NULL,
    port            INTEGER NOT NULL,
    type            proxy_type NOT NULL DEFAULT 'http',
    username        TEXT,
    password        TEXT,
    country         TEXT,
    city            TEXT,
    isp             TEXT,
    status          proxy_status NOT NULL DEFAULT 'available',
    speed_ms        INTEGER,
    last_checked_at TIMESTAMPTZ,
    assigned_to     UUID REFERENCES tele_users(id) ON DELETE SET NULL,
    assigned_at     TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ,
    tags            TEXT[],
    notes           TEXT,
    is_deleted      BOOLEAN NOT NULL DEFAULT false,
    deleted_at      TIMESTAMPTZ,
    created_by      UUID REFERENCES admins(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (host, port)
);

-- ----------------------
-- proxy_requests
-- ----------------------
CREATE TABLE proxy_requests (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tele_user_id    UUID NOT NULL REFERENCES tele_users(id) ON DELETE CASCADE,
    proxy_id        UUID REFERENCES proxies(id) ON DELETE SET NULL,
    proxy_type      proxy_type,
    country         TEXT,
    status          request_status NOT NULL DEFAULT 'pending',
    approval_mode   approval_mode,
    approved_by     UUID REFERENCES admins(id) ON DELETE SET NULL,
    rejected_reason TEXT,
    requested_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at    TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ,
    is_deleted      BOOLEAN NOT NULL DEFAULT false,
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------
-- chat_messages
-- ----------------------
CREATE TABLE chat_messages (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tele_user_id        UUID NOT NULL REFERENCES tele_users(id) ON DELETE CASCADE,
    telegram_message_id BIGINT,
    direction           message_direction NOT NULL,
    message_text        TEXT,
    message_type        message_type NOT NULL DEFAULT 'text',
    raw_data            JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------
-- activity_logs
-- ----------------------
CREATE TABLE activity_logs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_type    actor_type NOT NULL,
    actor_id      UUID,
    action        TEXT NOT NULL,
    resource_type TEXT,
    resource_id   UUID,
    details       JSONB,
    ip_address    TEXT,
    user_agent    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------
-- settings
-- ----------------------
CREATE TABLE settings (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key         TEXT UNIQUE NOT NULL,
    value       JSONB NOT NULL,
    description TEXT,
    updated_by  UUID REFERENCES admins(id) ON DELETE SET NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
