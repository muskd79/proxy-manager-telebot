-- ============================================================
-- 018_wave18b_security.sql
-- Wave 18B security hardening: remove secret material from the
-- settings table (RLS gap: viewer-role admin can SELECT) and add
-- AUP acceptance tracking on tele_users (vendor ToS requirement
-- for every downstream proxy reseller agreement).
-- ============================================================

-- 1) Delete secret keys from the settings table. These secrets now
--    live exclusively in environment variables (Vercel). Keeping
--    them in settings was a defense-in-depth gap: any viewer-role
--    admin could SELECT them via the settings RLS policy.
--    Safe to re-run (idempotent DELETE).
DELETE FROM settings
WHERE key IN (
  'telegram_bot_token',
  'telegram_webhook_secret'
);

-- 2) Track AUP (Acceptable Use Policy) acceptance per Telegram user.
--    Required by every major proxy vendor's reseller ToS before a
--    proxy can be distributed downstream. NULL = not accepted yet.
ALTER TABLE tele_users
  ADD COLUMN IF NOT EXISTS aup_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS aup_version     TEXT;

-- Index: fast lookup of users who have not yet accepted the current
-- AUP version (cron sweep + admin dashboard "pending AUP" counter).
CREATE INDEX IF NOT EXISTS idx_tele_users_aup_pending
  ON tele_users (aup_accepted_at)
  WHERE aup_accepted_at IS NULL AND is_deleted = false;

COMMENT ON COLUMN tele_users.aup_accepted_at IS
  'Timestamp of AUP acceptance via /start inline keyboard. NULL = not accepted yet; blocks proxy distribution.';
COMMENT ON COLUMN tele_users.aup_version IS
  'AUP document version accepted (e.g. "v1.0"). Rotated when the terms change so re-acceptance can be forced.';
