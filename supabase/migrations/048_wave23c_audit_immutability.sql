-- ============================================================
-- 048_wave23c_audit_immutability.sql
-- Wave 23C — append-only guard on activity_logs.
--
-- Reason: forensic trail must be tamper-evident. Pre-fix any admin
-- with the service-role key could UPDATE/DELETE rows to cover
-- their tracks (no constraint, only RLS — and service_role bypasses
-- RLS). This trigger raises EXCEPTION on UPDATE/DELETE so even the
-- service role hits a hard block at the engine level.
--
-- Insertion remains free (admins, the bot, cron all log).
-- Hard-purge for retention is allowed via a SECURITY DEFINER RPC
-- (separately migrated in Wave 25 retention work) which bumps a
-- session GUC the trigger checks first.
-- ============================================================

CREATE OR REPLACE FUNCTION activity_logs_immutability_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Allow purge by a future retention RPC that opts in via
  -- `SET LOCAL app.activity_logs_purge = on;`
  IF current_setting('app.activity_logs_purge', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'activity_logs is append-only (Wave 23C). UPDATE/DELETE blocked.'
    USING ERRCODE = 'P0001';
END $$;

DROP TRIGGER IF EXISTS trg_activity_logs_no_update ON activity_logs;
CREATE TRIGGER trg_activity_logs_no_update
  BEFORE UPDATE ON activity_logs
  FOR EACH ROW EXECUTE FUNCTION activity_logs_immutability_guard();

DROP TRIGGER IF EXISTS trg_activity_logs_no_delete ON activity_logs;
CREATE TRIGGER trg_activity_logs_no_delete
  BEFORE DELETE ON activity_logs
  FOR EACH ROW EXECUTE FUNCTION activity_logs_immutability_guard();

COMMENT ON FUNCTION activity_logs_immutability_guard IS
  'Wave 23C — refuses UPDATE/DELETE on activity_logs unless caller opts in '
  'via app.activity_logs_purge GUC (reserved for retention cron RPC).';
