-- ============================================================
-- 050_wave23c_default_approval_manual.sql
-- Wave 23C-fix — make admin approval an EXPLICIT setting in DB.
--
-- User report 2026-04-29: "mọi user tele đều cần qua lớp duyệt mới
-- được dùng bot chưa". Wave 23B-bot-fix already changed the code
-- fallback to 'manual', but if an admin had toggled the Settings UI
-- to 'auto' the row sticks. This migration upserts an explicit
-- 'manual' default so the operator's intent is recorded in DB and
-- the code fallback is no longer the source of truth.
--
-- Idempotent: only inserts when missing; does NOT overwrite an
-- explicit existing value (admin can still flip to 'auto' from
-- Settings if they want open signup later).
-- ============================================================

INSERT INTO settings (key, value, description)
VALUES (
  'default_approval_mode',
  '{"value":"manual"}'::jsonb,
  'Wave 23C — Default approval mode for new Telegram users. '
  '"manual" = pending admin review (safe default). '
  '"auto" = instant active (open-signup, off by default).'
)
ON CONFLICT (key) DO NOTHING;
