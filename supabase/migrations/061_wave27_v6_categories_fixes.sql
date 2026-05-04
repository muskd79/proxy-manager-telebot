-- ============================================================
-- 061_wave27_v6_categories_fixes.sql
-- Wave 27 bug hunt v6 — 2 SQL fixes for the categories module
-- shipped in mig 059.
--
-- #1 HIGH: apply_category_defaults_retroactively skipped `proxy.type`.
--    The BEFORE INSERT trigger correctly snapshots type, but the
--    retroactive RPC's UPDATE only touched country/isp/network_type/
--    vendor_label/cost_usd/sale_price_usd. Admin clicking "Áp dụng
--    mặc định" expected ALL fields to backfill, including type. Now:
--    type added to both only_null and force branches.
--
-- #6 MEDIUM: get_category_dashboard was declared STABLE while reading
--    auth.email() via is_admin(). STABLE lets Postgres skip
--    re-execution within a query — fine for a pure function, but the
--    is_admin() result is session-scoped, so caching across sessions
--    in the same backend connection is theoretically possible (rare
--    in practice on Supabase pgbouncer transaction-mode pools, but
--    safer to be VOLATILE for session-aware functions). Now: VOLATILE.
--
-- Idempotent: CREATE OR REPLACE rewrites the function body. No data
-- migration needed.
-- ============================================================

-- ─── #6: get_category_dashboard STABLE → VOLATILE ───────────
-- (Re-declares the entire function body since you can't ALTER
-- volatility separately on an OR REPLACE — must be in CREATE.)
--
-- Body identical to mig 059 amend; only the volatility marker changed.

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
  cnt_available INT,
  cnt_assigned INT,
  cnt_reported_broken INT,
  cnt_expired INT,
  cnt_banned INT,
  cnt_maintenance INT,
  total_hidden INT,
  stock_value_usd NUMERIC,
  revenue_usd_cumulative NUMERIC,
  cost_usd_total NUMERIC
)
LANGUAGE plpgsql
VOLATILE  -- bug v6 #6 — was STABLE; reads auth.email() via is_admin() (session-scoped)
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_show_money BOOLEAN;
BEGIN
  v_show_money := is_admin();

  RETURN QUERY
  WITH cumulative_revenue AS (
    SELECT
      COALESCE(
        (e.details->>'category_id_at_event')::UUID,
        p.category_id
      ) AS category_id,
      COALESCE(SUM(
        COALESCE(
          (e.details->>'sale_price_usd_at_event')::NUMERIC,
          p.sale_price_usd
        )
      ), 0) AS revenue_at_event
    FROM proxy_events e
    JOIN proxies p ON p.id = e.proxy_id
    WHERE e.event_type = 'assigned'
    GROUP BY 1
  )
  SELECT
    c.id, c.name, c.description, c.color, c.icon,
    c.sort_order, c.is_hidden,
    c.default_sale_price_usd, c.default_purchase_price_usd,
    c.min_stock_alert,
    COUNT(p.id)::INT AS proxy_count,
    COUNT(*) FILTER (WHERE p.status = 'available')::INT,
    COUNT(*) FILTER (WHERE p.status = 'assigned')::INT,
    COUNT(*) FILTER (WHERE p.status = 'reported_broken')::INT,
    COUNT(*) FILTER (WHERE p.status = 'expired')::INT,
    COUNT(*) FILTER (WHERE p.status = 'banned')::INT,
    COUNT(*) FILTER (WHERE p.status = 'maintenance')::INT,
    COUNT(*) FILTER (WHERE p.hidden = true)::INT,
    CASE WHEN v_show_money
      THEN COALESCE(SUM(p.sale_price_usd) FILTER (WHERE p.status = 'assigned'), 0)::NUMERIC
      ELSE 0::NUMERIC
    END,
    CASE WHEN v_show_money
      THEN COALESCE(MAX(cr.revenue_at_event), 0)::NUMERIC
      ELSE 0::NUMERIC
    END,
    CASE WHEN v_show_money
      THEN COALESCE(SUM(p.cost_usd), 0)::NUMERIC
      ELSE 0::NUMERIC
    END
  FROM proxy_categories c
  LEFT JOIN proxies p
    ON p.category_id = c.id
   AND p.is_deleted = false
  LEFT JOIN cumulative_revenue cr
    ON cr.category_id = c.id
  GROUP BY c.id
  ORDER BY c.sort_order ASC NULLS LAST, c.name ASC;
END;
$$;

REVOKE ALL ON FUNCTION get_category_dashboard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_category_dashboard() TO authenticated, service_role;


-- ─── #1: apply_category_defaults_retroactively now includes proxy.type ───
-- The trigger fn_proxy_snapshot_category_defaults already sets
-- NEW.type from default_proxy_type on INSERT. The retroactive RPC
-- shipped without the matching UPDATE clause, leaving existing
-- proxies with type=NULL untouched even when the category had a
-- default_proxy_type.
--
-- Both modes now treat type identically to other fields:
--   only_null: COALESCE(p.type, v_default_proxy_type) — fill blanks
--   force:     COALESCE(v_default_proxy_type, p.type) — overwrite all
--
-- The only_null WHERE clause also gains an OR p.type IS NULL term
-- so we actually trigger the UPDATE when only `type` is missing.

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
    UPDATE proxies p
    SET
      type           = COALESCE(p.type,                      v_default_proxy_type),
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
        p.type IS NULL                                     -- bug v6 #1: type wasn't on the predicate
        OR (p.country IS NULL OR p.country = '')
        OR (p.isp IS NULL OR p.isp = '')
        OR (p.network_type IS NULL OR p.network_type = '')
        OR (p.vendor_label IS NULL OR p.vendor_label = '')
        OR p.cost_usd IS NULL
        OR p.sale_price_usd IS NULL
      );
    GET DIAGNOSTICS v_affected = ROW_COUNT;
  ELSE
    UPDATE proxies p
    SET
      type           = COALESCE(v_default_proxy_type, p.type),
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
        'type',             v_default_proxy_type,
        'country',          v_default_country,
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
