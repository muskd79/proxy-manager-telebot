-- ============================================================
-- 041_wave23a_orphan_idx_and_bulk_edit.sql
-- Wave 23A — drop orphan indexes + redefine safe_bulk_edit_proxies
-- without the dropped tags column.
--
-- Why:
--   1. mig 040 dropped purchase_lots → idx_proxies_purchase_lot stale
--   2. Wave 22Y hid the isp column from UI; idx_proxies_isp_trgm
--      no longer used, just slowing inserts
--   3. mig 037 dropped proxies.tags but safe_bulk_edit_proxies (defined
--      mig 030, redef mig 031) still references p.tags → calls with
--      tags arrays now ERROR at runtime. Bug C1 from Wave 23A review.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Drop orphan indexes
-- ------------------------------------------------------------
DROP INDEX IF EXISTS idx_proxies_purchase_lot;
DROP INDEX IF EXISTS idx_proxies_isp_trgm;

-- ------------------------------------------------------------
-- 2. Drop legacy safe_bulk_edit_proxies signatures
--    Replaced by tags-free variant. Drop both mig 030 and mig 031
--    signatures (same arglist).
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS safe_bulk_edit_proxies(UUID[], TEXT, BOOLEAN, TEXT, INTEGER, TEXT[], TEXT[]);

-- ------------------------------------------------------------
-- 3. Redefine without tags args/body
-- ------------------------------------------------------------
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

REVOKE ALL ON FUNCTION safe_bulk_edit_proxies(UUID[], TEXT, BOOLEAN, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION safe_bulk_edit_proxies(UUID[], TEXT, BOOLEAN, TEXT, INTEGER)
  TO authenticated, service_role;

COMMENT ON FUNCTION safe_bulk_edit_proxies(UUID[], TEXT, BOOLEAN, TEXT, INTEGER) IS
  'Wave 23A — atomic bulk edit. Tags args dropped (column gone in mig 037).';
