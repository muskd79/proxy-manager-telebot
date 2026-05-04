-- ============================================================
-- 059_wave27_categories_dashboard.sql
-- Wave 27 — categories dashboard backend.
--
-- Ships 4 things:
--   1. Index `idx_proxies_dashboard_cover` — covering index for the
--      RPC's FILTER aggregations. Brainstormer's cost concern was
--      real; this turns the join into an index-only scan.
--   2. Function `get_category_dashboard()` — single-shot SQL returning
--      per-category breakdown (status counts + hidden count + money
--      triplet). Replaces N+1 fetches from the old table view.
--   3. Trigger `fn_proxy_snapshot_category_defaults` — moves the
--      "proxy follows category" rule from API code to the DB so it
--      fires for ALL insert paths (admin web, CSV import, Telegram
--      bot, future scripts). Snapshot semantics: fill if NULL, never
--      overwrite. Handles empty-string-vs-null normalisation
--      (brainstormer caught this — bot may pass "" instead of NULL).
--   4. Function `apply_category_defaults_retroactively(category_id,
--      mode)` — admin-driven backfill. mode='only_null' fills blanks
--      only; mode='force' overwrites every proxy in the category.
--      Both paths write a row to activity_logs for audit.
--
-- Live/Die NOT INCLUDED — that semantic exists in the user's sibling
-- VIA project (Facebook accounts have a binary alive/dead probe);
-- proxies use a richer status enum (available/assigned/
-- reported_broken/expired/banned/maintenance) which already encodes
-- lifecycle. Probe freshness (speed_ms / last_checked_at) remains
-- per-proxy operational metadata but does NOT drive the category
-- card breakdown — the status enum is the breakdown axis.
--
-- Idempotent: every CREATE/ALTER guards with IF NOT EXISTS or DROP-then-CREATE.
-- ============================================================

-- ─── 1. Covering index for the dashboard query ───────────────
-- Partial: only non-deleted rows (the dashboard ignores trash).
-- Includes the sale_price_usd / cost_usd / hidden columns so the
-- RPC's FILTER + SUM work as index-only scan.
CREATE INDEX IF NOT EXISTS idx_proxies_dashboard_cover
  ON proxies (category_id, status)
  INCLUDE (sale_price_usd, cost_usd, hidden)
  WHERE is_deleted = false;

COMMENT ON INDEX idx_proxies_dashboard_cover IS
  'Wave 27 — covering index for get_category_dashboard() RPC. Turns FILTER aggregations into index-only scan.';


-- ─── 2. The dashboard RPC ────────────────────────────────────
-- Note: revenue_usd_cumulative pulls from proxy_events (mig 057) where
-- event_type='assigned' — those rows are immutable so revenue is
-- "money earned forever" not "current inventory value at list price".
-- stock_value_usd is the point-in-time list-price total of currently-
-- assigned inventory (a different metric — admins use both).

