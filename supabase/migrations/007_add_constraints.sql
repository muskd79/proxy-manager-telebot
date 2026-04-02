-- The proxies table already has UNIQUE(host, port) from 001_create_tables.sql
-- This is sufficient since same host:port can't have different types
-- Verify it exists:
-- ALTER TABLE proxies ADD CONSTRAINT IF NOT EXISTS proxies_host_port_key UNIQUE (host, port);

-- Add index for faster duplicate checking during import
CREATE INDEX IF NOT EXISTS idx_proxies_host_port ON proxies(host, port) WHERE is_deleted = false;
