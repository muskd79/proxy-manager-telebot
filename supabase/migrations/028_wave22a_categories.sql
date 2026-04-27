-- ============================================================
-- 028_wave22a_categories.sql
-- Wave 22A — Strong proxy categories (FLAT v1, no hierarchy).
--
-- Multi-agent synthesis:
--   - Architect's pushback adopted: ship FLAT first. Hierarchy adds
--     ~50 LOC of trigger/cycle/depth logic + a GIN index for descendant
--     queries. VIA's reference (mig 141) is also flat. Hierarchy can be
--     graduated in a future wave (parent_id nullable, default null) if
--     real admin demand emerges.
--   - DB-reviewer's pattern adopted: trigger-maintained `proxy_count`
--     (matches Wave 21A purchase_lots.proxy_count) over matview. Single-
--     tenant + <50K rows = trigger wins on simplicity + freshness.
--
-- Tags are NOT dropped here. Wave 22A ships categories ALONGSIDE tags.
-- Tag column drop is queued for a later wave after a 2-week buffer
-- where admins can migrate values via the UI.
-- ============================================================

-- ------------------------------------------------------------
-- 1. proxy_categories
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS proxy_categories (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT         NOT NULL,
  description     TEXT,
  color           TEXT         NOT NULL DEFAULT 'purple',
  icon            TEXT         NOT NULL DEFAULT 'tag',
  sort_order      INTEGER      NOT NULL DEFAULT 0,
  is_hidden       BOOLEAN      NOT NULL DEFAULT false,
  -- Trigger-maintained denorm. Avoids COUNT(*) on /categories list page
  -- at 10k+ proxies.
  proxy_count     INTEGER      NOT NULL DEFAULT 0
                              CHECK (proxy_count >= 0),
  -- Hooks for future per-category pricing without re-migrating later.
  default_price_usd NUMERIC(10,4) DEFAULT 0
                              CHECK (default_price_usd IS NULL OR default_price_usd >= 0),
  min_stock_alert INTEGER      NOT NULL DEFAULT 0
                              CHECK (min_stock_alert >= 0),
  created_by      UUID         REFERENCES admins(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT proxy_categories_name_length
    CHECK (char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT proxy_categories_color_length
    CHECK (char_length(color) BETWEEN 1 AND 30),
  CONSTRAINT proxy_categories_icon_length
    CHECK (char_length(icon) BETWEEN 1 AND 50)
);

-- Unique name (case-insensitive) so admin can't accidentally create two
-- "US Residential" categories with different casing.
CREATE UNIQUE INDEX IF NOT EXISTS idx_proxy_categories_name_unique
  ON proxy_categories (lower(name));

-- Sort order for the categories list page (admin-tunable order, drag-reorder UI).
CREATE INDEX IF NOT EXISTS idx_proxy_categories_sort
  ON proxy_categories (sort_order ASC, name ASC);

-- ------------------------------------------------------------
-- 2. proxies.category_id FK
-- ------------------------------------------------------------
ALTER TABLE proxies
  ADD COLUMN IF NOT EXISTS category_id UUID
    REFERENCES proxy_categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_proxies_category_id
  ON proxies (category_id)
  WHERE is_deleted = false AND category_id IS NOT NULL;

-- Mark tags column as deprecated. Tag drop happens in a later wave
-- after admins have had ~2 weeks to migrate via the UI.
COMMENT ON COLUMN proxies.tags IS
  'DEPRECATED Wave 22A — replaced by category_id. Read-only after Wave 22C; column dropped in a later wave.';

-- ------------------------------------------------------------
-- 3. updated_at auto-touch
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_proxy_categories_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_proxy_categories_touch_updated_at ON proxy_categories;
CREATE TRIGGER trg_proxy_categories_touch_updated_at
  BEFORE UPDATE ON proxy_categories
  FOR EACH ROW EXECUTE FUNCTION fn_proxy_categories_touch_updated_at();

-- ------------------------------------------------------------
-- 4. proxy_count denorm — bumped by trigger on proxies INSERT/UPDATE/DELETE
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_proxy_categories_recount()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- INSERT: new proxy claims a category.
  IF TG_OP = 'INSERT' AND NEW.category_id IS NOT NULL THEN
    UPDATE proxy_categories
      SET proxy_count = proxy_count + 1, updated_at = now()
      WHERE id = NEW.category_id;
  END IF;

  -- DELETE (hard): proxy leaves a category.
  IF TG_OP = 'DELETE' AND OLD.category_id IS NOT NULL THEN
    UPDATE proxy_categories
      SET proxy_count = GREATEST(0, proxy_count - 1), updated_at = now()
      WHERE id = OLD.category_id;
  END IF;

  -- UPDATE: category changed (re-assignment or cleared).
  IF TG_OP = 'UPDATE' AND
     (OLD.category_id IS DISTINCT FROM NEW.category_id) THEN
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

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_proxies_category_recount ON proxies;
CREATE TRIGGER trg_proxies_category_recount
  AFTER INSERT OR UPDATE OF category_id OR DELETE ON proxies
  FOR EACH ROW EXECUTE FUNCTION fn_proxy_categories_recount();

-- ------------------------------------------------------------
-- 5. RLS — admins read+write, viewers read-only
-- ------------------------------------------------------------
ALTER TABLE proxy_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS proxy_categories_select  ON proxy_categories;
DROP POLICY IF EXISTS proxy_categories_insert  ON proxy_categories;
DROP POLICY IF EXISTS proxy_categories_update  ON proxy_categories;
DROP POLICY IF EXISTS proxy_categories_delete  ON proxy_categories;
DROP POLICY IF EXISTS proxy_categories_service ON proxy_categories;

-- Wrap is_admin*() in (SELECT ...) so the planner evaluates it once
-- per statement (init plan), not per row. At 10k category rows this
-- is the difference between 1 lookup and 10k lookups per query.
CREATE POLICY proxy_categories_select ON proxy_categories
  FOR SELECT TO authenticated USING ((SELECT is_admin_or_viewer()));
CREATE POLICY proxy_categories_insert ON proxy_categories
  FOR INSERT TO authenticated WITH CHECK ((SELECT is_admin()));
CREATE POLICY proxy_categories_update ON proxy_categories
  FOR UPDATE TO authenticated USING ((SELECT is_admin()))
  WITH CHECK ((SELECT is_admin()));
CREATE POLICY proxy_categories_delete ON proxy_categories
  FOR DELETE TO authenticated USING ((SELECT is_admin()));
CREATE POLICY proxy_categories_service ON proxy_categories
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ------------------------------------------------------------
-- 6. RPC reorder_proxy_categories_atomic
-- ------------------------------------------------------------
-- Drag-reorder UI sends N (id, sort_order) pairs at once. Doing this
-- as N separate UPDATEs from the client risks a partial reorder if any
-- UPDATE fails; this RPC writes them in one transaction.
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
    v_updated := v_updated + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'updated', v_updated);
END;
$$;

REVOKE ALL ON FUNCTION reorder_proxy_categories_atomic(UUID[], INTEGER[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reorder_proxy_categories_atomic(UUID[], INTEGER[])
  TO authenticated, service_role;

-- ------------------------------------------------------------
-- 7. RPC assign_proxies_to_category — bulk reassignment.
-- ------------------------------------------------------------
-- Admin selects N proxies on /proxies and clicks "Assign to category X".
-- One SQL UPDATE; trigger-recount handles per-category counters.
CREATE OR REPLACE FUNCTION assign_proxies_to_category(
  p_proxy_ids   UUID[],
  p_category_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF NOT (SELECT is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;
  IF p_proxy_ids IS NULL OR array_length(p_proxy_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'updated', 0);
  END IF;
  IF array_length(p_proxy_ids, 1) > 5000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'too many proxies (max 5000)');
  END IF;
  IF p_category_id IS NOT NULL AND
     NOT EXISTS (SELECT 1 FROM proxy_categories WHERE id = p_category_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'category not found');
  END IF;

  UPDATE proxies
    SET category_id = p_category_id, updated_at = now()
    WHERE id = ANY(p_proxy_ids) AND is_deleted = false;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'updated', v_count);
END;
$$;

REVOKE ALL ON FUNCTION assign_proxies_to_category(UUID[], UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION assign_proxies_to_category(UUID[], UUID)
  TO authenticated, service_role;
