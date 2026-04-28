-- ============================================================
-- 040_wave22s_drop_purchase_lots.sql
--
-- Wave 22S (Phase 8) — DROP purchase_lots stack hoàn toàn.
--
-- Wave 22K denormed (purchase_date, vendor_label as nguồn,
-- cost_usd as giá mua) onto proxies, removed /lots UI, but kept
-- the table for backward-compat. User confirmed Phase 8 path A:
-- drop everything.
--
-- Order matters — drop dependents first:
--   1. cron-driven views first (expiring_soon_lots, dashboard_cost_by_vendor)
--   2. import_lot RPC (depends on purchase_lots + import_lot_keys)
--   3. import_lot_keys (idempotency table — only used by import_lot)
--   4. proxies.purchase_lot_id FK + column
--   5. purchase_lots table itself
--   6. trigger fn_proxy_lot_count (used proxy_count maintenance on the
--      now-gone table)
-- ============================================================

-- 1. Drop dependent views.
DROP VIEW IF EXISTS expiring_soon_lots;
DROP VIEW IF EXISTS dashboard_cost_by_vendor;

-- 2. Drop import_lot RPC (Wave 21B). Both signatures defensively.
DROP FUNCTION IF EXISTS import_lot(jsonb, jsonb, jsonb, uuid);
DROP FUNCTION IF EXISTS import_lot(uuid, jsonb, jsonb, uuid);
DROP FUNCTION IF EXISTS import_lot CASCADE;

-- 3. Drop import_lot_keys (idempotency). No dependents.
DROP TABLE IF EXISTS import_lot_keys CASCADE;

-- 4. Drop trigger + function maintaining proxy_count on purchase_lots.
DROP TRIGGER IF EXISTS trg_proxies_lot_count ON proxies;
DROP TRIGGER IF EXISTS trg_proxy_lot_count ON proxies;
DROP FUNCTION IF EXISTS fn_proxy_lot_count CASCADE;
DROP FUNCTION IF EXISTS fn_purchase_lots_recount CASCADE;

-- 5. Drop FK column on proxies. Index drops automatically with the column.
ALTER TABLE proxies DROP COLUMN IF EXISTS purchase_lot_id;

-- 6. Drop purchase_lots table itself.
DROP TABLE IF EXISTS purchase_lots CASCADE;

-- 7. Sanity: any leftover indexes on the dropped column
DROP INDEX IF EXISTS idx_proxies_purchase_lot;
DROP INDEX IF EXISTS idx_proxies_purchase_lot_id;

-- ------------------------------------------------------------
-- Audit log row so the drop is visible in /logs going forward.
-- Defensive: only INSERT if actor_display_name column exists
-- (mig 032 may not have been applied on every environment).
-- ------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'activity_logs'
      AND column_name = 'actor_display_name'
  ) THEN
    EXECUTE $sql$
      INSERT INTO activity_logs (
        actor_type, actor_id, actor_display_name,
        action, resource_type, details
      ) VALUES (
        'system', NULL, 'System (mig 040)',
        'schema.drop_purchase_lots',
        'migration',
        jsonb_build_object(
          'wave', '22S Phase 8',
          'reason', 'Path A: drop. Wave 22K denormed metadata onto proxies.'
        )
      )
    $sql$;
  ELSE
    EXECUTE $sql$
      INSERT INTO activity_logs (
        actor_type, actor_id, action, resource_type, details
      ) VALUES (
        'system', NULL,
        'schema.drop_purchase_lots',
        'migration',
        jsonb_build_object(
          'wave', '22S Phase 8',
          'reason', 'Path A: drop. Wave 22K denormed metadata onto proxies.'
        )
      )
    $sql$;
  END IF;
END $$;
