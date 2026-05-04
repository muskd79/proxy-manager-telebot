-- ============================================================
-- 065_wave27_v10_perf_indexes.sql
-- Wave 27 v10 perf — three partial indexes targeting scale-load
-- failure modes flagged by the performance-optimizer agent.
--
-- Each index is sharply scoped via WHERE so it stays small (less
-- storage, faster scans, lower write amplification) and only
-- covers the exact filter shape used by the corresponding query.
--
-- Findings addressed:
--   #1 — analytics RPC: chat_messages has no index on
--        (created_at, tele_user_id) → 14× seq scan per call.
--        Index 065-A covers the COUNT(DISTINCT user) per-day path.
--   #3 — get_category_dashboard cumulative_revenue CTE: seq scans
--        proxy_events on every dashboard load. Index 065-B is a
--        partial index on event_type='assigned' so the JOIN turns
--        into an index scan.
--   #5 — expiry-warning cron: needs (status='assigned',
--        expires_at) composite filter. Index 065-C is a partial
--        on (expires_at) where status='assigned' AND is_deleted=
--        false AND expires_at IS NOT NULL.
--
-- All indexes use IF NOT EXISTS for idempotency. Use CREATE INDEX
-- CONCURRENTLY in production via the Supabase SQL editor (this
-- file omits CONCURRENTLY because Supabase migrations CLI wraps
-- everything in a transaction; CONCURRENTLY can't run inside one).
-- ============================================================


-- ─── 065-A: chat_messages.(created_at, tele_user_id) ─────────
--
-- Pre-fix: get_analytics() does
--   SELECT COUNT(DISTINCT cm.tele_user_id) FROM chat_messages cm
--   WHERE cm.created_at::date = d::date
-- inside a generate_series loop (14 iterations). With no index on
-- chat_messages.created_at the planner runs 14 seq scans of the
-- entire table per analytics call. At 50k rows = 700k row reads
-- per dashboard refresh.
--
-- This index covers the date-bucketed COUNT(DISTINCT user). The
-- (tele_user_id) tail makes COUNT(DISTINCT) an index-only scan;
-- without it Postgres still has to fetch the heap row.
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_user
  ON chat_messages (created_at, tele_user_id);


-- ─── 065-B: proxy_events partial index for 'assigned' ─────────
--
-- Pre-fix: get_category_dashboard()'s cumulative_revenue CTE has
--   FROM proxy_events e
--   JOIN proxies p ON p.id = e.proxy_id
--   WHERE e.event_type = 'assigned'
-- with NO index on event_type. Every dashboard render → full seq
-- scan of proxy_events. At 50k events / half being 'assigned',
-- that's a 25k-row scan + JSONB cast + GROUP BY.
--
-- Partial index keeps it small (only 'assigned' events indexed),
-- and the proxy_id tail enables index-only join with the proxies
-- table.
CREATE INDEX IF NOT EXISTS idx_proxy_events_assigned_proxy
  ON proxy_events (proxy_id, created_at)
  WHERE event_type = 'assigned';


-- ─── 065-C: proxies expiry-warning hot path ───────────────────
--
-- Pre-fix: cron expiry-warning runs
--   WHERE status = 'assigned'
--     AND is_deleted = false
--     AND expires_at > now()
--     AND expires_at <= now() + INTERVAL '3 days'
-- and there's no composite index covering both status='assigned'
-- AND the expires_at range. Pre-existing idx_proxies_expiry_vendor
-- doesn't filter by status. The planner picks the status index
-- and re-scans the result for date range, OR vice versa — both
-- visit every assigned-row at scale.
--
-- This partial index is the smallest possible: only assigned,
-- non-deleted, non-null-expiry rows are indexed by expires_at.
-- The cron's BETWEEN-now-and-3d window resolves to a tight range
-- scan against a much smaller index.
CREATE INDEX IF NOT EXISTS idx_proxies_assigned_expires_at
  ON proxies (expires_at)
  WHERE status = 'assigned'
    AND is_deleted = false
    AND expires_at IS NOT NULL;


-- ============================================================
-- Apply notes
-- ============================================================
-- 1. CI / Supabase migrations apply this file inside a tx, so
--    CONCURRENTLY is omitted. For zero-downtime production roll
--    out, drop the indexes (if previously created), open the
--    Supabase SQL editor outside any tx, and re-create them with
--    CREATE INDEX CONCURRENTLY ...
--
-- 2. Each index is small enough (KB-sized at typical row counts)
--    that even an in-tx CREATE on a live database completes in
--    <1s and locks only the affected table briefly. For our
--    current data volume the in-tx form is safe.
--
-- 3. Out of scope (deferred to PR #38):
--    - Rewrite get_analytics() RPC to lateral-join instead of
--      correlated subquery (algorithmic, not just an index)
--    - Consolidate /dashboard 3 realtime channels into 1 broadcast
-- ============================================================
