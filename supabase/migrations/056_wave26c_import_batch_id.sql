-- ============================================================
-- 056_wave26c_import_batch_id.sql
-- Wave 26-C (gap 5.1 + 7.1) — track which proxies came from
-- which import batch.
--
-- User feedback: after a 200-row import the admin lands back on
-- /proxies and has no way to find "the rows I just imported" —
-- they're scattered into the global list, sorted by created_at,
-- mixed with older inventory. Currently the only way to verify
-- the batch is to eyeball host:port one by one. With 200+ rows
-- that's not viable.
--
-- Fix:
--   1. Add `import_batch_id UUID NULL` to proxies. The import
--      route already mints a `crypto.randomUUID()` as `importId`
--      (api/proxies/import/route.ts:59) — but it only logs that
--      ID into activity_logs.details, never persists it on the
--      proxy rows. Now: every row imported in the same call
--      shares the same import_batch_id, and admins can filter
--      /proxies by it (`?import_batch_id=<id>`) to see the batch.
--
--   2. Add an index on `(import_batch_id)` so the filter is fast
--      even with hundreds of thousands of proxies. Partial index
--      on `WHERE import_batch_id IS NOT NULL` keeps the index
--      small for the historical (NULL) majority of rows.
--
-- Backfill: existing rows stay NULL — they pre-date Wave 26-C
-- batch tracking and we have no way to reconstruct which batch
-- they belonged to. Future imports populate the column.
--
-- Note: not a foreign key. There is no `proxy_import_batches`
-- table — the ID is opaque, used only for SELECT filtering.
-- A dedicated batches table is a future feature (would surface
-- "Import history" page); for now the activity_logs.details
-- already records {importId, total, imported, failed, skipped}
-- per import call so admins can cross-reference.
-- ============================================================

ALTER TABLE proxies
  ADD COLUMN IF NOT EXISTS import_batch_id UUID NULL;

COMMENT ON COLUMN proxies.import_batch_id IS
  'Wave 26-C — opaque UUID shared by all rows from one /api/proxies/import call. NULL for rows pre-dating Wave 26-C or for proxies created via single-add /api/proxies POST.';

CREATE INDEX IF NOT EXISTS proxies_import_batch_id_idx
  ON proxies (import_batch_id)
  WHERE import_batch_id IS NOT NULL;
