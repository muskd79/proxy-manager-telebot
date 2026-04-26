import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Wave 18B regression test.
 *
 * Bug: src/lib/supabase/admin.ts exports a Supabase client constructed
 * with SUPABASE_SERVICE_ROLE_KEY. If that module ever gets imported
 * from a client component (RSC slip-up, accidental Server Action ->
 * Client Component refactor), the service role key ends up in the
 * browser bundle.
 *
 * The fix is `import "server-only"` at the top of the file. Next.js
 * fails the build at compile time if a "server-only" module is reached
 * from the client graph.
 *
 * This regression test reads the source file directly and asserts the
 * sentinel import is present. A future refactor that drops the line
 * fails this test before it can ship.
 */
describe("supabase/admin.ts has server-only import (Wave 18B regression)", () => {
  it("imports 'server-only' so the service-role key cannot leak to the client bundle", () => {
    const file = path.join(
      __dirname,
      "..",
      "admin.ts",
    );
    const source = fs.readFileSync(file, "utf8");

    // Must be a top-level statement (not inside a comment, not inside
    // an `if (false)`). Test the simplest pattern: a literal import line.
    expect(source).toMatch(/^\s*import\s+["']server-only["'];?\s*$/m);

    // Defence-in-depth: assert the line appears BEFORE any other import,
    // so the runtime guard fires immediately on module load.
    const lines = source.split(/\r?\n/);
    const firstImportIdx = lines.findIndex((l) => /^\s*import\s/.test(l));
    expect(firstImportIdx).toBeGreaterThanOrEqual(0);
    expect(/server-only/.test(lines[firstImportIdx])).toBe(true);
  });
});
