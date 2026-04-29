-- ============================================================
-- 044_wave23a_anon_revoke.sql
-- Wave 23A — defense in depth: revoke anon role grants on the public
-- schema and explicitly deny on rate-limit / dedup tables.
--
-- Supabase by default grants USAGE on schema public to anon. RLS is the
-- primary defense, but a missing policy or service-role-bypass slip
-- elsewhere should not expose data to unauthenticated callers. Revoke
-- everything anon could ever need; if the public site needs an
-- explicit anon read later, add a targeted GRANT.
-- ============================================================

REVOKE ALL ON SCHEMA public FROM anon;
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon;

-- Explicit deny on internal-only tables (no public path needs these)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='webhook_dedup') THEN
    EXECUTE 'ALTER TABLE webhook_dedup ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE ALL ON webhook_dedup FROM anon, authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='api_rate_limits') THEN
    EXECUTE 'REVOKE ALL ON api_rate_limits FROM anon, authenticated';
  END IF;
END $$;

-- Default privileges so future objects don't accidentally grant anon
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon;
