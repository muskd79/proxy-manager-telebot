-- ============================================================
-- 021_wave20_reconciler.sql
-- Wave 20 — Purchase saga state machine + reconciler support.
--
-- Changes:
--   1. Add saga-control columns to vendor_orders.
--   2. Add state-machine guard trigger on vendor_orders.
--   3. Add reconciler indexes (hot path + stuck-lock sweep).
--   4. Add per-vendor rate-limit persistence table.
--   5. RLS on new table.
-- ============================================================

-- ------------------------------------------------------------
-- 1. vendor_orders — saga control columns
-- ------------------------------------------------------------
ALTER TABLE vendor_orders
  ADD COLUMN IF NOT EXISTS attempt_count      INT          NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at    TIMESTAMPTZ  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS locked_by          UUID         DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS locked_until       TIMESTAMPTZ  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS failure_category   TEXT         DEFAULT NULL
    CONSTRAINT chk_failure_category
      CHECK (failure_category IN (
        'vendor_api_error',
        'vendor_timeout',
        'insufficient_funds',
        'product_unavailable',
        'auth_error',
        'unknown'
      ));

COMMENT ON COLUMN vendor_orders.attempt_count    IS 'Incremented each time the reconciler pops this row. Capped at 5 before final failure.';
COMMENT ON COLUMN vendor_orders.next_attempt_at  IS 'NULL = eligible immediately. Set to future timestamp for exponential backoff.';
COMMENT ON COLUMN vendor_orders.locked_by        IS 'Vercel invocation UUID that currently holds this order. Cleared on terminal transition.';
COMMENT ON COLUMN vendor_orders.locked_until     IS 'Visibility timeout. Sweeper resets rows where locked_until < now() AND status = ''processing''.';
COMMENT ON COLUMN vendor_orders.failure_category IS 'Structured failure type for dashboards and retry policy routing.';

-- idempotency_key: enforce a sane length so it cannot be abused as a 1 MB blob.
-- TEXT with no limit is fine for the column type, but we need a CHECK.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_vendor_order_idempotency_key_len'
  ) THEN
    ALTER TABLE vendor_orders
      ADD CONSTRAINT chk_vendor_order_idempotency_key_len
        CHECK (length(idempotency_key) <= 128);
  END IF;
END;
$$;

-- ------------------------------------------------------------
-- 2. State-machine guard trigger
-- Applied BEFORE the touch-updated_at trigger so NEW is still mutable.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_vendor_order_state_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Allow no-op status updates (same -> same) to pass without noise.
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  -- Valid transitions table (source -> allowed targets):
  --   pending     -> processing | failed | cancelled
  --   processing  -> fulfilled  | failed | cancelled
  --   fulfilled   -> refunded
  --   failed      -> pending     (admin manual retry only)
  --   cancelled   -> (terminal — no exits)
  --   refunded    -> (terminal — no exits)

  IF OLD.status = 'pending' AND NEW.status IN ('processing', 'failed', 'cancelled') THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'processing' AND NEW.status IN ('fulfilled', 'failed', 'cancelled') THEN
    -- Clear lock columns on any terminal-from-processing transition.
    NEW.locked_by    := NULL;
    NEW.locked_until := NULL;
    RETURN NEW;
  END IF;

  IF OLD.status = 'fulfilled' AND NEW.status = 'refunded' THEN
    RETURN NEW;
  END IF;

  -- Admin manual retry: failed -> pending resets control columns.
  IF OLD.status = 'failed' AND NEW.status = 'pending' THEN
    NEW.locked_by      := NULL;
    NEW.locked_until   := NULL;
    NEW.failure_reason := NULL;
    RETURN NEW;
  END IF;

  -- Everything else is illegal.
  RAISE EXCEPTION
    'vendor_orders: invalid status transition % -> % for order %',
    OLD.status, NEW.status, OLD.id
    USING ERRCODE = 'P0001';
END;
$$;

DROP TRIGGER IF EXISTS trg_vendor_order_state_guard ON vendor_orders;
CREATE TRIGGER trg_vendor_order_state_guard
  BEFORE UPDATE OF status ON vendor_orders
  FOR EACH ROW EXECUTE FUNCTION fn_vendor_order_state_guard();

-- ------------------------------------------------------------
-- 3. Reconciler indexes
-- ------------------------------------------------------------

-- HOT PATH: reconciler pop query.
-- Covers: status filter, next_attempt_at filter, ORDER BY created_at.
-- INCLUDE avoids a heap fetch for the columns the pop CTE needs to
-- read before doing the UPDATE join.
CREATE INDEX IF NOT EXISTS idx_vendor_orders_reconciler_pop
  ON vendor_orders (created_at ASC)
  INCLUDE (vendor_id, idempotency_key, quantity, unit_cost_usd)
  WHERE status = 'pending';

-- PARTIAL for next_attempt_at backoff filtering (non-NULL scheduled retries).
CREATE INDEX IF NOT EXISTS idx_vendor_orders_next_attempt
  ON vendor_orders (next_attempt_at ASC)
  WHERE status = 'pending' AND next_attempt_at IS NOT NULL;

-- STUCK LOCK SWEEP: find processing rows whose visibility timeout expired.
CREATE INDEX IF NOT EXISTS idx_vendor_orders_stuck_locks
  ON vendor_orders (locked_until ASC)
  WHERE status = 'processing' AND locked_until IS NOT NULL;

