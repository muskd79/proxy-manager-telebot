import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Wave 25-pre4 (Pass 5.B) — Markdown escape policy CI gate.
 *
 * Telegram's `parse_mode: "Markdown"` treats `*_[]()~\`>#+-=|{}.!`
 * as formatting characters. Any unescaped one inside an interpolated
 * value triggers a 400 "can't parse entities" error and the user
 * sees silence.
 *
 * `safeCredentialString` (from format.ts) handles the credentials
 * path. But other places interpolate user/admin-supplied strings
 * directly into backtick / asterisk blocks (e.g. usernames in admin
 * notifications, status text from DB). Today most of those values
 * happen to be Markdown-safe (UUIDs, integers, hardcoded literals)
 * but Wave 26 vendor names with `*` or `_` would break silently.
 *
 * This test scans bot files for the high-risk pattern: a template
 * literal with `${expr}` AND parse_mode: "Markdown" in the same
 * function. When detected, it asserts the file imports
 * `escapeMarkdown` from "./format" so reviewers see the safety net
 * is in place. Files that legitimately don't need it (e.g. ones
 * that only interpolate UUIDs) can opt out with a per-file
 * `// markdown-escape: opt-out` header comment justifying why.
 *
 * This is intentionally a DESIGN check, not a runtime check —
 * we're enforcing "did the dev think about this?" not "is every
 * string safe at runtime". Runtime safety is the job of
 * `escapeMarkdown` + `safeCredentialString`.
 */

const OPT_OUT_MARKER = "markdown-escape: opt-out";

function listBotFiles(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, "..");
  const out: string[] = [];
  function walk(dir: string) {
    for (const name of readdirSync(dir)) {
      if (name === "__tests__") continue;
      if (name === "_deprecated") continue;
      const full = join(dir, name);
      const s = statSync(full);
      if (s.isDirectory()) {
        walk(full);
      } else if (s.isFile() && name.endsWith(".ts")) {
        out.push(full);
      }
    }
  }
  walk(root);
  return out;
}

describe("Wave 25-pre4 — Markdown escape policy", () => {
  it("every file using parse_mode Markdown either imports escapeMarkdown or opts out", () => {
    const violations: string[] = [];

    for (const file of listBotFiles()) {
      const content = readFileSync(file, "utf-8");

      // Skip the format.ts module itself — it DEFINES escapeMarkdown.
      if (file.endsWith("format.ts")) continue;

      // Per-file opt-out: must appear within the first 30 lines so
      // it's visible without scrolling.
      const head = content.split("\n").slice(0, 30).join("\n");
      if (head.includes(OPT_OUT_MARKER)) continue;

      // Heuristic: file uses Markdown parse_mode AND has at least
      // one template literal `\`...${...}...\``. If yes, it must
      // import either `escapeMarkdown` or `safeCredentialString`
      // from "../format" (or "./format").
      const usesMarkdown = /parse_mode\s*:\s*["']Markdown["']/.test(content);
      if (!usesMarkdown) continue;

      const hasTemplateInterp = /`[^`]*\$\{[^`]*`/.test(content);
      if (!hasTemplateInterp) continue;

      const importsEscape = /from\s+["']\.\.?\/(format|telegram\/format)["']/.test(content);
      if (!importsEscape) {
        violations.push(file.split(/[\\/]/).slice(-2).join("/"));
      }
    }

    expect(violations, "Files using parse_mode: \"Markdown\" with template interpolation should import escapeMarkdown / safeCredentialString from ./format, or add \"// markdown-escape: opt-out\" header with rationale").toEqual([]);
  });
});
