-- ============================================================
-- 046_wave23a_cascade_to_restrict.sql
-- Wave 23A — change ON DELETE CASCADE → RESTRICT on FKs that would
-- nuke audit-relevant history.
--
-- Pre-fix: hard-deleting a tele_users row also deleted every
-- proxy_requests + chat_messages row referencing it. That's audit
-- trail destruction. Soft-delete (is_deleted = true) is the supported
-- path; hard-delete should now error with FK violation, forcing the
-- caller to soft-delete first.
--
-- Audit finding DB-R4/R5.
-- ============================================================

DO $$
DECLARE
  v_constraint TEXT;
BEGIN
  -- proxy_requests.tele_user_id
  SELECT tc.constraint_name INTO v_constraint
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
   WHERE tc.table_name = 'proxy_requests'
     AND tc.constraint_type = 'FOREIGN KEY'
     AND ccu.table_name = 'tele_users'
   LIMIT 1;
  IF v_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE proxy_requests DROP CONSTRAINT %I', v_constraint);
    EXECUTE 'ALTER TABLE proxy_requests ADD CONSTRAINT proxy_requests_tele_user_id_fkey
      FOREIGN KEY (tele_user_id) REFERENCES tele_users(id) ON DELETE RESTRICT';
  END IF;

  -- chat_messages.tele_user_id
  v_constraint := NULL;
  SELECT tc.constraint_name INTO v_constraint
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
   WHERE tc.table_name = 'chat_messages'
     AND tc.constraint_type = 'FOREIGN KEY'
     AND ccu.table_name = 'tele_users'
   LIMIT 1;
  IF v_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE chat_messages DROP CONSTRAINT %I', v_constraint);
    EXECUTE 'ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_tele_user_id_fkey
      FOREIGN KEY (tele_user_id) REFERENCES tele_users(id) ON DELETE RESTRICT';
  END IF;
END $$;
