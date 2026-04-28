-- ============================================================
-- 034_wave22d2_backfill_actor_names.sql
--
-- Wave 22D-2: backfill activity_logs.actor_display_name for rows
-- created BEFORE Wave 22D added the column (mig 032).
--
-- The column was added nullable in mig 032 — every row before that
-- shows NULL, which the /logs UI renders as "8-char-uuid…". Useless
-- for ops. This migration walks both admins and tele_users and
-- fills the column with the snapshot name "as it was at the time
-- of the original event".
--
-- IMPORTANT: this is point-in-time snapshot semantics. If an admin
-- renames themselves AFTER this backfill runs, the old log rows
-- still show the OLD name. That's intentional — audit logs must
-- be immutable. New rows created after Wave 22D-2 are populated
-- at insert time by lib/logger.ts:logActivity, also point-in-time.
--
-- Online safety: UPDATE … FROM is an in-place update (no rewrite,
-- no exclusive lock beyond per-row). Backfill is bounded by the
-- admins/tele_users table sizes joined against activity_logs. At
-- expected volumes (a few thousand admins + tele_users; ~1M logs)
-- this runs in single-digit seconds.
--
-- Idempotent: WHERE actor_display_name IS NULL means re-running is
-- a no-op for already-populated rows.
-- ============================================================

-- A. Admin actors — pull full_name (or email as fallback)
UPDATE activity_logs al
   SET actor_display_name = COALESCE(a.full_name, a.email)
  FROM admins a
 WHERE al.actor_type = 'admin'
   AND al.actor_id IS NOT NULL
   AND al.actor_id::uuid = a.id
   AND al.actor_display_name IS NULL;

-- B. Tele user actors — username, then first_name, then telegram_id
UPDATE activity_logs al
   SET actor_display_name = COALESCE(
        u.username,
        u.first_name,
        '@' || u.telegram_id::text
   )
  FROM tele_users u
 WHERE al.actor_type = 'tele_user'
   AND al.actor_id IS NOT NULL
   AND al.actor_id::uuid = u.id
   AND al.actor_display_name IS NULL;

-- C. Bot/system actors — fixed labels (no FK to resolve)
UPDATE activity_logs
   SET actor_display_name = 'System'
 WHERE actor_type = 'system'
   AND actor_display_name IS NULL;

UPDATE activity_logs
   SET actor_display_name = 'Telegram Bot'
 WHERE actor_type = 'bot'
   AND actor_display_name IS NULL;

-- D. Helpful comment so future operators understand the column
COMMENT ON COLUMN activity_logs.actor_display_name IS
    'Wave 22D point-in-time snapshot of the actor''s display name '
    '(admin.full_name / tele_user.username / static label for system+bot). '
    'Captured at insert time by lib/logger.ts; backfilled by mig 034 for '
    'rows older than Wave 22D. NEVER updated after the fact — audit logs '
    'are immutable history.';
