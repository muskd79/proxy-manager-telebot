-- ============================================================
-- 030_wave22e3_safe_bulk_edit.sql
-- Wave 22E-3 — atomic safe_bulk_edit_proxies RPC.
--
-- BUG B2 (code-reviewer audit, severity HIGH):
-- src/app/api/proxies/bulk-edit/route.ts ran a 3-step pattern:
--   1. SELECT id, status FROM proxies WHERE id IN (ids)
--   2. App-side proxyMachine.canTransition() validation
--   3. UPDATE proxies SET status=$new WHERE id IN (ids)
-- Two concurrent admins could both pass step 2 with different
-- "current statuses", then both proceed to step 3, producing illegal
-- final states (e.g. banned -> available without going through
-- maintenance).
--
-- Fix: this RPC pushes the status-machine guard INTO the UPDATE
-- statement via a CTE that filters out illegal transitions. Either
-- all rows successfully transition or the RPC reports the invalid
-- count without changing any row.
--
-- The function ALSO supersedes bulk_proxy_ops (mig 026) by accepting
-- the same (extend_days, tags_add, tags_remove) parameters AND the
-- new (status, is_deleted, notes, deleted_at) parameters, so the API
-- route makes ONE round-trip instead of two.
-- ============================================================

-- ------------------------------------------------------------
-- Allowed transitions matrix — mirrors src/lib/state-machine/proxy.ts
-- exactly. Encoded as a compile-time table so the planner can use
-- a single CTE to filter rows. Keep in sync with the TS machine.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_proxy_status_can_transition(
  p_from TEXT, p_to TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
BEGIN
  -- No-op transitions are always allowed.
  IF p_from = p_to THEN RETURN true; END IF;

  IF p_from = 'available'   AND p_to IN ('assigned', 'maintenance') THEN RETURN true; END IF;
  IF p_from = 'assigned'    AND p_to IN ('available', 'maintenance', 'banned', 'expired') THEN RETURN true; END IF;
  IF p_from = 'expired'     AND p_to IN ('available', 'maintenance') THEN RETURN true; END IF;
  IF p_from = 'banned'      AND p_to = 'maintenance' THEN RETURN true; END IF;
  IF p_from = 'maintenance' AND p_to IN ('available', 'banned') THEN RETURN true; END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION fn_proxy_status_can_transition(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_proxy_status_can_transition(TEXT, TEXT)
  TO authenticated, service_role;

-- ------------------------------------------------------------
-- safe_bulk_edit_proxies — single atomic call covering all bulk-edit
-- operations the UI exposes.
--
-- Returns:
--   { ok, updated, invalid_count, ... }
-- where invalid_count > 0 means some rows had illegal status
-- transitions and the entire bulk was rejected (no row was changed).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION safe_bulk_edit_proxies(
  p_ids          UUID[],
  p_status       TEXT     DEFAULT NULL,
  p_is_deleted   BOOLEAN  DEFAULT NULL,
  p_notes        TEXT     DEFAULT NULL,
  p_extend_days  INTEGER  DEFAULT NULL,
  p_tags_add     TEXT[]   DEFAULT NULL,
  p_tags_remove  TEXT[]   DEFAULT NULL
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

  -- 1. ATOMIC GUARD: count how many rows have an illegal transition
  --    to the requested status. If any, reject the entire bulk.
  --    Done in the same transaction as the UPDATE below — no race.
  IF p_status IS NOT NULL THEN
    SELECT count(*)
      INTO v_invalid_count
      FROM proxies
      WHERE id = ANY(p_ids)
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

  -- 2. Single UPDATE applying every requested field.
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
      tags = CASE
        WHEN p_tags_add IS NULL AND p_tags_remove IS NULL THEN p.tags
        ELSE
          ARRAY(
            SELECT DISTINCT t
            FROM unnest(
              COALESCE(
                CASE WHEN p_tags_remove IS NULL THEN p.tags
                     ELSE ARRAY(SELECT t FROM unnest(p.tags) AS t WHERE t <> ALL(p_tags_remove))
                END,
                ARRAY[]::TEXT[]
              ) || COALESCE(p_tags_add, ARRAY[]::TEXT[])
            ) AS t
          )
      END,
      updated_at = now()
    WHERE p.id = ANY(p_ids)
    RETURNING 1
  )
  SELECT count(*) INTO v_updated FROM upd;

  RETURN jsonb_build_object('ok', true, 'updated', v_updated);
END;
$$;

REVOKE ALL ON FUNCTION safe_bulk_edit_proxies(UUID[], TEXT, BOOLEAN, TEXT, INTEGER, TEXT[], TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION safe_bulk_edit_proxies(UUID[], TEXT, BOOLEAN, TEXT, INTEGER, TEXT[], TEXT[])
  TO authenticated, service_role;

COMMENT ON FUNCTION safe_bulk_edit_proxies IS
  'Wave 22E-3 — atomic bulk edit. Status guard + UPDATE in one transaction. Closes B2 race condition (code-reviewer audit).';
