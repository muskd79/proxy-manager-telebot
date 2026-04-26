-- ============================================================
-- 023_wave21a_inventory.sql
-- Wave 21A — Manual proxy inventory management at 10k+ scale.
--
-- Strategic context: vendor API automation (Wave 19/20) is parked
-- because most vendor sites don't expose a complete API. The user buys
-- 50-1000 proxies at a time from 4-8 vendor websites and gets a
-- CSV/TXT dump per purchase. They need to track purchase date, expiry,
-- cost, vendor (free-text label, NOT FK to vendors table), country,
-- speed, type — and bulk-renew/alert/distribute fairly.
--
-- This migration is foundational. Wave 21B (import wizard + lots UI),
-- 21C (filter/bulk/alert UX), 21D (smart distribution + GeoIP) build
-- on it.
--
-- All idempotent (IF NOT EXISTS / DO blocks).
-- ============================================================

-- ------------------------------------------------------------
-- 1. purchase_lots — one row per CSV/manual purchase
-- ------------------------------------------------------------
-- Why a lot table: aggregate cost queries ("spend by vendor this quarter")
-- and bulk-renew ("extend all 500 proxies in lot X by 30 days") become
-- single-row operations instead of full proxies-table scans. The join
-- cost on the proxies list page (~1ms at 10k) is cheap by comparison.
CREATE TABLE IF NOT EXISTS purchase_lots (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_label     TEXT        NOT NULL
                               CHECK (char_length(vendor_label) BETWEEN 1 AND 120),
  purchase_date    TIMESTAMPTZ NOT NULL,
  expiry_date      TIMESTAMPTZ,
  total_cost_usd   NUMERIC(12, 4),
  currency         TEXT        NOT NULL DEFAULT 'USD'
                               CHECK (char_length(currency) = 3),
  source_file_name TEXT,
  batch_reference  TEXT,
  notes            TEXT,
  -- Denormalised count — bumped by trigger on proxies INSERT/UPDATE/DELETE.
  -- Avoids COUNT(*) on the proxies list page at 10k scale.
  proxy_count      INTEGER     NOT NULL DEFAULT 0
                               CHECK (proxy_count >= 0),
  -- Renewal chain: when admin "renews" a lot, a new row is inserted with
  -- parent_lot_id pointing here. Original lot keeps historical cost +
  -- expiry intact. Renewal cost is on the child lot.
  parent_lot_id    UUID        REFERENCES purchase_lots(id) ON DELETE SET NULL,
  -- Per-window alert dedup. Three columns because 7d alert mustn't
  -- suppress 24h alert.
  last_alert_24h_at TIMESTAMPTZ,
  last_alert_7d_at  TIMESTAMPTZ,
  last_alert_30d_at TIMESTAMPTZ,
  created_by       UUID        REFERENCES admins(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Re-import dedup. Partial: only enforced when batch_reference is set.
  -- Many CSVs lack a vendor order number; for those, we rely on the
  -- proxies-level UNIQUE(host, port).
  CONSTRAINT uq_lot_vendor_batch UNIQUE (vendor_label, batch_reference)
);

-- updated_at auto-touch
CREATE OR REPLACE FUNCTION fn_purchase_lots_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_purchase_lots_updated_at ON purchase_lots;
CREATE TRIGGER trg_purchase_lots_updated_at
  BEFORE UPDATE ON purchase_lots
  FOR EACH ROW EXECUTE FUNCTION fn_purchase_lots_touch_updated_at();

-- ------------------------------------------------------------
-- 2. ALTER proxies — inventory columns
-- ------------------------------------------------------------
ALTER TABLE proxies
  ADD COLUMN IF NOT EXISTS purchase_date        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS vendor_label         TEXT
                                                CHECK (vendor_label IS NULL
                                                  OR char_length(vendor_label) <= 120),
  ADD COLUMN IF NOT EXISTS cost_usd             NUMERIC(10, 4)
                                                CHECK (cost_usd IS NULL OR cost_usd >= 0),
  ADD COLUMN IF NOT EXISTS purchase_lot_id      UUID
                                                REFERENCES purchase_lots(id) ON DELETE SET NULL,
  -- ISO 3166-1 alpha-2, GeoIP-detected at import time.
  -- Distinct from `country` (vendor-supplied label, e.g. "Vietnam"/"VN"/"vn").
  ADD COLUMN IF NOT EXISTS geo_country_iso      TEXT
                                                CHECK (geo_country_iso IS NULL
                                                  OR char_length(geo_country_iso) = 2),
  ADD COLUMN IF NOT EXISTS distribute_count     INTEGER NOT NULL DEFAULT 0
                                                CHECK (distribute_count >= 0),
  ADD COLUMN IF NOT EXISTS last_distributed_at  TIMESTAMPTZ;

-- Invariant: lot-imported proxy MUST carry an expiry date. Without this
-- bulk-renew breaks (UPDATE WHERE lot_id = X SET expires_at = ... has
-- nothing to anchor on for renewal-cost-per-day calculation).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_proxy_lot_expiry'
  ) THEN
    ALTER TABLE proxies
      ADD CONSTRAINT chk_proxy_lot_expiry
      CHECK (purchase_lot_id IS NULL OR expires_at IS NOT NULL);
  END IF;
