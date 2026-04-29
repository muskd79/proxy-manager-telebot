import { describe, it, expect } from "vitest";
import {
  mainMenuKeyboard,
  proxyTypeKeyboard,
  languageKeyboard,
  confirmKeyboard,
} from "../keyboard";

/**
 * Wave 23B-bot — regression tests pinning the menu layout user signed
 * off on (8 buttons in 4 rows of 2, specific labels, specific callback
 * data). If a refactor reorders or renames a button, these tests
 * scream BEFORE the bot ships to users.
 */
describe("mainMenuKeyboard (Wave 23B-bot)", () => {
  describe("redesign: 4×2 layout, 8 buttons total", () => {
    it("Vietnamese — labels match user spec", () => {
      const kb = mainMenuKeyboard("vi");
      const rows = kb.inline_keyboard;
      expect(rows).toHaveLength(4);
      expect(rows.every((r) => r.length === 2)).toBe(true);

      const labels = rows.flat().map((b) => b.text);
      expect(labels).toEqual([
        "Yêu cầu proxy",
        "Proxy của tôi",
        "Kiểm tra proxy",
        "Limit yêu cầu",
        "Bảo hành proxy",
        "Lịch sử",
        "Hướng dẫn",
        "English",
      ]);
    });

    it("English — labels translated", () => {
      const kb = mainMenuKeyboard("en");
      const labels = kb.inline_keyboard.flat().map((b) => b.text);
      expect(labels).toEqual([
        "Request proxy",
        "My proxies",
        "Check proxy",
        "Quota & limits",
        "Warranty claim",
        "History",
        "Help",
        "Tiếng Việt",
      ]);
    });

    it("callback data uses menu: prefix in fixed order", () => {
      const kb = mainMenuKeyboard("vi");
      const data = kb.inline_keyboard.flat().map((b) => {
        // grammy InlineKeyboardButton.text variant
        return "callback_data" in b ? b.callback_data : null;
      });
      expect(data).toEqual([
        "menu:request",
        "menu:my",
        "menu:check",
        "menu:limit",
        "menu:warranty",
        "menu:history",
        "menu:help",
        "menu:language",
      ]);
    });

    it("regression: warranty button maps to menu:warranty (not menu:revoke)", () => {
      // The warranty button reuses the /revoke handler at runtime, but
      // its callback_data MUST stay menu:warranty so future warranty
      // schema (Wave 24, Option C) can swap the handler without
      // changing the keyboard.
      const kb = mainMenuKeyboard("vi");
      const warrantyBtn = kb.inline_keyboard[2][0];
      expect("callback_data" in warrantyBtn ? warrantyBtn.callback_data : null).toBe(
        "menu:warranty",
      );
    });
  });
});

describe("proxyTypeKeyboard", () => {
  it("returns 3 type buttons + Hủy/Cancel row (Wave 23B-bot UX)", () => {
    const kb = proxyTypeKeyboard("vi");
    expect(kb.inline_keyboard).toHaveLength(2); // type row + cancel row
    const typeRow = kb.inline_keyboard[0];
    expect(typeRow.map((b) => b.text)).toEqual(["HTTP", "HTTPS", "SOCKS5"]);
    expect(typeRow.map((b) => ("callback_data" in b ? b.callback_data : null))).toEqual([
      "proxy_type:http",
      "proxy_type:https",
      "proxy_type:socks5",
    ]);
    const cancelRow = kb.inline_keyboard[1];
    expect(cancelRow).toHaveLength(1);
    expect(cancelRow[0].text).toBe("Hủy");
    expect("callback_data" in cancelRow[0] ? cancelRow[0].callback_data : null).toBe(
      "proxy_type:cancel",
    );
  });

  it("English Cancel label", () => {
    const kb = proxyTypeKeyboard("en");
    expect(kb.inline_keyboard[1][0].text).toBe("Cancel");
  });
});

describe("languageKeyboard", () => {
  it("offers vi + en", () => {
    const kb = languageKeyboard();
    const row = kb.inline_keyboard[0];
    expect(row.map((b) => b.text)).toEqual(["Tiếng Việt", "English"]);
    expect(row.map((b) => ("callback_data" in b ? b.callback_data : null))).toEqual([
      "lang:vi",
      "lang:en",
    ]);
  });
});

describe("confirmKeyboard", () => {
  it("Vietnamese yes/no", () => {
    const kb = confirmKeyboard("vi");
    expect(kb.inline_keyboard[0].map((b) => b.text)).toEqual(["Có", "Không"]);
  });
  it("English yes/no", () => {
    const kb = confirmKeyboard("en");
    expect(kb.inline_keyboard[0].map((b) => b.text)).toEqual(["Yes", "No"]);
  });
});
