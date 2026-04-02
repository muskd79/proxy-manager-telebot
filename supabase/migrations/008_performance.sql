-- =========================================================
-- 008: Performance optimizations for 50 admin + 1000 users
-- =========================================================

-- 1. Dashboard stats RPC (replaces loading all rows into memory)
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

-- 2. Analytics RPC (14-day daily breakdown)
CREATE OR REPLACE FUNCTION get_analytics(p_days INTEGER DEFAULT 14)
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_agg(row_to_json(daily)) INTO result FROM (
    SELECT
      d::date AS date,
      COALESCE((SELECT COUNT(*) FROM proxy_requests WHERE status = 'approved' AND (processed_at::date = d::date OR (processed_at IS NULL AND created_at::date = d::date)) AND is_deleted = false), 0) AS approved,
      COALESCE((SELECT COUNT(*) FROM proxy_requests WHERE status = 'auto_approved' AND (processed_at::date = d::date OR (processed_at IS NULL AND created_at::date = d::date)) AND is_deleted = false), 0) AS auto_approved,
      COALESCE((SELECT COUNT(*) FROM proxy_requests WHERE status = 'rejected' AND (processed_at::date = d::date OR (processed_at IS NULL AND created_at::date = d::date)) AND is_deleted = false), 0) AS rejected,
      COALESCE((SELECT COUNT(DISTINCT tele_user_id) FROM chat_messages WHERE created_at::date = d::date), 0) AS active_users
    FROM generate_series(CURRENT_DATE - (p_days - 1), CURRENT_DATE, '1 day') AS d
    ORDER BY d
  ) daily;
  RETURN COALESCE(result, '[]'::json);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Safe proxy assignment (atomic, prevents race condition)
CREATE OR REPLACE FUNCTION safe_assign_proxy(
  p_request_id UUID,
  p_proxy_id UUID,
  p_admin_id UUID
) RETURNS JSON AS $$
DECLARE
  v_proxy_id UUID;
  v_tele_user_id UUID;
  v_host TEXT;
  v_port INTEGER;
  v_type TEXT;
  v_username TEXT;
  v_password TEXT;
BEGIN
  -- Get request info
  SELECT tele_user_id INTO v_tele_user_id
  FROM proxy_requests
  WHERE id = p_request_id AND status = 'pending';

  IF v_tele_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Request not found or already processed');
  END IF;

  -- Lock and assign proxy atomically
  UPDATE proxies
  SET status = 'assigned',
      assigned_to = v_tele_user_id,
      assigned_at = now(),
      updated_at = now()
  WHERE id = p_proxy_id
    AND status = 'available'
    AND is_deleted = false
  RETURNING id, host, port, type::text, username, password
  INTO v_proxy_id, v_host, v_port, v_type, v_username, v_password;

  IF v_proxy_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Proxy no longer available');
  END IF;

  -- Update request
  UPDATE proxy_requests
  SET status = 'approved',
      proxy_id = v_proxy_id,
      approved_by = p_admin_id,
      processed_at = now()
  WHERE id = p_request_id;

  RETURN json_build_object(
    'success', true,
    'proxy', json_build_object('id', v_proxy_id, 'host', v_host, 'port', v_port, 'type', v_type, 'username', v_username, 'password', v_password),
    'tele_user_id', v_tele_user_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Composite indexes for performance
CREATE INDEX IF NOT EXISTS idx_requests_user_status_date ON proxy_requests(tele_user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_proxies_status_assigned ON proxies(status, assigned_to) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_chat_created ON chat_messages(created_at DESC);

-- 5. API rate limit table (replaces in-memory Map)
CREATE TABLE IF NOT EXISTS api_rate_limits (
  ip_address TEXT PRIMARY KEY,
  request_count INTEGER NOT NULL DEFAULT 1,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON api_rate_limits(window_start);

-- Rate limit check function
CREATE OR REPLACE FUNCTION check_api_rate_limit(
  p_ip TEXT,
  p_max_requests INTEGER DEFAULT 100,
  p_window_seconds INTEGER DEFAULT 60
) RETURNS JSON AS $$
DECLARE
  v_count INTEGER;
  v_window_start TIMESTAMPTZ;
  v_now TIMESTAMPTZ := now();
BEGIN
  -- Get or create rate limit entry
  SELECT request_count, window_start INTO v_count, v_window_start
  FROM api_rate_limits
  WHERE ip_address = p_ip
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO api_rate_limits (ip_address, request_count, window_start)
    VALUES (p_ip, 1, v_now);
    RETURN json_build_object('allowed', true, 'remaining', p_max_requests - 1);
  END IF;

  -- Check if window expired
  IF v_window_start + (p_window_seconds || ' seconds')::interval < v_now THEN
    UPDATE api_rate_limits SET request_count = 1, window_start = v_now WHERE ip_address = p_ip;
    RETURN json_build_object('allowed', true, 'remaining', p_max_requests - 1);
  END IF;

  -- Increment
  IF v_count >= p_max_requests THEN
    RETURN json_build_object('allowed', false, 'remaining', 0);
  END IF;

  UPDATE api_rate_limits SET request_count = v_count + 1 WHERE ip_address = p_ip;
  RETURN json_build_object('allowed', true, 'remaining', p_max_requests - v_count - 1);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
