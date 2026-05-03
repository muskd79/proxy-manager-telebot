import { describe, it, expect } from "vitest";
import {
  parseFiltersFromSearchParams,
  formatFiltersToSearchParams,
  resolveTimeBucket,
} from "../request-filters-url";
import {
  DEFAULT_REQUEST_FILTERS,
  type RequestPageFilters,
} from "../request-filters";

/**
 * Wave 26-D-post1 — pin every branch of the URL codec.
 *
 * Critical because URL state is the only place the filter is durable
 * across reloads. Drift = admin shares a "filtered" link that opens to
 * a different view — would hide bugs and confuse the team.
 */

describe("parseFiltersFromSearchParams", () => {
  it("returns defaults for empty params", () => {
    const f = parseFiltersFromSearchParams(new URLSearchParams());
    expect(f).toEqual(DEFAULT_REQUEST_FILTERS);
  });

  it("parses every known field", () => {
    const params = new URLSearchParams(
      "status=approved&within=30d&proxyType=http&approvalMode=auto&country=VN&search=alice",
    );
    const f = parseFiltersFromSearchParams(params);
    expect(f.status).toBe("approved");
    expect(f.within).toBe("30d");
    expect(f.proxyType).toBe("http");
    expect(f.approvalMode).toBe("auto");
    expect(f.country).toBe("VN");
    expect(f.search).toBe("alice");
  });

  it("falls back to default for unknown status", () => {
    const f = parseFiltersFromSearchParams(new URLSearchParams("status=garbage"));
    expect(f.status).toBe(DEFAULT_REQUEST_FILTERS.status);
  });

  it("falls back to default for unknown within", () => {
    const f = parseFiltersFromSearchParams(new URLSearchParams("within=lifetime"));
    expect(f.within).toBe(DEFAULT_REQUEST_FILTERS.within);
  });

  it("accepts both proxyType and legacy 'type' alias", () => {
    expect(
      parseFiltersFromSearchParams(new URLSearchParams("type=https")).proxyType,
    ).toBe("https");
    expect(
      parseFiltersFromSearchParams(new URLSearchParams("proxyType=socks5")).proxyType,
    ).toBe("socks5");
  });

  it("accepts both approvalMode and legacy 'mode' alias", () => {
    expect(
      parseFiltersFromSearchParams(new URLSearchParams("mode=manual")).approvalMode,
    ).toBe("manual");
  });

  it("only accepts ISO yyyy-mm-dd dates", () => {
    expect(
      parseFiltersFromSearchParams(new URLSearchParams("dateFrom=2026-01-15")).dateFrom,
    ).toBe("2026-01-15");
    expect(
      parseFiltersFromSearchParams(new URLSearchParams("dateFrom=01/15/2026")).dateFrom,
    ).toBeUndefined();
  });

  it("clamps overlong country / search to safe limits", () => {
    const longCountry = "X".repeat(200);
    const longSearch = "Y".repeat(500);
    const f = parseFiltersFromSearchParams(
      new URLSearchParams(`country=${longCountry}&search=${longSearch}`),
    );
    expect(f.country.length).toBe(100);
    expect(f.search.length).toBe(200);
  });
});

describe("formatFiltersToSearchParams", () => {
  it("returns empty string when all defaults", () => {
    const params = formatFiltersToSearchParams(DEFAULT_REQUEST_FILTERS);
    expect(params.toString()).toBe("");
  });

  it("includes only NON-default values", () => {
    const f: RequestPageFilters = {
      ...DEFAULT_REQUEST_FILTERS,
      status: "approved",
      country: "VN",
    };
    const params = formatFiltersToSearchParams(f);
    expect(params.get("status")).toBe("approved");
    expect(params.get("country")).toBe("VN");
    expect(params.get("within")).toBeNull(); // still default
  });

  it("includes dateFrom + dateTo only when within=custom", () => {
    const fAll: RequestPageFilters = {
      ...DEFAULT_REQUEST_FILTERS,
      within: "all",
      dateFrom: "2026-01-15",
      dateTo: "2026-02-15",
    };
    const params1 = formatFiltersToSearchParams(fAll);
    expect(params1.get("dateFrom")).toBeNull();
    expect(params1.get("dateTo")).toBeNull();

    const fCustom: RequestPageFilters = {
      ...DEFAULT_REQUEST_FILTERS,
      within: "custom",
      dateFrom: "2026-01-15",
      dateTo: "2026-02-15",
    };
    const params2 = formatFiltersToSearchParams(fCustom);
    expect(params2.get("within")).toBe("custom");
    expect(params2.get("dateFrom")).toBe("2026-01-15");
    expect(params2.get("dateTo")).toBe("2026-02-15");
  });
});

describe("parse → format → parse round trip", () => {
  it("is stable", () => {
    const cases: RequestPageFilters[] = [
      DEFAULT_REQUEST_FILTERS,
      { ...DEFAULT_REQUEST_FILTERS, status: "approved", proxyType: "https" },
      {
        ...DEFAULT_REQUEST_FILTERS,
        within: "custom",
        dateFrom: "2026-01-01",
        dateTo: "2026-02-01",
      },
      { ...DEFAULT_REQUEST_FILTERS, search: "alice", country: "US" },
    ];
    for (const original of cases) {
      const formatted = formatFiltersToSearchParams(original);
      const reparsed = parseFiltersFromSearchParams(formatted);
      expect(reparsed).toEqual(original);
    }
  });
});

describe("resolveTimeBucket", () => {
  const NOW = new Date("2026-05-04T12:00:00Z");

  it("returns no constraint for 'all'", () => {
    const r = resolveTimeBucket(
      { ...DEFAULT_REQUEST_FILTERS, within: "all" },
      NOW,
    );
    expect(r).toEqual({});
  });

  it("'today' returns dateFrom set to start-of-day", () => {
    const r = resolveTimeBucket(
      { ...DEFAULT_REQUEST_FILTERS, within: "today" },
      NOW,
    );
    expect(r.dateFrom).toBeDefined();
    expect(r.dateFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("'7d' returns dateFrom 7 days back", () => {
    const r = resolveTimeBucket(
      { ...DEFAULT_REQUEST_FILTERS, within: "7d" },
      NOW,
    );
    expect(r.dateFrom).toBeDefined();
    // 2026-04-27
    expect(r.dateFrom).toMatch(/^2026-04-2[67]$/);
  });

  it("'30d' returns dateFrom 30 days back", () => {
    const r = resolveTimeBucket(
      { ...DEFAULT_REQUEST_FILTERS, within: "30d" },
      NOW,
    );
    expect(r.dateFrom).toBeDefined();
    // 2026-04-04
    expect(r.dateFrom).toMatch(/^2026-04-0[345]$/);
  });

  it("'custom' passes through dateFrom/dateTo", () => {
    const r = resolveTimeBucket(
      {
        ...DEFAULT_REQUEST_FILTERS,
        within: "custom",
        dateFrom: "2026-01-01",
        dateTo: "2026-02-01",
      },
      NOW,
    );
    expect(r.dateFrom).toBe("2026-01-01");
    expect(r.dateTo).toBe("2026-02-01");
  });
});
