-- Wave 25-pre4 (Pass 7.A) — drop the AUP gate columns.
--
-- Pre-fix `tele_users.aup_accepted_at` + `aup_version` were added in
-- migration 018_wave18b_security.sql to gate users behind an
-- "Accept policy" tap before they could /getproxy. Per user request
-- 2026-04-29 ("bỏ đoạn chấp nhận chính sách đi") the gate was
-- removed in Wave 23C-fix; the AUP file was moved to
-- src/lib/telegram/_deprecated/aup.ts in Wave 25-pre3.
--
-- These columns are now dead-data: zero callers in the live tree
-- (verified via grep before this migration ships). Drop the columns
-- + the partial index that was created in mig 018:30.
--
-- Tracked in docs/decision-log.md#aup-cleanup.

DROP INDEX IF EXISTS idx_tele_users_aup_accepted_at;

ALTER TABLE tele_users
  DROP COLUMN IF EXISTS aup_accepted_at,
  DROP COLUMN IF EXISTS aup_version;
