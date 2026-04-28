-- ============================================================
-- 038_wave22k_per_proxy_dates_prices.sql
--
-- Wave 22K — denormalise purchase metadata onto proxies row.
-- The /lots tab is being removed from the UI; admins want each
-- proxy to carry its own purchase_date / vendor_source / prices
-- so the import wizard can bulk-set them per row.
--
-- Three changes:
--   1. Add per-proxy money/date columns
--   2. Convert network_type enum → free-text TEXT (admin-extensible).
--      The Wave 22J enum was too rigid — user wants to type "proxy
--      dung lượng" etc. without us shipping a new migration.
--   3. Backfill purchase_date + purchase_price_usd from purchase_lots
--      JOIN where the proxy is currently linked to a lot.
--
-- The purchase_lots table itself is NOT dropped — it has FK
-- references from imports + history. UI removes the /lots route;
-- the table stays for historical reads. New imports go straight
-- onto the proxies row, no lot needed.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Per-proxy purchase metadata
--    REUSE existing Wave 21A inventory columns where they already
--    serve the purpose; only ADD what's truly new.
--      purchase_date  (Wave 21A)         — already exists
--      vendor_label   (Wave 21A)         — already exists, used as
--                                          "Nguồn" in the UI
--      cost_usd       (Wave 21A)         — already exists, used as
--                                          "Giá mua"
--      sale_price_usd (Wave 22K, NEW)    — sticker price for sale
-- ------------------------------------------------------------
ALTER TABLE proxies
  ADD COLUMN IF NOT EXISTS sale_price_usd NUMERIC(10, 4)
                                          CHECK (sale_price_usd IS NULL
                                                 OR sale_price_usd >= 0);

COMMENT ON COLUMN proxies.sale_price_usd IS
  'Wave 22K — sticker price the proxy will be sold at (USD). Pair with cost_usd (purchase price) to compute margin.';

-- Wave 21A's purchase_date defaulted to now() and was NOT NULL —
-- relax it for proxies imported without a known purchase date.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'proxies' AND column_name = 'purchase_date'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE proxies ALTER COLUMN purchase_date DROP NOT NULL;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2. network_type: enum → TEXT (admin-extensible)
--    The Wave 22J enum (`proxy_network_type`) was too rigid.
--    Admin wants to type custom values like "proxy dung lượng".
-- ------------------------------------------------------------

-- Step A: drop the column on dependent tables. CASCADE removes
-- the partial index idx_proxies_network_type that was created
-- with WHERE network_type IS NOT NULL.
DROP INDEX IF EXISTS idx_proxies_network_type;

ALTER TABLE proxies              DROP COLUMN IF EXISTS network_type;
ALTER TABLE proxy_categories     DROP COLUMN IF EXISTS default_network_type;

-- Step B: drop the enum type itself.
DROP TYPE IF EXISTS proxy_network_type;

-- Step C: re-add as TEXT with a length CHECK (no enum).
ALTER TABLE proxies
  ADD COLUMN network_type TEXT
    CHECK (network_type IS NULL OR char_length(network_type) BETWEEN 1 AND 80);

ALTER TABLE proxy_categories
  ADD COLUMN default_network_type TEXT
    CHECK (default_network_type IS NULL OR char_length(default_network_type) BETWEEN 1 AND 80);

-- Step D: GIN trigram index so the /proxies "Phân loại" filter can
-- do partial match (e.g. typing "ipv" matches "ipv4" and "ipv6").
-- Requires pg_trgm extension; create if missing.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_proxies_network_type_trgm
  ON proxies USING GIN (network_type gin_trgm_ops)
  WHERE is_deleted = false AND network_type IS NOT NULL;

COMMENT ON COLUMN proxies.network_type IS
  'Wave 22K — proxy classification (free text). Common values: ipv4, ipv6, isp, residential, mobile, bandwidth. Admin may type custom labels per import.';

-- ------------------------------------------------------------
-- 3. Per-category purchase defaults (snapshot semantics from
--    Wave 22G carry through). These prefill the import wizard
--    when admin picks a category.
-- ------------------------------------------------------------
ALTER TABLE proxy_categories
  -- Re-using "vendor_source" as the column name — kept distinct from
  -- proxies.vendor_label semantics for forward flexibility (could
  -- diverge in future).
  ADD COLUMN IF NOT EXISTS default_vendor_source       TEXT,
  ADD COLUMN IF NOT EXISTS default_purchase_price_usd  NUMERIC(10, 4)
                                                       CHECK (default_purchase_price_usd IS NULL
                                                              OR default_purchase_price_usd >= 0),
  ADD COLUMN IF NOT EXISTS default_sale_price_usd      NUMERIC(10, 4)
                                                       CHECK (default_sale_price_usd IS NULL
                                                              OR default_sale_price_usd >= 0);

COMMENT ON COLUMN proxy_categories.default_vendor_source IS
  'Wave 22K — prefill "Nguồn" field on import. Snapshot semantics.';
COMMENT ON COLUMN proxy_categories.default_purchase_price_usd IS
  'Wave 22K — prefill "Giá mua" (proxies.cost_usd). NULL = no default.';
COMMENT ON COLUMN proxy_categories.default_sale_price_usd IS
  'Wave 22K — prefill "Giá bán" (proxies.sale_price_usd).';

-- ------------------------------------------------------------
-- 4. No backfill needed — purchase_date / vendor_label / cost_usd
-- already populated by Wave 21A's import_lot RPC. sale_price_usd
-- starts NULL until admin sets it via the new import wizard or
-- per-proxy edit form.
-- ------------------------------------------------------------
