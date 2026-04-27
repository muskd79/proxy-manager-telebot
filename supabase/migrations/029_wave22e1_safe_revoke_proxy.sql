-- ============================================================
-- 029_wave22e1_safe_revoke_proxy.sql
-- Wave 22E-1 — atomic safe_revoke_proxy RPC.
--
-- BUG B5 (code-reviewer audit, severity HIGH):
-- src/lib/telegram/utils.ts revokeProxy() runs two non-atomic ops:
--   1. UPDATE proxies SET status='available', assigned_to=NULL, ...
--   2. supabaseAdmin.rpc('decrement_usage', { user_id })
-- If the process crashes between (1) and (2), the proxy returns to the
-- pool but the user's rate-limit counter is NOT decremented. The user
-- is permanently inflated until an admin manually fixes the counter.
--
-- Fix: wrap both UPDATEs in one SECURITY DEFINER RPC executing in the
-- same DB transaction. Either both succeed or both roll back.
-- ============================================================

CREATE OR REPLACE FUNCTION safe_revoke_proxy(
  p_proxy_id UUID,
  p_user_id  UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  -- 1. Mark the proxy available, but ONLY if it is currently
  --    assigned to this user. Race-safe: if a concurrent revoke
  --    already changed the row, the WHERE filter rejects this update
  --    and we return success=false.
  UPDATE proxies
    SET status      = 'available',
        assigned_to = NULL,
        assigned_at = NULL,
        updated_at  = now()
    WHERE id = p_proxy_id
      AND assigned_to = p_user_id
      AND status = 'assigned'
      AND is_deleted = false
    RETURNING assigned_to INTO v_user_id;

  IF v_user_id IS NULL THEN
    -- Either proxy not found, not assigned, or assigned to someone else.
    -- Do NOT touch the rate-limit counters in any of those cases.
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Proxy not assigned to this user, or already revoked'
    );
  END IF;

  -- 2. Decrement usage counters for this user. Same transaction →
  --    rolled back automatically if the UPDATE above somehow throws,
  --    or if this UPDATE fails (e.g. row-level lock contention).
  UPDATE tele_users
    SET proxies_used_total  = GREATEST(0, proxies_used_total - 1),
        updated_at          = now()
    WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'proxy_id', p_proxy_id,
    'user_id', p_user_id
  );
END;
$$;

REVOKE ALL ON FUNCTION safe_revoke_proxy(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION safe_revoke_proxy(UUID, UUID) TO authenticated, service_role;

COMMENT ON FUNCTION safe_revoke_proxy IS
  'Wave 22E-1 — atomic proxy revoke + usage decrement. Replaces the non-atomic two-step in src/lib/telegram/utils.ts (bug B5).';
