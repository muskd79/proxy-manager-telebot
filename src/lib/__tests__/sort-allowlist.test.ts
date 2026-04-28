import { describe, it, expect } from "vitest";
import {
  makeSortValidator,
  safeSort,
  PROXIES_SORT,
  LOGS_SORT,
  USERS_SORT,
  REQUESTS_SORT,
} from "@/lib/sort-allowlist";

/**
 * Wave 22D-3 — sortBy injection regression tests.
 *
 * Pre-22D-3, four list routes (proxies, logs, users, requests) passed
 * the unvalidated `sortBy` URL param straight into Supabase's
 * `.order(column, ...)` call. This test pins the allowlist behaviour
 * — any future PR that bypasses safeSort fails the integration test
 * paired with this unit test.
 */

describe("safeSort", () => {
  const v = makeSortValidator(["a", "b", "c"], "a");

  it("returns input unchanged when in allowlist", () => {
    expect(safeSort(v, "b")).toBe("b");
  });

  it("returns fallback when input is null", () => {
    expect(safeSort(v, null)).toBe("a");
  });

  it("returns fallback when input is undefined", () => {
    expect(safeSort(v, undefined)).toBe("a");
  });

  it("returns fallback when input is empty string", () => {
    expect(safeSort(v, "")).toBe("a");
  });

  it("returns fallback when input not in allowlist (the injection guard)", () => {
    expect(safeSort(v, "evil_column")).toBe("a");
  });

  it("rejects SQL-injection attempts disguised as column names", () => {
    expect(safeSort(v, "(select case when 1=1 then 'a' end)")).toBe("a");
    expect(safeSort(v, "a; DROP TABLE users")).toBe("a");
    expect(safeSort(v, "a OR 1=1")).toBe("a");
    expect(safeSort(v, "a)) UNION SELECT password FROM admins --")).toBe("a");
  });
});

describe("Wave 22D-3 per-route allowlists", () => {
  // The point of these tests: if someone deletes a column from the DB
  // and forgets to remove it from the allowlist, the route itself will
  // hit a runtime error (Supabase will return "column does not exist").
  // The allowlist test pins the EXPECTED column set — a column rename
  // requires updating both the DB and this test, surfacing the
  // dependency.

  it("PROXIES_SORT contains expected columns", () => {
    expect(PROXIES_SORT.allowed.has("created_at")).toBe(true);
    expect(PROXIES_SORT.allowed.has("host")).toBe(true);
    expect(PROXIES_SORT.allowed.has("status")).toBe(true);
    expect(PROXIES_SORT.fallback).toBe("created_at");
  });

  it("PROXIES_SORT rejects sensitive columns (password)", () => {
    // If sortBy=password were allowed, a covert side-channel could
    // probe individual password values via timing. Hard-pin the
    // exclusion.
    // Cast `as ReadonlySet<string>` to bypass the generic-narrowed
    // .has() — we WANT to assert these strings are not members.
    const set = PROXIES_SORT.allowed as ReadonlySet<string>;
    expect(set.has("password")).toBe(false);
    expect(set.has("username")).toBe(false);
  });

  it("LOGS_SORT minimal surface (only created_at + a few facets)", () => {
    const set = LOGS_SORT.allowed as ReadonlySet<string>;
    expect(set.has("created_at")).toBe(true);
    expect(set.has("ip_address")).toBe(false);
    expect(set.has("details")).toBe(false);
    expect(LOGS_SORT.fallback).toBe("created_at");
  });

  it("USERS_SORT excludes rate-limit counters not safe to enumerate", () => {
    const set = USERS_SORT.allowed as ReadonlySet<string>;
    expect(set.has("created_at")).toBe(true);
    expect(set.has("username")).toBe(true);
    // Phone number, language, and timestamps that could be used to
    // enumerate users are excluded.
    expect(set.has("phone")).toBe(false);
    expect(set.has("hourly_reset_at")).toBe(false);
  });

  it("REQUESTS_SORT pins the expected facet set", () => {
    const set = REQUESTS_SORT.allowed as ReadonlySet<string>;
    expect(set.has("requested_at")).toBe(true);
    expect(set.has("status")).toBe(true);
    expect(REQUESTS_SORT.fallback).toBe("requested_at");
    // tele_user_id is a join column, not a sort target.
    expect(set.has("tele_user_id")).toBe(false);
  });

  it("safeSort returns the route-specific fallback for each", () => {
    expect(safeSort(PROXIES_SORT, "evil")).toBe("created_at");
    expect(safeSort(LOGS_SORT, "evil")).toBe("created_at");
    expect(safeSort(USERS_SORT, "evil")).toBe("created_at");
    expect(safeSort(REQUESTS_SORT, "evil")).toBe("requested_at");
  });
});
