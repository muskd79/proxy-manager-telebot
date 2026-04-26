-- ============================================================
-- 024_wave21a5_drop_vendor_api.sql
-- Wave 21A.5 — Drop Wave 19/20 vendor-API automation stack.
--
-- Rationale: vendor websites lack complete APIs; the platform is
-- manual-only from Wave 21A onward (lot/inventory model). This
-- migration removes all Wave 19/20 tables, functions, triggers,
-- views, and proxies columns that were solely owned by the
-- vendor-automation path.
--
-- Decisions per database-reviewer audit (Wave 21A.5 design session):
--   - KEEP rotation_mode on proxies (useful for rotating residential
--     proxies bought manually — independent of vendor automation)
--   - KEEP pgsodium 'vendor_credentials_key' (PITR safety; cheap to
--     retain)
--   - DROP source, vendor_id, vendor_product_id, vendor_order_id,
--     vendor_allocation_id from proxies
--   - DROP all vendor_* tables, functions, triggers, view
--
-- Section 7 DO-block raises EXCEPTION if anything is left behind
-- so a partial cleanup cannot commit.
--
-- All statements idempotent (DROP IF EXISTS / DO blocks).
-- ============================================================

-- ============================================================
-- SECTION 1: DROP TRIGGERS ON vendor_* tables
-- Must happen before dropping the function they reference.
-- ============================================================
DROP TRIGGER IF EXISTS trg_vendor_orders_transition              ON vendor_orders;
DROP TRIGGER IF EXISTS trg_vendors_touch_updated_at              ON vendors;
DROP TRIGGER IF EXISTS trg_vendor_orders_touch_updated_at        ON vendor_orders;
DROP TRIGGER IF EXISTS trg_vendor_allocations_touch_updated_at   ON vendor_allocations;
DROP TRIGGER IF EXISTS trg_vendor_renewal_schedule_touch_updated_at ON vendor_renewal_schedule;

-- ============================================================
-- SECTION 2: DROP VIEW (mig 020)
-- Drop before dropping base table vendor_credentials.
-- ============================================================
DROP VIEW IF EXISTS vendor_credentials_safe;

-- ============================================================
-- SECTION 3: DROP SECURITY DEFINER FUNCTIONS (mig 020, 021)
-- Drop before tables they reference.
-- ============================================================
DROP FUNCTION IF EXISTS encrypt_vendor_cred(TEXT);
DROP FUNCTION IF EXISTS decrypt_vendor_cred(UUID);
DROP FUNCTION IF EXISTS list_vendor_credentials(UUID);
DROP FUNCTION IF EXISTS fn_assert_vendor_order_transition();
DROP FUNCTION IF EXISTS fn_release_stuck_vendor_orders(INTEGER);
DROP FUNCTION IF EXISTS fn_vendor_tables_touch_updated_at();

-- ============================================================
-- SECTION 4: DROP TABLES IN FK DEPENDENCY ORDER
-- Leaf tables first, root tables last.
-- ============================================================
DROP TABLE IF EXISTS vendor_usage_events;
DROP TABLE IF EXISTS vendor_allocations;
DROP TABLE IF EXISTS vendor_renewal_schedule;
DROP TABLE IF EXISTS vendor_orders;
DROP TABLE IF EXISTS vendor_webhook_events;
DROP TABLE IF EXISTS vendor_credentials;
DROP TABLE IF EXISTS vendor_products;
DROP TABLE IF EXISTS vendors;

-- ============================================================
-- SECTION 5: DROP COLUMNS FROM proxies (mig 019 ALTER)
-- chk_proxies_vendor_consistency must be dropped first because
-- the CHECK references both source AND vendor_id.
-- ============================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_proxies_vendor_consistency'
      AND conrelid = 'proxies'::regclass
  ) THEN
    ALTER TABLE proxies DROP CONSTRAINT chk_proxies_vendor_consistency;
  END IF;
END;
$$;

ALTER TABLE proxies
  DROP COLUMN IF EXISTS source,
  DROP COLUMN IF EXISTS vendor_id,
  DROP COLUMN IF EXISTS vendor_product_id,
  DROP COLUMN IF EXISTS vendor_order_id,
  DROP COLUMN IF EXISTS vendor_allocation_id;

-- rotation_mode KEPT — see header comment.
-- The vendor_id index idx_proxies_vendor (mig 019) is dropped automatically
-- by Postgres when the underlying column is removed.

-- ============================================================
-- SECTION 6: pgsodium key (mig 020)
-- KEEP 'vendor_credentials_key' — PITR safety. Drop in a future
-- migration once you are certain no PITR window of interest covers
-- the Wave 19-22 era.
-- ============================================================

-- ============================================================
-- SECTION 7: VERIFY CLEANUP — fails the migration if anything
-- remains. Treat this as the canonical post-condition: a green
-- migration means a clean database.
-- ============================================================
DO $$
DECLARE
  v_tables INTEGER;
  v_fns    INTEGER;
  v_cols   INTEGER;
BEGIN
  SELECT count(*) INTO v_tables
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name LIKE 'vendor_%';

  SELECT count(*) INTO v_fns
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (p.proname LIKE 'fn_%vendor%'
        OR p.proname IN ('encrypt_vendor_cred','decrypt_vendor_cred','list_vendor_credentials'));

  SELECT count(*) INTO v_cols
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'proxies'
      AND column_name  IN ('source','vendor_id','vendor_product_id',
                           'vendor_order_id','vendor_allocation_id');

  IF v_tables > 0 THEN
    RAISE EXCEPTION 'Wave 21A.5 cleanup incomplete: % vendor_* tables remain', v_tables;
  END IF;
  IF v_fns > 0 THEN
    RAISE EXCEPTION 'Wave 21A.5 cleanup incomplete: % vendor functions remain', v_fns;
  END IF;
  IF v_cols > 0 THEN
    RAISE EXCEPTION 'Wave 21A.5 cleanup incomplete: % vendor columns remain in proxies', v_cols;
  END IF;

  RAISE NOTICE 'Wave 21A.5 cleanup verified: 0 vendor tables, 0 vendor functions, 0 vendor columns. rotation_mode preserved.';
END;
$$;
