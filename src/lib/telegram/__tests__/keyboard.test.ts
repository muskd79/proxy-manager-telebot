import { describe, it, expect } from "vitest";
import {
  mainMenuKeyboard,
  proxyTypeKeyboard,
  languageKeyboard,
  confirmKeyboard,
  orderTypeKeyboard,
  quantityKeyboard,
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
      // Wave 25-pre2 (P0 1.1) — "Bảo hành proxy" → "Trả proxy".
      // Real warranty deferred to Wave 26 (decision-log.md).
      expect(labels).toEqual([
        "Yêu cầu proxy",
        "Proxy của tôi",
        "Kiểm tra proxy",
        "Limit yêu cầu",
        "Trả proxy",
        "Lịch sử",
        "Hướng dẫn",
        "English",
      ]);
    });

    it("English — labels translated", () => {
      const kb = mainMenuKeyboard("en");
      const labels = kb.inline_keyboard.flat().map((b) => b.text);
      // Wave 25-pre2 (P0 1.1) — "Warranty claim" → "Return proxy".
      expect(labels).toEqual([
        "Request proxy",
        "My proxies",
        "Check proxy",
        "Quota & limits",
        "Return proxy",
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
      // Wave 25-pre2 (P0 1.1) — `menu:warranty` → `menu:return` so
      // a future Wave 26 warranty schema can claim `menu:warranty`
      // for itself without colliding with the revoke flow.
      expect(data).toEqual([
        "menu:request",
        "menu:my",
        "menu:check",
        "menu:limit",
        "menu:return",
        "menu:history",
        "menu:help",
        "menu:language",
      ]);
    });

    it("regression: return button maps to menu:return (not menu:revoke or menu:warranty)", () => {
      // Wave 25-pre2 (P0 1.1) — replaces the pre-25 "warranty button
      // maps to menu:warranty" regression. The label and callback
      // both now say "return" so the user mental model and the code
      // agree. Wave 26 warranty schema will introduce a new button
      // with callback `menu:warranty` (or its own namespace).
      const kb = mainMenuKeyboard("vi");
      const returnBtn = kb.inline_keyboard[2][0];
      expect("callback_data" in returnBtn ? returnBtn.callback_data : null).toBe(
        "menu:return",
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

describe("orderTypeKeyboard (Wave 23B-bot, VIA pattern)", () => {
  it("Vietnamese: Order nhanh + Order riêng + Hủy", () => {
    const kb = orderTypeKeyboard("http", "vi");
    expect(kb.inline_keyboard).toHaveLength(2);
    const labels = kb.inline_keyboard[0].map((b) => b.text);
    expect(labels).toEqual(["Order nhanh", "Order riêng"]);
    const cancel = kb.inline_keyboard[1][0];
    expect(cancel.text).toBe("Hủy");
  });

  it("English: Quick + Custom + Cancel", () => {
    const kb = orderTypeKeyboard("https", "en");
    expect(kb.inline_keyboard[0].map((b) => b.text)).toEqual([
      "Quick order",
      "Custom order",
    ]);
    expect(kb.inline_keyboard[1][0].text).toBe("Cancel");
  });

  it("callback data carries proxy type", () => {
    const kb = orderTypeKeyboard("socks5", "vi");
    const data = kb.inline_keyboard[0].map((b) =>
      "callback_data" in b ? b.callback_data : null,
    );
    expect(data).toEqual(["order_quick:socks5", "order_custom:socks5"]);
    const cancelData = kb.inline_keyboard[1][0];
    expect("callback_data" in cancelData ? cancelData.callback_data : null).toBe(
      "order_type:cancel",
    );
  });
});

describe("quantityKeyboard with mode (Wave 23B-bot)", () => {
  it("quick mode: 1/2/5/10 + Hủy, callback qty:quick:<type>:<n>", () => {
    const kb = quantityKeyboard("http", "vi", "quick");
    const allButtons = kb.inline_keyboard.flat();
    const labels = allButtons.map((b) => b.text);
    expect(labels).toEqual(["1", "2", "5", "10", "Hủy"]);
    const data = allButtons
      .filter((b) => "callback_data" in b)
      .map((b) => ("callback_data" in b ? b.callback_data : null));
    expect(data).toEqual([
      "qty:quick:http:1",
      "qty:quick:http:2",
      "qty:quick:http:5",
      "qty:quick:http:10",
      "qty:quick:cancel",
    ]);
  });

  it("custom mode: 5/10/20/50/100 + Hủy", () => {
    const kb = quantityKeyboard("http", "vi", "custom");
    const labels = kb.inline_keyboard.flat().map((b) => b.text);
    expect(labels).toEqual(["5", "10", "20", "50", "100", "Hủy"]);
  });

  it("regression: legacy default keeps quick keyboard", () => {
    // Older callers omit mode; we default to quick to avoid breaking
    // existing slash-command tests that haven't migrated yet.
    const kb = quantityKeyboard("http", "vi");
    expect(kb.inline_keyboard.flat().map((b) => b.text)[0]).toBe("1");
  });
});

// ---------------------------------------------------------------------------
// Wave 25-pre2 (Pass 6.2) — inline button label length budget.
//
// Telegram mobile renders inline buttons in 2 columns at ~140px each on
// 320px-wide phones. Empirically, labels ≤ 12 chars never wrap; 13-14
// occasionally wrap to two lines depending on font; ≥ 15 always wrap.
// Two-line buttons look broken.
//
// We enforce a TEMPORARY ceiling of 14 chars to match what currently
// ships ("Bảo hành proxy" / "Warranty claim" — both 14 — were renamed
// to "Trả proxy" / "Return proxy" in 2.A but other 13-char labels like
// "Yêu cầu proxy" remain). Future Wave 25-pre3 may tighten the budget
// to 12 once labels are shortened with user input. Tracked in
// docs/decision-log.md#button-label-length.
//
// New buttons must respect the 14-char ceiling FROM DAY ONE — that's
// the entire point of having this test.
// ---------------------------------------------------------------------------
describe("Wave 25-pre2 — inline button label length budget", () => {
  const MAX_LABEL_LEN = 14;

  function assertLabels(label: string, value: string) {
    expect(value.length, `${label}: "${value}" exceeds ${MAX_LABEL_LEN} chars`).toBeLessThanOrEqual(
      MAX_LABEL_LEN,
    );
  }

  it("mainMenuKeyboard labels (vi) fit the budget", () => {
    const kb = mainMenuKeyboard("vi");
    for (const btn of kb.inline_keyboard.flat()) {
      assertLabels("mainMenuKeyboard.vi", btn.text);
    }
  });

  it("mainMenuKeyboard labels (en) fit the budget", () => {
    const kb = mainMenuKeyboard("en");
    for (const btn of kb.inline_keyboard.flat()) {
      assertLabels("mainMenuKeyboard.en", btn.text);
    }
  });

  it("orderTypeKeyboard labels fit the budget (both langs)", () => {
    for (const lang of ["vi", "en"] as const) {
      const kb = orderTypeKeyboard("http", lang);
      for (const btn of kb.inline_keyboard.flat()) {
        assertLabels(`orderTypeKeyboard.${lang}`, btn.text);
      }
    }
  });

  it("quantityKeyboard labels fit the budget (both modes, both langs)", () => {
    for (const lang of ["vi", "en"] as const) {
      for (const mode of ["quick", "custom"] as const) {
        const kb = quantityKeyboard("http", lang, mode);
        for (const btn of kb.inline_keyboard.flat()) {
          assertLabels(`quantityKeyboard.${mode}.${lang}`, btn.text);
        }
      }
    }
  });

  it("proxyTypeKeyboard labels fit the budget (both langs)", () => {
    for (const lang of ["vi", "en"] as const) {
      const kb = proxyTypeKeyboard(lang);
      for (const btn of kb.inline_keyboard.flat()) {
        assertLabels(`proxyTypeKeyboard.${lang}`, btn.text);
      }
    }
  });

  it("languageKeyboard labels fit the budget", () => {
    const kb = languageKeyboard();
    for (const btn of kb.inline_keyboard.flat()) {
      assertLabels("languageKeyboard", btn.text);
    }
  });

  it("confirmKeyboard labels fit the budget (both langs)", () => {
    for (const lang of ["vi", "en"] as const) {
      const kb = confirmKeyboard(lang);
      for (const btn of kb.inline_keyboard.flat()) {
        assertLabels(`confirmKeyboard.${lang}`, btn.text);
      }
    }
  });
});
