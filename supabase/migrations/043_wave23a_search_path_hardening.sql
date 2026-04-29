-- ============================================================
-- 043_wave23a_search_path_hardening.sql
-- Wave 23A — set search_path = public on every SECURITY DEFINER
-- function in schema public that does not already have it.
--
-- Why: without an explicit search_path, an attacker who can create
-- a table in another schema can shadow `public.admins` and trick
-- is_admin() into returning true. CWE-1336 search-path injection.
--
-- Approach: single auto-loop. Earlier draft used hard-coded
-- `ALTER FUNCTION foo(UUID)` per helper, which broke when a
-- function existed with a different signature on prod (e.g.
-- increment_login_count). The loop introspects pg_proc and only
-- touches functions that need it, so it is safe + idempotent
-- regardless of overload signatures.
-- ============================================================

DO $$
DECLARE
  v_oid OID;
BEGIN
  FOR v_oid IN
    SELECT p.oid
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prosecdef = true
       AND (
         p.proconfig IS NULL
         OR NOT EXISTS (
           SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'
         )
       )
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public', v_oid::regprocedure);
  END LOOP;
END $$;
