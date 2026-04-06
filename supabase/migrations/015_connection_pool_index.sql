-- Migration: Composite index for cursor-based pagination on proxies
-- Supports efficient DESC ordering with soft-delete filter
CREATE INDEX IF NOT EXISTS idx_proxies_created_desc
  ON proxies(created_at DESC, id)
  WHERE is_deleted = false;
