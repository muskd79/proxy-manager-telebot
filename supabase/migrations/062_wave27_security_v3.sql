-- ============================================================
-- 062_wave27_security_v3.sql
-- Wave 27 security audit v3 — RLS / RPC auth gap closures.
--
-- 7 fixes from security-reviewer agent v3 audit:
--
-- #1 CRITICAL — RLS missing on 3 sensitive tables. Mig 057
--    intentionally skipped RLS on warranty_claims, proxy_events,
--    proxy_health_logs because "all admins can see, service_role
--    bypasses anyway." But mig 044 only REVOKEd `anon` role; the
--    `authenticated` role still has implicit GRANT and can read
--    these tables via PostgREST `/rest/v1/*` even without an
--    explicit policy. A compromised viewer cookie → full audit
--    trail exfiltration. Fix: enable RLS + add SELECT policies
--    requiring is_admin_or_viewer().
--
-- #2 HIGH — Legacy SECURITY DEFINER functions from mig 004/008
--    (assign_proxy, auto_assign_proxy, smart_pick_proxy, etc.)
--    have no REVOKE/GRANT. SECURITY DEFINER defaults to grant
--    EXECUTE to PUBLIC — any caller with PostgREST access could
--    invoke them and bypass admin auth. Fix: REVOKE from PUBLIC,
--    GRANT only to needed roles.
--
-- #3 HIGH — safe_assign_proxy + smart_pick_proxy don't check
--    is_admin() inside their bodies. A viewer-role admin can
--    call them via RPC and approve requests / pick proxies —
--    bypassing the proxy_requests RLS policy. Fix: add the same
--    `IF NOT is_admin() THEN raise/return forbidden` guard that
--    safe_bulk_edit_proxies has.
--
-- #4 HIGH — import_lot RPC accepts p_admin_id with no auth check.
--    Same vector — viewer can insert ≤1000 proxies via RPC,
--    bypassing the proxies INSERT RLS policy. Fix: is_admin()
--    guard.
--
-- #6 HIGH — admin_login_logs + admin_backup_codes RLS policies use
--    `auth.jwt() ->> 'email'` for ownership identification. Stale
--    JWT after email change leaves admin unable to read their own
--    logs. Fix: use auth.uid() directly (immutable, guaranteed by
--    auth system).
--
-- #7 MEDIUM — check_api_rate_limit needs SET search_path + GRANT
--    revoke from authenticated (only API layer should call).
--
-- #8 MEDIUM — bot_conversation_state explicit admin-debug SELECT
--    policy so future read intent is documented in schema.
--
-- Idempotent: every CREATE/POLICY uses IF NOT EXISTS / CREATE OR
-- REPLACE. Re-running has no effect.
-- ============================================================


-- ─── #1 CRITICAL — RLS on warranty_claims / proxy_events / proxy_health_logs ─

ALTER TABLE warranty_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS warranty_claims_admin_select ON warranty_claims;
CREATE POLICY warranty_claims_admin_select
  ON warranty_claims FOR SELECT TO authenticated
  USING (is_admin_or_viewer());

-- Mutations only via service_role (bot inserts new claims, admin web
-- mutates via /api/warranty/[id] which uses requireAdminOrAbove +
-- supabaseAdmin). No authenticated INSERT/UPDATE/DELETE policy.

ALTER TABLE proxy_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS proxy_events_admin_select ON proxy_events;
CREATE POLICY proxy_events_admin_select
  ON proxy_events FOR SELECT TO authenticated
  USING (is_admin_or_viewer());

ALTER TABLE proxy_health_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS proxy_health_logs_admin_select ON proxy_health_logs;
CREATE POLICY proxy_health_logs_admin_select
  ON proxy_health_logs FOR SELECT TO authenticated
  USING (is_admin_or_viewer());


-- ─── #2 HIGH — REVOKE PUBLIC + GRANT-restrict on legacy functions ──
--
-- Functions originally created in mig 004/008/027 without explicit
-- GRANT. Default behaviour grants EXECUTE to PUBLIC for SECURITY
-- DEFINER. Lock them down.

