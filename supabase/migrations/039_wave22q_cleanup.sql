-- ============================================================
-- 039_wave22q_cleanup.sql
-- Wave 22Q — Tech-debt cleanup identified in 5-agent review.
--
-- Summary of changes:
--   1. Drop dead RPCs from mig 004 (superseded by newer functions).
--   2. Drop duplicate idx_proxies_created_desc (mig 015b == mig 015a).
--   3. Drop unfiltered idx_proxies_host_trgm (mig 011, superseded by
--      mig 023 which adds WHERE is_deleted = false).
--   4. Add B-tree index idx_proxies_network_type_eq for equality
--      filter on network_type (complements existing GIN trigram index).
--   5. Enable RLS on api_rate_limits table (currently unprotected).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Drop dead RPCs (zero callers in application code verified
--    via grep on 2026-04-28 before this migration was written).
-- ------------------------------------------------------------

-- check_rate_limit — superseded by check_and_increment_usage (mig 012)
--   which atomically checks AND increments in one DB round-trip.
DROP FUNCTION IF EXISTS check_rate_limit(UUID);

-- assign_proxy — superseded by safe_assign_proxy (mig 027)
--   which uses SELECT ... FOR UPDATE SKIP LOCKED to prevent races.
DROP FUNCTION IF EXISTS assign_proxy(UUID, UUID, UUID);

-- auto_assign_proxy — superseded by smart_pick_proxy (mig 027)
--   which adds fair distribution and GeoIP preference.
DROP FUNCTION IF EXISTS auto_assign_proxy(UUID, TEXT, TEXT);

-- reset_hourly_limits — inline reset inside check_and_increment_usage
--   (mig 012); cron callers were removed in mig 014.
DROP FUNCTION IF EXISTS reset_hourly_limits();

-- reset_daily_limits — same rationale as reset_hourly_limits above.
DROP FUNCTION IF EXISTS reset_daily_limits();

-- ------------------------------------------------------------
-- 2. Drop duplicate pagination index
-- ------------------------------------------------------------
-- idx_proxies_created_desc (mig 015b: 015_connection_pool_index.sql)
-- is byte-for-byte identical to idx_proxies_created_at_id
-- (mig 015a: 015_cursor_pagination_index.sql).
-- PostgreSQL keeps both but uses only one; drop the alias.
DROP INDEX IF EXISTS idx_proxies_created_desc;

-- ------------------------------------------------------------
-- 3. Drop unfiltered trigram host index (mig 011)
-- ------------------------------------------------------------
-- mig 023 created idx_proxies_host_trgm with WHERE is_deleted = false,
-- which is strictly better: smaller, faster, consistent with all queries.
-- mig 011's version had no predicate — drop it if it still exists.
-- (If the DB was migrated sequentially the CREATE INDEX IF NOT EXISTS
--  in mig 023 already replaced it; this DROP is a belt-and-suspenders
--  cleanup for environments that never ran mig 011 after mig 023.)
-- Note: both carry the same name, so only one can exist at a time.
-- This is a no-op if mig 023 already replaced it.
-- Recreate the filtered version in case this drop removed it.
DROP INDEX IF EXISTS idx_proxies_host_trgm;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_proxies_host_trgm
  ON proxies USING GIN (host gin_trgm_ops)
  WHERE is_deleted = false;

-- ------------------------------------------------------------
-- 4. B-tree index for network_type equality filter
-- ------------------------------------------------------------
-- The GIN trigram index (idx_proxies_network_type_trgm, mig 038) handles
-- ILIKE partial-match searches. For exact equality filters
-- (e.g. WHERE network_type = 'isp') a B-tree index is more efficient.
CREATE INDEX IF NOT EXISTS idx_proxies_network_type_eq
  ON proxies (network_type)
  WHERE is_deleted = false AND network_type IS NOT NULL;

-- ------------------------------------------------------------
-- 5. Enable RLS on api_rate_limits
-- ------------------------------------------------------------
-- api_rate_limits had NO RLS — any authenticated user could read or
-- modify rate-limit counters for other users. Restrict to service_role
-- only (the server-side Supabase admin client) so end-user JWT sessions
-- cannot touch this table directly.
ALTER TABLE api_rate_limits ENABLE ROW LEVEL SECURITY;

-- Service-role bypass (admin client used by all server-side RPC callers).
CREATE POLICY api_rate_limits_service
  ON api_rate_limits
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
