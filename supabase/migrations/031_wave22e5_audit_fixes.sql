-- ============================================================
-- 031_wave22e5_audit_fixes.sql
-- Wave 22E-5 — second-pass audit fixes (CRITICAL + HIGH + MED).
--
-- Closes:
--   B2 (HIGH) — safe_bulk_edit_proxies guard counts soft-deleted rows
--   A1 (HIGH) — reorder_proxy_categories_atomic increments unconditionally
--   C1 (MED)  — bulk_proxy_ops still callable; supersede + revoke
--   C2 (MED)  — fn_proxy_categories_recount doesn't filter soft-deleted
--
-- All changes idempotent (CREATE OR REPLACE / DROP IF EXISTS).
-- ============================================================

-- ------------------------------------------------------------
-- 1. B2 fix — safe_bulk_edit_proxies guard now excludes soft-deleted
-- ------------------------------------------------------------
-- Pre-fix: a bulk status change rejected the entire batch when ANY soft-
-- deleted proxy in the id list had an illegal transition. E.g. setting
-- 100 available->maintenance with 5 banned-and-soft-deleted in the list
-- returned 409 invalid_count=5 forever — those rows wouldn't actually
-- be touched but the guard counted them.
-- Fix: AND is_deleted = false in the count + UPDATE.

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

  -- Guard: only count NON-deleted rows toward invalid_count.
  -- A bulk-edit re-marking is_deleted from true->false is the only
  -- path that should touch soft-deleted rows; that's not subject to
  -- the status-machine guard.
  IF p_status IS NOT NULL THEN
    SELECT count(*)
      INTO v_invalid_count
      FROM proxies
      WHERE id = ANY(p_ids)
        AND is_deleted = false   -- <<< Wave 22E-5 B2 fix
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

  -- UPDATE applies to all matching ids; soft-deleted rows can still be
  -- restored via the is_deleted=false path. Status only changes on rows
  -- where the transition is legal (the guard already proved this).
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

-- ------------------------------------------------------------
-- 2. A1 fix — reorder_proxy_categories_atomic returns honest count
-- ------------------------------------------------------------
-- Pre-fix: incremented v_updated for every loop iteration, even when
-- the UPDATE matched zero rows. UI saw {ok:true, updated:N} for non-
-- existent UUIDs. Fix: GET DIAGNOSTICS the row-count and only count
-- rows that actually changed.

CREATE OR REPLACE FUNCTION reorder_proxy_categories_atomic(
  p_category_ids UUID[],
  p_sort_orders  INTEGER[]
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated INTEGER := 0;
  v_affected INTEGER;
  i INTEGER;
BEGIN
  IF NOT (SELECT is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;
  IF p_category_ids IS NULL OR p_sort_orders IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'arrays required');
  END IF;
  IF array_length(p_category_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'updated', 0);
  END IF;
  IF array_length(p_category_ids, 1) <> array_length(p_sort_orders, 1) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'length mismatch');
  END IF;
  IF array_length(p_category_ids, 1) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'too many rows (max 500)');
  END IF;

  FOR i IN 1..array_length(p_category_ids, 1) LOOP
    UPDATE proxy_categories
      SET sort_order = p_sort_orders[i], updated_at = now()
      WHERE id = p_category_ids[i];
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    v_updated := v_updated + v_affected;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'updated', v_updated);
END;
$$;

-- ------------------------------------------------------------
-- 3. C1 fix — drop bulk_proxy_ops (superseded by safe_bulk_edit_proxies)
-- ------------------------------------------------------------
-- bulk_proxy_ops (mig 026) does NOT enforce the status-machine guard.
-- After Wave 22E-3 the route uses safe_bulk_edit_proxies; bulk_proxy_ops
-- is a stranded entry point that any direct-DB script could call to
-- bypass the guard. Drop it.
DROP FUNCTION IF EXISTS bulk_proxy_ops(UUID[], INTEGER, TEXT[], TEXT[]);

