-- ============================================================
-- 068_wave28_categories_proxy_required.sql
-- Wave 28-A — every proxy must belong to a category.
--
-- Business rule from user (verbatim):
--   "mọi proxy đều cần có danh mục"
--   "mọi proxy thêm hoặc chọn qua danh mục đều mặc định áp dụng theo danh mục"
--
-- Implementation strategy
-- -----------------------
-- 1. Add `is_system BOOLEAN NOT NULL DEFAULT false` to proxy_categories.
--    Lets us flag the sentinel "Mặc định" row so UI / API can:
--      - render it visually distinct
--      - block rename / hide / delete
--      - exclude it from "create proxy → pick category" choosers if desired
--    Pre-Wave-28 rows default false — only the sentinel inserted below
--    has is_system=true.
--
-- 2. Insert the sentinel row with a hardcoded UUID so SQL + JS share
--    the same value. The constant lives in
--    `src/lib/categories/constants.ts` as DEFAULT_CATEGORY_ID; a CI
--    test (E.6 in the design plan) greps this file to assert match.
--
-- 3. Backfill: every proxy whose category_id IS NULL (active or
--    soft-deleted) gets re-homed to the sentinel.
--
-- 4. Switch FK to ON DELETE SET DEFAULT and add a column DEFAULT
--    pointing at the sentinel — so deleting a non-sentinel category
--    re-homes its proxies automatically (no orphans, no API 500).
--
-- 5. Add NOT NULL on category_id. Defence-in-depth: a future API bug
--    that forgets to set category_id triggers the column DEFAULT
--    (sentinel) instead of failing the constraint — so user-facing
--    surface stays alive while the bug gets logged.
--
-- 6. Add BEFORE-DELETE / BEFORE-UPDATE triggers protecting the
--    sentinel from accidental rename or removal. Bypassable only by
--    direct SQL with elevated role.
--
-- Idempotent: every step uses IF NOT EXISTS / ON CONFLICT or is
-- safe to re-run. Re-applying produces no diff.
-- ============================================================


-- ─── 1. is_system flag column ────────────────────────────────
ALTER TABLE proxy_categories
  ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN proxy_categories.is_system IS
  'Wave 28 — true for system-managed rows (currently just the
   "Mặc định" sentinel). System rows cannot be renamed, hidden, or
   deleted via the admin UI; the API + DB triggers enforce this.';


-- ─── 2. Seed the sentinel "Mặc định" category ────────────────
-- UUID intentionally chosen as a low-collision constant; mirrors the
-- export `DEFAULT_CATEGORY_ID` in src/lib/categories/constants.ts.
-- Rebuilds idempotently — re-running this migration on a DB that
-- already has the row is a no-op.
INSERT INTO proxy_categories (
  id,
  name,
  description,
  color,
  icon,
  sort_order,
  is_hidden,
  is_system,
  default_purchase_price_usd,
  default_sale_price_usd,
  min_stock_alert,
  created_by
) VALUES (
  '00000000-0000-4000-8000-0000000028ca',
  'Mặc định',
  'Danh mục dự phòng cho proxy chưa phân loại. Không thể xoá hoặc đổi tên — proxy không có danh mục riêng sẽ tự động về đây.',
  'gray',
  'folder',
  999999,        -- sort_order at the end
  false,
  true,          -- is_system flag
  NULL,          -- no default purchase price (admin must set per category)
  NULL,          -- no default sale price
  0,
  NULL
)
ON CONFLICT (id) DO UPDATE
  -- Re-running mig 068 keeps the sentinel marked as system even if
  -- a brave admin somehow flipped is_system off. Other fields not
  -- touched so admin renames (if they bypassed the protect trigger)
  -- aren't reverted on re-deploy.
  SET is_system = true;


-- ─── 3. Backfill proxies with NULL category_id ───────────────
-- Includes soft-deleted rows so undelete doesn't violate the upcoming
-- NOT NULL constraint.
UPDATE proxies
   SET category_id = '00000000-0000-4000-8000-0000000028ca'
 WHERE category_id IS NULL;


-- ─── 4. FK switch + column DEFAULT ───────────────────────────
ALTER TABLE proxies
  ALTER COLUMN category_id SET DEFAULT '00000000-0000-4000-8000-0000000028ca';

