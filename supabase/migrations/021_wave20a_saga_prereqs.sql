-- ============================================================
-- 021_wave20a_saga_prereqs.sql
-- Wave 20A schema prerequisites for the purchase saga.
--
-- Contents:
--   1. vendor_orders saga columns (attempt_count, next_attempt_at,
--      locked_by, locked_until, failure_category, dlq_at)
--   2. Length CHECK on idempotency_key (bug found by db-reviewer:
--      unbounded text could bloat the unique index).
--   3. State-machine trigger enforcing valid status transitions
--      in SQL (defense-in-depth alongside the TS machine).
--   4. Reconciler hot-path partial indexes (pop query pattern).
--   5. FK index on vendor_renewal_schedule.vendor_order_id
--      (cascade delete was doing a sequential scan).
--   6. Length CHECK on vendor_webhook_events.signature.
--
-- All changes idempotent; safe to re-apply.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Saga columns on vendor_orders
-- ------------------------------------------------------------
ALTER TABLE vendor_orders
  ADD COLUMN IF NOT EXISTS attempt_count     INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS locked_by         TEXT,
  ADD COLUMN IF NOT EXISTS locked_until      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failure_category  TEXT,
  ADD COLUMN IF NOT EXISTS dlq_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error        TEXT;

COMMENT ON COLUMN vendor_orders.attempt_count IS
  'Number of times the reconciler has attempted this order. Bumped before each vendor call.';
COMMENT ON COLUMN vendor_orders.next_attempt_at IS
  'Earliest time at which the reconciler may pick up this order. NULL = ready now. Used for exponential backoff scheduling.';
COMMENT ON COLUMN vendor_orders.locked_by IS
  'Reconciler instance ID (deployId:invocationId) currently processing this order.';
COMMENT ON COLUMN vendor_orders.locked_until IS
  'Visibility timeout. If a reconciler crashes after claim, next run can force-claim after this expires.';
COMMENT ON COLUMN vendor_orders.dlq_at IS
  'Non-null when attempt_count exceeded the max and the order moved to dead-letter. Admin must manually retry or refund.';

-- ------------------------------------------------------------
-- 2. Length CHECK on idempotency_key (db-reviewer bug #1)
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_vendor_orders_idem_key_length'
  ) THEN
    ALTER TABLE vendor_orders
      ADD CONSTRAINT chk_vendor_orders_idem_key_length
      CHECK (char_length(idempotency_key) BETWEEN 1 AND 128);
  END IF;
END;
$$;

-- ------------------------------------------------------------
-- 3. State-machine trigger
-- ------------------------------------------------------------
-- Valid transitions matrix:
--   pending    -> processing | failed | cancelled
--   processing -> fulfilled  | failed | cancelled | pending (retry)
--   fulfilled  -> refunded   (otherwise terminal)
--   failed     -> pending    (admin manual retry)
--   cancelled  -> (terminal)
--   refunded   -> (terminal)
CREATE OR REPLACE FUNCTION fn_assert_vendor_order_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- No-op transitions are always allowed (e.g. updating attempt_count).
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'pending' AND NEW.status IN ('processing', 'failed', 'cancelled') THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'processing' AND NEW.status IN ('fulfilled', 'failed', 'cancelled', 'pending') THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'fulfilled' AND NEW.status = 'refunded' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'failed' AND NEW.status = 'pending' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'Invalid vendor_order transition: % -> %', OLD.status, NEW.status
    USING ERRCODE = 'P0001';
END;
$$;

DROP TRIGGER IF EXISTS trg_vendor_orders_transition ON vendor_orders;
CREATE TRIGGER trg_vendor_orders_transition
  BEFORE UPDATE OF status ON vendor_orders
  FOR EACH ROW
  EXECUTE FUNCTION fn_assert_vendor_order_transition();

-- ------------------------------------------------------------
-- 4. Reconciler hot-path indexes
-- ------------------------------------------------------------
-- Drain pop query shape:
--   SELECT id FROM vendor_orders
--   WHERE status = 'pending'
--     AND (next_attempt_at IS NULL OR next_attempt_at <= now())
--   ORDER BY created_at
--   LIMIT 50 FOR UPDATE SKIP LOCKED
CREATE INDEX IF NOT EXISTS idx_vendor_orders_pending_pop
  ON vendor_orders (created_at ASC)
  WHERE status = 'pending' AND dlq_at IS NULL;

-- Scheduled-retry branch: rows with next_attempt_at set, sorted by due time.
CREATE INDEX IF NOT EXISTS idx_vendor_orders_next_attempt
  ON vendor_orders (next_attempt_at ASC)
  WHERE status = 'pending' AND next_attempt_at IS NOT NULL AND dlq_at IS NULL;

-- Stuck-lock sweeper: reconcilers look for orders locked beyond their visibility timeout.
CREATE INDEX IF NOT EXISTS idx_vendor_orders_stuck_locks
  ON vendor_orders (locked_until ASC)
  WHERE status = 'processing' AND locked_until IS NOT NULL;

-- DLQ admin view.
CREATE INDEX IF NOT EXISTS idx_vendor_orders_dlq
  ON vendor_orders (dlq_at DESC)
  WHERE dlq_at IS NOT NULL;

-- ------------------------------------------------------------
-- 5. FK index on vendor_renewal_schedule (db-reviewer bug #4)
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_renewal_schedule_order
  ON vendor_renewal_schedule (vendor_order_id);

-- ------------------------------------------------------------
-- 6. Length CHECK on webhook event signature
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_webhook_signature_length'
  ) THEN
    ALTER TABLE vendor_webhook_events
      ADD CONSTRAINT chk_webhook_signature_length
      CHECK (signature IS NULL OR char_length(signature) <= 512);
  END IF;
END;
$$;

-- ------------------------------------------------------------
-- 7. Stuck-lock sweeper helper function
--    Reconciler calls this at the start of each run to free
--    orders whose workers crashed mid-processing.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_release_stuck_vendor_orders(p_max INTEGER DEFAULT 100)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_released INTEGER;
BEGIN
  -- Reset status back to pending so the next drain picks them up.
  -- Use the allowed processing -> pending transition in the state machine.
  WITH stuck AS (
    SELECT id FROM vendor_orders
    WHERE status = 'processing'
      AND locked_until IS NOT NULL
      AND locked_until < now()
    LIMIT p_max
    FOR UPDATE SKIP LOCKED
  )
  UPDATE vendor_orders o
    SET status       = 'pending',
        locked_by    = NULL,
        locked_until = NULL,
        last_error   = COALESCE(o.last_error, 'stuck_lock_recovered')
    FROM stuck
    WHERE o.id = stuck.id;

  GET DIAGNOSTICS v_released = ROW_COUNT;
  RETURN v_released;
END;
$$;

REVOKE ALL ON FUNCTION fn_release_stuck_vendor_orders(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_release_stuck_vendor_orders(INTEGER) TO service_role;
