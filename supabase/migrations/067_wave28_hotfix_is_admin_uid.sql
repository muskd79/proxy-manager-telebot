-- ============================================================
-- 067_wave28_hotfix_is_admin_uid.sql
-- Wave 28 HOTFIX — is_admin() / is_admin_or_viewer() / get_admin_role()
-- read email from auth.users via auth.uid() instead of auth.email().
--
-- Why this is a critical hotfix
-- -----------------------------
-- The user reported TWO production bugs simultaneously:
--   1. "mất hết proxy" — /proxies list returns nothing
--   2. "tạo danh mục không được" — POST /api/categories returns 500
--
-- Both share a single root cause:
--
--   `is_admin()` (mig 005) reads admin email via `auth.email()`, which
--   is a wrapper around `auth.jwt() ->> 'email'`. Telegram /  Supabase
--   refresh tokens encode the email AT SIGN-IN TIME. If the admin's
--   email was changed in `admins` table mid-session, OR if the JWT
--   was issued with a slightly different casing/whitespace than what
--   was later normalised in `admins.email`, OR if the admin signed in
--   via passwordless and the JWT's `email` claim is missing entirely,
--   `auth.email()` returns the stale/missing value.
--
--   Effect: `is_admin()` returns FALSE for a logged-in admin →
--   - SELECT on `proxies` blocked (policy uses `is_admin_or_viewer()`)
--     → "mất hết proxy"
--   - INSERT on `proxy_categories` blocked (policy uses `is_admin()`)
--     → "tạo danh mục không được"
--
-- Fix
-- ---
-- Rewrite the three helper functions to fetch email from `auth.users`
-- using `auth.uid()` (which IS immutable across token refreshes,
-- guaranteed by the Supabase Auth contract). This makes the admin
-- resolution path independent of JWT freshness.
--
-- `admins.id` does NOT equal `auth.users.id` in this project (admins
-- table was seeded independently of Supabase Auth user IDs — see
-- `scripts/seed-test-admin.mjs`). We continue to link by email; we
-- just read the canonical email from `auth.users` instead of the JWT.
--
-- Idempotent — `CREATE OR REPLACE` everywhere.
-- ============================================================


-- ─── 1. is_admin() ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid   UUID;
  v_email TEXT;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Wave 28 hotfix — fetch the canonical email from auth.users
  -- so a stale JWT email claim doesn't lock the admin out.
  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
  IF v_email IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM admins
    WHERE email = v_email
      AND is_active = true
      AND role IN ('super_admin', 'admin')
  );
END;
$$;


-- ─── 2. is_admin_or_viewer() ─────────────────────────────────
CREATE OR REPLACE FUNCTION is_admin_or_viewer()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid   UUID;
  v_email TEXT;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
  IF v_email IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM admins
    WHERE email = v_email
      AND is_active = true
  );
END;
$$;


-- ─── 3. get_admin_role() ─────────────────────────────────────
CREATE OR REPLACE FUNCTION get_admin_role()
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid   UUID;
  v_email TEXT;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
  IF v_email IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN (
    SELECT role::TEXT FROM admins
    WHERE email = v_email
      AND is_active = true
    LIMIT 1
  );
END;
$$;


-- ─── 4. Diagnostic helper: who_am_i() ────────────────────────
-- New SECURITY DEFINER function admins / devs can call from the
-- Supabase SQL editor while logged in via the dashboard. Returns
-- exactly the values our policies see, so future "lockout" reports
-- can be triaged in 30 seconds without code reading.
--
-- Returns one row even when not logged in (with NULLs).
CREATE OR REPLACE FUNCTION who_am_i()
RETURNS TABLE (
  uid                UUID,
  jwt_email          TEXT,
  auth_users_email   TEXT,
  admins_email       TEXT,
  admins_id          UUID,
  is_active          BOOLEAN,
  role               TEXT,
  is_admin_result    BOOLEAN,
  is_viewer_result   BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_email TEXT;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
  RETURN QUERY
    SELECT
      v_uid,
      auth.email(),
      v_email,
      a.email,
      a.id,
      a.is_active,
      a.role::TEXT,
      is_admin(),
      is_admin_or_viewer()
    FROM admins a
    WHERE a.email = v_email
    UNION ALL
    -- If no admins row, still return a row with NULLs in admin columns.
    SELECT v_uid, auth.email(), v_email, NULL, NULL, NULL, NULL, FALSE, FALSE
    WHERE NOT EXISTS (SELECT 1 FROM admins a WHERE a.email = v_email)
    LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION who_am_i() TO authenticated;
COMMENT ON FUNCTION who_am_i() IS
  'Wave 28 — diagnostic helper. From the Supabase SQL editor (or any
   authenticated session) call SELECT * FROM who_am_i() to see why
   your is_admin() / is_admin_or_viewer() returned its current value.
   Read-only, surfaces nothing sensitive beyond what the caller already
   has access to.';
