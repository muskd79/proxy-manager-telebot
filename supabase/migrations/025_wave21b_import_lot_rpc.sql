-- ============================================================
-- 025_wave21b_import_lot_rpc.sql
-- Wave 21B — Atomic lot+proxies import via SECURITY DEFINER RPC.
--
-- WHY an RPC: Wave 21A created the schema; Wave 21B's import wizard
-- uploads up to 1000 proxies + 1 lot row in one user action. Doing
-- this from app code requires:
--   - 1 INSERT into purchase_lots (or ON CONFLICT lookup)
--   - N INSERTs into proxies with the new lot_id
-- Without a transactional wrapper a mid-batch crash leaves orphan
-- proxies (no lot_id) and a half-populated lot (proxy_count wrong).
-- The RPC runs everything in one DB transaction so either the whole
-- import succeeds or nothing changes.
--
-- IDEMPOTENCY: the RPC takes a `p_idempotency_key UUIDv7` from the
-- caller. A new lot row is created only if no lot exists with the
-- same key. Re-submitting the same key returns the existing lot's
-- summary so the wizard can show "already imported" instead of
-- erroring. Implemented via a tiny `import_lot_keys` lookup table
-- (one row per import; cleaned up after 30 days by cron).
--
-- DEDUP within the proxies batch: ON CONFLICT (host, port) DO UPDATE
-- so re-uploading a CSV that overlaps an existing lot rebinds the
-- duplicate proxies to the new lot rather than failing the import.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Idempotency-key lookup table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS import_lot_keys (
  idempotency_key UUID         PRIMARY KEY,
  lot_id          UUID         NOT NULL REFERENCES purchase_lots(id) ON DELETE CASCADE,
  imported_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  imported_by     UUID         REFERENCES admins(id) ON DELETE SET NULL,
  proxy_count     INTEGER      NOT NULL CHECK (proxy_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_import_lot_keys_imported_at
  ON import_lot_keys (imported_at);

ALTER TABLE import_lot_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS import_lot_keys_select ON import_lot_keys;
CREATE POLICY import_lot_keys_select ON import_lot_keys
  FOR SELECT TO authenticated
  USING ((SELECT is_admin_or_viewer()));

DROP POLICY IF EXISTS import_lot_keys_service ON import_lot_keys
;
CREATE POLICY import_lot_keys_service ON import_lot_keys
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ------------------------------------------------------------
-- 2. Input shape (JSONB)
-- ------------------------------------------------------------
-- p_proxies is a jsonb array of objects with the shape:
--   {
--     "host":     string,
--     "port":     integer (1-65535),
--     "type":     "http" | "https" | "socks5",
--     "username": string | null,
--     "password": string | null,
--     "country":  string | null,
--     "isp":      string | null,
--     "tags":     string[] | null,
--     "notes":    string | null,
--     "expires_at": iso-string | null   (overrides lot expiry per row)
--   }
-- Maximum 1000 entries — guarded inside the function to avoid OOM.
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- 3. The RPC
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION import_lot(
  p_idempotency_key UUID,
  p_lot             JSONB,
  p_proxies         JSONB,
  p_admin_id        UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing       RECORD;
  v_lot_id         UUID;
  v_count          INTEGER;
  v_inserted       INTEGER := 0;
  v_updated        INTEGER := 0;
  v_lot_expiry     TIMESTAMPTZ;
  v_lot_purchased  TIMESTAMPTZ;
  v_lot_vendor     TEXT;
  v_lot_cost_total NUMERIC;
  v_lot_currency   TEXT;
BEGIN
  -- 1) Idempotent re-submit short-circuit.
  SELECT k.lot_id, k.proxy_count INTO v_existing
  FROM import_lot_keys k
  WHERE k.idempotency_key = p_idempotency_key;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'deduplicated', true,
      'lot_id', v_existing.lot_id,
      'inserted_proxies', 0,
      'updated_proxies', 0,
      'total_proxies', v_existing.proxy_count
    );
  END IF;

  -- 2) Validate proxies array bounds.
  v_count := COALESCE(jsonb_array_length(p_proxies), 0);
  IF v_count = 0 THEN
    RAISE EXCEPTION 'import_lot: proxies array is empty';
  END IF;
  IF v_count > 1000 THEN
    RAISE EXCEPTION 'import_lot: too many proxies in one lot (got %, max 1000)', v_count;
  END IF;

  -- 3) Extract + validate lot fields.
  v_lot_vendor := p_lot->>'vendor_label';
  IF v_lot_vendor IS NULL OR char_length(v_lot_vendor) = 0 THEN
    RAISE EXCEPTION 'import_lot: vendor_label is required';
  END IF;
  v_lot_purchased := COALESCE((p_lot->>'purchase_date')::TIMESTAMPTZ, now());
  v_lot_expiry    := NULLIF(p_lot->>'expiry_date', '')::TIMESTAMPTZ;
  v_lot_cost_total := NULLIF(p_lot->>'total_cost_usd', '')::NUMERIC;
  v_lot_currency  := COALESCE(p_lot->>'currency', 'USD');

  -- 4) Insert (or fetch on conflict) the lot row.
  -- UNIQUE (vendor_label, batch_reference) handles the dedup when
  -- batch_reference is set.
  INSERT INTO purchase_lots (
    vendor_label,
    purchase_date,
    expiry_date,
    total_cost_usd,
    currency,
    source_file_name,
    batch_reference,
    notes,
    created_by
  ) VALUES (
    v_lot_vendor,
    v_lot_purchased,
    v_lot_expiry,
    v_lot_cost_total,
    v_lot_currency,
    NULLIF(p_lot->>'source_file_name', ''),
    NULLIF(p_lot->>'batch_reference', ''),
    NULLIF(p_lot->>'notes', ''),
    p_admin_id
  )
  ON CONFLICT (vendor_label, batch_reference) DO UPDATE
    SET updated_at = now()
  RETURNING id INTO v_lot_id;

  -- 5) Insert/upsert each proxy. ON CONFLICT (host, port) rebinds an
  -- existing proxy to the new lot rather than failing.
  WITH src AS (
    SELECT
      (e->>'host')::TEXT          AS host,
      (e->>'port')::INTEGER       AS port,
      (e->>'type')::TEXT          AS type,
      NULLIF(e->>'username','')   AS username,
      NULLIF(e->>'password','')   AS password,
      NULLIF(e->>'country','')    AS country,
      NULLIF(e->>'isp','')        AS isp,
      CASE WHEN e ? 'tags' AND jsonb_typeof(e->'tags') = 'array'
           THEN ARRAY(SELECT jsonb_array_elements_text(e->'tags'))
           ELSE NULL END          AS tags,
      NULLIF(e->>'notes','')      AS notes,
      COALESCE(NULLIF(e->>'expires_at','')::TIMESTAMPTZ, v_lot_expiry) AS expires_at
    FROM jsonb_array_elements(p_proxies) AS e
  ),
  ins AS (
    INSERT INTO proxies (
      host, port, type, username, password, country, isp, tags, notes,
      status, is_deleted,
      purchase_date, vendor_label, cost_usd, purchase_lot_id,
      expires_at, created_by
    )
    SELECT
      s.host, s.port, s.type::proxy_type, s.username, s.password,
      s.country, s.isp, s.tags, s.notes,
      'available'::proxy_status, false,
      v_lot_purchased,
      v_lot_vendor,
      CASE WHEN v_lot_cost_total IS NOT NULL AND v_count > 0
           THEN v_lot_cost_total / v_count
           ELSE NULL END,
      v_lot_id,
      s.expires_at,
      p_admin_id
    FROM src s
    ON CONFLICT (host, port) DO UPDATE SET
      purchase_lot_id = EXCLUDED.purchase_lot_id,
      vendor_label    = EXCLUDED.vendor_label,
      purchase_date   = EXCLUDED.purchase_date,
      expires_at      = EXCLUDED.expires_at,
      cost_usd        = EXCLUDED.cost_usd,
      updated_at      = now()
    RETURNING (xmax = 0) AS was_inserted
  )
  SELECT
    count(*) FILTER (WHERE was_inserted),
    count(*) FILTER (WHERE NOT was_inserted)
  INTO v_inserted, v_updated
  FROM ins;

  -- 6) Record idempotency key.
  INSERT INTO import_lot_keys (idempotency_key, lot_id, imported_by, proxy_count)
  VALUES (p_idempotency_key, v_lot_id, p_admin_id, v_inserted + v_updated);

  RETURN jsonb_build_object(
    'success', true,
    'deduplicated', false,
    'lot_id', v_lot_id,
    'inserted_proxies', v_inserted,
    'updated_proxies', v_updated,
    'total_proxies', v_inserted + v_updated
  );
END;
$$;

REVOKE ALL ON FUNCTION import_lot(UUID, JSONB, JSONB, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION import_lot(UUID, JSONB, JSONB, UUID) TO authenticated, service_role;

COMMENT ON FUNCTION import_lot IS
  'Wave 21B — atomic CSV import. Creates a purchase_lots row + N proxies in one transaction. Idempotent via import_lot_keys.';