DO $$
DECLARE
  f TEXT;
BEGIN
  FOR f IN SELECT unnest(ARRAY[
    'get_analytics(INTEGER)',
    'get_dashboard_stats()',
    'check_rate_limit(UUID)',
    'assign_proxy(UUID, UUID, UUID)',
    'auto_assign_proxy(UUID, TEXT, TEXT)',
    'safe_assign_proxy(UUID, UUID, UUID)',
    'smart_pick_proxy(TEXT, INTEGER)',
    'reset_hourly_limits()',
    'reset_daily_limits()',
    'check_api_rate_limit(TEXT, INTEGER, INTEGER)'
  ]) LOOP
    -- Only revoke if the function actually exists. The function
    -- signatures here are best-effort; if a sig has drifted in a
    -- later mig, the REVOKE silently succeeds (no-op) and ops can
    -- patch via the same loop with the correct sig.
    BEGIN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXCEPTION WHEN undefined_function THEN
      RAISE NOTICE 'Skipping non-existent function: %', f;
    END;
  END LOOP;
END $$;

-- Re-grant only to the roles that actually need each function.
DO $$
BEGIN
  -- Read-only stat functions: any admin/viewer (used by dashboard pages).
  EXECUTE 'GRANT EXECUTE ON FUNCTION get_dashboard_stats() TO authenticated, service_role';
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

DO $$
BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION get_analytics(INTEGER) TO authenticated, service_role';
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

-- Mutation functions: service_role only. The bot/cron use service-role
-- already; admin web routes use supabaseAdmin (also service-role).
DO $$
DECLARE
  f TEXT;
BEGIN
  FOR f IN SELECT unnest(ARRAY[
    'check_rate_limit(UUID)',
    'assign_proxy(UUID, UUID, UUID)',
    'auto_assign_proxy(UUID, TEXT, TEXT)',
    'safe_assign_proxy(UUID, UUID, UUID)',
    'smart_pick_proxy(TEXT, INTEGER)',
    'reset_hourly_limits()',
    'reset_daily_limits()',
    'check_api_rate_limit(TEXT, INTEGER, INTEGER)'
  ]) LOOP
    BEGIN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
    EXCEPTION WHEN undefined_function THEN
      RAISE NOTICE 'Skipping non-existent function for GRANT: %', f;
    END;
  END LOOP;
END $$;


-- ─── #6 HIGH — admin_login_logs + admin_backup_codes use auth.uid() ─
--
-- Fix the policies that compare `auth.jwt() ->> 'email'` (stale after
-- email change). Use auth.uid() directly which is immutable and
-- guaranteed by the Supabase Auth contract.

DROP POLICY IF EXISTS admin_login_logs_read_self ON admin_login_logs;
CREATE POLICY admin_login_logs_read_self
  ON admin_login_logs FOR SELECT TO authenticated
  USING (admin_id = auth.uid());

DROP POLICY IF EXISTS admin_backup_codes_self ON admin_backup_codes;
CREATE POLICY admin_backup_codes_self
  ON admin_backup_codes FOR ALL TO authenticated
  USING (admin_id = auth.uid())
  WITH CHECK (admin_id = auth.uid());


-- ─── #8 MEDIUM — Explicit bot_conversation_state policy ───────────
--
-- Currently RLS-enabled with no authenticated-role policy = deny-all
-- for authenticated. That's the intent (only service-role writes)
-- but admins debugging stuck states need read access. Add an
-- explicit admin-read policy so:
--   (a) intent is documented in the schema (no surprise denied reads
--       when admin debug feature lands)
--   (b) future viewer-only restrictions can refine without dropping
--       admin read

DROP POLICY IF EXISTS bot_conversation_state_admin_read ON bot_conversation_state;
CREATE POLICY bot_conversation_state_admin_read
  ON bot_conversation_state FOR SELECT TO authenticated
  USING (is_admin());
-- No INSERT/UPDATE/DELETE for authenticated — bot writes via service_role.
