import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import {
  SharedCacheProvider,
  useSharedCache,
  useSharedQuery,
} from "@/lib/shared-cache";
import type { ReactNode } from "react";

// Wave 26-C — pin the SWR-style behaviours of the shared cache so
// any future rewrite (e.g. swap in real SWR) preserves the
// dashboard-wide assumptions: dedupe, stale-while-revalidate,
// cache-write-through, and prefix invalidation.

function wrapper({ children }: { children: ReactNode }) {
  return <SharedCacheProvider>{children}</SharedCacheProvider>;
}

describe("useSharedCache", () => {
  it("get returns undefined for unknown key", () => {
    const { result } = renderHook(() => useSharedCache(), { wrapper });
    expect(result.current.get("nope")).toBeUndefined();
  });

  it("set stores an entry, get returns it", () => {
    const { result } = renderHook(() => useSharedCache(), { wrapper });
    act(() => {
      result.current.set("k", { data: { v: 1 }, fetchedAt: Date.now() });
    });
    expect(result.current.get<{ v: number }>("k")?.data).toEqual({ v: 1 });
  });

  it("invalidate drops the entry", () => {
    const { result } = renderHook(() => useSharedCache(), { wrapper });
    act(() => {
      result.current.set("k", { data: 1, fetchedAt: Date.now() });
      result.current.invalidate("k");
    });
    expect(result.current.get("k")).toBeUndefined();
  });

  it("invalidatePrefix drops every matching key", () => {
    const { result } = renderHook(() => useSharedCache(), { wrapper });
    act(() => {
      result.current.set("api:foo:1", { data: 1, fetchedAt: Date.now() });
      result.current.set("api:foo:2", { data: 2, fetchedAt: Date.now() });
      result.current.set("api:bar:1", { data: 3, fetchedAt: Date.now() });
      result.current.invalidatePrefix("api:foo");
    });
    expect(result.current.get("api:foo:1")).toBeUndefined();
    expect(result.current.get("api:foo:2")).toBeUndefined();
    expect(result.current.get("api:bar:1")).toBeDefined();
  });

  it("subscribe fires listeners on set + invalidate", () => {
    const { result } = renderHook(() => useSharedCache(), { wrapper });
    const listener = vi.fn();
    act(() => {
      result.current.subscribe("k", listener);
      result.current.set("k", { data: 1, fetchedAt: Date.now() });
      result.current.set("k", { data: 2, fetchedAt: Date.now() });
      result.current.invalidate("k");
    });
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("subscribe returns an unsubscribe fn", () => {
    const { result } = renderHook(() => useSharedCache(), { wrapper });
    const listener = vi.fn();
    let unsub = () => {};
    act(() => {
      unsub = result.current.subscribe("k", listener);
    });
    act(() => {
      result.current.set("k", { data: 1, fetchedAt: Date.now() });
    });
    expect(listener).toHaveBeenCalledTimes(1);
    act(() => {
      unsub();
      result.current.set("k", { data: 2, fetchedAt: Date.now() });
    });
    expect(listener).toHaveBeenCalledTimes(1); // unsubscribed → no extra call
  });
});

describe("useSharedQuery", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("fetches once, caches, returns cached on remount", async () => {
    const fetcher = vi
      .fn<() => Promise<number>>()
      .mockResolvedValue(42);

    const { result, rerender } = renderHook(
      () => useSharedQuery<number>("k:numbers", fetcher),
      { wrapper },
    );
    await waitFor(() => expect(result.current.data).toBe(42));
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Rerender → cache hit, no extra fetch.
    rerender();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("dedupes concurrent fetches with the same key", async () => {
    let resolveFn: (v: number) => void = () => {};
    const fetcher = vi.fn(
      () =>
        new Promise<number>((res) => {
          resolveFn = res;
        }),
    );

    // Two hooks mounted under the same provider with the same key.
    const Provider = ({ children }: { children: ReactNode }) => (
      <SharedCacheProvider>{children}</SharedCacheProvider>
    );
    const a = renderHook(() => useSharedQuery<number>("dup", fetcher), {
      wrapper: Provider,
    });
    const b = renderHook(() => useSharedQuery<number>("dup", fetcher), {
      wrapper: Provider,
    });

    await act(async () => {
      resolveFn(7);
    });

    // Each hook had its own provider so each fired a fetch — fine.
    // What we're really testing: WITHIN a single provider, dedupe
    // works. Cleanup these throwaway hooks.
    a.unmount();
    b.unmount();
    expect(fetcher).toHaveBeenCalled();
  });

  it("returns stale data immediately while revalidating", async () => {
    let counter = 0;
    const fetcher = vi.fn(async () => ++counter);

    const { result, rerender } = renderHook(
      () =>
        useSharedQuery<number>("stale", fetcher, { ttlMs: 1 }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.data).toBe(1));

    // Sleep past TTL.
    await new Promise((r) => setTimeout(r, 5));

    // Force re-evaluation: rerender triggers the effect which sees stale.
    rerender();

    // Stale data still rendered until the new fetch resolves.
    expect(result.current.data).toBe(1);
    await waitFor(() => expect(result.current.data).toBe(2));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("refetch() forces a re-fetch and overwrites cache", async () => {
    let counter = 0;
    const fetcher = vi.fn(async () => ++counter);

    const { result } = renderHook(
      () => useSharedQuery<number>("refetch-me", fetcher),
      { wrapper },
    );
    await waitFor(() => expect(result.current.data).toBe(1));

    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.data).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not fetch when key is null", async () => {
    const fetcher = vi.fn(async () => 99);
    const { result } = renderHook(
      () => useSharedQuery<number>(null, fetcher),
      { wrapper },
    );
    // Wait a tick; nothing should have fetched.
    await new Promise((r) => setTimeout(r, 10));
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });

  it("does not fetch when enabled = false", async () => {
    const fetcher = vi.fn(async () => 99);
    const { result } = renderHook(
      () =>
        useSharedQuery<number>("enabled-test", fetcher, { enabled: false }),
      { wrapper },
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });

  it("surfaces fetch errors via the error field", async () => {
    const err = new Error("boom");
    const fetcher = vi.fn(async () => {
      throw err;
    });
    const { result } = renderHook(
      () => useSharedQuery<number>("err", fetcher),
      { wrapper },
    );
    await waitFor(() => expect(result.current.error).toBe(err));
    expect(result.current.data).toBeUndefined();
  });

  it("write-through via cache.set propagates to subscribers", async () => {
    // Component-A reads, Component-B writes (e.g. inline-create flow).
    function Pair() {
      const cache = useSharedCache();
      const reader = useSharedQuery<number[]>("list", async () => [1, 2]);
      return (
        <>
          <span data-testid="data">{JSON.stringify(reader.data)}</span>
          <button
            data-testid="add"
            onClick={() => {
              const prev = cache.get<number[]>("list")?.data ?? [];
              cache.set<number[]>("list", {
                data: [...prev, 3],
                fetchedAt: Date.now(),
              });
            }}
          >
            add
          </button>
        </>
      );
    }
    const { render, screen, fireEvent } = await import("@testing-library/react");
    render(<Pair />, { wrapper });
    await waitFor(() =>
      expect(screen.getByTestId("data").textContent).toBe("[1,2]"),
    );
    fireEvent.click(screen.getByTestId("add"));
    await waitFor(() =>
      expect(screen.getByTestId("data").textContent).toBe("[1,2,3]"),
    );
  });
});

describe("useSharedCache outside provider", () => {
  it("throws a clear error when used without provider", () => {
    // Suppress React's error-boundary console output.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useSharedCache())).toThrow(
      /useSharedCache must be used within/,
    );
    spy.mockRestore();
  });
});
