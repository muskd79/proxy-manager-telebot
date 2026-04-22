import { describe, it, expect } from "vitest";
import {
  vendorOrderMachine,
  isTerminalVendorOrderStatus,
} from "../vendor-order";

describe("vendorOrderMachine", () => {
  describe("valid forward transitions", () => {
    it("pending -> processing (worker picks up)", () => {
      expect(vendorOrderMachine.canTransition("pending", "processing")).toBe(true);
    });

    it("pending -> failed (validation rejects before call)", () => {
      expect(vendorOrderMachine.canTransition("pending", "failed")).toBe(true);
    });

    it("pending -> cancelled (admin aborts before claim)", () => {
      expect(vendorOrderMachine.canTransition("pending", "cancelled")).toBe(true);
    });

    it("processing -> fulfilled (vendor success)", () => {
      expect(vendorOrderMachine.canTransition("processing", "fulfilled")).toBe(true);
    });

    it("processing -> failed (vendor error)", () => {
      expect(vendorOrderMachine.canTransition("processing", "failed")).toBe(true);
    });

    it("processing -> cancelled (admin force-cancels mid-flight)", () => {
      expect(vendorOrderMachine.canTransition("processing", "cancelled")).toBe(true);
    });

    it("processing -> pending (stuck-lock recovery)", () => {
      expect(vendorOrderMachine.canTransition("processing", "pending")).toBe(true);
    });

    it("fulfilled -> refunded", () => {
      expect(vendorOrderMachine.canTransition("fulfilled", "refunded")).toBe(true);
    });

    it("failed -> pending (admin manual retry)", () => {
      expect(vendorOrderMachine.canTransition("failed", "pending")).toBe(true);
    });
  });

  describe("invalid transitions", () => {
    it("rejects pending -> fulfilled (skipping processing)", () => {
      expect(vendorOrderMachine.canTransition("pending", "fulfilled")).toBe(false);
    });

    it("rejects fulfilled -> pending (no resurrection without refund)", () => {
      expect(vendorOrderMachine.canTransition("fulfilled", "pending")).toBe(false);
    });

    it("rejects cancelled -> pending (terminal)", () => {
      expect(vendorOrderMachine.canTransition("cancelled", "pending")).toBe(false);
    });

    it("rejects refunded -> fulfilled (terminal)", () => {
      expect(vendorOrderMachine.canTransition("refunded", "fulfilled")).toBe(false);
    });

    it("rejects fulfilled -> cancelled (must refund explicitly)", () => {
      expect(vendorOrderMachine.canTransition("fulfilled", "cancelled")).toBe(false);
    });

    it("transition() throws with context on invalid hop", () => {
      expect(() => vendorOrderMachine.transition("cancelled", "pending")).toThrowError(
        /Invalid state transition: cancelled -> pending/,
      );
    });
  });

  describe("isTerminalVendorOrderStatus", () => {
    it("cancelled is terminal", () => {
      expect(isTerminalVendorOrderStatus("cancelled")).toBe(true);
    });

    it("refunded is terminal", () => {
      expect(isTerminalVendorOrderStatus("refunded")).toBe(true);
    });

    it("pending, processing, fulfilled, failed are NOT terminal", () => {
      expect(isTerminalVendorOrderStatus("pending")).toBe(false);
      expect(isTerminalVendorOrderStatus("processing")).toBe(false);
      expect(isTerminalVendorOrderStatus("fulfilled")).toBe(false); // can still refund
      expect(isTerminalVendorOrderStatus("failed")).toBe(false); // can retry
    });
  });
});
