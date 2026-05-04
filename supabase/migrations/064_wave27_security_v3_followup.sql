-- ============================================================
-- 064_wave27_security_v3_followup.sql
-- Wave 27 security v3 followup — defer items #3 + #4 from
-- security-reviewer agent's audit (PR #26 shipped #1, #2, #5-#8).
--
-- #3 + #4: SECURITY DEFINER mutation RPCs were granted to
--          `authenticated` even though they have NO call site
--          from authenticated client code (only from route
--          handlers via supabaseAdmin). Open `EXECUTE TO
--          authenticated` is a foot-gun — any logged-in admin
--          (even viewer-role) could call them via PostgREST and
--          bypass route-level auth.
--
-- Fix: REVOKE EXECUTE from authenticated, leave GRANT only to
-- service_role. This matches the actual call pattern (all routes
-- use supabaseAdmin = service_role) without introducing new
-- function-body changes that could regress existing flows.
--
-- Functions locked down:
--   - import_lot(UUID, JSONB, JSONB, UUID)
--   - safe_assign_proxy(UUID, UUID, UUID)
--   - smart_pick_proxy(TEXT, INTEGER) — if exists
--
-- The route handlers stay unchanged. If a future use case needs
-- one of these from the browser, the migration to authenticated
-- can be done deliberately with a proper is_admin() guard inside
-- the function body — at which point this REVOKE acts as the
-- "checkpoint" that forces the conversation.
--
-- Idempotent: REVOKE is no-op if grant already absent.
-- ============================================================

DO $$
BEGIN
  EXECUTE 'REVOKE EXECUTE ON FUNCTION import_lot(UUID, JSONB, JSONB, UUID) FROM authenticated';
EXCEPTION
  WHEN undefined_function THEN
    RAISE NOTICE 'import_lot signature drifted — please re-grep and patch manually';
  WHEN insufficient_privilege THEN NULL;
END $$;

DO $$
BEGIN
  EXECUTE 'REVOKE EXECUTE ON FUNCTION safe_assign_proxy(UUID, UUID, UUID) FROM authenticated';
EXCEPTION
  WHEN undefined_function THEN
    RAISE NOTICE 'safe_assign_proxy signature drifted';
  WHEN insufficient_privilege THEN NULL;
END $$;

-- smart_pick_proxy: signature unknown — try a few common shapes.
-- Each block fails silently if the sig doesn't exist.
DO $$
BEGIN
  EXECUTE 'REVOKE EXECUTE ON FUNCTION smart_pick_proxy(TEXT, INTEGER) FROM authenticated';
EXCEPTION
  WHEN undefined_function THEN NULL;
  WHEN insufficient_privilege THEN NULL;
END $$;

DO $$
BEGIN
  EXECUTE 'REVOKE EXECUTE ON FUNCTION smart_pick_proxy(TEXT) FROM authenticated';
EXCEPTION
  WHEN undefined_function THEN NULL;
  WHEN insufficient_privilege THEN NULL;
END $$;

-- Confirm service_role still has access (idempotent grant).
DO $$
BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION import_lot(UUID, JSONB, JSONB, UUID) TO service_role';
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

DO $$
BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION safe_assign_proxy(UUID, UUID, UUID) TO service_role';
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

COMMENT ON FUNCTION import_lot(UUID, JSONB, JSONB, UUID) IS
  'Wave 21B + 27 security v3 — atomic import + idempotency. EXECUTE granted to service_role ONLY (called by /api/proxies/import via supabaseAdmin). Authenticated direct call blocked by mig 064.';
