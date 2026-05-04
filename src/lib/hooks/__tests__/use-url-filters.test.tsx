import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

/**
 * Wave 27 UX-2 — pin every branch of useUrlFilters.
 */

const mockReplace = vi.fn();
const mockPathname = "/categories";
let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => mockPathname,
  useSearchParams: () => mockSearchParams,
}));

import { useUrlFilters } from "../use-url-filters";

interface TestFilters {
  show: "all" | "hidden" | "visible";
  q: string;
}

const DEFAULTS: TestFilters = { show: "visible", q: "" };

function parse(p: URLSearchParams): TestFilters {
  const show = p.get("show");
  return {
    show:
      show === "all" || show === "hidden" || show === "visible"
        ? show
        : DEFAULTS.show,
    q: p.get("q") ?? "",
  };
}

function format(f: TestFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.show !== DEFAULTS.show) p.set("show", f.show);
  if (f.q) p.set("q", f.q);
  return p;
}

describe("useUrlFilters", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockReplace.mockClear();
    mockSearchParams = new URLSearchParams();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("initialises from defaults when URL is empty", () => {
    const { result } = renderHook(() =>
      useUrlFilters({ parse, format, defaults: DEFAULTS }),
    );
    expect(result.current[0]).toEqual(DEFAULTS);
  });

  it("initialises from URL when present", () => {
    mockSearchParams = new URLSearchParams("?show=hidden&q=foo");
    const { result } = renderHook(() =>
      useUrlFilters({ parse, format, defaults: DEFAULTS }),
    );
    expect(result.current[0]).toEqual({ show: "hidden", q: "foo" });
  });

  it("falls back to defaults on bad input", () => {
    mockSearchParams = new URLSearchParams("?show=garbage");
    const { result } = renderHook(() =>
      useUrlFilters({ parse, format, defaults: DEFAULTS }),
    );
    expect(result.current[0].show).toBe("visible");
  });

  it("setFilters updates state synchronously", () => {
    const { result } = renderHook(() =>
      useUrlFilters({ parse, format, defaults: DEFAULTS }),
    );
    act(() => {
      result.current[1]({ show: "hidden", q: "" });
    });
    expect(result.current[0]).toEqual({ show: "hidden", q: "" });
  });

  it("setFilters debounces URL writes", () => {
    const { result } = renderHook(() =>
      useUrlFilters({ parse, format, defaults: DEFAULTS, debounceMs: 300 }),
    );
    act(() => {
      result.current[1]({ show: "hidden", q: "a" });
    });
    expect(mockReplace).not.toHaveBeenCalled(); // debounced

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith(
      "/categories?show=hidden&q=a",
      { scroll: false },
    );
  });

  it("setFilters collapses rapid calls into one URL write", () => {
    const { result } = renderHook(() =>
      useUrlFilters({ parse, format, defaults: DEFAULTS, debounceMs: 300 }),
    );
    act(() => {
      result.current[1]({ show: "all", q: "" });
      result.current[1]({ show: "hidden", q: "" });
      result.current[1]({ show: "visible", q: "x" });
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(mockReplace).toHaveBeenCalledTimes(1);
    // Only the LAST value writes to URL.
    expect(mockReplace).toHaveBeenCalledWith(
      "/categories?q=x",
      { scroll: false },
    );
  });

  it("URL has no querystring when only defaults are set", () => {
    const { result } = renderHook(() =>
      useUrlFilters({ parse, format, defaults: DEFAULTS }),
    );
    act(() => {
      result.current[1](DEFAULTS);
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(mockReplace).toHaveBeenCalledWith("/categories", { scroll: false });
  });

  it("setFilters accepts a function updater", () => {
    const { result } = renderHook(() =>
      useUrlFilters({ parse, format, defaults: DEFAULTS }),
    );
    act(() => {
      result.current[1]((prev) => ({ ...prev, show: "all" }));
    });
    expect(result.current[0].show).toBe("all");
  });

  it("ignores no-op state changes (no extra URL write)", () => {
    const { result } = renderHook(() =>
      useUrlFilters({ parse, format, defaults: DEFAULTS }),
    );
    // Same value as default — format returns empty params.
    act(() => {
      result.current[1](DEFAULTS);
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    // Still writes once (URL clears) but only one call.
    expect(mockReplace).toHaveBeenCalledTimes(1);
  });
});
