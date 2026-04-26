import { describe, it, expect, vi } from "vitest";
import { tryAcquireCronLock, releaseCronLock, withCronLock } from "../advisory-lock";

/**
 * Wave 17 regression tests for the advisory lock.
 *
 * The bug being guarded against: Vercel cold-start concurrency was
 * causing duplicate cron executions. The fix is a settings-table
 * conditional UPDATE that succeeds only when the lock row is empty
 * or expired. These tests pin the contract so a future refactor of
 * the SQL string cannot silently break dual-invocation protection.
 *
 * Implementation references:
 *   - acquire = .from().upsert() then .from().update().eq().or().select()
 *   - release = .from().update().eq()
 */

interface MockResult<T> {
  data: T | null;
  error: { message: string } | null;
}

function mockSupabase(selectResults: MockResult<unknown[]>[]) {
  let selectIdx = 0;

  // The chain object is reused — every method returns `this`.
  const chain: Record<string, unknown> = {};
  chain.upsert = vi.fn().mockResolvedValue({ data: null, error: null });
  chain.update = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.or = vi.fn(() => chain);
  chain.select = vi.fn(() => {
    const r = selectResults[selectIdx] ?? { data: [], error: null };
    selectIdx += 1;
    return Promise.resolve(r);
  });

  // The release path awaits the result of `.eq()` so make `eq` thenable
  // when called as the LAST link of a release chain. We do this by
  // resolving its return as a promise too.
  const eqMock = chain.eq as ReturnType<typeof vi.fn>;
  eqMock.mockImplementation(() => {
    const ret = chain as unknown as PromiseLike<unknown> & typeof chain;
    // Make ret thenable so `await supabase.from().update().eq()` resolves.
    (ret as unknown as { then?: unknown }).then = (
      onFulfilled: (v: { data: null; error: null }) => unknown,
    ) => Promise.resolve({ data: null, error: null }).then(onFulfilled);
    return ret;
  });

  const fromImpl = vi.fn(() => chain);

  return {
    client: { from: fromImpl } as never,
    spies: { fromImpl, ...chain } as Record<string, ReturnType<typeof vi.fn>>,
  };
}

describe("tryAcquireCronLock — Wave 17 regression", () => {
  it("returns true when the conditional UPDATE returned a row (lock claimed)", async () => {
    const m = mockSupabase([{ data: [{ key: "test_lock" }], error: null }]);
    const acquired = await tryAcquireCronLock(m.client, "test_lock");
    expect(acquired).toBe(true);
    expect(m.spies.upsert).toHaveBeenCalled();
    expect(m.spies.update).toHaveBeenCalled();
  });

  it("returns false when no row was updated (another holder has the lock)", async () => {
    const m = mockSupabase([{ data: [], error: null }]);
    const acquired = await tryAcquireCronLock(m.client, "test_lock");
    expect(acquired).toBe(false);
  });

  it("returns false on DB error — caller MUST NOT proceed as if it has the lock", async () => {
    const m = mockSupabase([{ data: null, error: { message: "connection refused" } }]);
    const acquired = await tryAcquireCronLock(m.client, "test_lock");
    expect(acquired).toBe(false);
  });
});

describe("withCronLock — Wave 17 regression", () => {
  it("invokes fn() and returns result on success", async () => {
    const m = mockSupabase([{ data: [{ key: "k" }], error: null }]);
    const fn = vi.fn().mockResolvedValue("done");
    const result = await withCronLock(m.client, "k", fn);
    expect(fn).toHaveBeenCalledOnce();
    expect(result).toEqual({ skipped: false, result: "done" });
  });

  it("does NOT invoke fn() when lock cannot be acquired", async () => {
    const m = mockSupabase([{ data: [], error: null }]);
    const fn = vi.fn();
    const result = await withCronLock(m.client, "k", fn);
    expect(fn).not.toHaveBeenCalled();
    expect(result.skipped).toBe(true);
  });

  it("releases lock in finally even when fn() throws", async () => {
    const m = mockSupabase([{ data: [{ key: "k" }], error: null }]);
    const fn = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(withCronLock(m.client, "k", fn)).rejects.toThrow("boom");

    // Release ran: update was called twice (acquire + release)
    expect((m.spies.update as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe("releaseCronLock — Wave 17 regression", () => {
  it("issues a clearing update with acquired_at: null", async () => {
    const m = mockSupabase([]);
    await releaseCronLock(m.client, "k");
    const updateMock = m.spies.update as ReturnType<typeof vi.fn>;
    expect(updateMock).toHaveBeenCalled();
    expect(updateMock.mock.calls[0][0]).toEqual({ value: { acquired_at: null } });
  });
});
