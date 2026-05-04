-- ============================================================
-- 063_wave27_v7_reported_broken_expiry.sql
-- Wave 27 bug hunt v7 [debugger #2, HIGH] — reported_broken proxies
-- never expired by the cron.
--
-- Pre-fix: safe_expire_proxies() guards `status = 'assigned'` only.
-- mig 057 added the `reported_broken` state for warranty workflow.
-- A proxy in `reported_broken` whose `expires_at` is past stays
-- `reported_broken` forever — the cron skips it. Side effect: the
-- warranty approve handler then copies `expires_at` from the
-- original to the replacement, handing the user an already-expired
-- replacement proxy.
--
-- Now: safe_expire_proxies accepts BOTH `assigned` and
-- `reported_broken` rows. Counter decrement for tele_users
-- continues to use only `assigned` rows (a `reported_broken` proxy
-- was already excluded from the user's active count via the
-- warranty workflow's status-flip).
--
-- The cron's SELECT query is updated in TS (route.ts) to mirror
-- the same `.in("status", [...])` widening.
-- ============================================================

CREATE OR REPLACE FUNCTION safe_expire_proxies(
  p_proxy_ids UUID[]
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_ids UUID[];
  v_expired  INTEGER;
BEGIN
  IF p_proxy_ids IS NULL OR array_length(p_proxy_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('expired', 0, 'users_decremented', 0);
  END IF;

  -- Capture current assigned_to BEFORE UPDATE clears it.
  -- Only `assigned` proxies count — `reported_broken` was already
  -- excluded from the user's active count when the user submitted
  -- the warranty claim (status flipped + counter decremented).
  SELECT ARRAY(
    SELECT DISTINCT assigned_to
    FROM proxies
    WHERE id = ANY(p_proxy_ids)
      AND status = 'assigned'
      AND is_deleted = false
      AND assigned_to IS NOT NULL
  ) INTO v_user_ids;

  -- Batch expire — race-safe via status guard.
  -- Wave 27 v7: widen to assigned + reported_broken (both can be
  -- past their expires_at; both should transition to expired).
  UPDATE proxies
    SET status = 'expired', assigned_to = NULL, assigned_at = NULL, updated_at = now()
    WHERE id = ANY(p_proxy_ids)
      AND status IN ('assigned', 'reported_broken');
  GET DIAGNOSTICS v_expired = ROW_COUNT;

  -- Decrement total counter for each affected user.
  IF v_user_ids IS NOT NULL AND array_length(v_user_ids, 1) > 0 THEN
    UPDATE tele_users
      SET proxies_used_total = GREATEST(0, proxies_used_total - 1),
          updated_at         = now()
      WHERE id = ANY(v_user_ids);
  END IF;

  RETURN jsonb_build_object(
    'expired', v_expired,
    'users_decremented', COALESCE(array_length(v_user_ids, 1), 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION safe_expire_proxies(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION safe_expire_proxies(UUID[]) TO service_role;

COMMENT ON FUNCTION safe_expire_proxies IS
  'Wave 27 v7 — atomic batch expire + tele_users counter decrement. Now handles BOTH assigned and reported_broken statuses. Called by /api/cron/expire-proxies.';
