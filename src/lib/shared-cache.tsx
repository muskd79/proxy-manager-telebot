"use client";

/**
 * Wave 26-C (gap 6.3) — SWR-style shared in-memory cache for the
 * dashboard's autocomplete-ish endpoints (categories, country list,
 * stats). Pre-fix every component that needed `/api/categories`
 * fired its own fetch on mount: the proxies list page, the Sửa form
 * dialog, the Import wizard, the bulk-edit dialog. Opening the form
 * after the page loaded re-fetched 200 categories that hadn't
 * changed.
 *
 * This module ships a small purpose-built cache rather than pulling
 * in the `swr` package — Next.js 16 + React 19 runtimes are picky
 * about transitive deps and we only need ~30 lines of logic here.
 *
 * Surface:
 *   <SharedCacheProvider>          — wrap the dashboard layout once
 *   useSharedQuery(key, fetcher)   — hook used in components
 *   useSharedCache().invalidate(k) — bust a key after a mutation
 *
 * Cache semantics:
 *   - Returns cached data immediately if the entry is younger than `ttlMs`
 *   - Older than ttl → re-fetch in background, but still return the
 *     cached value while it's loading (stale-while-revalidate)
 *   - In-flight requests are de-duplicated: 5 components mounting
 *     simultaneously share ONE network request
 *   - `invalidate(key)` drops the entry; next read fetches fresh
 *   - `invalidatePrefix("api:categories")` busts a family of keys
 *     (useful when the realtime channel signals a write)
 *
 * NOT implemented (keep scope tight):
 *   - Persistence to localStorage
 *   - Optimistic updates
 *   - Mutate-and-rollback patterns
 *   - Suspense integration
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
  /** In-flight promise — set while a fetch is running so others can subscribe. */
  inflight?: Promise<T>;
}

interface SharedCacheValue {
  /** Get cached entry (or undefined). Type param is type-only — caller knows the shape. */
  get<T>(key: string): CacheEntry<T> | undefined;
  /** Replace the cache entry for `key`. */
  set<T>(key: string, entry: CacheEntry<T>): void;
  /** Drop the entry for `key`. Subsequent reads re-fetch. */
  invalidate(key: string): void;
  /** Drop every entry whose key startsWith the given prefix. */
  invalidatePrefix(prefix: string): void;
  /** Subscribe to changes on `key`. Returns an unsubscribe fn. */
  subscribe(key: string, listener: () => void): () => void;
}

const SharedCacheContext = createContext<SharedCacheValue | null>(null);

export function SharedCacheProvider({ children }: { children: ReactNode }) {
  // useRef so the cache identity is stable across re-renders. The
  // listeners are stored separately because emit() iterates them.
  const cache = useRef(new Map<string, CacheEntry<unknown>>());
  const listeners = useRef(new Map<string, Set<() => void>>());

  const emit = useCallback((key: string) => {
    const set = listeners.current.get(key);
    if (set) for (const l of set) l();
  }, []);

  const value: SharedCacheValue = {
    get: <T,>(key: string) => cache.current.get(key) as CacheEntry<T> | undefined,
    set: <T,>(key: string, entry: CacheEntry<T>) => {
      cache.current.set(key, entry as CacheEntry<unknown>);
      emit(key);
    },
    invalidate: (key: string) => {
      cache.current.delete(key);
      emit(key);
    },
    invalidatePrefix: (prefix: string) => {
      const dropped: string[] = [];
      for (const k of cache.current.keys()) {
        if (k.startsWith(prefix)) {
          cache.current.delete(k);
          dropped.push(k);
        }
      }
      for (const k of dropped) emit(k);
    },
    subscribe: (key: string, listener: () => void) => {
      let set = listeners.current.get(key);
      if (!set) {
        set = new Set();
        listeners.current.set(key, set);
      }
      set.add(listener);
      return () => {
        set!.delete(listener);
        if (set!.size === 0) listeners.current.delete(key);
      };
    },
  };

  return (
    <SharedCacheContext.Provider value={value}>
      {children}
    </SharedCacheContext.Provider>
  );
}

