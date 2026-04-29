-- ============================================================
-- 045_wave23a_fk_indexes.sql  (re-applied with 043 fix)
-- Wave 23A — index foreign-key columns that lack a covering index.
-- Without these, every cascade-delete on the parent and every join
-- query on the FK does a sequential scan of the child table.
--
-- Audit finding DB-R6/R7.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_proxy_requests_proxy_id
  ON proxy_requests (proxy_id)
  WHERE proxy_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_proxy_requests_approved_by
  ON proxy_requests (approved_by)
  WHERE approved_by IS NOT NULL;

-- Recent-tab composite (status + processed_at) — used by /requests
-- "recent activity" tab in the admin UI.
CREATE INDEX IF NOT EXISTS idx_proxy_requests_processed_at
  ON proxy_requests (status, processed_at DESC)
  WHERE is_deleted = false AND processed_at IS NOT NULL;
