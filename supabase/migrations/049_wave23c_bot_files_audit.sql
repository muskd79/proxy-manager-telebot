-- ============================================================
-- 049_wave23c_bot_files_audit.sql
-- Wave 23C — audit table for files the bot sends to users.
--
-- Reason: bulk proxy assignments deliver as .txt attachments
-- (sendTelegramDocument) but we kept no record. If a user disputes
-- "I never got the file" we have nothing to show. VIA project ships
-- a bot_files table for this; we port a slimmed shape.
--
-- Service-role-only RLS. INSERT-only from app code (no immutability
-- trigger here yet — keep it light; Wave 25 may add one).
-- ============================================================

CREATE TABLE IF NOT EXISTS bot_files (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tele_user_id    UUID NOT NULL REFERENCES tele_users(id) ON DELETE RESTRICT,
  filename        TEXT NOT NULL,
  size_bytes      INTEGER NOT NULL,
  /** Reason / domain for this delivery: "bulk_assign", "warranty", etc. */
  kind            TEXT NOT NULL,
  /** Free-form context for the delivery (request_id, batch_id, count, …). */
  context         JSONB NOT NULL DEFAULT '{}'::jsonb,
  /** Telegram message_id of the document, if known. NULL if API failed. */
  telegram_message_id BIGINT,
  delivered_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bot_files_tele_user_id_delivered_at
  ON bot_files(tele_user_id, delivered_at DESC);

CREATE INDEX IF NOT EXISTS idx_bot_files_kind
  ON bot_files(kind);

ALTER TABLE bot_files ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'bot_files'
       AND policyname = 'service_role_all'
  ) THEN
    CREATE POLICY service_role_all
      ON bot_files
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

COMMENT ON TABLE bot_files IS
  'Wave 23C — audit log for files the Telegram bot delivers to users '
  '(bulk proxy txt attachments today; warranty payouts later).';
