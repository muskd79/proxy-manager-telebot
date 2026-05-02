-- ============================================================
-- 051_phase1c_safe_bulk_edit_for_update.sql
-- Phase 1C (B-010) — close TOCTOU window in safe_bulk_edit_proxies.
--
-- Senior Dev review (docs/REVIEW_2026-05-02_SENIOR_DEV.md B-010):
-- the existing RPC (mig 041) does
--    SELECT count(*) ... WHERE NOT fn_proxy_status_can_transition(...)
-- then
--    UPDATE proxies WHERE id = ANY(p_ids)
-- in the SAME transaction. READ COMMITTED isolation lets a concurrent
-- transaction race in between SELECT and UPDATE: both calls see the
-- same "valid" snapshot, both pass the can_transition guard, both
-- run UPDATE → final state can be illegal (e.g. banned -> available
-- bypassing maintenance).
--
-- Fix: take a row-level lock on the target rows BEFORE running the
-- transition check. The first transaction to FOR UPDATE blocks
-- subsequent ones; when the second tx wakes up its can_transition
-- check now sees the post-UPDATE state and (correctly) refuses the
-- illegal transition.
-- ============================================================

CREATE OR REPLACE FUNCTION safe_bulk_edit_proxies(
  p_ids          UUID[],
  p_status       TEXT     DEFAULT NULL,
  p_is_deleted   BOOLEAN  DEFAULT NULL,
  p_notes        TEXT     DEFAULT NULL,
  p_extend_days  INTEGER  DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invalid_count INTEGER := 0;
  v_updated       INTEGER := 0;
BEGIN
  IF NOT (SELECT is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'updated', 0);
  END IF;
  IF array_length(p_ids, 1) > 5000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'too many rows (max 5000)');
  END IF;

  -- Phase 1C — lock rows we are about to inspect + update. The
  -- result discarded; we just need the lock semantics. Subsequent
  -- transactions wait here until our COMMIT/ROLLBACK.
  PERFORM 1
    FROM proxies
    WHERE id = ANY(p_ids)
      AND is_deleted = false
    FOR UPDATE;

  IF p_status IS NOT NULL THEN
    SELECT count(*)
      INTO v_invalid_count
      FROM proxies
      WHERE id = ANY(p_ids)
        AND is_deleted = false
        AND NOT fn_proxy_status_can_transition(status::text, p_status);

    IF v_invalid_count > 0 THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'invalid_status_transition',
        'invalid_count', v_invalid_count,
        'requested_status', p_status
      );
    END IF;
  END IF;

  WITH upd AS (
    UPDATE proxies p
    SET
      status     = CASE WHEN p_status IS NULL THEN p.status
                        ELSE p_status::proxy_status END,
      is_deleted = CASE WHEN p_is_deleted IS NULL THEN p.is_deleted
                        ELSE p_is_deleted END,
      deleted_at = CASE WHEN p_is_deleted IS NULL THEN p.deleted_at
                        WHEN p_is_deleted THEN now()
                        ELSE NULL END,
      notes      = CASE WHEN p_notes IS NULL THEN p.notes ELSE p_notes END,
      expires_at = CASE WHEN p_extend_days IS NULL THEN p.expires_at
                        ELSE COALESCE(p.expires_at, now()) + make_interval(days => p_extend_days)
                   END,
      updated_at = now()
    WHERE p.id = ANY(p_ids)
    RETURNING 1
  )
  SELECT count(*) INTO v_updated FROM upd;

  RETURN jsonb_build_object('ok', true, 'updated', v_updated);
END;
$$;

-- Permissions are inherited from the existing GRANT.
COMMENT ON FUNCTION safe_bulk_edit_proxies(UUID[], TEXT, BOOLEAN, TEXT, INTEGER) IS
  'Phase 1C — added FOR UPDATE row lock to close TOCTOU window between '
  'the can_transition guard and the UPDATE.';
