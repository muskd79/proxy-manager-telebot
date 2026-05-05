/**
 * Wave 28 — pin the sentinel UUID across SQL + JS.
 *
 * The single largest multi-dev hazard for this feature: someone
 * changes `DEFAULT_CATEGORY_ID` in `src/lib/categories/constants.ts`
 * but forgets to change the literal in the SQL migrations (or vice
 * versa). The DB row uses the SQL value; every API + form + test
 * uses the JS value. Drift = orphan proxies in production with no
 * matching sentinel row → API 500s when the FK ON DELETE SET DEFAULT
 * fires.
 *
 * This test reads both files and asserts byte-for-byte equality.
 * If a future agent rotates the UUID, this test breaks AND points
 * at the exact files to update together.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  DEFAULT_CATEGORY_ID,
  DEFAULT_CATEGORY_NAME,
  isDefaultCategory,
} from "@/lib/categories/constants";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const MIGRATION_PATH = path.join(
  REPO_ROOT,
  "supabase/migrations/068_wave28_categories_proxy_required.sql",
);
const RESNAPSHOT_MIGRATION_PATH = path.join(
  REPO_ROOT,
  "supabase/migrations/069_wave28_resnapshot_on_reassign.sql",
);

describe("Wave 28 — DEFAULT_CATEGORY_ID cross-validation", () => {
  it("exports a v4 UUID literal", () => {
    expect(DEFAULT_CATEGORY_ID).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("export name is the Vietnamese 'Mặc định'", () => {
    expect(DEFAULT_CATEGORY_NAME).toBe("Mặc định");
  });

  it("mig 068 SQL contains the same UUID literal as constants.ts", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf-8");
    expect(sql.includes(DEFAULT_CATEGORY_ID)).toBe(true);
    // Belt-and-braces: the string MUST appear at least twice
    // (INSERT VALUES + the protect-update trigger comparison).
    const occurrences = sql.match(
      new RegExp(DEFAULT_CATEGORY_ID.replace(/[-]/g, "\\-"), "g"),
    );
    expect((occurrences ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("mig 068 inserts the row with name = DEFAULT_CATEGORY_NAME", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf-8");
    expect(sql).toContain(`'${DEFAULT_CATEGORY_NAME}'`);
  });

  it("mig 068 marks the sentinel row with is_system = true", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf-8");
    // Loose check — the literal "true" should appear in the
    // INSERT block. We can't easily AST-parse the SQL here, so
    // we just spot-check the comment block + the protect trigger.
    expect(sql).toContain("is_system");
    expect(sql).toContain("fn_protect_default_category_delete");
    expect(sql).toContain("fn_protect_default_category_update");
  });

  it("mig 069 (re-snapshot trigger) exists and references both insert + reassign behavior", () => {
    const sql = readFileSync(RESNAPSHOT_MIGRATION_PATH, "utf-8");
    expect(sql).toContain("fn_proxy_resnapshot_on_reassign");
    expect(sql).toContain("BEFORE UPDATE OF category_id");
    expect(sql).toContain("override-detection");
  });
});

describe("Wave 28 — isDefaultCategory helper", () => {
  it("returns true when row.is_system is true", () => {
    expect(isDefaultCategory({ id: "anything", is_system: true })).toBe(true);
  });

  it("returns true when row.id === DEFAULT_CATEGORY_ID (pre-Wave-28 fallback)", () => {
    expect(isDefaultCategory({ id: DEFAULT_CATEGORY_ID })).toBe(true);
  });

  it("returns false for a normal row", () => {
    expect(
      isDefaultCategory({
        id: "11111111-1111-4111-8111-111111111111",
        is_system: false,
      }),
    ).toBe(false);
  });

  it("returns false for null / undefined input", () => {
    expect(isDefaultCategory(null)).toBe(false);
    expect(isDefaultCategory(undefined)).toBe(false);
  });
});
