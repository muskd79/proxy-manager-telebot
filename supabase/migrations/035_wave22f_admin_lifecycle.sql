-- ============================================================
-- 035_wave22f_admin_lifecycle.sql
--
-- Wave 22F: deep admin management — password/email/2FA/telegram
-- self-service + super_admin force-management of others.
--
-- Studies VIA project's admin system (sibling). Adopts the strong
-- patterns: backup codes (hashed + salted), login history,
-- per-action audit, point-in-time snapshots. Avoids VIA's bloat
-- (multi-tenant org isolation — out of scope for now).
--
-- Three additions:
--   A. admins table extension     — totp + email-change + login-tracking columns
--   B. admin_backup_codes table   — 8 hashed+salted codes per admin for 2FA recovery
--   C. admin_login_logs table     — login/logout/failed attempts with IP + UA
-- ============================================================

-- ------------------------------------------------------------
-- A. admins table extension
-- ------------------------------------------------------------
ALTER TABLE admins
  -- 2FA — Supabase Auth MFA stores the TOTP secret in auth.mfa_factors,
  -- so we don't duplicate it. We just track enrollment timestamp + the
  -- factor id for fast "is 2FA on?" checks without hitting auth schema.
  ADD COLUMN IF NOT EXISTS totp_factor_id    UUID,
  ADD COLUMN IF NOT EXISTS totp_enabled_at   TIMESTAMPTZ,
  -- Password rotation — track when current password was set so the
  -- /profile UI can warn about stale passwords + enforce policy later.
  ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ DEFAULT NOW(),
  -- Email-change flow — store the pending new email until Supabase
  -- Auth confirms. UI shows "pending: <email> — check your inbox".
  ADD COLUMN IF NOT EXISTS pending_email      TEXT,
  ADD COLUMN IF NOT EXISTS pending_email_at   TIMESTAMPTZ,
  -- Phone (used for 2FA SMS fallback some day; not required now).
  ADD COLUMN IF NOT EXISTS phone              TEXT,
  -- Lockout — ops can manually freeze an account without deactivating.
  ADD COLUMN IF NOT EXISTS locked_until       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lockout_reason     TEXT;

-- ------------------------------------------------------------
-- B. admin_backup_codes — 2FA recovery codes
--
-- 8 codes generated at 2FA-verify time; each is hashed (sha256) +
-- salted before storage. Plain-text shown ONCE in the response;
-- users save them somewhere safe.
--
-- A code is single-use: `used_at` set on consumption.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_backup_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    UUID NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  code_hash   TEXT NOT NULL,
  salt        TEXT NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_backup_codes_admin
  ON admin_backup_codes (admin_id)
  WHERE used_at IS NULL;

COMMENT ON TABLE admin_backup_codes IS
  'Wave 22F: 2FA recovery codes. Hashed sha256(code || salt). Single-use; '
  'used_at = NULL means available. Regenerate via POST /api/profile/2fa/backup-codes '
  '(with current password gate). All codes are deleted when 2FA is disabled.';

-- ------------------------------------------------------------
-- C. admin_login_logs — append-only login history
--
-- Existing admins.last_login_at gets the LATEST event; this table
-- gives the full history for /profile -> Sessions tab.
--
-- We log: login (success), logout (manual), failed_login (wrong pass).
-- Failed-login attempts inform automatic lockout policy if we add it
-- later (no auto-lockout in this wave; ops triggers via locked_until).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_login_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id     UUID REFERENCES admins(id) ON DELETE SET NULL,
  -- Denormalised email so we can record FAILED-LOGIN attempts even
  -- when no admin row matches (e.g. attacker probing). admin_id stays
  -- NULL for those rows.
  email        TEXT NOT NULL,
  action       TEXT NOT NULL CHECK (action IN ('login', 'logout', 'failed_login', 'session_revoked', 'password_changed', '2fa_enabled', '2fa_disabled')),
  ip_address   TEXT,
  user_agent   TEXT,
  details      JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_login_logs_admin_created
  ON admin_login_logs (admin_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_login_logs_email_action
  ON admin_login_logs (email, action, created_at DESC);

COMMENT ON TABLE admin_login_logs IS
  'Wave 22F: per-event admin auth history. Append-only. admins.last_login_at '
  'is a denormalised cache of the most-recent login row here. Failed logins '
  'with no matching admin still log a row (admin_id NULL) for incident response.';

-- ------------------------------------------------------------
-- D. RLS — admin_backup_codes is sensitive
-- ------------------------------------------------------------
ALTER TABLE admin_backup_codes ENABLE ROW LEVEL SECURITY;

-- Admins can read/write only their own codes via the API. The API
-- uses supabaseAdmin (service-role) so RLS is bypassed there.
-- This RLS exists as defence-in-depth in case a viewer-role admin
-- ever tries to query the table directly via the dashboard.
DROP POLICY IF EXISTS admin_backup_codes_self ON admin_backup_codes;
CREATE POLICY admin_backup_codes_self ON admin_backup_codes
  FOR ALL TO authenticated
  USING (
    admin_id IN (
      SELECT id FROM admins WHERE email = auth.jwt() ->> 'email'
    )
  )
  WITH CHECK (
    admin_id IN (
      SELECT id FROM admins WHERE email = auth.jwt() ->> 'email'
    )
  );

-- admin_login_logs: any logged-in admin can read their own log;
-- no-one can write directly (only the API via supabaseAdmin).
ALTER TABLE admin_login_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_login_logs_read_self ON admin_login_logs;
CREATE POLICY admin_login_logs_read_self ON admin_login_logs
  FOR SELECT TO authenticated
  USING (
    admin_id IN (
      SELECT id FROM admins WHERE email = auth.jwt() ->> 'email'
    )
  );
