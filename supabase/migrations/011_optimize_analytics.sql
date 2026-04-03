-- =========================================================
-- 011: Optimize analytics & dashboard stats queries
-- =========================================================
-- Reduces get_analytics() from 56 subqueries to 1 aggregated query + 1 correlated subquery per day.
-- Reduces get_dashboard_stats() from 14 subqueries to 3 single-scan queries using COUNT FILTER.
-- Adds trigram indexes for fast ILIKE proxy host/ISP search.

-- 1. Optimized get_analytics(): single LEFT JOIN instead of 4 subqueries per day
CREATE OR REPLACE FUNCTION get_analytics(p_days INTEGER DEFAULT 14)
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_agg(daily ORDER BY daily.date) INTO result FROM (
    SELECT
      d::date AS date,
      COALESCE(SUM(CASE WHEN pr.status = 'approved' THEN 1 ELSE 0 END), 0) AS approved,
      COALESCE(SUM(CASE WHEN pr.status = 'auto_approved' THEN 1 ELSE 0 END), 0) AS auto_approved,
      COALESCE(SUM(CASE WHEN pr.status = 'rejected' THEN 1 ELSE 0 END), 0) AS rejected,
      COALESCE((
        SELECT COUNT(DISTINCT tele_user_id)
        FROM chat_messages cm
        WHERE cm.created_at::date = d::date
      ), 0) AS active_users
    FROM generate_series(CURRENT_DATE - (p_days - 1), CURRENT_DATE, '1 day') AS d
    LEFT JOIN proxy_requests pr ON (
      COALESCE(pr.processed_at::date, pr.created_at::date) = d::date
      AND pr.status IN ('approved', 'auto_approved', 'rejected')
      AND pr.is_deleted = false
    )
    GROUP BY d::date
  ) daily;
  RETURN COALESCE(result, '[]'::json);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Optimized get_dashboard_stats(): 3 single-scan queries using COUNT FILTER
CREATE OR REPLACE FUNCTION get_dashboard_stats()
RETURNS JSON AS $$
DECLARE
  result JSON;
  proxy_stats JSON;
  user_stats JSON;
  request_stats JSON;
BEGIN
  -- Single scan for proxies
  SELECT json_build_object(
    'totalProxies', COUNT(*),
    'availableProxies', COUNT(*) FILTER (WHERE status = 'available'),
    'assignedProxies', COUNT(*) FILTER (WHERE status = 'assigned'),
    'expiredProxies', COUNT(*) FILTER (WHERE status = 'expired')
  ) INTO proxy_stats FROM proxies WHERE is_deleted = false;

  -- Single scan for users
  SELECT json_build_object(
    'totalUsers', COUNT(*),
    'activeUsers', COUNT(*) FILTER (WHERE status = 'active'),
    'pendingUsers', COUNT(*) FILTER (WHERE status = 'pending'),
    'blockedUsers', COUNT(*) FILTER (WHERE status = 'blocked')
  ) INTO user_stats FROM tele_users WHERE is_deleted = false;

  -- Single scan for requests
  SELECT json_build_object(
    'totalRequests', COUNT(*),
    'pendingRequests', COUNT(*) FILTER (WHERE status = 'pending'),
    'approvedRequests', COUNT(*) FILTER (WHERE status IN ('approved', 'auto_approved')),
    'rejectedRequests', COUNT(*) FILTER (WHERE status = 'rejected'),
    'todayRequests', COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE),
    'todayApproved', COUNT(*) FILTER (WHERE status IN ('approved', 'auto_approved') AND created_at >= CURRENT_DATE)
  ) INTO request_stats FROM proxy_requests WHERE is_deleted = false;

  SELECT proxy_stats::jsonb || user_stats::jsonb || request_stats::jsonb INTO result;
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Enable trigram extension for ILIKE search performance
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram index for fast proxy host search (ILIKE %search%)
CREATE INDEX IF NOT EXISTS idx_proxies_host_trgm ON proxies USING GIN (host gin_trgm_ops);

-- Also add for ISP search which uses ilike
CREATE INDEX IF NOT EXISTS idx_proxies_isp_trgm ON proxies USING GIN (isp gin_trgm_ops);
