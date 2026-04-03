-- =========================================================
-- 012: Atomic rate limit check + increment
-- Fixes race conditions where concurrent requests both pass
-- the check and both increment, exceeding limits.
-- =========================================================

-- Single atomic function that checks limits AND increments usage
-- Uses FOR UPDATE row lock to prevent concurrent bypasses
CREATE OR REPLACE FUNCTION check_and_increment_usage(
  p_user_id UUID,
  p_global_max_total INTEGER DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
  v_user RECORD;
  v_now TIMESTAMPTZ := now();
  v_used_hourly INTEGER;
  v_used_daily INTEGER;
  v_used_total INTEGER;
  v_effective_total INTEGER;
  v_hourly_reset TIMESTAMPTZ;
  v_daily_reset TIMESTAMPTZ;
BEGIN
  -- Lock the user row to prevent concurrent access
  SELECT * INTO v_user
  FROM tele_users
  WHERE id = p_user_id AND is_deleted = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('allowed', false, 'reason', 'User not found');
  END IF;

  -- Determine current usage (reset if window expired)
  v_used_hourly := v_user.proxies_used_hourly;
  v_hourly_reset := v_user.hourly_reset_at;
  IF v_hourly_reset IS NULL OR v_hourly_reset <= v_now THEN
    v_used_hourly := 0;
    v_hourly_reset := v_now + INTERVAL '1 hour';
  END IF;

  v_used_daily := v_user.proxies_used_daily;
  v_daily_reset := v_user.daily_reset_at;
  IF v_daily_reset IS NULL OR v_daily_reset <= v_now THEN
    v_used_daily := 0;
    v_daily_reset := v_now + INTERVAL '1 day';
  END IF;

  v_used_total := v_user.proxies_used_total;

  -- Apply global cap as upper bound on total limit
  v_effective_total := v_user.rate_limit_total;
  IF p_global_max_total IS NOT NULL AND p_global_max_total > 0 THEN
    v_effective_total := LEAST(v_effective_total, p_global_max_total);
  END IF;

  -- Check all limits
  IF v_used_hourly >= v_user.rate_limit_hourly THEN
    -- Still update reset times even if blocked
    UPDATE tele_users SET
      proxies_used_hourly = v_used_hourly,
      hourly_reset_at = v_hourly_reset,
      proxies_used_daily = v_used_daily,
      daily_reset_at = v_daily_reset
    WHERE id = p_user_id;

    RETURN json_build_object(
      'allowed', false,
      'reason', 'hourly_limit_exceeded',
      'remaining', json_build_object('hourly', 0, 'daily', v_user.rate_limit_daily - v_used_daily, 'total', v_effective_total - v_used_total)
    );
  END IF;

  IF v_used_daily >= v_user.rate_limit_daily THEN
    UPDATE tele_users SET
      proxies_used_hourly = v_used_hourly,
      hourly_reset_at = v_hourly_reset,
      proxies_used_daily = v_used_daily,
      daily_reset_at = v_daily_reset
    WHERE id = p_user_id;

    RETURN json_build_object(
      'allowed', false,
      'reason', 'daily_limit_exceeded',
      'remaining', json_build_object('hourly', v_user.rate_limit_hourly - v_used_hourly, 'daily', 0, 'total', v_effective_total - v_used_total)
    );
  END IF;

  IF v_used_total >= v_effective_total THEN
    UPDATE tele_users SET
      proxies_used_hourly = v_used_hourly,
      hourly_reset_at = v_hourly_reset,
      proxies_used_daily = v_used_daily,
      daily_reset_at = v_daily_reset
    WHERE id = p_user_id;

    RETURN json_build_object(
      'allowed', false,
      'reason', 'total_limit_exceeded',
      'remaining', json_build_object('hourly', v_user.rate_limit_hourly - v_used_hourly, 'daily', v_user.rate_limit_daily - v_used_daily, 'total', 0)
    );
  END IF;

  -- All checks passed: atomically increment AND update resets
  UPDATE tele_users SET
    proxies_used_hourly = v_used_hourly + 1,
    proxies_used_daily = v_used_daily + 1,
    proxies_used_total = v_used_total + 1,
    hourly_reset_at = v_hourly_reset,
    daily_reset_at = v_daily_reset,
    updated_at = v_now
  WHERE id = p_user_id;

  RETURN json_build_object(
    'allowed', true,
    'remaining', json_build_object(
      'hourly', v_user.rate_limit_hourly - v_used_hourly - 1,
      'daily', v_user.rate_limit_daily - v_used_daily - 1,
      'total', v_effective_total - v_used_total - 1
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
