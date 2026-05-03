import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { msg } from "../messages";
import { BOT_COMMANDS } from "@/lib/constants";

/**
 * Wave 23E — regression tests pinning the Vietnamese-with-accents
 * + VIA-format port. If a refactor reintroduces unaccented Vietnamese
 * (Tai khoan, Khong, Yeu cau...) these tests scream BEFORE the bot
 * ships to users.
 *
 * Source: docs/PORT_VIA_TEXT_2026-05-02.md TASK 4 accent sweep.
 */

const UNACCENTED_BANLIST = [
  "Tai khoan",
  "Khong co",
  "Cac lenh",
  "Yeu cau",
  "Lich su",
  "Trang thai",
  "Huong dan",
  "Bao loi",
  "Sap het",
  "Da huy",
  "Su dung",
  "Theo gio",
  "Theo ngay",
  "Tong cong",
  "Ho tro",
  "Gui tin nhan",
  "Tin nhan da nhan",
  "Dang kiem tra",
  "Ket qua kiem tra",
  "Het han",
  "Chua co",
  "Gioi han",
  "thanh cong",
  "Ban co chac",
];

describe("Wave 23E — Vietnamese accents (VIA-format port)", () => {
  it("regression: messages.ts has zero unaccented Vietnamese in vi text", () => {
    const offenders: string[] = [];
    for (const [key, value] of Object.entries(msg)) {
      const vi = (value as { vi: string }).vi;
      for (const banned of UNACCENTED_BANLIST) {
        if (vi.includes(banned)) offenders.push(`${key}: "${banned}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  // 2026-05-02 user feedback: native Telegram bot menu (the Menu
  // button in the chat composer area, populated by setMyCommands)
  // was still showing un-accented strings. The descriptions live
  // in BOT_COMMANDS, separate from msg. Pin them too.
  it("regression: BOT_COMMANDS description_vi has zero unaccented strings", () => {
    const offenders: string[] = [];
    for (const cmd of BOT_COMMANDS) {
      for (const banned of UNACCENTED_BANLIST) {
        if (cmd.description_vi.includes(banned)) {
          offenders.push(`${cmd.command}: "${banned}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("help text uses proper accents (Wave 23E port)", () => {
    expect(msg.help.vi).toContain("Hướng dẫn sử dụng");
    expect(msg.help.vi).toContain("Bắt đầu");
    expect(msg.help.vi).toContain("Yêu cầu");
    expect(msg.help.vi).toContain("Kiểm tra");
    expect(msg.help.vi.toLowerCase()).toContain("trạng thái");
    expect(msg.help.vi.toLowerCase()).toContain("lịch sử");
    expect(msg.help.vi).toContain("Hủy");
    // /support description has "Gửi tin nhắn cho admin"
    expect(msg.help.vi).toContain("Gửi tin");
    expect(msg.help.vi).toContain("Đổi ngôn ngữ");
    expect(msg.help.vi).toContain("Giới hạn");
    expect(msg.help.vi).toContain("Mỗi người dùng");
  });

  it("pendingApproval uses proper accents", () => {
    expect(msg.pendingApproval.vi).toContain("Tài khoản");
    expect(msg.pendingApproval.vi).toContain("đang chờ");
    expect(msg.pendingApproval.vi).toContain("phê duyệt");
  });

  it("supportMessageReceived uses proper accents", () => {
    expect(msg.supportMessageReceived.vi).toBe(
      "Tin nhắn đã nhận. Admin sẽ phản hồi sớm.",
    );
  });

  it("revokeConfirmAll uses proper accents", () => {
    expect(msg.revokeConfirmAll.vi).toContain("Bạn có chắc");
    expect(msg.revokeConfirmAll.vi).toContain("Hành động");
  });

  it("cancelConfirmPrompt is 'Hủy tất cả?'", () => {
    expect(msg.cancelConfirmPrompt.vi).toBe("Hủy tất cả?");
  });

  it("noAuth uses 'không xác thực'", () => {
    expect(msg.noAuth.vi).toBe("không xác thực");
  });

  it("expiresSoon uses 'Sắp hết hạn!'", () => {
    expect(msg.expiresSoon.vi).toBe("[!] Sắp hết hạn!");
  });

  it("bulkRequestPending uses 'đang chờ duyệt'", () => {
    expect(msg.bulkRequestPending.vi).toContain("Yêu cầu");
    expect(msg.bulkRequestPending.vi).toContain("đang chờ duyệt");
  });

  it("bulkPartialAssigned uses 'không khả dụng'", () => {
    expect(msg.bulkPartialAssigned.vi).toContain("Đã cấp");
    expect(msg.bulkPartialAssigned.vi).toContain("không khả dụng");
  });
});

// ---------------------------------------------------------------------------
// Wave 25-pre2 (P0 4.A) — extend the banlist scan to ALL bot command files,
// not just messages.ts. The Wave 23E test only caught strings IN messages.ts,
// but the diacritic regression in admin-approve.ts:246 ("Yeu cau proxy bi
// tu choi.") sat in an inline string in a command file and slipped through
// for two waves. Walk every .ts file under src/lib/telegram/commands/ and
// fail on any banlist hit.
// ---------------------------------------------------------------------------

describe("Wave 25-pre2 — diacritic lint across bot command files", () => {
  function listCommandFiles(): string[] {
    // Resolve `<this-test-file>/../../commands` cross-platform.
    // fileURLToPath handles Windows drive letters correctly where
    // URL.pathname does not.
    const here = dirname(fileURLToPath(import.meta.url));
    const dir = join(here, "..", "commands");
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".ts")) continue;
      const full = join(dir, name);
      if (statSync(full).isFile()) out.push(full);
    }
    return out;
  }

  it("regression: command files have zero unaccented Vietnamese in 'vi' branches", () => {
    const offenders: string[] = [];
    for (const file of listCommandFiles()) {
      const content = readFileSync(file, "utf-8");
      // Strip comments — banlist entries in the rationale comment of a
      // 25-pre2 fix shouldn't trip the test. Keep it simple: drop
      // // line comments and /* block */ comments before scanning.
      const stripped = content
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      for (const banned of UNACCENTED_BANLIST) {
        if (stripped.includes(banned)) {
          offenders.push(`${file.split(/[\\/]/).pop()}: "${banned}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Wave 25-pre3 (Pass 5.5) — emoji policy enforcement.
//
// messages.ts:6 has a comment "no emojis" but nothing enforces it. A new
// dev pasting 🚀 into a copy key during Wave 26 would slip through.
// Block the emoji unicode ranges across the entire bot tree (commands +
// messages.ts + keyboard.ts + state.ts + format.ts + handlers.ts + ...).
//
// Range covered: U+1F300–U+1FAFF (Miscellaneous Symbols and Pictographs +
// Supplemental Symbols and Pictographs). Excludes:
//   - U+2700–U+27BF (Dingbats — used legitimately, e.g. ✓ ✗ ✓ ✗)
//   - U+2600–U+26FF (Misc Symbols — sun, snowflake, etc; rare in code)
// In practice we mostly care about the "playful" emoji — 🚀 ❤️ 👍 etc.
//
// Allow per-line override: append `// allow-emoji` comment to keep a
// specific instance (e.g. for tests that intentionally use emoji input).
// ---------------------------------------------------------------------------

describe("Wave 25-pre3 — emoji policy across bot tree", () => {
  function listBotFiles(): string[] {
    const here = dirname(fileURLToPath(import.meta.url));
    const root = join(here, "..");
    const out: string[] = [];
    function walk(dir: string) {
      for (const name of readdirSync(dir)) {
        // Skip __tests__ folder — tests can use any string they want
        // for fixtures (we test emoji handling, etc.).
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

  // Match the BMP emoji ranges. We keep the regex narrow so legit
  // dingbats (U+2713 ✓, U+2717 ✗) and misc symbols are NOT flagged.
  const EMOJI_RE = /[\u{1F300}-\u{1FAFF}]/u;

  it("regression: bot tree has no playful emoji (1F300-1FAFF)", () => {
    const offenders: string[] = [];
    for (const file of listBotFiles()) {
      const content = readFileSync(file, "utf-8");
      const lines = content.split("\n");
      lines.forEach((line, i) => {
        if (line.includes("// allow-emoji")) return;
        const match = line.match(EMOJI_RE);
        if (match) {
          const fileName = file.split(/[\\/]/).slice(-2).join("/");
          offenders.push(
            `${fileName}:${i + 1} contains emoji "${match[0]}" (codepoint U+${match[0].codePointAt(0)?.toString(16).toUpperCase()})`,
          );
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
