-- ============================================================
-- 036_wave22g_rich_categories.sql
--
-- Wave 22G: rich proxy categories + cascade-hide.
--
-- Synthesis from architect agent (read sibling VIA mig 141 + 151
-- + 113 for precedent). Key decisions adopted:
--   - Cascade hide: denorm proxies.hidden boolean (Option A).
--     Trigger fires on category.is_hidden flip + on proxy
--     reassignment. Read path is just `WHERE NOT hidden`.
--   - Inheritance vs snapshot: SNAPSHOT. Frontend prefills proxy
--     fields from category defaults at create time; thereafter the
--     proxy's own fields are independent. This keeps audit trail
--     honest (a proxy sold at $5 reports $5 forever).
--   - Tags column: tombstone here (move to proxies_tags_archive),
--     drop in mig 037 after 1-week observation buffer.
-- ============================================================

-- ------------------------------------------------------------
-- 1. proxy_categories — new default-attribute columns
-- ------------------------------------------------------------
ALTER TABLE proxy_categories
  ADD COLUMN IF NOT EXISTS default_country     TEXT,
  ADD COLUMN IF NOT EXISTS default_proxy_type  proxy_type,
  ADD COLUMN IF NOT EXISTS default_isp         TEXT;

-- Wave 22G ADD CONSTRAINTs are wrapped in DO blocks because Postgres
-- treats `ADD CONSTRAINT IF NOT EXISTS` as a syntax error on some
-- versions. The DO block uses a catalog probe instead.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'proxy_categories_default_country_length'
  ) THEN
    ALTER TABLE proxy_categories
      ADD CONSTRAINT proxy_categories_default_country_length
        CHECK (default_country IS NULL OR char_length(default_country) BETWEEN 2 AND 64);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'proxy_categories_default_isp_length'
  ) THEN
    ALTER TABLE proxy_categories
      ADD CONSTRAINT proxy_categories_default_isp_length
        CHECK (default_isp IS NULL OR char_length(default_isp) BETWEEN 1 AND 200);
  END IF;
END $$;

COMMENT ON COLUMN proxy_categories.default_country IS
  'Wave 22G — prefill value for new proxies in this category. Snapshot, not inheritance: copied to proxy at create time.';
COMMENT ON COLUMN proxy_categories.default_proxy_type IS
  'Wave 22G — prefill value for new proxies. Reuses proxy_type enum.';
COMMENT ON COLUMN proxy_categories.default_isp IS
  'Wave 22G — prefill value for ISP field on new proxies.';

-- ------------------------------------------------------------
-- 2. proxies.hidden — cascade-hide denorm
-- ------------------------------------------------------------
ALTER TABLE proxies
  ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT false;

-- Partial index so the common /proxies query only scans visible rows.
-- The existing idx_proxies_visible (if any) will be picked up; this
-- is the new right one for Wave 22G filtering.
CREATE INDEX IF NOT EXISTS idx_proxies_visible_v22g
  ON proxies (status, category_id)
  WHERE is_deleted = false AND hidden = false;

COMMENT ON COLUMN proxies.hidden IS
  'Wave 22G — cascaded from proxy_categories.is_hidden via fn_cascade_category_hidden + fn_proxy_inherit_hidden_on_reassign. Mirror of VIA project mig 151 pattern.';

-- ------------------------------------------------------------
-- 3. Backfill — set hidden=true for proxies whose category is currently hidden
-- ------------------------------------------------------------
UPDATE proxies p
SET hidden = true, updated_at = now()
FROM proxy_categories c
WHERE p.category_id = c.id
  AND c.is_hidden = true
  AND p.hidden = false;

-- ------------------------------------------------------------
-- 4. Tags tombstone — archive then queue drop for mig 037
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS proxies_tags_archive (
  proxy_id     UUID PRIMARY KEY,
  tags         TEXT[] NOT NULL,
  archived_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO proxies_tags_archive (proxy_id, tags)
SELECT id, tags
FROM proxies
WHERE tags IS NOT NULL AND array_length(tags, 1) > 0
ON CONFLICT (proxy_id) DO NOTHING;

COMMENT ON COLUMN proxies.tags IS
  'TOMBSTONE Wave 22G — archived to proxies_tags_archive. DROP COLUMN scheduled for mig 037 after observation buffer.';

-- ------------------------------------------------------------
-- 5. Cascade trigger — category.is_hidden flip propagates to proxies
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_cascade_category_hidden()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.is_hidden IS DISTINCT FROM NEW.is_hidden THEN
    UPDATE proxies
      SET hidden = NEW.is_hidden, updated_at = now()
      WHERE category_id = NEW.id
        AND is_deleted = false
        AND hidden IS DISTINCT FROM NEW.is_hidden;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_proxy_categories_cascade_hidden ON proxy_categories;
CREATE TRIGGER trg_proxy_categories_cascade_hidden
  AFTER UPDATE OF is_hidden ON proxy_categories
  FOR EACH ROW EXECUTE FUNCTION fn_cascade_category_hidden();

-- ------------------------------------------------------------
-- 6. Reassignment trigger — proxy.category_id change inherits new cat's hidden
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_proxy_inherit_hidden_on_reassign()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_cat_hidden BOOLEAN;
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') AND
     NEW.category_id IS NOT NULL AND
     (TG_OP = 'INSERT' OR OLD.category_id IS DISTINCT FROM NEW.category_id) THEN
    SELECT is_hidden INTO v_cat_hidden
      FROM proxy_categories WHERE id = NEW.category_id;
    NEW.hidden := COALESCE(v_cat_hidden, false);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_proxies_inherit_hidden ON proxies;
CREATE TRIGGER trg_proxies_inherit_hidden
  BEFORE INSERT OR UPDATE OF category_id ON proxies
  FOR EACH ROW EXECUTE FUNCTION fn_proxy_inherit_hidden_on_reassign();

-- ------------------------------------------------------------
-- 7. RPC: resync_proxies_hidden_from_categories
--    Recovery path for the rare race noted by architect (#8) where
--    a concurrent toggle + bulk reassign leaves rows out of sync.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION resync_proxies_hidden_from_categories()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count INTEGER;
BEGIN
  IF NOT (SELECT is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  WITH delta AS (
    UPDATE proxies p
    SET hidden = c.is_hidden, updated_at = now()
    FROM proxy_categories c
    WHERE p.category_id = c.id
      AND p.is_deleted = false
      AND p.hidden IS DISTINCT FROM c.is_hidden
    RETURNING p.id
  )
  SELECT COUNT(*) INTO v_count FROM delta;

  RETURN jsonb_build_object('ok', true, 'updated', v_count);
END;
$$;

REVOKE ALL ON FUNCTION resync_proxies_hidden_from_categories() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resync_proxies_hidden_from_categories()
  TO authenticated, service_role;

COMMENT ON FUNCTION resync_proxies_hidden_from_categories IS
  'Wave 22G recovery RPC. Re-synchronises proxies.hidden against the parent category.is_hidden. Safe to run any time; idempotent.';
