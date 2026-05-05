-- ============================================================
-- 069_wave28_resnapshot_on_reassign.sql
-- Wave 28-D — re-apply category defaults when a proxy is moved
-- between categories (with override-detection so admin's custom
-- per-proxy values aren't clobbered).
--
-- Why this trigger
-- ----------------
-- Mig 059 added `fn_proxy_snapshot_category_defaults` which fires
-- BEFORE INSERT only. Admin reassigning a proxy from category A to
-- category B today → category_id changes but the cached snapshot
-- columns (sale_price_usd, country, network_type, …) keep the OLD
-- values from category A. This silently breaks the user's
-- "mọi proxy thêm hoặc chọn qua danh mục đều mặc định áp dụng theo
-- danh mục" rule for the reassign path.
--
-- Re-snapshot strategy
-- --------------------
-- Fire BEFORE UPDATE OF category_id. For each candidate field:
--   - If the proxy's current value MATCHES the source category's
--     default → admin hasn't customised; safe to re-snapshot from
--     the new category
--   - If the proxy's current value DIFFERS from the source category's
--     default → admin customised; preserve the override
--
-- Edge cases:
--   - Source category default was NULL → "no default", treat any
--     non-null current value as override
--   - Both values are NULL → no-op
--   - Reassign to the sentinel "Mặc định" (which has all NULL
--     defaults) → effectively clears the snapshot for non-overridden
--     fields; admin can then re-pick a real category and have
--     everything inherit fresh
--
-- This is the cleanest data model the brainstormer agent flagged
-- in the design review: snapshot-on-insert + snapshot-on-reassign,
-- with override-detection. Architect's plan covered insert; this
-- trigger closes the reassign gap.
--
-- Idempotent: CREATE OR REPLACE FUNCTION + DROP/CREATE TRIGGER.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_proxy_resnapshot_on_reassign()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_country     TEXT;
  v_old_proxy_type  proxy_type;
  v_old_isp         TEXT;
  v_old_network     TEXT;
  v_old_vendor      TEXT;
  v_old_cost        NUMERIC;
  v_old_sale        NUMERIC;
  v_new_country     TEXT;
  v_new_proxy_type  proxy_type;
  v_new_isp         TEXT;
  v_new_network     TEXT;
  v_new_vendor      TEXT;
  v_new_cost        NUMERIC;
  v_new_sale        NUMERIC;
BEGIN
  -- Only fires when category_id ACTUALLY changes (BEFORE UPDATE
  -- with WHEN clause below would be tighter but DROP/CREATE-time
  -- safer to do the check inside the function — defence-in-depth).
  IF NEW.category_id IS NOT DISTINCT FROM OLD.category_id THEN
    RETURN NEW;
  END IF;

  -- Snapshot the source category's defaults (what the proxy was
  -- inheriting). NULL row = no source defaults; everything is
  -- treated as override.
  IF OLD.category_id IS NOT NULL THEN
    SELECT
      default_country, default_proxy_type, default_isp,
      default_network_type, default_vendor_source,
      default_purchase_price_usd, default_sale_price_usd
    INTO
      v_old_country, v_old_proxy_type, v_old_isp,
      v_old_network, v_old_vendor, v_old_cost, v_old_sale
    FROM proxy_categories
    WHERE id = OLD.category_id;
  END IF;

  -- Snapshot the destination category's defaults.
  IF NEW.category_id IS NOT NULL THEN
    SELECT
      default_country, default_proxy_type, default_isp,
      default_network_type, default_vendor_source,
      default_purchase_price_usd, default_sale_price_usd
    INTO
      v_new_country, v_new_proxy_type, v_new_isp,
      v_new_network, v_new_vendor, v_new_cost, v_new_sale
    FROM proxy_categories
    WHERE id = NEW.category_id;
  END IF;

  -- For each field: if the proxy's value matches the OLD category's
  -- default (= admin hadn't customised), re-snapshot from the NEW
  -- category. Otherwise leave the override alone.
  --
  -- Helper logic per field:
  --   IF NEW.field IS NOT DISTINCT FROM v_old_<field>
  --   THEN NEW.field := v_new_<field>;

  IF NEW.country IS NOT DISTINCT FROM v_old_country THEN
    NEW.country := v_new_country;
  END IF;

  IF NEW.type IS NOT DISTINCT FROM v_old_proxy_type THEN
    -- proxy.type is NOT NULL — only re-snapshot if v_new_proxy_type
    -- is non-null AND distinct (don't overwrite a known type with
    -- NULL).
    IF v_new_proxy_type IS NOT NULL THEN
      NEW.type := v_new_proxy_type;
    END IF;
  END IF;

  IF NEW.isp IS NOT DISTINCT FROM v_old_isp THEN
    NEW.isp := v_new_isp;
  END IF;

  IF NEW.network_type IS NOT DISTINCT FROM v_old_network THEN
    NEW.network_type := v_new_network;
  END IF;

  IF NEW.vendor_label IS NOT DISTINCT FROM v_old_vendor THEN
    NEW.vendor_label := v_new_vendor;
  END IF;

  IF NEW.cost_usd IS NOT DISTINCT FROM v_old_cost THEN
    NEW.cost_usd := v_new_cost;
  END IF;

  IF NEW.sale_price_usd IS NOT DISTINCT FROM v_old_sale THEN
    NEW.sale_price_usd := v_new_sale;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_proxies_resnapshot_on_reassign ON proxies;

-- WHEN clause guarantees the function only fires when category_id
-- actually changes — saves a function call on every UPDATE.
CREATE TRIGGER trg_proxies_resnapshot_on_reassign
  BEFORE UPDATE OF category_id ON proxies
  FOR EACH ROW
  WHEN (NEW.category_id IS DISTINCT FROM OLD.category_id)
  EXECUTE FUNCTION fn_proxy_resnapshot_on_reassign();

COMMENT ON FUNCTION fn_proxy_resnapshot_on_reassign() IS
  'Wave 28-D — re-apply category defaults on category_id UPDATE.
   Override-detection: only re-snapshots fields that match the OLD
   category default (i.e., admin had not customised). Custom values
   are preserved. Fires together with mig 059 INSERT trigger to
   close the "proxy follows category" rule across both create AND
   reassign paths.';
