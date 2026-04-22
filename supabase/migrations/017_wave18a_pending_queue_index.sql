-- ============================================================
-- 017_wave18a_pending_queue_index.sql
-- WHY: The admin dashboard's most frequent query is
--   SELECT * FROM proxy_requests
--   WHERE status = 'pending' AND is_deleted = false
--   ORDER BY created_at DESC
-- Existing idx_requests_status (mig 002) covers status only; the composite
-- idx_requests_user_status_date (mig 008) requires the user filter to help.
-- Neither efficiently serves the pending-admin-queue query, so every admin
-- dashboard page currently does a partial heap scan. This adds the partial
-- index that is exactly sized for the hot path.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_requests_pending_queue
  ON proxy_requests (status, created_at DESC)
  WHERE is_deleted = false;

COMMENT ON INDEX idx_requests_pending_queue IS
  'Serves admin pending-queue pagination: WHERE status=''pending'' AND is_deleted=false ORDER BY created_at DESC.';
