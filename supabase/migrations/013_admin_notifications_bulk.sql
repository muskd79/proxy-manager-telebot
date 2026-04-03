-- =========================================================
-- 013: Admin Telegram ID, bulk proxy requests
-- =========================================================

-- 1. Add telegram_id to admins table (nullable, unique per admin)
ALTER TABLE admins ADD COLUMN IF NOT EXISTS telegram_id BIGINT UNIQUE;

-- 2. Add quantity + batch_id to proxy_requests for bulk requests
ALTER TABLE proxy_requests ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1;
ALTER TABLE proxy_requests ADD COLUMN IF NOT EXISTS batch_id UUID;
CREATE INDEX IF NOT EXISTS idx_proxy_requests_batch ON proxy_requests(batch_id) WHERE batch_id IS NOT NULL;

-- 3. Bulk assign proxies atomically (FOR UPDATE SKIP LOCKED)
CREATE OR REPLACE FUNCTION bulk_assign_proxies(
  p_user_id UUID,
  p_type TEXT,
  p_quantity INTEGER,
  p_admin_id UUID DEFAULT NULL,
  p_batch_id UUID DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
  v_proxy RECORD;
  v_proxies JSON[];
  v_count INTEGER := 0;
  v_expires_at TIMESTAMPTZ := now() + INTERVAL '30 days';
  v_status TEXT;
BEGIN
  -- Lock and assign up to p_quantity available proxies
  FOR v_proxy IN
    SELECT id, host, port, type::text, username, password
    FROM proxies
    WHERE type = p_type
      AND status = 'available'
      AND is_deleted = false
    ORDER BY created_at ASC
    LIMIT p_quantity
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Assign proxy
    UPDATE proxies SET
      status = 'assigned',
      assigned_to = p_user_id,
      assigned_at = now(),
      expires_at = v_expires_at,
      updated_at = now()
    WHERE id = v_proxy.id;

    -- Determine request status
    v_status := CASE WHEN p_admin_id IS NOT NULL THEN 'approved' ELSE 'auto_approved' END;

    -- Create request record
    INSERT INTO proxy_requests (
      tele_user_id, proxy_id, proxy_type, status, approval_mode,
      requested_at, processed_at, expires_at, quantity, batch_id,
      approved_by, is_deleted
    ) VALUES (
      p_user_id, v_proxy.id, p_type, v_status,
      CASE WHEN p_admin_id IS NOT NULL THEN 'manual' ELSE 'auto' END,
      now(), now(), v_expires_at, 1, p_batch_id,
      p_admin_id, false
    );

    v_proxies := array_append(v_proxies, json_build_object(
      'id', v_proxy.id,
      'host', v_proxy.host,
      'port', v_proxy.port,
      'type', v_proxy.type,
      'username', v_proxy.username,
      'password', v_proxy.password
    ));
    v_count := v_count + 1;
  END LOOP;

  -- Increment user usage counters
  IF v_count > 0 THEN
    UPDATE tele_users SET
      proxies_used_hourly = proxies_used_hourly + v_count,
      proxies_used_daily = proxies_used_daily + v_count,
      proxies_used_total = proxies_used_total + v_count,
      updated_at = now()
    WHERE id = p_user_id;
  END IF;

  RETURN json_build_object(
    'success', v_count > 0,
    'assigned', v_count,
    'requested', p_quantity,
    'proxies', COALESCE(array_to_json(v_proxies), '[]'::json),
    'batch_id', p_batch_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
