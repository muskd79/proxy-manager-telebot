-- =========================================================
-- 009: Add decrement_usage RPC for proxy revocation
-- =========================================================

CREATE OR REPLACE FUNCTION decrement_usage(p_user_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE tele_users
  SET
    proxies_used_hourly = GREATEST(proxies_used_hourly - 1, 0),
    proxies_used_daily = GREATEST(proxies_used_daily - 1, 0),
    proxies_used_total = GREATEST(proxies_used_total - 1, 0),
    updated_at = now()
  WHERE id = p_user_id
    AND is_deleted = false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
