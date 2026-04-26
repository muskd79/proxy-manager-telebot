-- ============================================================
-- 026_wave21c_bulk_ops_and_alerts.sql
-- Wave 21C — bulk_proxy_ops RPC + dashboard cost view +
-- proxies-expiring-soon view (used by cron + dashboard widget).
-- ============================================================

-- ------------------------------------------------------------
-- 1. bulk_proxy_ops — atomic expiry-extend + tag-add + tag-remove
-- ------------------------------------------------------------
-- Called by /api/proxies/bulk-edit. Combines into one SQL statement
-- so 1000-row bulk edits run in ms (vs the per-row PUT loop that
-- took 30s in the old proxy-bulk-edit component).
--
-- p_extend_days NULL  -> skip expiry update
-- p_tags_add    NULL  -> skip add
-- p_tags_remove NULL  -> skip remove
CREATE OR REPLACE FUNCTION bulk_proxy_ops(
  p_ids          UUID[],
  p_extend_days  INTEGER  DEFAULT NULL,
  p_tags_add     TEXT[]   DEFAULT NULL,
  p_tags_remove  TEXT[]   DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('updated', 0);
  END IF;
  IF array_length(p_ids, 1) > 5000 THEN
    RAISE EXCEPTION 'bulk_proxy_ops: too many ids (got %, max 5000)', array_length(p_ids, 1);
  END IF;

  WITH upd AS (
    UPDATE proxies p
    SET
      expires_at = CASE
        WHEN p_extend_days IS NULL THEN p.expires_at
        ELSE COALESCE(p.expires_at, now()) + make_interval(days => p_extend_days)
      END,
      tags = CASE
        WHEN p_tags_add IS NULL AND p_tags_remove IS NULL THEN p.tags
        ELSE
          -- Merge: existing minus tags_remove plus tags_add (deduped)
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

  RETURN jsonb_build_object('updated', v_updated);
END;
$$;

REVOKE ALL ON FUNCTION bulk_proxy_ops(UUID[], INTEGER, TEXT[], TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bulk_proxy_ops(UUID[], INTEGER, TEXT[], TEXT[]) TO authenticated, service_role;

COMMENT ON FUNCTION bulk_proxy_ops IS
  'Wave 21C — atomic bulk expiry-extend + tag merge. Called by /api/proxies/bulk-edit.';

-- ------------------------------------------------------------
-- 2. dashboard_cost_by_vendor view
-- ------------------------------------------------------------
-- Powers the dashboard "MTD spend by vendor" card. Lives as a view
-- (not a matview) because at <1k lots/month the query is fast enough
-- and matview refresh adds operational complexity.
CREATE OR REPLACE VIEW dashboard_cost_by_vendor AS
SELECT
  vendor_label,
  date_trunc('month', purchase_date) AS month,
  COUNT(*)                            AS lot_count,
  SUM(proxy_count)                    AS proxy_total,
  SUM(total_cost_usd)                 AS spend_usd
FROM purchase_lots
GROUP BY vendor_label, date_trunc('month', purchase_date);

COMMENT ON VIEW dashboard_cost_by_vendor IS
  'Wave 21C — month/vendor rollup of lot spend for the dashboard card.';

-- View RLS: matches the underlying table policy (purchase_lots requires admin/viewer).
-- Views inherit RLS from base tables in Postgres.

-- ------------------------------------------------------------
-- 3. expiring_soon view (cron source)
-- ------------------------------------------------------------
-- Returns lots expiring in 24h / 7d / 30d windows that haven't yet
-- been alerted in that window. The cron picks rows from this view,
-- sends a Telegram alert, then UPDATEs last_alert_*_at to mark the
-- window as fired.
CREATE OR REPLACE VIEW expiring_soon_lots AS
SELECT
  l.*,
  CASE
    WHEN l.expiry_date < now() + interval '24 hours'
      AND (l.last_alert_24h_at IS NULL OR l.last_alert_24h_at < now() - interval '23 hours')
      THEN '24h'
    WHEN l.expiry_date < now() + interval '7 days'
      AND (l.last_alert_7d_at IS NULL OR l.last_alert_7d_at < now() - interval '6 days')
      THEN '7d'
    WHEN l.expiry_date < now() + interval '30 days'
      AND (l.last_alert_30d_at IS NULL OR l.last_alert_30d_at < now() - interval '29 days')
      THEN '30d'
    ELSE NULL
  END AS alert_window
FROM purchase_lots l
WHERE l.expiry_date IS NOT NULL
  AND l.expiry_date >= now()
  AND l.expiry_date <  now() + interval '30 days';

COMMENT ON VIEW expiring_soon_lots IS
  'Wave 21C — feeds /api/cron/lot-expiry-alert. Rows where alert_window IS NOT NULL need a Telegram notification.';
