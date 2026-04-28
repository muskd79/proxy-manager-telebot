import { supabaseAdmin } from "@/lib/supabase/admin";
import { ActorType } from "@/types/database";
import { logActivity } from "./logging";

/**
 * Atomically revoke a proxy from a user.
 *
 * Wave 22E-1 BUG FIX (B5 from code-reviewer audit):
 * The pre-22E-1 implementation ran two non-atomic operations:
 *   1. UPDATE proxies SET status='available', assigned_to=NULL, ...
 *   2. supabaseAdmin.rpc('decrement_usage', { user_id })
 * If the process crashed between (1) and (2), the proxy returned to
 * the pool but the user's rate-limit counter was permanently inflated.
 *
 * The fix: a single SECURITY DEFINER RPC `safe_revoke_proxy` (mig 029)
 * wraps both writes in one DB transaction. Either both succeed or both
 * roll back. The RPC also enforces "proxy must be assigned to THIS
 * user" so a malformed call cannot revoke someone else's proxy.
 *
 * Returns true on success, false when the RPC reported the proxy was
 * not assignable (already revoked, never assigned, or assigned to
 * a different user). Caller-side audit logging is preserved.
 *
 * Wave 22E-4 split: extracted from src/lib/telegram/utils.ts. The
 * pinning regression test in `__tests__/revoke-atomic.test.ts` now
 * imports from `@/lib/telegram/revoke` directly.
 */
export async function revokeProxy(
  proxyId: string,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc("safe_revoke_proxy", {
    p_proxy_id: proxyId,
    p_user_id: userId,
  });

  if (error) {
    console.error("safe_revoke_proxy RPC error:", error.message);
    // Audit: record the attempted revoke even on RPC error so the
    // log shows it tried. The bot caller should treat false as "no-op".
    await logActivity({
      actor_type: ActorType.Bot,
      actor_id: null,
      action: "proxy_revoke_failed",
      resource_type: "proxy",
      resource_id: proxyId,
      details: { tele_user_id: userId, error: error.message },
      ip_address: null,
      user_agent: null,
    });
    return false;
  }

  const result = data as { success: boolean; error?: string } | null;
  if (!result?.success) {
    return false;
  }

  await logActivity({
    actor_type: ActorType.Bot,
    actor_id: null,
    action: "proxy_revoked",
    resource_type: "proxy",
    resource_id: proxyId,
    details: { tele_user_id: userId },
    ip_address: null,
    user_agent: null,
  });
  return true;
}