-- ------------------------------------------------------------
-- 4. C2 fix — proxy_count denorm excludes soft-deleted
-- ------------------------------------------------------------
-- Pre-fix: trigger incremented proxy_count on INSERT/UPDATE without
-- checking is_deleted. When a proxy was soft-deleted, the trigger
-- did NOT decrement (because category_id didn't change), leaving
-- the count inflated. The /categories list page badge showed
-- trashed proxies in the count.
-- Fix: only count non-deleted rows; add a hook for soft-delete
-- transitions.

CREATE OR REPLACE FUNCTION fn_proxy_categories_recount()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- INSERT: only count if the proxy is live (not soft-deleted at insert time).
  IF TG_OP = 'INSERT' AND NEW.category_id IS NOT NULL AND NEW.is_deleted = false THEN
    UPDATE proxy_categories
      SET proxy_count = proxy_count + 1, updated_at = now()
      WHERE id = NEW.category_id;
  END IF;

  -- DELETE (hard): decrement if the row was live; soft-deleted rows
  -- already had their count decremented by the soft-delete UPDATE branch.
  IF TG_OP = 'DELETE' AND OLD.category_id IS NOT NULL AND OLD.is_deleted = false THEN
    UPDATE proxy_categories
      SET proxy_count = GREATEST(0, proxy_count - 1), updated_at = now()
      WHERE id = OLD.category_id;
  END IF;

  -- UPDATE: handle three orthogonal axes — category_id change, is_deleted
  -- soft-delete, is_deleted restore.
  IF TG_OP = 'UPDATE' THEN
    -- Soft-delete: live row becoming trashed.
    IF OLD.is_deleted = false AND NEW.is_deleted = true AND OLD.category_id IS NOT NULL THEN
      UPDATE proxy_categories
        SET proxy_count = GREATEST(0, proxy_count - 1), updated_at = now()
        WHERE id = OLD.category_id;
    -- Restore: trashed row becoming live.
    ELSIF OLD.is_deleted = true AND NEW.is_deleted = false AND NEW.category_id IS NOT NULL THEN
      UPDATE proxy_categories
        SET proxy_count = proxy_count + 1, updated_at = now()
        WHERE id = NEW.category_id;
    -- Category re-assignment on a live row.
    ELSIF NEW.is_deleted = false AND OLD.is_deleted = false
          AND OLD.category_id IS DISTINCT FROM NEW.category_id THEN
      IF OLD.category_id IS NOT NULL THEN
        UPDATE proxy_categories
          SET proxy_count = GREATEST(0, proxy_count - 1), updated_at = now()
          WHERE id = OLD.category_id;
      END IF;
      IF NEW.category_id IS NOT NULL THEN
        UPDATE proxy_categories
          SET proxy_count = proxy_count + 1, updated_at = now()
          WHERE id = NEW.category_id;
      END IF;
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Trigger now also fires on is_deleted column changes — extend the
-- AFTER UPDATE column list.
DROP TRIGGER IF EXISTS trg_proxies_category_recount ON proxies;
CREATE TRIGGER trg_proxies_category_recount
  AFTER INSERT OR UPDATE OF category_id, is_deleted OR DELETE ON proxies
  FOR EACH ROW EXECUTE FUNCTION fn_proxy_categories_recount();

-- ------------------------------------------------------------
-- 5. A6 — safe_expire_proxies (atomic batch expire + counter decrement)
-- ------------------------------------------------------------
-- The expire-proxies cron now batch-UPDATEs proxies but does NOT
-- decrement tele_users.proxies_used_total. Users have inflated counters
-- after expiry until the hourly/daily reset window — possibly blocking
-- new requests for hours.
--
-- Fix: this RPC mirrors safe_revoke_proxy semantics for the cron's
-- batch expiry path. Returns counts so the cron can log accurately.

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
  SELECT ARRAY(
    SELECT DISTINCT assigned_to
    FROM proxies
    WHERE id = ANY(p_proxy_ids)
      AND status = 'assigned'
      AND is_deleted = false
      AND assigned_to IS NOT NULL
  ) INTO v_user_ids;

  -- Batch expire — race-safe via status='assigned' guard.
  UPDATE proxies
    SET status = 'expired', assigned_to = NULL, assigned_at = NULL, updated_at = now()
    WHERE id = ANY(p_proxy_ids)
      AND status = 'assigned';
  GET DIAGNOSTICS v_expired = ROW_COUNT;

  -- Decrement total counter for each affected user.
  -- Hourly/daily are window counters that auto-reset; total is lifetime
  -- and the only one that grows monotonically.
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
  'Wave 22E-5 — atomic batch expire + tele_users counter decrement. Called by /api/cron/expire-proxies.';
