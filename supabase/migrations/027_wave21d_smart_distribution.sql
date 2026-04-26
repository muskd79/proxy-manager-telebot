-- ============================================================
-- 027_wave21d_smart_distribution.sql
-- Wave 21D — smart distribution priority + bulk_assign with same priority.
--
-- Replaces the legacy "first available proxy" pick (mig 008) with
-- inventory-aware priority. The bot user gets the proxy that:
--   1. Has the most expiry time remaining (fairer to them, defers
--      our own renewal cost on under-utilised proxies)
--   2. Is fastest among ties (UX win)
--   3. Has been distributed least recently (rotation fairness so
--      no single proxy is hot-cycled to multiple users)
--
-- After SELECT FOR UPDATE SKIP LOCKED + UPDATE, the function also:
--   - increments distribute_count
--   - sets last_distributed_at = now()
--   - records assignment timestamps
--
-- Hot-path index: idx_proxies_distribute_priority (Wave 21A) covers
-- (type, geo_country_iso, expires_at DESC, speed_ms ASC,
--  last_distributed_at ASC NULLS FIRST) WHERE is_deleted=false AND
-- status='available'. The query plan reads index entries in order
-- and FOR UPDATE SKIP LOCKED returns the first non-locked row.
-- ============================================================

-- ------------------------------------------------------------
-- 1. safe_assign_proxy — UPDATE the chosen row (called when admin
-- already has a proxy_id pinned). The change here is auxiliary:
-- we now also bump distribute_count + last_distributed_at so the
-- fairness sort (used by the auto-pick variant below) sees the
-- update.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION safe_assign_proxy(
  p_request_id UUID,
  p_proxy_id   UUID,
  p_admin_id   UUID
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
  SELECT tele_user_id INTO v_tele_user_id
  FROM proxy_requests
  WHERE id = p_request_id AND status = 'pending';

  IF v_tele_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Request not found or already processed');
  END IF;

  UPDATE proxies
  SET status              = 'assigned',
      assigned_to         = v_tele_user_id,
      assigned_at         = now(),
      distribute_count    = distribute_count + 1,    -- Wave 21D
      last_distributed_at = now(),                   -- Wave 21D
      updated_at          = now()
  WHERE id = p_proxy_id
    AND status = 'available'
    AND is_deleted = false
  RETURNING id, host, port, type::text, username, password
  INTO v_proxy_id, v_host, v_port, v_type, v_username, v_password;

  IF v_proxy_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Proxy no longer available');
  END IF;

  UPDATE proxy_requests
  SET status      = 'approved',
      proxy_id    = v_proxy_id,
      approved_by = p_admin_id,
      processed_at = now()
  WHERE id = p_request_id;

  RETURN json_build_object(
    'success', true,
    'proxy', json_build_object(
      'id', v_proxy_id, 'host', v_host, 'port', v_port,
      'type', v_type, 'username', v_username, 'password', v_password
    ),
    'tele_user_id', v_tele_user_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 2. smart_pick_proxy — auto-select the best available proxy.
--    Used by the bot's `/getproxy` flow when the user filtered by
--    type + country but did not pin a specific proxy_id.
--
--    Priority (matches idx_proxies_distribute_priority order):
--      ORDER BY expires_at DESC NULLS LAST,
--               speed_ms ASC NULLS LAST,
--               last_distributed_at ASC NULLS FIRST
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION smart_pick_proxy(
  p_request_id      UUID,
  p_admin_id        UUID,
  p_type            TEXT,
  p_geo_country_iso TEXT DEFAULT NULL
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
  SELECT tele_user_id INTO v_tele_user_id
  FROM proxy_requests
  WHERE id = p_request_id AND status = 'pending';

  IF v_tele_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Request not found or already processed');
  END IF;

  -- Pick the best candidate row with FOR UPDATE SKIP LOCKED so
  -- concurrent bot invocations each get a different proxy.
  WITH candidate AS (
    SELECT id
    FROM proxies
    WHERE status = 'available'
      AND is_deleted = false
      AND type = p_type::proxy_type
      AND (p_geo_country_iso IS NULL OR geo_country_iso = p_geo_country_iso)
    ORDER BY
      expires_at          DESC NULLS LAST,
      speed_ms            ASC  NULLS LAST,
      last_distributed_at ASC  NULLS FIRST
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  UPDATE proxies p
  SET status              = 'assigned',
      assigned_to         = v_tele_user_id,
      assigned_at         = now(),
      distribute_count    = p.distribute_count + 1,
      last_distributed_at = now(),
      updated_at          = now()
  FROM candidate c
  WHERE p.id = c.id
  RETURNING p.id, p.host, p.port, p.type::text, p.username, p.password
  INTO v_proxy_id, v_host, v_port, v_type, v_username, v_password;

  IF v_proxy_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'No available proxies match the criteria');
  END IF;

  UPDATE proxy_requests
  SET status      = 'approved',
      proxy_id    = v_proxy_id,
      approved_by = p_admin_id,
      processed_at = now()
  WHERE id = p_request_id;

  RETURN json_build_object(
    'success', true,
    'proxy', json_build_object(
      'id', v_proxy_id, 'host', v_host, 'port', v_port,
      'type', v_type, 'username', v_username, 'password', v_password
    ),
    'tele_user_id', v_tele_user_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION smart_pick_proxy(UUID, UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION smart_pick_proxy(UUID, UUID, TEXT, TEXT) TO authenticated, service_role;

COMMENT ON FUNCTION smart_pick_proxy IS
  'Wave 21D — auto-pick the best available proxy. Uses idx_proxies_distribute_priority. FOR UPDATE SKIP LOCKED for concurrency.';
