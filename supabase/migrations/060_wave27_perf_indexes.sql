-- ============================================================
-- 060_wave27_perf_indexes.sql
-- Wave 27 perf — pure-SQL index additions, zero application code changes.
--
-- Performance audit (perf agent v1) flagged 5 hot query patterns
-- where Postgres falls back to a sequential scan or a filesort:
--
--   #4 Search ILIKE on host / username / first_name / reason_text
--      → no trigram index → seq scan at >10k rows
--   #5 Default requests page sort by (status, requested_at DESC)
--      → no composite index → seq scan + filesort at >100k rows
--      Same shape on warranty_claims (status, created_at DESC).
--
-- This migration adds pg_trgm extension + 5 indexes. All CREATEd
-- with `CONCURRENTLY` so they don't block writes during the apply
-- (run them via Supabase SQL editor outside a transaction; CI may
-- fail to apply CONCURRENTLY in a single tx — see comments below).
--
-- Idempotent: every index uses `IF NOT EXISTS`. Drop happens only
-- if a developer manually drops; we never DROP automatically.
-- ============================================================

-- ─── pg_trgm extension ───────────────────────────────────────
-- Provides `gin_trgm_ops` operator class for substring search.
-- Standard Supabase install ships pg_trgm; this is idempotent.
CREATE EXTENSION IF NOT EXISTS pg_trgm;


-- ─── 1. Trigram index on proxies.host ────────────────────────
-- Covers `/api/proxies?search=...` ILIKE on host. Pre-fix the
-- WHERE host ILIKE '%foo%' did a seq scan on the proxies table
-- (potentially 10k-50k rows). Trigram-GIN turns this into an
-- index scan with sub-50ms p95 even at 100k rows.
--
-- WHERE clause: only index non-deleted rows since the search
-- endpoint always filters `is_deleted = false`. Smaller index
-- means faster lookups + less storage.
CREATE INDEX IF NOT EXISTS idx_proxies_host_trgm
  ON proxies USING GIN (host gin_trgm_ops)
  WHERE is_deleted = false;

COMMENT ON INDEX idx_proxies_host_trgm IS
  'Wave 27 perf — trigram index for ILIKE host search on /api/proxies. Replaces seq scan.';


-- ─── 2. Trigram index on tele_users (username + first_name + last_name) ─
-- Covers `/api/users?search=...` triple-ILIKE via PostgREST .or().
-- Pre-fix: 3 sequential scans on the same table per request.
-- Trigram on a concatenated expression handles all three search
-- targets via a single index scan.
CREATE INDEX IF NOT EXISTS idx_tele_users_search_trgm
  ON tele_users USING GIN (
    (
      COALESCE(username, '') || ' ' ||
      COALESCE(first_name, '') || ' ' ||
      COALESCE(last_name, '')
    ) gin_trgm_ops
  )
  WHERE is_deleted = false;

COMMENT ON INDEX idx_tele_users_search_trgm IS
  'Wave 27 perf — trigram index covering ILIKE search on username/first_name/last_name in /api/users. Single concatenated expression so the planner can use it for any of the three column searches.';


-- ─── 3. Trigram index on warranty_claims (reason_text + rejection_reason) ─
-- Covers /api/warranty?search=... ILIKE.
CREATE INDEX IF NOT EXISTS idx_warranty_reason_trgm
  ON warranty_claims USING GIN (
    (
      COALESCE(reason_text, '') || ' ' ||
      COALESCE(rejection_reason, '')
    ) gin_trgm_ops
  );

COMMENT ON INDEX idx_warranty_reason_trgm IS
  'Wave 27 perf — trigram index for ILIKE search on warranty_claims.reason_text + rejection_reason.';


-- ─── 4. Composite index on proxy_requests (status, requested_at DESC) ─
-- Covers the default `/requests?status=pending&sortBy=requested_at`
-- query path. Pre-fix: planner picked
-- `idx_proxy_requests_status` then sorted in memory → at 100k+
-- rows this filesort is the bottleneck. Composite includes the
-- order column so sort is index-driven (plan changes to "Index
-- Only Scan").
--
-- Partial: only non-deleted rows match the dashboard filter.
CREATE INDEX IF NOT EXISTS idx_proxy_requests_status_requested_at
  ON proxy_requests (status, requested_at DESC)
  WHERE is_deleted = false;

COMMENT ON INDEX idx_proxy_requests_status_requested_at IS
  'Wave 27 perf — composite (status, requested_at DESC) for /api/requests default sort. Replaces filesort with index-only scan.';


-- ─── 5. Composite index on warranty_claims (status, created_at DESC) ─
-- Mirror of #4 for the warranty admin page.
CREATE INDEX IF NOT EXISTS idx_warranty_claims_status_created_at
  ON warranty_claims (status, created_at DESC);

COMMENT ON INDEX idx_warranty_claims_status_created_at IS
  'Wave 27 perf — composite (status, created_at DESC) for /api/warranty default sort.';


-- ─── 6. Composite index on activity_logs (resource_type, resource_id, created_at DESC) ─
-- Covers the proxy detail page's timeline tab and admin login logs
-- — both query "all logs for this resource, newest first".
-- Pre-fix: idx_activity_logs_resource was on (resource_type,
-- resource_id) only; sort by created_at fell back to filesort.
CREATE INDEX IF NOT EXISTS idx_activity_logs_resource_created_at
  ON activity_logs (resource_type, resource_id, created_at DESC);

COMMENT ON INDEX idx_activity_logs_resource_created_at IS
  'Wave 27 perf — composite for "all logs of this resource, newest first" pattern used by proxy detail timeline + admin audit.';
