-- ============================================================
-- 004_create_functions.sql
-- Helper functions and triggers for proxy-manager-telebot
-- ============================================================

-- ----------------------
-- updated_at trigger function
-- ----------------------
CREATE OR REPLACE FUNCTION handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

-- Create updated_at triggers on all tables that have the column
CREATE TRIGGER set_updated_at_admins
    BEFORE UPDATE ON admins
    FOR EACH ROW
    EXECUTE FUNCTION handle_updated_at();

CREATE TRIGGER set_updated_at_proxies
    BEFORE UPDATE ON proxies
    FOR EACH ROW
    EXECUTE FUNCTION handle_updated_at();

CREATE TRIGGER set_updated_at_tele_users
    BEFORE UPDATE ON tele_users
    FOR EACH ROW
    EXECUTE FUNCTION handle_updated_at();

CREATE TRIGGER set_updated_at_settings
    BEFORE UPDATE ON settings
    FOR EACH ROW
    EXECUTE FUNCTION handle_updated_at();

-- ----------------------
-- check_rate_limit: checks if a user can request a proxy
-- Returns JSONB {allowed: boolean, reason: text}
-- ----------------------
CREATE OR REPLACE FUNCTION check_rate_limit(p_tele_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user tele_users%ROWTYPE;
BEGIN
    SELECT * INTO v_user
    FROM tele_users
    WHERE id = p_tele_user_id
      AND is_deleted = false;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('allowed', false, 'reason', 'User not found');
    END IF;

    IF v_user.status != 'active' THEN
        RETURN jsonb_build_object('allowed', false, 'reason', 'User is not active. Status: ' || v_user.status::text);
    END IF;

    -- Check total limit
    IF v_user.proxies_used_total >= v_user.rate_limit_total THEN
        RETURN jsonb_build_object('allowed', false, 'reason', 'Total proxy limit reached');
    END IF;

    -- Check daily limit (reset if needed)
    IF v_user.daily_reset_at IS NOT NULL AND v_user.daily_reset_at < now() THEN
        UPDATE tele_users
        SET proxies_used_daily = 0,
            daily_reset_at = now() + INTERVAL '1 day'
        WHERE id = p_tele_user_id;
        v_user.proxies_used_daily := 0;
    END IF;

    IF v_user.proxies_used_daily >= v_user.rate_limit_daily THEN
        RETURN jsonb_build_object('allowed', false, 'reason', 'Daily proxy limit reached');
    END IF;

    -- Check hourly limit (reset if needed)
    IF v_user.hourly_reset_at IS NOT NULL AND v_user.hourly_reset_at < now() THEN
        UPDATE tele_users
        SET proxies_used_hourly = 0,
            hourly_reset_at = now() + INTERVAL '1 hour'
        WHERE id = p_tele_user_id;
        v_user.proxies_used_hourly := 0;
    END IF;

    IF v_user.proxies_used_hourly >= v_user.rate_limit_hourly THEN
        RETURN jsonb_build_object('allowed', false, 'reason', 'Hourly proxy limit reached');
    END IF;

    -- Check max concurrent proxies
    DECLARE
        v_active_count INTEGER;
    BEGIN
        SELECT COUNT(*) INTO v_active_count
        FROM proxies
        WHERE assigned_to = p_tele_user_id
          AND status = 'assigned'
          AND is_deleted = false;

        IF v_active_count >= v_user.max_proxies THEN
            RETURN jsonb_build_object('allowed', false, 'reason', 'Maximum concurrent proxies reached');
        END IF;
    END;

    RETURN jsonb_build_object('allowed', true, 'reason', NULL);
END;
$$;

-- ----------------------
-- reset_hourly_limits: resets hourly counters
-- ----------------------
CREATE OR REPLACE FUNCTION reset_hourly_limits()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE tele_users
    SET proxies_used_hourly = 0,
        hourly_reset_at = now() + INTERVAL '1 hour'
    WHERE hourly_reset_at < now()
      AND is_deleted = false;
END;
$$;

-- ----------------------
-- reset_daily_limits: resets daily counters
-- ----------------------
CREATE OR REPLACE FUNCTION reset_daily_limits()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE tele_users
    SET proxies_used_daily = 0,
        daily_reset_at = now() + INTERVAL '1 day'
    WHERE daily_reset_at < now()
      AND is_deleted = false;
END;
$$;

-- ----------------------
-- assign_proxy: manually assigns a proxy to a user via a request
-- ----------------------
CREATE OR REPLACE FUNCTION assign_proxy(
    p_request_id UUID,
    p_proxy_id   UUID,
    p_admin_id   UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_request proxy_requests%ROWTYPE;
    v_proxy   proxies%ROWTYPE;
BEGIN
    -- Lock and fetch the request
    SELECT * INTO v_request
    FROM proxy_requests
    WHERE id = p_request_id
      AND is_deleted = false
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Request not found: %', p_request_id;
    END IF;

    IF v_request.status != 'pending' THEN
        RAISE EXCEPTION 'Request is not in pending status: %', v_request.status;
    END IF;

    -- Lock and fetch the proxy
    SELECT * INTO v_proxy
    FROM proxies
    WHERE id = p_proxy_id
      AND is_deleted = false
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Proxy not found: %', p_proxy_id;
    END IF;

    IF v_proxy.status != 'available' THEN
        RAISE EXCEPTION 'Proxy is not available. Status: %', v_proxy.status;
    END IF;

    -- Update the proxy
    UPDATE proxies
    SET status      = 'assigned',
        assigned_to = v_request.tele_user_id,
        assigned_at = now()
    WHERE id = p_proxy_id;

    -- Update the request
    UPDATE proxy_requests
    SET status       = 'approved',
        proxy_id     = p_proxy_id,
        approved_by  = p_admin_id,
        processed_at = now()
    WHERE id = p_request_id;

    -- Increment user counters
    UPDATE tele_users
    SET proxies_used_hourly = proxies_used_hourly + 1,
        proxies_used_daily  = proxies_used_daily + 1,
        proxies_used_total  = proxies_used_total + 1,
        hourly_reset_at     = COALESCE(hourly_reset_at, now() + INTERVAL '1 hour'),
        daily_reset_at      = COALESCE(daily_reset_at, now() + INTERVAL '1 day')
    WHERE id = v_request.tele_user_id;

    -- Log the action
    INSERT INTO activity_logs (actor_type, actor_id, action, resource_type, resource_id, details)
    VALUES (
        'admin',
        p_admin_id,
        'assign_proxy',
        'proxy',
        p_proxy_id,
        jsonb_build_object(
            'request_id', p_request_id,
            'tele_user_id', v_request.tele_user_id
        )
    );
END;
$$;

-- ----------------------
-- auto_assign_proxy: finds an available proxy matching criteria and assigns it
-- Returns the proxy UUID or NULL if none available
-- ----------------------
CREATE OR REPLACE FUNCTION auto_assign_proxy(
    p_tele_user_id UUID,
    p_proxy_type   TEXT DEFAULT NULL,
    p_country      TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_proxy_id    UUID;
    v_request_id  UUID;
    v_rate_check  JSONB;
BEGIN
    -- Check rate limit first
    v_rate_check := check_rate_limit(p_tele_user_id);
    IF NOT (v_rate_check->>'allowed')::boolean THEN
        RAISE EXCEPTION 'Rate limit exceeded: %', v_rate_check->>'reason';
    END IF;

    -- Find an available proxy matching criteria
    SELECT id INTO v_proxy_id
    FROM proxies
    WHERE status = 'available'
      AND is_deleted = false
      AND (p_proxy_type IS NULL OR type = p_proxy_type::proxy_type)
      AND (p_country IS NULL OR country = p_country)
    ORDER BY last_checked_at DESC NULLS LAST, speed_ms ASC NULLS LAST
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF v_proxy_id IS NULL THEN
        RETURN NULL;
    END IF;

    -- Create a request record
    INSERT INTO proxy_requests (tele_user_id, proxy_id, proxy_type, country, status, approval_mode, processed_at)
    VALUES (
        p_tele_user_id,
        v_proxy_id,
        CASE WHEN p_proxy_type IS NOT NULL THEN p_proxy_type::proxy_type ELSE NULL END,
        p_country,
        'auto_approved',
        'auto',
        now()
    )
    RETURNING id INTO v_request_id;

    -- Assign the proxy
    UPDATE proxies
    SET status      = 'assigned',
        assigned_to = p_tele_user_id,
        assigned_at = now()
    WHERE id = v_proxy_id;

    -- Increment user counters
    UPDATE tele_users
    SET proxies_used_hourly = proxies_used_hourly + 1,
        proxies_used_daily  = proxies_used_daily + 1,
        proxies_used_total  = proxies_used_total + 1,
        hourly_reset_at     = COALESCE(hourly_reset_at, now() + INTERVAL '1 hour'),
        daily_reset_at      = COALESCE(daily_reset_at, now() + INTERVAL '1 day')
    WHERE id = p_tele_user_id;

    -- Log the action
    INSERT INTO activity_logs (actor_type, actor_id, action, resource_type, resource_id, details)
    VALUES (
        'bot',
        p_tele_user_id,
        'auto_assign_proxy',
        'proxy',
        v_proxy_id,
        jsonb_build_object('request_id', v_request_id)
    );

    RETURN v_proxy_id;
END;
$$;

-- ----------------------
-- soft_delete_proxy
-- ----------------------
CREATE OR REPLACE FUNCTION soft_delete_proxy(p_proxy_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE proxies
    SET is_deleted = true,
        deleted_at = now(),
        status     = 'maintenance'
    WHERE id = p_proxy_id
      AND is_deleted = false;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Proxy not found or already deleted: %', p_proxy_id;
    END IF;
END;
$$;

-- ----------------------
-- restore_proxy
-- ----------------------
CREATE OR REPLACE FUNCTION restore_proxy(p_proxy_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE proxies
    SET is_deleted = false,
        deleted_at = NULL,
        status     = 'available'
    WHERE id = p_proxy_id
      AND is_deleted = true;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Proxy not found or not deleted: %', p_proxy_id;
    END IF;
END;
$$;

-- ----------------------
-- get_dashboard_stats: returns aggregated statistics
-- ----------------------
CREATE OR REPLACE FUNCTION get_dashboard_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
    v_result JSONB;
BEGIN
    SELECT jsonb_build_object(
        'proxies', jsonb_build_object(
            'total',       COUNT(*) FILTER (WHERE NOT is_deleted),
            'available',   COUNT(*) FILTER (WHERE status = 'available' AND NOT is_deleted),
            'assigned',    COUNT(*) FILTER (WHERE status = 'assigned' AND NOT is_deleted),
            'expired',     COUNT(*) FILTER (WHERE status = 'expired' AND NOT is_deleted),
            'banned',      COUNT(*) FILTER (WHERE status = 'banned' AND NOT is_deleted),
            'maintenance', COUNT(*) FILTER (WHERE status = 'maintenance' AND NOT is_deleted),
            'deleted',     COUNT(*) FILTER (WHERE is_deleted)
        )
    ) INTO v_result
    FROM proxies;

    -- User stats
    v_result := v_result || jsonb_build_object(
        'users', (
            SELECT jsonb_build_object(
                'total',   COUNT(*) FILTER (WHERE NOT is_deleted),
                'active',  COUNT(*) FILTER (WHERE status = 'active' AND NOT is_deleted),
                'pending', COUNT(*) FILTER (WHERE status = 'pending' AND NOT is_deleted),
                'blocked', COUNT(*) FILTER (WHERE status = 'blocked' AND NOT is_deleted),
                'banned',  COUNT(*) FILTER (WHERE status = 'banned' AND NOT is_deleted)
            )
            FROM tele_users
        )
    );

    -- Request stats
    v_result := v_result || jsonb_build_object(
        'requests', (
            SELECT jsonb_build_object(
                'pending',       COUNT(*) FILTER (WHERE status = 'pending' AND NOT is_deleted),
                'approved',      COUNT(*) FILTER (WHERE status = 'approved' AND NOT is_deleted),
                'rejected',      COUNT(*) FILTER (WHERE status = 'rejected' AND NOT is_deleted),
                'auto_approved', COUNT(*) FILTER (WHERE status = 'auto_approved' AND NOT is_deleted)
            )
            FROM proxy_requests
        )
    );

    RETURN v_result;
END;
$$;