-- ------------------------------------------------------------
-- 4. vendor_rate_limits — persistent fallback when Cloudflare DO is down
-- ------------------------------------------------------------
-- One row per vendor per rolling window. The reconciler upserts here
-- before calling the vendor API so that cold starts don't lose the
-- in-flight request count.
CREATE TABLE IF NOT EXISTS vendor_rate_limits (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id      UUID        NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  window_start   TIMESTAMPTZ NOT NULL,
  window_seconds INT         NOT NULL DEFAULT 60 CHECK (window_seconds > 0),
  request_count  INT         NOT NULL DEFAULT 0  CHECK (request_count >= 0),
  -- ceiling is copied from vendors.rate_limit_rpm at window creation
  -- so a vendor config change doesn't retroactively break a live window.
  request_limit  INT         NOT NULL DEFAULT 60 CHECK (request_limit > 0),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_vendor_rate_limit_window
    UNIQUE (vendor_id, window_start, window_seconds)
);

CREATE INDEX IF NOT EXISTS idx_vendor_rate_limits_lookup
  ON vendor_rate_limits (vendor_id, window_start DESC);

-- Prune windows older than 24 h via pg_cron (add separately); the index
-- keeps point-in-time lookups fast while old rows are being deleted.

COMMENT ON TABLE vendor_rate_limits IS
  'Persistent per-vendor rate-limit counters. Primary store is Cloudflare DO; this table is the fallback when DO is unreachable and the authoritative record for audit.';

-- updated_at maintenance
DO $$
BEGIN
  DROP TRIGGER IF EXISTS trg_vendor_rate_limits_touch_updated_at ON vendor_rate_limits;
  CREATE TRIGGER trg_vendor_rate_limits_touch_updated_at
    BEFORE UPDATE ON vendor_rate_limits
    FOR EACH ROW EXECUTE FUNCTION fn_vendor_tables_touch_updated_at();
END;
$$;

-- RLS
ALTER TABLE vendor_rate_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vendor_rate_limits_service ON vendor_rate_limits;
CREATE POLICY vendor_rate_limits_service
  ON vendor_rate_limits FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS vendor_rate_limits_read ON vendor_rate_limits;
CREATE POLICY vendor_rate_limits_read
  ON vendor_rate_limits FOR SELECT TO authenticated
  USING (is_admin_or_viewer());

DROP POLICY IF EXISTS vendor_rate_limits_write ON vendor_rate_limits;
CREATE POLICY vendor_rate_limits_write
  ON vendor_rate_limits FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- ------------------------------------------------------------
-- 5. Stuck-lock sweeper helper function
-- Called by the reconciler at the top of each run, before the pop.
-- Resets orders that have been in 'processing' past their visibility
-- timeout back to 'pending' with exponential backoff on next_attempt_at.
-- Returns the count of rows reset so the caller can log it.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_release_stuck_vendor_orders()
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_count INT;
BEGIN
  -- Bypass the state-guard trigger: failed->pending is allowed,
  -- but processing->pending is NOT in the state machine (by design —
  -- direct processing->pending would be confusing in the audit log).
  -- We go processing->failed first, then the caller can retry.
  -- Actually: we reset directly to 'pending' here as a privileged
  -- internal operation. To avoid the trigger blocking us, we
  -- temporarily set a session variable the trigger can check.
  PERFORM set_config('app.internal_stuck_reset', 'true', true);

  WITH stuck AS (
    SELECT id FROM vendor_orders
    WHERE status = 'processing'
      AND locked_until < now()
    FOR UPDATE SKIP LOCKED
  )
  UPDATE vendor_orders vo
  SET
    status           = 'pending',
    locked_by        = NULL,
    locked_until     = NULL,
    failure_category = 'vendor_timeout',
    next_attempt_at  = now() + (
      -- Exponential backoff: 30s * 2^attempt_count, capped at 1 hour.
      least(
        interval '1 hour',
        make_interval(secs => 30 * power(2, least(attempt_count, 6))::int)
      )
    )
  FROM stuck
  WHERE vo.id = stuck.id;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  PERFORM set_config('app.internal_stuck_reset', 'false', true);
  RETURN v_count;
END;
$$;

-- Amend the state-guard trigger to allow the sweeper's privileged reset.
CREATE OR REPLACE FUNCTION fn_vendor_order_state_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  -- Privileged internal reset by fn_release_stuck_vendor_orders().
  -- processing -> pending allowed only when the session flag is set.
  IF OLD.status = 'processing' AND NEW.status = 'pending'
     AND current_setting('app.internal_stuck_reset', true) = 'true' THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'pending' AND NEW.status IN ('processing', 'failed', 'cancelled') THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'processing' AND NEW.status IN ('fulfilled', 'failed', 'cancelled') THEN
    NEW.locked_by    := NULL;
    NEW.locked_until := NULL;
    RETURN NEW;
  END IF;

  IF OLD.status = 'fulfilled' AND NEW.status = 'refunded' THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'failed' AND NEW.status = 'pending' THEN
    NEW.locked_by      := NULL;
    NEW.locked_until   := NULL;
    NEW.failure_reason := NULL;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'vendor_orders: invalid status transition % -> % for order %',
    OLD.status, NEW.status, OLD.id
    USING ERRCODE = 'P0001';
END;
$$;

REVOKE ALL ON FUNCTION fn_release_stuck_vendor_orders() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_release_stuck_vendor_orders() TO service_role;
