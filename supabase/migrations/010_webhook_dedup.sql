-- Webhook dedup table for Telegram update_ids
-- Prevents duplicate processing across Vercel cold starts
CREATE TABLE IF NOT EXISTS webhook_dedup (
  update_id BIGINT PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for efficient cleanup of old entries
CREATE INDEX IF NOT EXISTS idx_webhook_dedup_processed ON webhook_dedup(processed_at);

-- RLS: Only service role should access this table
ALTER TABLE webhook_dedup ENABLE ROW LEVEL SECURITY;
