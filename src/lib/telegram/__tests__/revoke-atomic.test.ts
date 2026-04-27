import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Wave 22E-1 regression test for bug B5.
 *
 * Original bug (pre-22E-1): `revokeProxy(proxyId, userId)` did:
 *   1. UPDATE proxies SET status='available', assigned_to=NULL
 *   2. supabaseAdmin.rpc('decrement_usage', { p_user_id: userId })
 * If the process crashed between (1) and (2), the proxy returned to
 * the pool but the user's rate-limit counter was permanently inflated.
 *
 * The fix: a single SECURITY DEFINER RPC `safe_revoke_proxy` (mig 029)
 * runs both updates in one DB transaction. These tests pin that
 * contract — no future refactor can re-introduce the two-step pattern
 * without breaking these tests.
 */

const mockRpc = vi.fn();
const mockInsert = vi.fn().mockResolvedValue({ data: null, error: null });

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: () => ({ insert: mockInsert }),
  },
}));

import { revokeProxy } from "@/lib/telegram/utils";

describe("revokeProxy — Wave 22E-1 regression", () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockInsert.mockClear();
  });

  it("calls safe_revoke_proxy RPC (NOT the legacy two-step)", async () => {
    mockRpc.mockResolvedValueOnce({
      data: { success: true, proxy_id: "p1", user_id: "u1" },
      error: null,
    });

    await revokeProxy("p1", "u1");

    expect(mockRpc).toHaveBeenCalledOnce();
    expect(mockRpc).toHaveBeenCalledWith("safe_revoke_proxy", {
      p_proxy_id: "p1",
      p_user_id: "u1",
    });
    // Critical: verify it did NOT also call the legacy decrement_usage RPC.
    const calls = mockRpc.mock.calls.map((c) => c[0]);
    expect(calls).not.toContain("decrement_usage");
  });

  it("returns true when RPC reports success", async () => {
    mockRpc.mockResolvedValueOnce({ data: { success: true }, error: null });
    const result = await revokeProxy("p1", "u1");
    expect(result).toBe(true);
  });

  it("returns false when RPC reports the proxy was not assignable", async () => {
    mockRpc.mockResolvedValueOnce({
      data: { success: false, error: "Proxy not assigned to this user" },
      error: null,
    });
    const result = await revokeProxy("p1", "u1");
    expect(result).toBe(false);
  });

  it("returns false on RPC transport error AND logs an audit entry", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "Connection refused" },
    });
    const result = await revokeProxy("p1", "u1");
    expect(result).toBe(false);
    // Audit insert must still run — the failed-revoke entry is what
    // surfaces the bug at incident-response time.
    expect(mockInsert).toHaveBeenCalled();
  });

  it("only writes a 'proxy_revoked' audit on success", async () => {
    mockRpc.mockResolvedValueOnce({ data: { success: true }, error: null });
    await revokeProxy("p1", "u1");
    expect(mockInsert).toHaveBeenCalled();
    const arg = mockInsert.mock.calls[0][0] as { action: string };
    expect(arg.action).toBe("proxy_revoked");
  });
});
