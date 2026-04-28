import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Wave 22D-6 regression guard for CSV export consolidation.
 *
 * Pre-22D-6, four export sites hand-rolled CSV serializers:
 *   - src/app/(dashboard)/history/page.tsx
 *   - src/app/(dashboard)/logs/page.tsx
 *   - src/app/(dashboard)/users/page.tsx
 *   - src/app/api/proxies/export/route.ts
 *
 * Two of them (`users/page.tsx`, `history/page.tsx`) did
 * `row.join(",")` with ZERO escaping — a username with `,` or `"`
 * corrupted alignment, and leading `=`/`+`/`-`/`@` triggered Excel
 * formula execution on open (CSV injection / formula injection).
 *
 * Wave 22D-6 routes them all through buildCsv from lib/csv.ts which
 * already handles both. These tests pin the consolidation: a file
 * search asserts each site references buildCsv and does NOT contain
 * the old hand-rolled patterns.
 */

const SRC = path.join(__dirname, "..", "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(SRC, rel), "utf8");
}

const EXPORT_SITES = [
  "app/(dashboard)/logs/page.tsx",
  "app/(dashboard)/history/page.tsx",
  "app/(dashboard)/users/page.tsx",
  "app/api/proxies/export/route.ts",
] as const;

describe("Wave 22D-6 — CSV export sites use buildCsv", () => {
  it.each(EXPORT_SITES)("%s imports buildCsv", (relPath) => {
    const src = read(relPath);
    expect(src).toMatch(/from\s+["']@\/lib\/csv["']/);
    expect(src).toMatch(/buildCsv/);
  });

  it.each(EXPORT_SITES)("%s does NOT use the old hand-rolled join(',')", (relPath) => {
    const src = read(relPath);
    // Pre-22D-6 patterns to detect:
    //   row.join(",")  — used in users + history (no escaping at all)
    //   row.map((cell) => `"${...}"`).join(",")  — used in logs (no formula esc)
    //   headers.join(",")  — used in proxies/export (header line only;
    //                         the row builder was the dangerous one)
    expect(src).not.toMatch(/\.map\(\(cell\)\s*=>\s*`"\$\{/);
    // The `.map((row) => row.join(","))` regex (no escaping at all):
    expect(src).not.toMatch(/\.map\(\(\w+\)\s*=>\s*\w+\.join\("\,"\)\)/);
  });
});

describe("Wave 22D-6 — buildCsv formula-injection contract still holds", () => {
  // Sanity: lib/csv.ts:buildCsv keeps the OWASP-recommended prefix
  // for cells starting with =, +, -, @. If anyone weakens this guard,
  // every export site silently regresses — pin the regex here.
  it("sanitizeCell prefixes formula-trigger characters", () => {
    const src = read("lib/csv.ts");
    // The current implementation prefixes with `'\t` for cells starting with
    // = + - @ \t \r \n | \ — assert the regex still includes all 4 critical
    // formula triggers. Any future PR that drops one of them would
    // silently regress.
    expect(src).toMatch(/\^\[=\+\\-@/); // =, +, -, @ at start of regex
  });
});
