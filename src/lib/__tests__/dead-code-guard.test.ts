import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Wave 22D-5 dead-code regression guards.
 *
 * Each block in this file pins a specific cleanup that the audit
 * verified was safe to remove. If a future PR re-introduces the
 * symbol or file (e.g. by copy-pasting old code, or merging from
 * a stale branch), the matching test fails and the reviewer sees
 * exactly what was removed and why.
 *
 * The tests deliberately read FILES, not imports, so they catch
 * source-level re-introduction even if the symbol is otherwise
 * tree-shaken away.
 */

const SRC = path.join(__dirname, "..", "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(SRC, rel), "utf8");
}

function exists(rel: string): boolean {
  return fs.existsSync(path.join(SRC, rel));
}

describe("Wave 22D-5 — dead file guards", () => {
  it("src/lib/env.ts is deleted (project uses process.env directly)", () => {
    expect(exists("lib/env.ts")).toBe(false);
  });

  it("src/components/shared/data-table.tsx is deleted (unused)", () => {
    expect(exists("components/shared/data-table.tsx")).toBe(false);
  });

  it("src/components/shared/export-button.tsx is deleted (unused)", () => {
    expect(exists("components/shared/export-button.tsx")).toBe(false);
  });

  it("src/components/ui/input-group.tsx is deleted (unused)", () => {
    expect(exists("components/ui/input-group.tsx")).toBe(false);
  });

  it("src/components/ui/popover.tsx is deleted (unused)", () => {
    expect(exists("components/ui/popover.tsx")).toBe(false);
  });
});

describe("Wave 22D-5 — unused-export guards", () => {
  it("captureMessage is removed from error-tracking.ts", () => {
    const src = read("lib/error-tracking.ts");
    // Allow comment references but no function declaration.
    expect(src).not.toMatch(/export function captureMessage\(/);
    expect(src).not.toMatch(/^export.*captureMessage/m);
  });

  it("checkProxies (plural) is removed from proxy-checker.ts", () => {
    const src = read("lib/proxy-checker.ts");
    expect(src).not.toMatch(/export async function checkProxies\(/);
    // checkProxy (singular) MUST still exist — it has 3 callers.
    expect(src).toMatch(/export async function checkProxy\(/);
  });

  it("getAdminLabel is removed from notify-admins.ts", () => {
    const src = read("lib/telegram/notify-admins.ts");
    expect(src).not.toMatch(/export async function getAdminLabel\(/);
  });

  it("getAdminTelegramIds is no longer exported (used internally only)", () => {
    const src = read("lib/telegram/notify-admins.ts");
    expect(src).not.toMatch(/export async function getAdminTelegramIds\(/);
    // Function body itself must still exist — notifyAllAdmins calls it.
    expect(src).toMatch(/async function getAdminTelegramIds\(/);
  });

  it("getQueueStats is removed from webhook-queue.ts (replaced by _getQueueDepthForTests)", () => {
    const src = read("lib/telegram/webhook-queue.ts");
    expect(src).not.toMatch(/export function getQueueStats\(/);
  });
});

describe("Wave 22D-5 — unused constant guards", () => {
  it("SIDEBAR_WIDTH / SIDEBAR_COLLAPSED_WIDTH / ANALYTICS_DAYS removed", () => {
    const src = read("lib/constants.ts");
    expect(src).not.toMatch(/^export const SIDEBAR_WIDTH/m);
    expect(src).not.toMatch(/^export const SIDEBAR_COLLAPSED_WIDTH/m);
    expect(src).not.toMatch(/^export const ANALYTICS_DAYS/m);
  });

  it("PROXY_TYPES survives (still used by validations + proxy-form)", () => {
    const src = read("lib/constants.ts");
    expect(src).toMatch(/export const PROXY_TYPES/);
  });
});

describe("Wave 22D-5 — unused npm dep guards", () => {
  it("next-intl is removed from package.json", () => {
    const pkg = JSON.parse(read("../package.json")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.["next-intl"]).toBeUndefined();
    expect(pkg.devDependencies?.["next-intl"]).toBeUndefined();
  });

  it("@testing-library/jest-dom is removed from package.json", () => {
    const pkg = JSON.parse(read("../package.json")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.["@testing-library/jest-dom"]).toBeUndefined();
    expect(pkg.devDependencies?.["@testing-library/jest-dom"]).toBeUndefined();
  });
});
