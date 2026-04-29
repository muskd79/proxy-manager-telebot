-- ============================================================
-- 046_wave23a_cascade_to_restrict.sql
-- Wave 23A — change ON DELETE CASCADE → RESTRICT on FKs that
-- would nuke audit-relevant history.
--
-- Pre-fix: hard-deleting a tele_users row also deleted every
-- proxy_requests + chat_messages row referencing it. That's
-- audit trail destruction. Soft-delete (is_deleted = true) is
-- the supported path; hard-delete should now error with FK
-- violation, forcing the caller to soft-delete first.
--
-- Idempotent: skips when the FK is already RESTRICT.
-- ============================================================

DO $$
DECLARE
  v_constraint TEXT;
  v_action     CHAR;
BEGIN
  -- proxy_requests.tele_user_id
  SELECT con.conname, con.confdeltype
    INTO v_constraint, v_action
    FROM pg_constraint con
    JOIN pg_class child ON child.oid = con.conrelid
    JOIN pg_class parent ON parent.oid = con.confrelid
   WHERE child.relname = 'proxy_requests'
     AND parent.relname = 'tele_users'
     AND con.contype = 'f'
   LIMIT 1;
  IF v_constraint IS NOT NULL AND v_action <> 'r' THEN
    EXECUTE format('ALTER TABLE proxy_requests DROP CONSTRAINT %I', v_constraint);
    EXECUTE 'ALTER TABLE proxy_requests
      ADD CONSTRAINT proxy_requests_tele_user_id_fkey
      FOREIGN KEY (tele_user_id) REFERENCES tele_users(id) ON DELETE RESTRICT';
  END IF;

  -- chat_messages.tele_user_id
  v_constraint := NULL;
  v_action := NULL;
  SELECT con.conname, con.confdeltype
    INTO v_constraint, v_action
    FROM pg_constraint con
    JOIN pg_class child ON child.oid = con.conrelid
    JOIN pg_class parent ON parent.oid = con.confrelid
   WHERE child.relname = 'chat_messages'
     AND parent.relname = 'tele_users'
     AND con.contype = 'f'
   LIMIT 1;
  IF v_constraint IS NOT NULL AND v_action <> 'r' THEN
    EXECUTE format('ALTER TABLE chat_messages DROP CONSTRAINT %I', v_constraint);
    EXECUTE 'ALTER TABLE chat_messages
      ADD CONSTRAINT chat_messages_tele_user_id_fkey
      FOREIGN KEY (tele_user_id) REFERENCES tele_users(id) ON DELETE RESTRICT';
  END IF;
END $$;