END;
$$;

-- ------------------------------------------------------------
-- 3. Backfill — existing proxies pre-Wave-21
-- ------------------------------------------------------------
-- Default purchase_date to created_at so the column can be NOT NULL
-- without breaking historical rows.
UPDATE proxies
  SET purchase_date = created_at
  WHERE purchase_date IS NULL;

-- Lock down purchase_date as required.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'proxies' AND column_name = 'purchase_date'
      AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE proxies ALTER COLUMN purchase_date SET NOT NULL;
  END IF;
END;
$$;

-- ------------------------------------------------------------
-- 4. proxy_count auto-maintenance trigger
-- ------------------------------------------------------------
-- The denormalised count avoids COUNT(*) per lot row at 10k scale.
-- Soft-deleted proxies STILL count as "in lot" — they retain their
-- purchase_lot_id FK. Switch to filtered count via view if "live count"
-- becomes the dominant UX (Wave 21B can revisit).
CREATE OR REPLACE FUNCTION fn_sync_lot_proxy_count()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.purchase_lot_id IS NOT NULL THEN
    UPDATE purchase_lots
      SET proxy_count = proxy_count + 1, updated_at = now()
      WHERE id = NEW.purchase_lot_id;
  ELSIF TG_OP = 'DELETE' AND OLD.purchase_lot_id IS NOT NULL THEN
    UPDATE purchase_lots
      SET proxy_count = GREATEST(proxy_count - 1, 0), updated_at = now()
      WHERE id = OLD.purchase_lot_id;
  ELSIF TG_OP = 'UPDATE' AND
        OLD.purchase_lot_id IS DISTINCT FROM NEW.purchase_lot_id THEN
    IF OLD.purchase_lot_id IS NOT NULL THEN
      UPDATE purchase_lots
        SET proxy_count = GREATEST(proxy_count - 1, 0), updated_at = now()
        WHERE id = OLD.purchase_lot_id;
    END IF;
    IF NEW.purchase_lot_id IS NOT NULL THEN
      UPDATE purchase_lots
        SET proxy_count = proxy_count + 1, updated_at = now()
        WHERE id = NEW.purchase_lot_id;
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_proxy_lot_count ON proxies;
CREATE TRIGGER trg_proxy_lot_count
  AFTER INSERT OR UPDATE OF purchase_lot_id OR DELETE ON proxies
  FOR EACH ROW EXECUTE FUNCTION fn_sync_lot_proxy_count();

-- ------------------------------------------------------------
-- 5. Indexes for 10k-scale hot queries
-- ------------------------------------------------------------

-- Q1: "Proxies expiring in next N days, grouped by vendor_label"
-- Used by: expiry alert cron + dashboard "expiring soon" widget.
CREATE INDEX IF NOT EXISTS idx_proxies_expiry_vendor
  ON proxies (expires_at ASC, vendor_label)
  WHERE is_deleted = false AND expires_at IS NOT NULL;

-- Q2: "Available proxies in country=X, type=Y, paginate cursor-style"
-- Used by: /proxies admin list with country+type filter.
CREATE INDEX IF NOT EXISTS idx_proxies_avail_geo_type
  ON proxies (geo_country_iso, type, status, created_at DESC, id)
  WHERE is_deleted = false AND status = 'available';

-- Q3: Distribution priority sort.
-- ORDER BY expires_at DESC, speed_ms ASC, last_distributed_at ASC NULLS FIRST
CREATE INDEX IF NOT EXISTS idx_proxies_distribute_priority
  ON proxies (
    type, geo_country_iso,
    expires_at DESC NULLS LAST,
    speed_ms ASC NULLS LAST,
    last_distributed_at ASC NULLS FIRST
  )
  WHERE is_deleted = false AND status = 'available';

