-- Composite index for cursor-based pagination on proxies
-- Enables O(1) keyset pagination using created_at + id
CREATE INDEX IF NOT EXISTS idx_proxies_created_at_id
  ON proxies(created_at DESC, id)
  WHERE is_deleted = false;
