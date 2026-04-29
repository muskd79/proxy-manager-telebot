-- ============================================================
-- 042_wave23a_rls_initplan_fix.sql
-- Wave 23A — wrap is_admin()/is_admin_or_viewer() in (SELECT ...) so
-- Postgres caches the result as an InitPlan instead of re-running the
-- SECURITY DEFINER function once per row.
--
-- Pre-fix: SELECT … FROM proxies (10k rows) ran is_admin() 10k times,
-- each function call hitting admins table again. Audit DB-R1.
-- Post-fix: 1 InitPlan call per query.
--
-- All policies recreated via DROP + CREATE because Postgres has no
-- CREATE OR REPLACE POLICY. Wrapped in DO blocks so the migration
-- is idempotent if any policy was already manually fixed.
-- ============================================================

-- Drop old policies (idempotent — IF EXISTS)
DROP POLICY IF EXISTS admins_select_own       ON admins;
DROP POLICY IF EXISTS admins_select_all       ON admins;
DROP POLICY IF EXISTS admins_insert           ON admins;
DROP POLICY IF EXISTS admins_update           ON admins;
DROP POLICY IF EXISTS proxies_select          ON proxies;
DROP POLICY IF EXISTS proxies_insert          ON proxies;
DROP POLICY IF EXISTS proxies_update          ON proxies;
DROP POLICY IF EXISTS proxies_delete          ON proxies;
DROP POLICY IF EXISTS tele_users_select       ON tele_users;
DROP POLICY IF EXISTS tele_users_insert       ON tele_users;
DROP POLICY IF EXISTS tele_users_update       ON tele_users;
DROP POLICY IF EXISTS tele_users_delete       ON tele_users;
DROP POLICY IF EXISTS requests_select         ON proxy_requests;
DROP POLICY IF EXISTS requests_insert         ON proxy_requests;
DROP POLICY IF EXISTS requests_update         ON proxy_requests;
DROP POLICY IF EXISTS requests_delete         ON proxy_requests;
DROP POLICY IF EXISTS chat_select             ON chat_messages;
DROP POLICY IF EXISTS chat_insert             ON chat_messages;
DROP POLICY IF EXISTS chat_update             ON chat_messages;
DROP POLICY IF EXISTS chat_delete             ON chat_messages;
DROP POLICY IF EXISTS logs_select             ON activity_logs;
DROP POLICY IF EXISTS logs_insert             ON activity_logs;
DROP POLICY IF EXISTS settings_select         ON settings;
DROP POLICY IF EXISTS settings_insert         ON settings;
DROP POLICY IF EXISTS settings_update         ON settings;
DROP POLICY IF EXISTS settings_delete         ON settings;

-- ADMINS
CREATE POLICY admins_select_own ON admins
  FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()));

CREATE POLICY admins_select_all ON admins
  FOR SELECT TO authenticated
  USING ((SELECT is_admin_or_viewer()));

CREATE POLICY admins_insert ON admins
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT is_admin()));

CREATE POLICY admins_update ON admins
  FOR UPDATE TO authenticated
  USING ((SELECT is_admin()))
  WITH CHECK ((SELECT is_admin()));

-- PROXIES
CREATE POLICY proxies_select ON proxies
  FOR SELECT TO authenticated
  USING ((SELECT is_admin_or_viewer()));

CREATE POLICY proxies_insert ON proxies
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT is_admin()));

CREATE POLICY proxies_update ON proxies
  FOR UPDATE TO authenticated
  USING ((SELECT is_admin()))
  WITH CHECK ((SELECT is_admin()));

CREATE POLICY proxies_delete ON proxies
  FOR DELETE TO authenticated
  USING ((SELECT is_admin()));

-- TELE_USERS
CREATE POLICY tele_users_select ON tele_users
  FOR SELECT TO authenticated
  USING ((SELECT is_admin_or_viewer()));

CREATE POLICY tele_users_insert ON tele_users
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT is_admin()));

CREATE POLICY tele_users_update ON tele_users
  FOR UPDATE TO authenticated
  USING ((SELECT is_admin()))
  WITH CHECK ((SELECT is_admin()));

CREATE POLICY tele_users_delete ON tele_users
  FOR DELETE TO authenticated
  USING ((SELECT is_admin()));

-- PROXY_REQUESTS
CREATE POLICY requests_select ON proxy_requests
  FOR SELECT TO authenticated
  USING ((SELECT is_admin_or_viewer()));

CREATE POLICY requests_insert ON proxy_requests
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT is_admin()));

CREATE POLICY requests_update ON proxy_requests
  FOR UPDATE TO authenticated
  USING ((SELECT is_admin()))
  WITH CHECK ((SELECT is_admin()));

CREATE POLICY requests_delete ON proxy_requests
  FOR DELETE TO authenticated
  USING ((SELECT is_admin()));

-- CHAT_MESSAGES
CREATE POLICY chat_select ON chat_messages
  FOR SELECT TO authenticated
  USING ((SELECT is_admin_or_viewer()));

CREATE POLICY chat_insert ON chat_messages
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT is_admin()));

CREATE POLICY chat_update ON chat_messages
  FOR UPDATE TO authenticated
  USING ((SELECT is_admin()))
  WITH CHECK ((SELECT is_admin()));

CREATE POLICY chat_delete ON chat_messages
  FOR DELETE TO authenticated
  USING ((SELECT is_admin()));

-- ACTIVITY_LOGS
CREATE POLICY logs_select ON activity_logs
  FOR SELECT TO authenticated
  USING ((SELECT is_admin_or_viewer()));

CREATE POLICY logs_insert ON activity_logs
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT is_admin()));

-- SETTINGS
CREATE POLICY settings_select ON settings
  FOR SELECT TO authenticated
  USING ((SELECT is_admin_or_viewer()));

CREATE POLICY settings_insert ON settings
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT is_admin()));

CREATE POLICY settings_update ON settings
  FOR UPDATE TO authenticated
  USING ((SELECT is_admin()))
  WITH CHECK ((SELECT is_admin()));

CREATE POLICY settings_delete ON settings
  FOR DELETE TO authenticated
  USING ((SELECT is_admin()));
