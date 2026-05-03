import { describe, it, expect } from "vitest";
import {
  parseCallback,
  serializeCallback,
  CB,
  type CallbackData,
} from "../callbacks";

/**
 * Wave 25-pre3 (Pass 5.2) — exhaustive coverage of every callback
 * shape produced by keyboard.ts and consumed by handlers.ts.
 *
 * If this test fails, an existing in-flight callback in user chat
 * history will return "Unknown action" after deploy. Take that
 * seriously: prefer adding a backward-compat parse path over
 * deleting one.
 */
describe("parseCallback — every wire shape currently produced", () => {
  // -------------------------------------------------------------------
  // menu:<action>
  // -------------------------------------------------------------------
  it("menu:<8 actions>", () => {
    const actions = [
      "request",
      "my",
      "check",
      "limit",
      "return",
      "history",
      "help",
      "language",
    ] as const;
    for (const a of actions) {
      const parsed = parseCallback(`menu:${a}`);
      expect(parsed).toEqual({ kind: "menu", action: a });
    }
  });

  it("menu:warranty (legacy alias) maps to menu:return", () => {
    expect(parseCallback("menu:warranty")).toEqual({
      kind: "menu",
      action: "return",
    });
  });

  it("menu:<unknown> returns null", () => {
    expect(parseCallback("menu:bogus")).toBeNull();
  });

  // -------------------------------------------------------------------
  // proxy_type:<type|cancel>
  // -------------------------------------------------------------------
  it("proxy_type:http|https|socks5", () => {
    expect(parseCallback("proxy_type:http")).toEqual({
      kind: "type",
      proxyType: "http",
    });
    expect(parseCallback("proxy_type:https")).toEqual({
      kind: "type",
      proxyType: "https",
    });
    expect(parseCallback("proxy_type:socks5")).toEqual({
      kind: "type",
      proxyType: "socks5",
    });
  });

  it("proxy_type:cancel", () => {
    expect(parseCallback("proxy_type:cancel")).toEqual({ kind: "typeCancel" });
  });

  it("proxy_type:bogus returns null", () => {
    expect(parseCallback("proxy_type:bogus")).toBeNull();
  });

  // -------------------------------------------------------------------
  // order_quick:<type> | order_custom:<type> | order_type:cancel
  // -------------------------------------------------------------------
  it("order_quick:<type>", () => {
    expect(parseCallback("order_quick:http")).toEqual({
      kind: "order",
      mode: "quick",
      proxyType: "http",
    });
  });

  it("order_custom:<type>", () => {
    expect(parseCallback("order_custom:socks5")).toEqual({
      kind: "order",
      mode: "custom",
      proxyType: "socks5",
    });
  });

  it("order_type:cancel", () => {
    expect(parseCallback("order_type:cancel")).toEqual({ kind: "orderCancel" });
  });

  // -------------------------------------------------------------------
  // qty:<...>
  // -------------------------------------------------------------------
  it("qty:cancel (no mode)", () => {
    expect(parseCallback("qty:cancel")).toEqual({ kind: "qtyCancel" });
  });

  it("qty:quick:cancel / qty:custom:cancel", () => {
    expect(parseCallback("qty:quick:cancel")).toEqual({
      kind: "qtyCancel",
      mode: "quick",
    });
    expect(parseCallback("qty:custom:cancel")).toEqual({
      kind: "qtyCancel",
      mode: "custom",
    });
  });

  it("qty:<mode>:<type>:<n> (current shape)", () => {
    expect(parseCallback("qty:quick:http:5")).toEqual({
      kind: "qty",
      mode: "quick",
      proxyType: "http",
      quantity: 5,
    });
    expect(parseCallback("qty:custom:socks5:50")).toEqual({
      kind: "qty",
      mode: "custom",
      proxyType: "socks5",
      quantity: 50,
    });
  });

  it("qty:<type>:<n> legacy 2-arg shape defaults to mode='quick'", () => {
    expect(parseCallback("qty:http:3")).toEqual({
      kind: "qty",
      mode: "quick",
      proxyType: "http",
      quantity: 3,
    });
  });

  it("qty:<mode>:<type>:<garbage> returns null", () => {
    expect(parseCallback("qty:quick:http:abc")).toBeNull();
    expect(parseCallback("qty:quick:http:0")).toBeNull();
    expect(parseCallback("qty:quick:http:-5")).toBeNull();
  });

  // -------------------------------------------------------------------
  // confirm:yes / confirm:no
  // -------------------------------------------------------------------
  it("confirm:yes / confirm:no", () => {
    expect(parseCallback("confirm:yes")).toEqual({
      kind: "confirm",
      result: "yes",
    });
    expect(parseCallback("confirm:no")).toEqual({
      kind: "confirm",
      result: "no",
    });
  });

  // -------------------------------------------------------------------
  // check:cancel
  // -------------------------------------------------------------------
  it("check:cancel", () => {
    expect(parseCallback("check:cancel")).toEqual({ kind: "checkCancel" });
  });

  // -------------------------------------------------------------------
  // lang:vi | lang:en
  // -------------------------------------------------------------------
  it("lang:vi / lang:en", () => {
    expect(parseCallback("lang:vi")).toEqual({ kind: "lang", lang: "vi" });
    expect(parseCallback("lang:en")).toEqual({ kind: "lang", lang: "en" });
  });

  it("lang:<unknown> returns null", () => {
    expect(parseCallback("lang:fr")).toBeNull();
  });

  // -------------------------------------------------------------------
  // cancel_confirm:yes|no
  // -------------------------------------------------------------------
  it("cancel_confirm:yes / cancel_confirm:no", () => {
    expect(parseCallback("cancel_confirm:yes")).toEqual({
      kind: "cancelConfirm",
      result: "yes",
    });
    expect(parseCallback("cancel_confirm:no")).toEqual({
      kind: "cancelConfirm",
      result: "no",
    });
  });

  // -------------------------------------------------------------------
  // revoke_confirm:all:<count>  ← MUST come before revoke:
  // revoke:cancel / revoke:<id|"all">
  // -------------------------------------------------------------------
  it("revoke_confirm:all:<count>", () => {
    expect(parseCallback("revoke_confirm:all:5")).toEqual({
      kind: "revokeConfirmAll",
      count: "5",
    });
  });

  it("revoke:cancel", () => {
    expect(parseCallback("revoke:cancel")).toEqual({ kind: "revokeCancel" });
  });

  it("revoke:<uuid>", () => {
    expect(parseCallback("revoke:abc-123-def")).toEqual({
      kind: "revoke",
      target: "abc-123-def",
    });
  });

  it("revoke:all", () => {
    expect(parseCallback("revoke:all")).toEqual({
      kind: "revoke",
      target: "all",
    });
  });

  // -------------------------------------------------------------------
  // admin_*:<id>
  // -------------------------------------------------------------------
  it("admin_approve:<id>", () => {
    expect(parseCallback("admin_approve:req-1")).toEqual({
      kind: "admin",
      action: "approve",
      targetId: "req-1",
    });
  });

  it("admin_reject:<id>", () => {
    expect(parseCallback("admin_reject:req-1")).toEqual({
      kind: "admin",
      action: "reject",
      targetId: "req-1",
    });
  });

  it("admin_approve_user:<id>", () => {
    expect(parseCallback("admin_approve_user:u-1")).toEqual({
      kind: "admin",
      action: "approve_user",
      targetId: "u-1",
    });
  });

  it("admin_block_user:<id>", () => {
    expect(parseCallback("admin_block_user:u-1")).toEqual({
      kind: "admin",
      action: "block_user",
      targetId: "u-1",
    });
  });

  it("admin_bulk_approve:<id>", () => {
    expect(parseCallback("admin_bulk_approve:req-1")).toEqual({
      kind: "admin",
      action: "bulk_approve",
      targetId: "req-1",
    });
  });

  it("admin_bulk_reject:<id>", () => {
    expect(parseCallback("admin_bulk_reject:req-1")).toEqual({
      kind: "admin",
      action: "bulk_reject",
      targetId: "req-1",
    });
  });

  // -------------------------------------------------------------------
  // Unknown / empty
  // -------------------------------------------------------------------
  it("returns null for empty / garbage", () => {
    expect(parseCallback("")).toBeNull();
    expect(parseCallback("garbage")).toBeNull();
    expect(parseCallback(":")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Round-trip: serialize then parse must give back the same union
// ---------------------------------------------------------------------------

describe("serializeCallback ↔ parseCallback round-trip", () => {
  const fixtures: CallbackData[] = [
    { kind: "menu", action: "request" },
    { kind: "menu", action: "language" },
    { kind: "type", proxyType: "http" },
    { kind: "typeCancel" },
    { kind: "order", mode: "quick", proxyType: "https" },
    { kind: "order", mode: "custom", proxyType: "socks5" },
    { kind: "orderCancel" },
    { kind: "qty", mode: "quick", proxyType: "http", quantity: 5 },
    { kind: "qty", mode: "custom", proxyType: "socks5", quantity: 100 },
    { kind: "qtyCancel" },
    { kind: "qtyCancel", mode: "quick" },
    { kind: "qtyCancel", mode: "custom" },
    { kind: "confirm", result: "yes" },
    { kind: "confirm", result: "no" },
    { kind: "checkCancel" },
    { kind: "lang", lang: "vi" },
    { kind: "lang", lang: "en" },
    { kind: "cancelConfirm", result: "yes" },
    { kind: "cancelConfirm", result: "no" },
    { kind: "revokeConfirmAll", count: "5" },
    { kind: "revoke", target: "uuid-123" },
    { kind: "revoke", target: "all" },
    { kind: "revokeCancel" },
    { kind: "admin", action: "approve", targetId: "req-1" },
    { kind: "admin", action: "reject", targetId: "req-1" },
    { kind: "admin", action: "approve_user", targetId: "u-1" },
    { kind: "admin", action: "block_user", targetId: "u-1" },
    { kind: "admin", action: "bulk_approve", targetId: "req-1" },
    { kind: "admin", action: "bulk_reject", targetId: "req-1" },
  ];

  for (const cb of fixtures) {
    it(`round-trip: ${cb.kind}${"action" in cb ? ":" + cb.action : ""}${"mode" in cb ? ":" + cb.mode : ""}`, () => {
      const wire = serializeCallback(cb);
      const reparsed = parseCallback(wire);
      expect(reparsed).toEqual(cb);
    });
  }
});

// ---------------------------------------------------------------------------
// CB.* builders match serializeCallback output
// ---------------------------------------------------------------------------

describe("CB.* builders produce canonical wire format", () => {
  it("CB.menu", () => {
    expect(CB.menu("request")).toBe("menu:request");
    expect(CB.menu("return")).toBe("menu:return");
  });

  it("CB.type / CB.typeCancel", () => {
    expect(CB.type("http")).toBe("proxy_type:http");
    expect(CB.typeCancel()).toBe("proxy_type:cancel");
  });

  it("CB.order / CB.orderCancel", () => {
    expect(CB.order("quick", "https")).toBe("order_quick:https");
    expect(CB.order("custom", "socks5")).toBe("order_custom:socks5");
    expect(CB.orderCancel()).toBe("order_type:cancel");
  });

  it("CB.qty / CB.qtyCancel", () => {
    expect(CB.qty("quick", "http", 5)).toBe("qty:quick:http:5");
    expect(CB.qty("custom", "socks5", 100)).toBe("qty:custom:socks5:100");
    expect(CB.qtyCancel()).toBe("qty:cancel");
    expect(CB.qtyCancel("quick")).toBe("qty:quick:cancel");
    expect(CB.qtyCancel("custom")).toBe("qty:custom:cancel");
  });

  it("CB.confirm", () => {
    expect(CB.confirm("yes")).toBe("confirm:yes");
    expect(CB.confirm("no")).toBe("confirm:no");
  });

  it("CB.checkCancel / CB.lang / CB.cancelConfirm", () => {
    expect(CB.checkCancel()).toBe("check:cancel");
    expect(CB.lang("vi")).toBe("lang:vi");
    expect(CB.cancelConfirm("yes")).toBe("cancel_confirm:yes");
  });

  it("CB.revokeConfirmAll / CB.revoke / CB.revokeCancel", () => {
    expect(CB.revokeConfirmAll(5)).toBe("revoke_confirm:all:5");
    expect(CB.revokeConfirmAll("12")).toBe("revoke_confirm:all:12");
    expect(CB.revoke("uuid-1")).toBe("revoke:uuid-1");
    expect(CB.revoke("all")).toBe("revoke:all");
    expect(CB.revokeCancel()).toBe("revoke:cancel");
  });

  it("CB.admin", () => {
    expect(CB.admin("approve", "r-1")).toBe("admin_approve:r-1");
    expect(CB.admin("approve_user", "u-1")).toBe("admin_approve_user:u-1");
    expect(CB.admin("bulk_reject", "r-1")).toBe("admin_bulk_reject:r-1");
  });
});
