-- ============================================================
-- 032: Wave 22D activity_logs hardening
--
-- Three independent changes to the audit log table:
--   A. Generated tsvector column + GIN index for full-text search
--      (replaces the broken `details::text ILIKE` path in /api/logs).
--   B. Drop redundant idx_activity_logs_created_at created in
--      migration 014 — idx_logs_created from migration 002 already
--      satisfies range scans regardless of sort direction.
--   D. Denormalised actor_display_name column so the /logs UI can
--      stop showing useless 8-char actor_id slices. Captures the
--      name AT THE TIME OF THE EVENT (point-in-time correctness;
--      a later admin rename does not rewrite history).
--
-- Online-safety notes:
--   - ADD COLUMN ... GENERATED ALWAYS AS ... STORED rewrites the
--     table (ACCESS EXCLUSIVE). The current table at 22D ship time
--     is well under 1M rows, so the rewrite is single-digit seconds.
--     If you hit this migration on a >5M row table, switch to a
--     multi-step (add nullable -> backfill in batches -> convert
--     to GENERATED) pattern.
--   - CREATE INDEX CONCURRENTLY and DROP INDEX CONCURRENTLY are
--     safe online but MUST run outside an explicit transaction.
--     Supabase dashboard "Run SQL" executes statements independently
--     so this file is fine; if running via psql in a script, do not
--     wrap in BEGIN/COMMIT.
-- ============================================================

-- A. Full-text search column + GIN index
-- Use 'simple' config (no language stemming) so Vietnamese names
-- and proxy hosts are not lemmatised away.
ALTER TABLE activity_logs
  ADD COLUMN IF NOT EXISTS search_text tsvector
    GENERATED ALWAYS AS (
      to_tsvector('simple',
        coalesce(details->>'reason',     '') || ' ' ||
        coalesce(details->>'username',   '') || ' ' ||
        coalesce(details->>'proxy_id',   '') || ' ' ||
        coalesce(details->>'host',       '') || ' ' ||
        coalesce(details->>'tele_user_id', '') || ' ' ||
        coalesce(action,                 '') || ' ' ||
        coalesce(resource_type,          '') || ' ' ||
        coalesce(resource_id,            '')
      )
    ) STORED;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activity_logs_search
  ON activity_logs USING GIN (search_text);

-- B. Drop redundant created_at index added in migration 014
-- (idx_logs_created from migration 002 satisfies range scans both
-- directions; b-tree indexes are bidirectional)
DROP INDEX CONCURRENTLY IF EXISTS idx_activity_logs_created_at;

-- D. Actor display name (point-in-time, denormalised)
-- Append-only column; existing rows get NULL. The /logs UI falls
-- back to the truncated actor_id for old rows.
ALTER TABLE activity_logs
  ADD COLUMN IF NOT EXISTS actor_display_name TEXT;
