-- =========================================================
-- 014: Operational fixes - indexes, cascade, cleanup
-- =========================================================

-- 1. Indexes for cleanup cron performance (DELETE WHERE created_at < cutoff)
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at);

-- 2. Index for proxy expiry cron (WHERE status='assigned' AND expires_at < now)
CREATE INDEX IF NOT EXISTS idx_proxies_expiry ON proxies(expires_at)
  WHERE status = 'assigned' AND is_deleted = false AND expires_at IS NOT NULL;

-- 3. Trigger: When user is soft-deleted, revoke all their assigned proxies
CREATE OR REPLACE FUNCTION cascade_user_soft_delete()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_deleted = true AND OLD.is_deleted = false THEN
    -- Revoke all assigned proxies
    UPDATE proxies SET
      status = 'available',
      assigned_to = NULL,
      assigned_at = NULL,
      updated_at = now()
    WHERE assigned_to = NEW.id
      AND status = 'assigned'
      AND is_deleted = false;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tele_users_soft_delete_cascade ON tele_users;
CREATE TRIGGER tele_users_soft_delete_cascade
  AFTER UPDATE OF is_deleted ON tele_users
  FOR EACH ROW
  WHEN (NEW.is_deleted = true AND OLD.is_deleted = false)
  EXECUTE FUNCTION cascade_user_soft_delete();

-- 4. Trigger: When proxy is soft-deleted, clear assignment + update request
CREATE OR REPLACE FUNCTION cascade_proxy_soft_delete()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_deleted = true AND OLD.is_deleted = false THEN
    -- If proxy was assigned, update the proxy_request
    IF OLD.status = 'assigned' AND OLD.assigned_to IS NOT NULL THEN
      UPDATE proxy_requests SET
        status = 'cancelled',
        processed_at = now()
      WHERE proxy_id = OLD.id
        AND status IN ('approved', 'auto_approved')
        AND is_deleted = false;

      -- Decrement user usage
      UPDATE tele_users SET
        proxies_used_total = GREATEST(proxies_used_total - 1, 0),
        updated_at = now()
      WHERE id = OLD.assigned_to;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS proxies_soft_delete_cascade ON proxies;
CREATE TRIGGER proxies_soft_delete_cascade
  AFTER UPDATE OF is_deleted ON proxies
  FOR EACH ROW
  WHEN (NEW.is_deleted = true AND OLD.is_deleted = false)
  EXECUTE FUNCTION cascade_proxy_soft_delete();
