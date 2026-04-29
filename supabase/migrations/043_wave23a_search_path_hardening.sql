-- ============================================================
-- 043_wave23a_search_path_hardening.sql
-- Wave 23A — set search_path = public on legacy SECURITY DEFINER
-- helpers. Without this, an attacker who can create a table in another
-- schema can shadow `public.admins` and trick is_admin() into returning
-- true. CWE-1336 (PostgreSQL search-path injection).
--
-- Newer functions (mig 027+, 030+, 031+) already SET search_path =
-- public in their definitions. This migration retrofits the older ones
-- declared in mig 003-010 that did not.
--
-- ALTER FUNCTION ... SET is reversible and idempotent; safe to re-run.
-- ============================================================

ALTER FUNCTION is_admin()              SET search_path = public;
ALTER FUNCTION is_admin_or_viewer()    SET search_path = public;

-- get_admin_role (mig 005) — defined as SECURITY DEFINER, no search_path
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_admin_role') THEN
    EXECUTE 'ALTER FUNCTION get_admin_role() SET search_path = public';
  END IF;
END $$;

-- decrement_usage (mig 009)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'decrement_usage') THEN
    EXECUTE 'ALTER FUNCTION decrement_usage(UUID) SET search_path = public';
  END IF;
END $$;

-- increment_login_count (mig 016)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'increment_login_count') THEN
    EXECUTE 'ALTER FUNCTION increment_login_count(UUID) SET search_path = public';
  END IF;
END $$;

-- get_dashboard_stats (varied signature; loop over all overloads)
DO $$
DECLARE
  v_oid OID;
BEGIN
  FOR v_oid IN
    SELECT oid FROM pg_proc WHERE proname = 'get_dashboard_stats'
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public', v_oid::regprocedure);
  END LOOP;
END $$;

-- Older bulk RPCs that may exist without search_path
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
       AND NOT EXISTS (
         SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'
       )
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public', v_oid::regprocedure);
  END LOOP;
END $$;
