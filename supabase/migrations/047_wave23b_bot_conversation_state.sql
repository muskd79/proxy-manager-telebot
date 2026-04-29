-- ============================================================
-- 047_wave23b_bot_conversation_state.sql
-- Wave 23B-bot UX — DB-persisted conversation state for the
-- Telegram bot. Vercel runs serverless so in-memory Map state
-- evaporates between cold starts; we mirror VIA's bot_state
-- pattern (TABLES.BOT_STATE) and persist per-user step + context.
--
-- Schema kept minimal — only fields the proxy bot needs today.
-- TTL enforced at read time (30 min); a future cron can sweep.
-- ============================================================

CREATE TABLE IF NOT EXISTS bot_conversation_state (
  tele_user_id UUID PRIMARY KEY REFERENCES tele_users(id) ON DELETE CASCADE,
  step         TEXT NOT NULL DEFAULT 'idle',
  context      JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for the (rare) sweep cron later.
CREATE INDEX IF NOT EXISTS idx_bot_conversation_state_updated_at
  ON bot_conversation_state(updated_at)
  WHERE step <> 'idle';

-- RLS — service-role only (bot writes via supabaseAdmin).
ALTER TABLE bot_conversation_state ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'bot_conversation_state'
       AND policyname = 'service_role_all'
  ) THEN
    CREATE POLICY service_role_all
      ON bot_conversation_state
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

COMMENT ON TABLE bot_conversation_state IS
  'Wave 23B-bot — per-user Telegram bot conversation state. '
  'Step + JSON context. TTL 30 min at read time.';
