-- ============================================================
-- 003_create_rls.sql
-- Enable Row Level Security and create policies
-- ============================================================

-- ----------------------
-- Enable RLS on all tables
-- ----------------------
ALTER TABLE admins          ENABLE ROW LEVEL SECURITY;
ALTER TABLE proxies         ENABLE ROW LEVEL SECURITY;
ALTER TABLE tele_users      ENABLE ROW LEVEL SECURITY;
ALTER TABLE proxy_requests  ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages   ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings        ENABLE ROW LEVEL SECURITY;

-- ----------------------
-- Helper function: check if current user is an admin
-- ----------------------
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM admins
        WHERE id = auth.uid()
          AND is_active = true
          AND role IN ('super_admin', 'admin')
    );
$$;

-- ----------------------
-- Helper function: check if current user is any admin role (including viewer)
-- ----------------------
CREATE OR REPLACE FUNCTION is_admin_or_viewer()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM admins
        WHERE id = auth.uid()
          AND is_active = true
    );
$$;

-- ============================================================
-- ADMINS policies
-- ============================================================

-- Authenticated users can read their own admin row
CREATE POLICY admins_select_own ON admins
    FOR SELECT
    TO authenticated
    USING (id = auth.uid());

-- Admin users can read all admin rows
CREATE POLICY admins_select_all ON admins
    FOR SELECT
    TO authenticated
    USING (is_admin_or_viewer());

-- Admin users can insert/update admins
CREATE POLICY admins_insert ON admins
    FOR INSERT
    TO authenticated
    WITH CHECK (is_admin());

CREATE POLICY admins_update ON admins
    FOR UPDATE
    TO authenticated
    USING (is_admin())
    WITH CHECK (is_admin());

-- Service role has full access
CREATE POLICY admins_service_all ON admins
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================================
-- PROXIES policies
-- ============================================================

CREATE POLICY proxies_select ON proxies
    FOR SELECT
    TO authenticated
    USING (is_admin_or_viewer());

CREATE POLICY proxies_insert ON proxies
    FOR INSERT
    TO authenticated
    WITH CHECK (is_admin());

CREATE POLICY proxies_update ON proxies
    FOR UPDATE
    TO authenticated
    USING (is_admin())
    WITH CHECK (is_admin());

CREATE POLICY proxies_delete ON proxies
    FOR DELETE
    TO authenticated
    USING (is_admin());

CREATE POLICY proxies_service_all ON proxies
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================================
-- TELE_USERS policies
-- ============================================================

CREATE POLICY tele_users_select ON tele_users
    FOR SELECT
    TO authenticated
    USING (is_admin_or_viewer());

CREATE POLICY tele_users_insert ON tele_users
    FOR INSERT
    TO authenticated
    WITH CHECK (is_admin());

CREATE POLICY tele_users_update ON tele_users
    FOR UPDATE
    TO authenticated
    USING (is_admin())
    WITH CHECK (is_admin());

CREATE POLICY tele_users_delete ON tele_users
    FOR DELETE
    TO authenticated
    USING (is_admin());

CREATE POLICY tele_users_service_all ON tele_users
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================================
-- PROXY_REQUESTS policies
-- ============================================================

CREATE POLICY requests_select ON proxy_requests
    FOR SELECT
    TO authenticated
    USING (is_admin_or_viewer());

CREATE POLICY requests_insert ON proxy_requests
    FOR INSERT
    TO authenticated
    WITH CHECK (is_admin());

CREATE POLICY requests_update ON proxy_requests
    FOR UPDATE
    TO authenticated
    USING (is_admin())
    WITH CHECK (is_admin());

CREATE POLICY requests_delete ON proxy_requests
    FOR DELETE
    TO authenticated
    USING (is_admin());

CREATE POLICY requests_service_all ON proxy_requests
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================================
-- CHAT_MESSAGES policies
-- ============================================================

CREATE POLICY chat_select ON chat_messages
    FOR SELECT
    TO authenticated
    USING (is_admin_or_viewer());

CREATE POLICY chat_insert ON chat_messages
    FOR INSERT
    TO authenticated
    WITH CHECK (is_admin());

CREATE POLICY chat_update ON chat_messages
    FOR UPDATE
    TO authenticated
    USING (is_admin())
    WITH CHECK (is_admin());

CREATE POLICY chat_delete ON chat_messages
    FOR DELETE
    TO authenticated
    USING (is_admin());

CREATE POLICY chat_service_all ON chat_messages
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================================
-- ACTIVITY_LOGS policies
-- ============================================================

CREATE POLICY logs_select ON activity_logs
    FOR SELECT
    TO authenticated
    USING (is_admin_or_viewer());

CREATE POLICY logs_insert ON activity_logs
    FOR INSERT
    TO authenticated
    WITH CHECK (is_admin());

CREATE POLICY logs_service_all ON activity_logs
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================================
-- SETTINGS policies
-- ============================================================

CREATE POLICY settings_select ON settings
    FOR SELECT
    TO authenticated
    USING (is_admin_or_viewer());

CREATE POLICY settings_insert ON settings
    FOR INSERT
    TO authenticated
    WITH CHECK (is_admin());

CREATE POLICY settings_update ON settings
    FOR UPDATE
    TO authenticated
    USING (is_admin())
    WITH CHECK (is_admin());

CREATE POLICY settings_delete ON settings
    FOR DELETE
    TO authenticated
    USING (is_admin());

CREATE POLICY settings_service_all ON settings
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
