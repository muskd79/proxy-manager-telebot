-- =========================================================
-- 010: Fix function signature conflicts
--
-- get_dashboard_stats() was defined in 004 (returns JSONB)
-- and redefined in 008 (returns JSON) without dropping first.
-- PostgreSQL cannot change the return type via CREATE OR REPLACE,
-- so we drop and recreate with the intended JSON return type.
-- =========================================================

-- Drop the old signature so we can recreate with correct return type
DROP FUNCTION IF EXISTS get_dashboard_stats();

-- Recreate with the 008 definition (JSON return type, flat keys)
CREATE OR REPLACE FUNCTION get_dashboard_stats()
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'totalProxies', (SELECT COUNT(*) FROM proxies WHERE is_deleted = false),
    'availableProxies', (SELECT COUNT(*) FROM proxies WHERE status = 'available' AND is_deleted = false),
    'assignedProxies', (SELECT COUNT(*) FROM proxies WHERE status = 'assigned' AND is_deleted = false),
    'expiredProxies', (SELECT COUNT(*) FROM proxies WHERE status = 'expired' AND is_deleted = false),
    'totalUsers', (SELECT COUNT(*) FROM tele_users WHERE is_deleted = false),
    'activeUsers', (SELECT COUNT(*) FROM tele_users WHERE status = 'active' AND is_deleted = false),
    'pendingUsers', (SELECT COUNT(*) FROM tele_users WHERE status = 'pending' AND is_deleted = false),
    'blockedUsers', (SELECT COUNT(*) FROM tele_users WHERE status = 'blocked' AND is_deleted = false),
    'totalRequests', (SELECT COUNT(*) FROM proxy_requests WHERE is_deleted = false),
    'pendingRequests', (SELECT COUNT(*) FROM proxy_requests WHERE status = 'pending' AND is_deleted = false),
    'approvedRequests', (SELECT COUNT(*) FROM proxy_requests WHERE status IN ('approved', 'auto_approved') AND is_deleted = false),
    'rejectedRequests', (SELECT COUNT(*) FROM proxy_requests WHERE status = 'rejected' AND is_deleted = false),
    'todayRequests', (SELECT COUNT(*) FROM proxy_requests WHERE created_at >= CURRENT_DATE AND is_deleted = false),
    'todayApproved', (SELECT COUNT(*) FROM proxy_requests WHERE status IN ('approved', 'auto_approved') AND created_at >= CURRENT_DATE AND is_deleted = false)
  ) INTO result;
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