CREATE OR REPLACE FUNCTION get_category_dashboard()
RETURNS TABLE (
  id UUID,
  name TEXT,
  description TEXT,
  color TEXT,
  icon TEXT,
  sort_order INT,
  is_hidden BOOLEAN,
  default_sale_price_usd NUMERIC,
  default_purchase_price_usd NUMERIC,
  min_stock_alert INT,
  proxy_count INT,
  -- per-status counts (non-deleted only)
  cnt_available INT,
  cnt_assigned INT,
  cnt_reported_broken INT,
  cnt_expired INT,
  cnt_banned INT,
  cnt_maintenance INT,
  -- aggregate footer
  total_hidden INT,
  -- money
  stock_value_usd NUMERIC,        -- point-in-time list price of currently assigned
  revenue_usd_cumulative NUMERIC, -- all-time sum from proxy_events.assigned
  cost_usd_total NUMERIC          -- sum of cost across all non-deleted proxies in category
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH cumulative_revenue AS (
    -- All-time revenue per category, queried from immutable proxy_events.
    -- We use proxy_events's category snapshot at event-time if we add
    -- one later; for now we attribute to the proxy's CURRENT category
    -- (acceptable since proxies rarely change category — Wave 27 will
    -- track category-change events explicitly).
    SELECT
      p.category_id,
      COALESCE(SUM(p.sale_price_usd), 0) AS revenue_at_event
    FROM proxy_events e
    JOIN proxies p ON p.id = e.proxy_id
    WHERE e.event_type = 'assigned'
    GROUP BY p.category_id
  )
  SELECT
    c.id,
    c.name,
    c.description,
    c.color,
    c.icon,
    c.sort_order,
    c.is_hidden,
    c.default_sale_price_usd,
    c.default_purchase_price_usd,
    c.min_stock_alert,
    c.proxy_count,
    -- status counts
    COUNT(*) FILTER (WHERE p.status = 'available')::INT,
    COUNT(*) FILTER (WHERE p.status = 'assigned')::INT,
    COUNT(*) FILTER (WHERE p.status = 'reported_broken')::INT,
    COUNT(*) FILTER (WHERE p.status = 'expired')::INT,
    COUNT(*) FILTER (WHERE p.status = 'banned')::INT,
    COUNT(*) FILTER (WHERE p.status = 'maintenance')::INT,
    -- footer: hidden count
    COUNT(*) FILTER (WHERE p.hidden = true)::INT,
    -- money
    COALESCE(SUM(p.sale_price_usd) FILTER (WHERE p.status = 'assigned'), 0)::NUMERIC,
    COALESCE(MAX(cr.revenue_at_event), 0)::NUMERIC, -- MAX since cumulative_revenue is 1 row per category
    COALESCE(SUM(p.cost_usd), 0)::NUMERIC
  FROM proxy_categories c
  LEFT JOIN proxies p
    ON p.category_id = c.id
   AND p.is_deleted = false
  LEFT JOIN cumulative_revenue cr
    ON cr.category_id = c.id
  GROUP BY c.id
  ORDER BY c.sort_order ASC NULLS LAST, c.name ASC;
$$;

REVOKE ALL ON FUNCTION get_category_dashboard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_category_dashboard() TO authenticated, service_role;

COMMENT ON FUNCTION get_category_dashboard() IS
  'Wave 27 — single-shot category dashboard data. Returns per-category status counts + hidden count + money summary. Used by /api/categories/dashboard.';


-- ─── 3. BEFORE INSERT trigger: snapshot category defaults ────
-- Brainstormer's "double snapshot" concern: API layer does NOT prefill
-- anymore; the trigger is the only source. This guarantees the rule
-- fires for ALL insert paths (admin web, CSV import, bot, scripts).
--
-- Empty-string normalisation: bot/CSV may send '' for unfilled. We
-- treat empty string as NULL via NULLIF before COALESCE.

CREATE OR REPLACE FUNCTION fn_proxy_snapshot_category_defaults()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_default_country     TEXT;
  v_default_proxy_type  proxy_type;
  v_default_isp         TEXT;
  v_default_network     TEXT;
  v_default_vendor      TEXT;
  v_default_cost        NUMERIC;
  v_default_sale        NUMERIC;
BEGIN
  IF NEW.category_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT
    default_country,
    default_proxy_type,
    default_isp,
    default_network_type,
    default_vendor_source,
    default_purchase_price_usd,
    default_sale_price_usd
  INTO
    v_default_country,
    v_default_proxy_type,
    v_default_isp,
    v_default_network,
    v_default_vendor,
    v_default_cost,
    v_default_sale
  FROM proxy_categories
  WHERE id = NEW.category_id;

  -- Snapshot fields. NULLIF('') is the empty-string-as-null guard.
  NEW.country       := COALESCE(NULLIF(NEW.country, ''),       v_default_country);
  NEW.type          := COALESCE(NEW.type,                      v_default_proxy_type);
  NEW.isp           := COALESCE(NULLIF(NEW.isp, ''),           v_default_isp);
  NEW.network_type  := COALESCE(NULLIF(NEW.network_type, ''),  v_default_network);
  NEW.vendor_label  := COALESCE(NULLIF(NEW.vendor_label, ''),  v_default_vendor);
  NEW.cost_usd      := COALESCE(NEW.cost_usd,                  v_default_cost);
  NEW.sale_price_usd := COALESCE(NEW.sale_price_usd,           v_default_sale);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_proxies_snapshot_category_defaults ON proxies;
CREATE TRIGGER trg_proxies_snapshot_category_defaults
  BEFORE INSERT ON proxies
  FOR EACH ROW EXECUTE FUNCTION fn_proxy_snapshot_category_defaults();

COMMENT ON FUNCTION fn_proxy_snapshot_category_defaults() IS
  'Wave 27 — fills NEW row with category defaults if its fields are NULL/empty. Source of truth for "proxy follows category" rule. Fires on INSERT only (snapshot semantics — edits to category defaults do NOT cascade retroactively).';


-- ─── 4. Retroactive backfill RPC ─────────────────────────────
-- Two modes:
--   only_null  — fill blanks only, never overwrite admin's manual edits
--   force      — overwrite every proxy in the category (destructive)
-- Always writes 1 activity_logs row for audit. Returns affected count.

DO $$
BEGIN
  CREATE TYPE category_apply_mode AS ENUM ('only_null', 'force');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION apply_category_defaults_retroactively(
  p_category_id UUID,
  p_mode category_apply_mode DEFAULT 'only_null'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_default_country     TEXT;
  v_default_proxy_type  proxy_type;
  v_default_isp         TEXT;
  v_default_network     TEXT;
  v_default_vendor      TEXT;
  v_default_cost        NUMERIC;
  v_default_sale        NUMERIC;
  v_affected            INT;
BEGIN
  -- Auth guard. is_admin() returns true for super_admin OR admin roles.
  IF NOT is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  SELECT
    default_country,
    default_proxy_type,
    default_isp,
    default_network_type,
    default_vendor_source,
    default_purchase_price_usd,
    default_sale_price_usd
  INTO
    v_default_country,
    v_default_proxy_type,
    v_default_isp,
    v_default_network,
    v_default_vendor,
    v_default_cost,
    v_default_sale
  FROM proxy_categories
  WHERE id = p_category_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'category_not_found');
  END IF;

  IF p_mode = 'only_null' THEN
    -- Fill blanks only.
    UPDATE proxies p
    SET
      country        = COALESCE(NULLIF(p.country, ''),       v_default_country),
      isp            = COALESCE(NULLIF(p.isp, ''),           v_default_isp),
      network_type   = COALESCE(NULLIF(p.network_type, ''),  v_default_network),
      vendor_label   = COALESCE(NULLIF(p.vendor_label, ''),  v_default_vendor),
      cost_usd       = COALESCE(p.cost_usd,                  v_default_cost),
      sale_price_usd = COALESCE(p.sale_price_usd,            v_default_sale),
      updated_at     = NOW()
    WHERE p.category_id = p_category_id
      AND p.is_deleted = false
      AND (
        (p.country IS NULL OR p.country = '')         -- only touch if at least one field is missing
        OR (p.isp IS NULL OR p.isp = '')
        OR (p.network_type IS NULL OR p.network_type = '')
        OR (p.vendor_label IS NULL OR p.vendor_label = '')
        OR p.cost_usd IS NULL
        OR p.sale_price_usd IS NULL
      );
    GET DIAGNOSTICS v_affected = ROW_COUNT;
  ELSE
    -- force: overwrite ALL proxies in the category. Defaults that
    -- are themselves NULL leave the proxy field unchanged.
    UPDATE proxies p
    SET
      country        = COALESCE(v_default_country, p.country),
      isp            = COALESCE(v_default_isp, p.isp),
      network_type   = COALESCE(v_default_network, p.network_type),
      vendor_label   = COALESCE(v_default_vendor, p.vendor_label),
      cost_usd       = COALESCE(v_default_cost, p.cost_usd),
      sale_price_usd = COALESCE(v_default_sale, p.sale_price_usd),
      updated_at     = NOW()
    WHERE p.category_id = p_category_id
      AND p.is_deleted = false;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
  END IF;

  -- Audit. activity_logs table exists from earlier migs.
  INSERT INTO activity_logs (
    actor_type, actor_id,
    action, resource_type, resource_id,
    details
  ) VALUES (
    'admin', auth.uid(),
    'category.apply_defaults_retroactively', 'category', p_category_id,
    jsonb_build_object(
      'mode', p_mode::TEXT,
      'affected', v_affected,
      'defaults', jsonb_build_object(
        'country',          v_default_country,
        'proxy_type',       v_default_proxy_type,
        'isp',              v_default_isp,
        'network_type',     v_default_network,
        'vendor_source',    v_default_vendor,
        'cost_usd',         v_default_cost,
        'sale_price_usd',   v_default_sale
      )
    )
  );

  RETURN jsonb_build_object('ok', true, 'affected', v_affected, 'mode', p_mode::TEXT);
END;
$$;

REVOKE ALL ON FUNCTION apply_category_defaults_retroactively(UUID, category_apply_mode) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION apply_category_defaults_retroactively(UUID, category_apply_mode)
  TO authenticated, service_role;

COMMENT ON FUNCTION apply_category_defaults_retroactively(UUID, category_apply_mode) IS
  'Wave 27 — admin-driven retroactive fill of category defaults onto existing proxies. Mode "only_null" fills blanks; "force" overwrites. Always audits to activity_logs.';
