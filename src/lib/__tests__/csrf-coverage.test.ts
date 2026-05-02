import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Phase 1A regression — pin CSRF coverage on every mutation route
 * the Senior Dev review (2026-05-02) flagged as gap. If a refactor
 * or new wave drops the assertSameOrigin call, this test screams
 * BEFORE attacker exploits it.
 *
 * Static check: open each file and verify it imports + calls
 * assertSameOrigin. We don't try to instantiate handlers (too much
 * mock surface) — pattern presence is enough since assertSameOrigin
 * has its own behavioral tests in csrf.test.ts.
 */

const REPO_ROOT = join(__dirname, "..", "..", "..");
const ROUTES_NEEDING_CSRF = [
  // admins/[id]/* (Senior Dev B-001..B-004)
  "src/app/api/admins/[id]/route.ts",
  "src/app/api/admins/[id]/disable-2fa/route.ts",
  "src/app/api/admins/[id]/reset-password/route.ts",
  "src/app/api/admins/[id]/revoke-sessions/route.ts",

  // profile/* (Senior Dev B-005, B-006)
  "src/app/api/profile/route.ts",
  "src/app/api/profile/password/route.ts",
  "src/app/api/profile/email/route.ts",
  "src/app/api/profile/2fa/disable/route.ts",
  "src/app/api/profile/2fa/enroll/route.ts",
  "src/app/api/profile/2fa/verify/route.ts",
  "src/app/api/profile/2fa/backup-codes/regenerate/route.ts",
  "src/app/api/profile/sessions/revoke/route.ts",

  // requests POST (Senior Dev B-018)
  "src/app/api/requests/route.ts",
];

describe("Phase 1A CSRF coverage (regression)", () => {
  for (const rel of ROUTES_NEEDING_CSRF) {
    it(`${rel} imports + calls assertSameOrigin`, () => {
      const path = join(REPO_ROOT, rel);
      const src = readFileSync(path, "utf-8");
      expect(
        src,
        `${rel}: missing 'import { assertSameOrigin } from "@/lib/csrf"'`,
      ).toMatch(/import\s*{[^}]*assertSameOrigin[^}]*}\s*from\s*"@\/lib\/csrf"/);
      expect(
        src,
        `${rel}: missing 'const csrfErr = assertSameOrigin(request)' invocation`,
      ).toContain("assertSameOrigin(request)");
    });
  }
});
