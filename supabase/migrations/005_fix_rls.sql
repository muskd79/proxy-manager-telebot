-- Fix is_admin function to use email instead of id
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM admins
    WHERE email = auth.email()
    AND is_active = true
    AND role IN ('super_admin', 'admin')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Fix is_admin_or_viewer function
CREATE OR REPLACE FUNCTION is_admin_or_viewer()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM admins
    WHERE email = auth.email()
    AND is_active = true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add helper to get admin role
CREATE OR REPLACE FUNCTION get_admin_role()
RETURNS TEXT AS $$
BEGIN
  RETURN (
    SELECT role FROM admins
    WHERE email = auth.email()
    AND is_active = true
    LIMIT 1
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update settings policies to only allow super_admin
DROP POLICY IF EXISTS "settings_admin_select" ON settings;
DROP POLICY IF EXISTS "settings_admin_insert" ON settings;
DROP POLICY IF EXISTS "settings_admin_update" ON settings;
DROP POLICY IF EXISTS "settings_admin_delete" ON settings;

CREATE POLICY "settings_read" ON settings
  FOR SELECT TO authenticated
  USING (is_admin_or_viewer());

CREATE POLICY "settings_write" ON settings
  FOR ALL TO authenticated
  USING (get_admin_role() = 'super_admin')
  WITH CHECK (get_admin_role() = 'super_admin');
