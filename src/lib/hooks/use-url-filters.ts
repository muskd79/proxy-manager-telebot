"use client";

/**
 * Wave 27 UX-2 — generic URL-bound filter state hook.
 *
 * Extracted from the request-filters-url + warranty-filters-url
 * patterns shipped in Wave 26-D. Lets any page round-trip its
 * filter state to the URL via `router.replace(?…)` so:
 *   - Reload preserves filters
 *   - Browser back/forward restores filters
 *   - Admin can copy-paste a filtered view to a colleague
 *
 * Caller passes a `parse(URLSearchParams) → T` and a
 * `format(T) → URLSearchParams`. Both should be PURE and
 * idempotent — `parse(format(x)) === x` for every reachable x.
 *
 * Usage:
 *   const [filters, setFilters] = useUrlFilters({
 *     parse: parseFromSearchParams,
 *     format: formatToSearchParams,
 *     defaults: DEFAULT_FILTERS,
 *   });
 *
 * Implementation notes:
 *   - Debounce 300ms to avoid history-spam during typing.
 *   - Uses `router.replace(...)` not `push(...)` — typing in a
 *     filter shouldn't add 100 entries to back-stack.
 *   - `scroll: false` so URL update doesn't jank the page.
 *   - Reads initial state from useSearchParams() — works with
 *     SSR + hydration.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

interface UseUrlFiltersOptions<T> {
  /** Parse URL params → T. Should fall back to `defaults` on bad input. */
  parse: (params: URLSearchParams) => T;
  /** Format T → URL params. Default values should be omitted. */
  format: (filters: T) => URLSearchParams;
  /** Initial fallback when URL is empty or unparseable. */
  defaults: T;
  /** Debounce delay in ms before pushing the URL update. Default 300ms. */
  debounceMs?: number;
}

export function useUrlFilters<T>({
  parse,
  format,
  defaults,
  debounceMs = 300,
}: UseUrlFiltersOptions<T>): [T, (next: T | ((prev: T) => T)) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Initial state: parse the URL once on mount. Subsequent URL
  // changes (from browser back/forward) re-parse via the
  // searchParams effect below.
  const [filters, setFiltersState] = useState<T>(() => {
    if (!searchParams) return defaults;
    return parse(new URLSearchParams(searchParams.toString()));
  });

  // Sync URL → state when searchParams change externally (browser
  // back/forward). Skip this branch on the first render since the
  // initial state already reflects searchParams.
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (!searchParams) return;
    const next = parse(new URLSearchParams(searchParams.toString()));
    // Stringify-compare to avoid a state update when the parsed
    // value matches what we already have (which would re-trigger
    // the URL-write effect below in a loop).
    if (JSON.stringify(next) !== JSON.stringify(filters)) {
      setFiltersState(next);
    }
    // Intentionally don't include `filters` in deps — we only want
    // to react to searchParams changes here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, parse]);

  // Debounced URL writer. Each setFilters call schedules a single
  // router.replace; rapid typing collapses to one URL change.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const formatRef = useRef(format);
  formatRef.current = format;

  const setFilters = useCallback(
    (next: T | ((prev: T) => T)) => {
      setFiltersState((prev) => {
        const resolved =
          typeof next === "function"
            ? (next as (p: T) => T)(prev)
            : next;
        // Schedule URL update on the resolved value.
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          const params = formatRef.current(resolved);
          const qs = params.toString();
          const url = qs ? `${pathname}?${qs}` : pathname;
          router.replace(url, { scroll: false });
        }, debounceMs);
        return resolved;
      });
    },
    [debounceMs, pathname, router],
  );

  // Clean up pending debounce on unmount so we don't push a URL
  // update for a page the user already navigated away from.
  useEffect(() => {
    return () => {
      clearTimeout(debounceRef.current);
    };
  }, []);

  return [filters, setFilters];
}