-- Q4: FK index on purchase_lot_id (always index FKs).
CREATE INDEX IF NOT EXISTS idx_proxies_purchase_lot
  ON proxies (purchase_lot_id)
  WHERE purchase_lot_id IS NOT NULL;

-- Q5: Host search via pg_trgm — leading-wildcard ILIKE at 10k scale
-- otherwise does a full table scan.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_proxies_host_trgm
  ON proxies USING GIN (host gin_trgm_ops)
  WHERE is_deleted = false;

-- purchase_lots: cost rollup query "spend by vendor for time range".
CREATE INDEX IF NOT EXISTS idx_lots_vendor_label_purchase
  ON purchase_lots (vendor_label, purchase_date DESC);

-- purchase_lots: expiry alert cron query "lots expiring within window".
CREATE INDEX IF NOT EXISTS idx_lots_expiry_alert
  ON purchase_lots (expiry_date ASC)
  WHERE expiry_date IS NOT NULL;

-- ------------------------------------------------------------
-- 6. Drop indexes superseded by Q3 (Wave 21A optimisation)
-- ------------------------------------------------------------
-- idx_proxies_expires_at (mig 006) was a single-column B-tree that
-- could not serve the new multi-column ORDER BY. Q3 supersedes it.
-- DROP CONCURRENTLY would be cleaner but Supabase migrations run inside
-- a transaction; plain DROP INDEX IF EXISTS is fine for Wave 21A scale.
DROP INDEX IF EXISTS idx_proxies_expires_at;

-- ------------------------------------------------------------
-- 7. RLS on purchase_lots
-- ------------------------------------------------------------
-- Helper functions is_admin() / is_admin_or_viewer() defined in mig 003.
-- Wrapping in (SELECT ...) forces InitPlan evaluation (once per query)
-- instead of per-row at 10k scale.
ALTER TABLE purchase_lots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS purchase_lots_select ON purchase_lots;
CREATE POLICY purchase_lots_select ON purchase_lots
  FOR SELECT TO authenticated
  USING ((SELECT is_admin_or_viewer()));

DROP POLICY IF EXISTS purchase_lots_insert ON purchase_lots;
CREATE POLICY purchase_lots_insert ON purchase_lots
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT is_admin()));

DROP POLICY IF EXISTS purchase_lots_update ON purchase_lots;
CREATE POLICY purchase_lots_update ON purchase_lots
  FOR UPDATE TO authenticated
  USING ((SELECT is_admin()))
  WITH CHECK ((SELECT is_admin()));

DROP POLICY IF EXISTS purchase_lots_delete ON purchase_lots;
CREATE POLICY purchase_lots_delete ON purchase_lots
  FOR DELETE TO authenticated
  USING ((SELECT is_admin()));

DROP POLICY IF EXISTS purchase_lots_service ON purchase_lots;
CREATE POLICY purchase_lots_service ON purchase_lots
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ------------------------------------------------------------
-- 8. Comments — for schema introspection tools (Supabase Studio, etc.)
-- ------------------------------------------------------------
COMMENT ON TABLE  purchase_lots               IS 'One row per proxy purchase batch (manual, no FK to vendors). Cost + expiry rollup unit.';
COMMENT ON COLUMN purchase_lots.vendor_label  IS 'Free text — admin types the vendor name. NOT a FK to vendors table.';
COMMENT ON COLUMN purchase_lots.proxy_count   IS 'Denormalised. Maintained by trigger on proxies INSERT/UPDATE/DELETE.';
COMMENT ON COLUMN purchase_lots.parent_lot_id IS 'Set when this lot is a renewal of a prior lot. Forms a chain.';
COMMENT ON COLUMN proxies.purchase_date       IS 'When admin paid for this proxy. Distinct from created_at (DB insert time).';
COMMENT ON COLUMN proxies.vendor_label        IS 'Free text — denormalised from purchase_lots.vendor_label for fast filter without join.';
COMMENT ON COLUMN proxies.geo_country_iso     IS 'ISO 3166-1 alpha-2 from GeoIP at import. Distinct from country (vendor-supplied label).';
COMMENT ON COLUMN proxies.distribute_count    IS 'Total times this proxy has been distributed. Used by smart-distribution fairness sort.';
COMMENT ON COLUMN proxies.last_distributed_at IS 'Last distribution time. Tie-breaker for fair rotation in safe_assign_proxy.';