-- Drop the old FK if it exists (mig 028 / 042 named it
-- `proxies_category_id_fkey`) and re-add with ON DELETE SET DEFAULT.
ALTER TABLE proxies
  DROP CONSTRAINT IF EXISTS proxies_category_id_fkey;

ALTER TABLE proxies
  ADD CONSTRAINT proxies_category_id_fkey
    FOREIGN KEY (category_id)
    REFERENCES proxy_categories(id)
    ON DELETE SET DEFAULT;

COMMENT ON CONSTRAINT proxies_category_id_fkey ON proxies IS
  'Wave 28 — ON DELETE SET DEFAULT re-homes proxies to the "Mặc định"
   sentinel when their category is removed. Combined with the
   sentinel-protect trigger, no orphan rows are ever possible.';


-- ─── 5. NOT NULL constraint on category_id ───────────────────
ALTER TABLE proxies
  ALTER COLUMN category_id SET NOT NULL;


-- ─── 6. Sentinel protection triggers ─────────────────────────
-- Block DELETE on the sentinel.
CREATE OR REPLACE FUNCTION fn_protect_default_category_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.is_system = true OR OLD.id = '00000000-0000-4000-8000-0000000028ca' THEN
    RAISE EXCEPTION
      'Cannot delete system category "%". Wave 28 — sentinel is required for the proxies.category_id FK ON DELETE SET DEFAULT path.',
      OLD.name
      USING ERRCODE = '23503';
  END IF;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_protect_default_category_delete ON proxy_categories;
CREATE TRIGGER trg_protect_default_category_delete
  BEFORE DELETE ON proxy_categories
  FOR EACH ROW EXECUTE FUNCTION fn_protect_default_category_delete();


-- Block UPDATE that:
--   - flips is_system from true → false on the sentinel row, OR
--   - sets is_hidden=true on the sentinel (would silently mass-hide
--     orphan proxies — exactly the bug we're protecting against)
CREATE OR REPLACE FUNCTION fn_protect_default_category_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.id = '00000000-0000-4000-8000-0000000028ca' THEN
    -- Allow admin to edit defaults (price, country, etc.) on the
    -- sentinel — those are fine. Block name change, hide toggle,
    -- and is_system flip.
    IF NEW.name IS DISTINCT FROM OLD.name THEN
      RAISE EXCEPTION 'Cannot rename system category "Mặc định".'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.is_hidden = true THEN
      RAISE EXCEPTION 'Cannot hide the system "Mặc định" category — orphan proxies would silently disappear from /proxies.'
        USING ERRCODE = '23514';
    END IF;
    -- Always force is_system back to true so the row stays protected
    -- across migrations / direct SQL edits.
    NEW.is_system := true;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_protect_default_category_update ON proxy_categories;
CREATE TRIGGER trg_protect_default_category_update
  BEFORE UPDATE ON proxy_categories
  FOR EACH ROW EXECUTE FUNCTION fn_protect_default_category_update();


-- ─── 7. Document the snapshot trigger gap (mig 059 audit) ────
-- The Wave 27 snapshot trigger fn_proxy_snapshot_category_defaults
-- already covers the 7 fields admin can default per category:
--   country, type, isp, network_type, vendor_label, cost_usd,
--   sale_price_usd.
-- No trigger change in mig 068. PR #45 (Wave 28-D) adds the
-- re-snapshot-on-reassign trigger so admin moving a proxy between
-- categories sees its prices update (with override-detection).


-- ─── 8. Recreate /api index helper for /proxies?include_hidden=true ─
-- (No-op if already exists; included so reading mig 068 alone tells
-- the full story.) The existing index from mig 060 covers the hot
-- path; this comment is documentation only.
COMMENT ON CONSTRAINT proxies_category_id_fkey ON proxies IS
  'Wave 28 — every proxy must have a category. ON DELETE SET DEFAULT
   re-homes orphans to the "Mặc định" sentinel. Combined with the
   sentinel-protect triggers (fn_protect_default_category_*), no
   orphan rows are ever possible. category_id has NOT NULL constraint
   + column DEFAULT pointing at sentinel for defence-in-depth.';
