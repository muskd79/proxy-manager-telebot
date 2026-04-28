import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Wave 22E-5 CRITICAL regression test (B1).
 *
 * Bug: src/app/(dashboard)/layout.tsx had `role: admin?.role ?? "admin"`
 * — defaulting an unrecognised authenticated user (no row in `admins`
 * table) to admin-level privileges in client-side useRole context.
 * Sidebar guards and any client gate using useRole() would render
 * admin controls. Server-side requireAdminOrAbove still queried the
 * DB so API routes were safe, but UI gating was bypassed.
 *
 * The fix: `?? "viewer"`. This test reads the source file and asserts
 * the literal "admin" fallback never returns. A future refactor that
 * accidentally re-introduces the bug fails this test before merge.
 */
describe("dashboard/layout.tsx role fallback (Wave 22E-5 B1)", () => {
  it("never falls back to admin role for unauthenticated/orphaned users", () => {
    const file = path.join(
      __dirname,
      "..",
      "layout.tsx",
    );
    const source = fs.readFileSync(file, "utf8");

    // Forbidden pattern: `?? "admin"` anywhere in role assignment.
    expect(source).not.toMatch(/role:\s*admin\?\.role\s*\?\?\s*["']admin["']/);

    // Required pattern: at least one `?? "viewer"` for the role default.
    expect(source).toMatch(/role:.*\?\?\s*["']viewer["']/);
  });

  it("does not export getUserLang dead code (Wave 22E-5 cleanup)", () => {
    const file = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "lib",
      "telegram",
      "utils.ts",
    );
    const source = fs.readFileSync(file, "utf8");
    // getUserLanguage (sync) is the canonical export; getUserLang (async)
    // was deleted in Wave 22E-5 because it had zero callers.
    expect(source).toMatch(/export function getUserLanguage/);
    expect(source).not.toMatch(/export async function getUserLang\(/);
  });
});