/**
 * Get the cache handle. Throws if used outside SharedCacheProvider —
 * loud failure beats silent re-fetch storms.
 */
export function useSharedCache(): SharedCacheValue {
  const ctx = useContext(SharedCacheContext);
  if (!ctx) {
    throw new Error(
      "useSharedCache must be used within <SharedCacheProvider>",
    );
  }
  return ctx;
}

const DEFAULT_TTL_MS = 30_000; // 30s — long enough for the form-dialog dance, short enough that mutations from another tab propagate quickly

export interface UseSharedQueryOptions {
  /** Cache freshness in ms. Default 30s. */
  ttlMs?: number;
  /**
   * If false, skip the fetch. Useful when the key depends on a value
   * that's not yet known (e.g. waiting for an id). The hook still
   * returns the latest cached value if any.
   */
  enabled?: boolean;
}

export interface UseSharedQueryResult<T> {
  data: T | undefined;
  loading: boolean;
  error: Error | null;
  /** Force a re-fetch and overwrite the cache. */
  refetch: () => Promise<void>;
}

/**
 * Subscribe to the cache for `key`, kick off a fetch if needed, and
 * re-render when the entry changes. Stale-while-revalidate:
 *   - cache hit + fresh    → returns data, no fetch
 *   - cache hit + stale    → returns data immediately, fetches in bg
 *   - cache miss           → returns undefined, fetches now (de-duped)
 *   - in-flight from another caller → just subscribes, no extra fetch
 */
export function useSharedQuery<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  opts: UseSharedQueryOptions = {},
): UseSharedQueryResult<T> {
  const cache = useSharedCache();
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const enabled = opts.enabled ?? true;

  // Mirror the cache entry into local state so React knows when to
  // re-render. We bump a "version" counter on subscription emit and
  // re-read the cache; the data identity stays stable across renders
  // because cache.set() reuses the entry reference.
  const [, setVersion] = useState(0);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  // Fetcher is captured in a ref so the effect doesn't re-run when
  // the parent inlines a fresh closure on every render. Pattern matches
  // proxies/page.tsx Wave 26-C realtime banner fix.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const runFetch = useCallback(
    async (force: boolean) => {
      if (!key) return;
      const existing = cache.get<T>(key);
      // De-dupe: another caller already kicked off this fetch.
      if (!force && existing?.inflight) {
        try {
          await existing.inflight;
        } catch {
          /* error surfaced via the cache entry below */
        }
        return;
      }
      setLoading(true);
      setError(null);
      const promise = fetcherRef
        .current()
        .then((data) => {
          cache.set<T>(key, { data, fetchedAt: Date.now() });
          return data;
        })
        .catch((e: unknown) => {
          // Don't store failures in cache; let the next attempt retry.
          const err = e instanceof Error ? e : new Error(String(e));
          setError(err);
          throw err;
        })
        .finally(() => {
          setLoading(false);
        });
      // Mark inflight on the cache entry — preserves any stale data
      // while the new fetch is in progress.
      const stale = cache.get<T>(key);
      cache.set<T>(key, {
        data: stale?.data as T,
        fetchedAt: stale?.fetchedAt ?? 0,
        inflight: promise,
      });
      try {
        await promise;
      } catch {
        /* already surfaced via setError */
      }
    },
    [cache, key],
  );

  // Subscribe + initial fetch.
  useEffect(() => {
    if (!key || !enabled) return;
    const unsubscribe = cache.subscribe(key, () => setVersion((v) => v + 1));
    const entry = cache.get<T>(key);
    const isStale = !entry || Date.now() - entry.fetchedAt > ttlMs;
    if (isStale && !entry?.inflight) {
      void runFetch(false);
    }
    return unsubscribe;
  }, [cache, key, enabled, ttlMs, runFetch]);

  const refetch = useCallback(() => runFetch(true), [runFetch]);

  const entry = key ? cache.get<T>(key) : undefined;
  return {
    data: entry?.data,
    loading: loading || (!entry?.data && !!entry?.inflight),
    error,
    refetch,
  };
}
