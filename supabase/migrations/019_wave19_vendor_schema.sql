-- ============================================================
-- 019_wave19_vendor_schema.sql
-- Wave 19 — Multi-vendor proxy aggregation foundation.
--
-- Adds the tables needed to buy proxies on-demand from external
-- providers (Webshare, Smartproxy/Decodo, IPRoyal, etc.) and
-- route those allocations into the existing `proxies` table.
--
-- This migration is SCHEMA ONLY. It does not insert vendor rows,
-- register any credentials, or change the existing proxy flow.
-- After apply, the platform continues to operate exactly as
-- before; vendor features gate behind a feature flag added in
-- Wave 20.
-- ============================================================

-- ------------------------------------------------------------
-- vendors  — one row per external provider
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vendors (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug             TEXT NOT NULL UNIQUE,           -- e.g. 'webshare', 'smartproxy', 'iproyal'
  display_name     TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'paused'
                   CHECK (status IN ('active', 'paused', 'deprecated')),
  base_url         TEXT NOT NULL,
  adapter_key      TEXT NOT NULL,                  -- maps to src/lib/vendors/registry.ts
  default_currency TEXT NOT NULL DEFAULT 'USD',
  support_email    TEXT,
  rate_limit_rpm   INTEGER NOT NULL DEFAULT 60     -- vendor-declared max requests/minute
                   CHECK (rate_limit_rpm > 0),
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendors_status ON vendors(status) WHERE status = 'active';

COMMENT ON TABLE vendors IS 'External proxy vendors we integrate with. New rows start paused until credentials are added.';
COMMENT ON COLUMN vendors.adapter_key IS 'Key into src/lib/vendors/registry.ts — picks which adapter class handles this vendor.';

-- ------------------------------------------------------------
-- vendor_credentials  — API keys per vendor (rotatable)
-- ------------------------------------------------------------
-- Note: ciphertext is a bytea. Encryption uses pgsodium_master_key
-- wired up in migration 020. Until then, rows can be inserted as
-- plain text and re-encrypted during the backfill.
CREATE TABLE IF NOT EXISTS vendor_credentials (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id       UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  label           TEXT NOT NULL,                   -- 'prod', 'staging', 'backup'
  ciphertext      BYTEA NOT NULL,                  -- pgsodium-encrypted API key
  key_id          UUID,                            -- pgsodium key reference
  scope           TEXT NOT NULL DEFAULT 'write'
                  CHECK (scope IN ('read', 'write', 'billing')),
  expires_at      TIMESTAMPTZ,
  last_used_at    TIMESTAMPTZ,
  is_primary      BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES admins(id) ON DELETE SET NULL,
  revoked_at      TIMESTAMPTZ,
  revoked_by      UUID REFERENCES admins(id) ON DELETE SET NULL
);

-- At most one primary credential per vendor (partial unique).
CREATE UNIQUE INDEX IF NOT EXISTS uq_vendor_cred_primary
  ON vendor_credentials(vendor_id) WHERE is_primary = true AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_vendor_cred_vendor ON vendor_credentials(vendor_id);

COMMENT ON TABLE vendor_credentials IS
  'Encrypted vendor API keys. Rotation: mark new row is_primary=true, leave the old one is_primary=false for 7 days as rollback, then set revoked_at.';

-- ------------------------------------------------------------
-- vendor_products — normalized catalog cache (refreshed via cron)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vendor_products (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id          UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  vendor_sku         TEXT NOT NULL,                -- vendor's own product ID
  name               TEXT NOT NULL,
  type               TEXT NOT NULL
                     CHECK (type IN ('residential', 'datacenter', 'mobile', 'isp')),
  country            TEXT[] NOT NULL DEFAULT '{}', -- ISO-3166 alpha-2 codes; empty = global
  bandwidth_gb       NUMERIC(10, 2),               -- per-period quota; null = unmetered
  concurrent_threads INTEGER,
  unit_price_usd     NUMERIC(10, 4) NOT NULL,
  billing_cycle      TEXT NOT NULL DEFAULT 'monthly'
                     CHECK (billing_cycle IN ('one_off', 'daily', 'weekly', 'monthly')),
  raw_json           JSONB NOT NULL,               -- full vendor response for audit
  is_available       BOOLEAN NOT NULL DEFAULT true,
  last_synced_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_vendor_product_sku
  ON vendor_products(vendor_id, vendor_sku);

CREATE INDEX IF NOT EXISTS idx_vendor_products_filter
  ON vendor_products(type, is_available) WHERE is_available = true;

CREATE INDEX IF NOT EXISTS idx_vendor_products_country_gin
  ON vendor_products USING GIN (country);

COMMENT ON COLUMN vendor_products.raw_json IS
  'Full vendor JSON response as returned by listProducts. Used for audit + debugging mapper changes.';

-- ------------------------------------------------------------
-- vendor_orders — our purchase records (single source of truth for spend)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vendor_orders (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id          UUID NOT NULL REFERENCES vendors(id),
  vendor_product_id  UUID REFERENCES vendor_products(id) ON DELETE SET NULL,
  admin_id           UUID REFERENCES admins(id) ON DELETE SET NULL,
  idempotency_key    TEXT NOT NULL,                -- client-generated UUIDv7
  vendor_order_ref   TEXT,                         -- ID returned by vendor after fulfillment
  quantity           INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost_usd      NUMERIC(10, 4) NOT NULL,
  total_cost_usd     NUMERIC(12, 4) NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','processing','fulfilled','failed','cancelled','refunded')),
  failure_reason     TEXT,
  renews_at          TIMESTAMPTZ,
  cancels_at         TIMESTAMPTZ,
  raw_response       JSONB,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotency is enforced DB-side so retries from the app don't double-charge.
CREATE UNIQUE INDEX IF NOT EXISTS uq_vendor_order_idempotency
  ON vendor_orders(idempotency_key);

CREATE INDEX IF NOT EXISTS idx_vendor_orders_vendor_status
  ON vendor_orders(vendor_id, status);

-- Renewal queue query: "orders due for renewal in next N hours"
CREATE INDEX IF NOT EXISTS idx_vendor_orders_renewal_due
  ON vendor_orders(renews_at) WHERE status = 'fulfilled' AND renews_at IS NOT NULL;

COMMENT ON COLUMN vendor_orders.idempotency_key IS
  'Client generates a UUIDv7 before calling /api/vendors/[id]/orders. DB UNIQUE prevents duplicate charges on retry.';

-- ------------------------------------------------------------
-- vendor_allocations — binds a vendor-side proxy to our proxies.id
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vendor_allocations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_order_id       UUID NOT NULL REFERENCES vendor_orders(id) ON DELETE CASCADE,
  proxy_id              UUID REFERENCES proxies(id) ON DELETE SET NULL,
  vendor_allocation_ref TEXT NOT NULL,             -- vendor's proxy ID or endpoint URL
  rotation_url          TEXT,                      -- for rotating pools: endpoint that rotates on each request
  sticky_session_id     TEXT,                      -- for sticky sessions
  last_rotated_at       TIMESTAMPTZ,
  last_health_at        TIMESTAMPTZ,
  health_status         TEXT NOT NULL DEFAULT 'unknown'
                        CHECK (health_status IN ('healthy','degraded','dead','unknown')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_allocations_order ON vendor_allocations(vendor_order_id);

-- One allocation row MAY map to one proxy row (static/sticky proxies).
-- Rotating pools don't map 1:1; proxy_id stays NULL and rotation_url holds the endpoint.
CREATE UNIQUE INDEX IF NOT EXISTS uq_allocation_proxy
  ON vendor_allocations(proxy_id) WHERE proxy_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_allocations_health
  ON vendor_allocations(health_status, last_health_at)
  WHERE health_status IN ('degraded','dead');

-- ------------------------------------------------------------
-- vendor_webhook_events — dedup + replay for inbound vendor webhooks
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vendor_webhook_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id     UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  event_id      TEXT NOT NULL,                     -- vendor-provided unique ID
  signature     TEXT,                              -- HMAC header value (stored for audit)
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at  TIMESTAMPTZ,
  payload       JSONB NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','processed','invalid','duplicate'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_vendor_webhook_event
  ON vendor_webhook_events(vendor_id, event_id);

CREATE INDEX IF NOT EXISTS idx_webhook_events_status
  ON vendor_webhook_events(status, received_at DESC)
  WHERE status IN ('pending','invalid');

-- ------------------------------------------------------------
-- vendor_usage_events — append-only telemetry (bytes, requests)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vendor_usage_events (
  id               BIGSERIAL PRIMARY KEY,
  allocation_id    UUID NOT NULL REFERENCES vendor_allocations(id) ON DELETE CASCADE,
  bucket_start     TIMESTAMPTZ NOT NULL,
  bucket_end       TIMESTAMPTZ NOT NULL,
  bandwidth_bytes  BIGINT NOT NULL DEFAULT 0,
  request_count    BIGINT NOT NULL DEFAULT 0,
  source           TEXT NOT NULL DEFAULT 'vendor_api'
                   CHECK (source IN ('vendor_api','our_probe')),
  raw              JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_usage_events_allocation_bucket
  ON vendor_usage_events(allocation_id, bucket_start DESC);

COMMENT ON TABLE vendor_usage_events IS
  'Append-only usage telemetry. Partition by month via pg_partman in a later migration when volume warrants.';

-- ------------------------------------------------------------
-- vendor_renewal_schedule — materialized renewal queue
-- ------------------------------------------------------------
-- Instead of scanning all vendor_orders for due renewals, a worker
-- enqueues rows into this table and pops them with SELECT FOR UPDATE
-- SKIP LOCKED so multiple workers can drain in parallel safely.
CREATE TABLE IF NOT EXISTS vendor_renewal_schedule (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_order_id  UUID NOT NULL REFERENCES vendor_orders(id) ON DELETE CASCADE,
  scheduled_at    TIMESTAMPTZ NOT NULL,
  attempt_count   INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued','locked','done','failed','skipped')),
  locked_by       UUID,                            -- Vercel function invocation ID
  locked_until    TIMESTAMPTZ,
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_renewal_queue
  ON vendor_renewal_schedule(scheduled_at, status) WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS idx_renewal_stuck_locks
  ON vendor_renewal_schedule(locked_until) WHERE status = 'locked';

-- ------------------------------------------------------------
-- ALTER proxies — add vendor linkage + rotation mode
-- ------------------------------------------------------------
ALTER TABLE proxies
  ADD COLUMN IF NOT EXISTS source               TEXT NOT NULL DEFAULT 'owned'
                                                 CHECK (source IN ('owned','vendor')),
  ADD COLUMN IF NOT EXISTS vendor_id            UUID REFERENCES vendors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vendor_product_id    UUID REFERENCES vendor_products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vendor_order_id      UUID REFERENCES vendor_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vendor_allocation_id UUID REFERENCES vendor_allocations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rotation_mode        TEXT NOT NULL DEFAULT 'static'
                                                 CHECK (rotation_mode IN ('static','sticky','rotating'));

-- Invariant: source='vendor' rows must have vendor_id set.
-- Only add if the constraint doesn't already exist (idempotent via exception catch).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_proxies_vendor_consistency'
  ) THEN
    ALTER TABLE proxies
      ADD CONSTRAINT chk_proxies_vendor_consistency
      CHECK (
        (source = 'owned' AND vendor_id IS NULL)
        OR (source = 'vendor' AND vendor_id IS NOT NULL)
      );
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_proxies_vendor
  ON proxies(vendor_id, status) WHERE source = 'vendor' AND is_deleted = false;

COMMENT ON COLUMN proxies.source IS 'owned = proxy acquired outside the platform; vendor = bought via an integrated vendor adapter.';
COMMENT ON COLUMN proxies.rotation_mode IS 'static = fixed IP; sticky = session-bound for N minutes; rotating = endpoint rotates per request.';

-- ------------------------------------------------------------
-- Updated-at auto-maintenance (simple trigger, reused from existing
-- pattern if one already exists in the project).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_vendor_tables_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['vendors','vendor_orders','vendor_allocations','vendor_renewal_schedule']
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%1$s_touch_updated_at ON %1$s; '
      'CREATE TRIGGER trg_%1$s_touch_updated_at '
      '  BEFORE UPDATE ON %1$s '
      '  FOR EACH ROW EXECUTE FUNCTION fn_vendor_tables_touch_updated_at();',
      tbl
    );
  END LOOP;
END;
$$;

-- ------------------------------------------------------------
-- RLS — admins read/write, service_role full access
-- ------------------------------------------------------------
ALTER TABLE vendors                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_credentials        ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_products           ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_orders             ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_allocations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_webhook_events     ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_usage_events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_renewal_schedule   ENABLE ROW LEVEL SECURITY;

-- Service role has full access to every vendor_* table.
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'vendors','vendor_credentials','vendor_products','vendor_orders',
    'vendor_allocations','vendor_webhook_events','vendor_usage_events',
    'vendor_renewal_schedule'
  ]
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %1$s_service ON %1$s; '
      'CREATE POLICY %1$s_service ON %1$s FOR ALL TO service_role USING (true) WITH CHECK (true);',
      tbl
    );
  END LOOP;
END;
$$;

-- vendor_credentials: NEVER readable by non-service-role. Even super-admins
-- read credentials via a SECURITY DEFINER function (added in migration 020)
-- that decrypts on demand; the raw ciphertext row stays invisible.
-- So no authenticated SELECT policy for vendor_credentials.

-- All other vendor_* tables: admin/viewer can SELECT, only admin writes.
-- The helper functions is_admin() and is_admin_or_viewer() are defined in
-- migration 003 of this repo.
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'vendors','vendor_products','vendor_orders','vendor_allocations',
    'vendor_webhook_events','vendor_usage_events','vendor_renewal_schedule'
  ]
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %1$s_read ON %1$s; '
      'CREATE POLICY %1$s_read ON %1$s FOR SELECT TO authenticated USING (is_admin_or_viewer());',
      tbl
    );
    EXECUTE format(
      'DROP POLICY IF EXISTS %1$s_write ON %1$s; '
      'CREATE POLICY %1$s_write ON %1$s FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());',
      tbl
    );
  END LOOP;
END;
$$;
