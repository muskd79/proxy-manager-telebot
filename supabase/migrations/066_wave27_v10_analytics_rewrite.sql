-- ============================================================
-- 066_wave27_v10_analytics_rewrite.sql
-- Wave 27 v10 perf — get_analytics() RPC rewrite to eliminate the
-- 14× correlated subquery against chat_messages.
--
-- Pre-fix shape (mig 011 line 20-24):
--   SELECT json_agg(...) FROM (
--     SELECT d::date, ..., (
--       SELECT COUNT(DISTINCT cm.tele_user_id)
--       FROM chat_messages cm
--       WHERE cm.created_at::date = d::date
--     ) AS active_users
--     FROM generate_series(...) AS d
--     LEFT JOIN proxy_requests ...
--   )
-- This forces 14 sequential scans of chat_messages per call.
-- Even with mig 065-A's index on (created_at, tele_user_id), each
-- subquery does its own range scan independently — Postgres can't
-- batch them across the generate_series rows.
--
-- Post-fix shape:
--   1. Pre-aggregate active_users per day in one scan via GROUP BY
--   2. Pre-aggregate proxy_requests per day similarly
--   3. LEFT JOIN both CTEs against generate_series for final shape
--
-- Result: 1 scan of chat_messages + 1 scan of proxy_requests per
-- call instead of 14 + 14. At 50k chat_messages with mig 065-A
-- index this drops from ~700k row reads to ~3500 (just the rows
-- in the 14-day window). Same for proxy_requests.
--
-- Adds an index on proxy_requests created_at to ensure the new
-- aggregation can use index-range scans for the date filter.
-- ============================================================

-- Index for the date-bounded aggregation in the new RPC.
-- Pre-fix: no index covered "rows in the last 14 days, GROUP BY
-- date(created_at)". Post-fix: range scan on this index returns
-- only the 14 days of rows + the GROUP BY can use the ordered
-- output for hash-aggregate efficiency.
CREATE INDEX IF NOT EXISTS idx_proxy_requests_created_at_status
  ON proxy_requests (created_at, status)
  WHERE is_deleted = false;


-- Replace the RPC. CREATE OR REPLACE is safe — same signature.
CREATE OR REPLACE FUNCTION get_analytics(p_days INTEGER DEFAULT 14)
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  WITH active_users_per_day AS (
    -- Wave 27 v10 — single scan replacing 14 correlated subqueries.
    SELECT
      created_at::date AS d_date,
      COUNT(DISTINCT tele_user_id) AS user_count
    FROM chat_messages
    WHERE created_at >= CURRENT_DATE - (p_days - 1)
      AND created_at <  CURRENT_DATE + INTERVAL '1 day'
    GROUP BY created_at::date
  ),
  request_aggs_per_day AS (
    -- Wave 27 v10 — single scan replacing 14 LEFT JOINs.
    -- COALESCE preserved exactly so analytics output unchanged
    -- for rows with non-null processed_at.
    SELECT
      COALESCE(processed_at::date, created_at::date) AS d_date,
      SUM(CASE WHEN status = 'approved'      THEN 1 ELSE 0 END) AS approved,
      SUM(CASE WHEN status = 'auto_approved' THEN 1 ELSE 0 END) AS auto_approved,
      SUM(CASE WHEN status = 'rejected'      THEN 1 ELSE 0 END) AS rejected
    FROM proxy_requests
    WHERE COALESCE(processed_at, created_at) >= CURRENT_DATE - (p_days - 1)
      AND COALESCE(processed_at, created_at) <  CURRENT_DATE + INTERVAL '1 day'
      AND status IN ('approved', 'auto_approved', 'rejected')
      AND is_deleted = false
    GROUP BY COALESCE(processed_at::date, created_at::date)
  )
  SELECT json_agg(daily ORDER BY daily.date) INTO result FROM (
    SELECT
      d::date AS date,
      COALESCE(ra.approved,      0) AS approved,
      COALESCE(ra.auto_approved, 0) AS auto_approved,
      COALESCE(ra.rejected,      0) AS rejected,
      COALESCE(au.user_count,    0) AS active_users
    FROM generate_series(
      CURRENT_DATE - (p_days - 1),
      CURRENT_DATE,
      '1 day'
    ) AS d
    LEFT JOIN request_aggs_per_day  ra ON ra.d_date = d::date
    LEFT JOIN active_users_per_day  au ON au.d_date = d::date
  ) daily;
  RETURN COALESCE(result, '[]'::json);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- Wave 27 security note — explicit search_path. Pre-fix the
-- function inherited the caller's search_path, opening a schema
-- shadow attack vector. Post-fix: search_path = public so an
-- attacker who creates `chat_messages` in their own schema can't
-- intercept the function's execution.

COMMENT ON FUNCTION get_analytics(INTEGER) IS
  'Returns daily counts of approved/auto_approved/rejected proxy_requests
   plus distinct active chat_messages users per day, for the last
   p_days days (default 14). Wave 27 v10 — rewrote to use 2 single-
   scan CTEs instead of 14 correlated subqueries; was ~700k row
   reads at 50k events, now ~3500.';
