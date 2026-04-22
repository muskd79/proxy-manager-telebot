import { describe, it, expect } from "vitest";
import { getAdapter, listAdapterKeys, VENDOR_REGISTRY } from "../registry";
import { NotSupportedError } from "../errors";

describe("vendor registry", () => {
  it("registers the 3 launch-ready adapters (Wave 20B: iproyal removed, evomi added)", () => {
    const keys = listAdapterKeys();
    expect(keys).toEqual(expect.arrayContaining(["webshare", "smartproxy", "evomi"]));
    // iproyal was removed in Wave 20B because its ToS prohibits resale.
    expect(keys).not.toContain("iproyal");
  });

  it("returns the same adapter instance on repeat lookup (stable reference)", () => {
    const a = getAdapter("webshare");
    const b = getAdapter("webshare");
    expect(a).toBe(b);
  });

  it("throws a descriptive error for unknown adapter key", () => {
    expect(() => getAdapter("nonexistent")).toThrow(/No adapter registered/);
  });

  it("each adapter has a non-empty capability set", () => {
    for (const [key, adapter] of Object.entries(VENDOR_REGISTRY)) {
      expect(adapter.slug).toBe(key);
      expect(adapter.capabilities.size).toBeGreaterThan(0);
      // All 3 launch adapters must support listProducts (Wave 19 DoD).
      expect(adapter.capabilities.has("listProducts")).toBe(true);
    }
  });

  it("NotSupportedError is thrown for methods the adapter doesn't implement", async () => {
    const adapter = getAdapter("webshare");
    // Webshare doesn't declare rotate capability.
    expect(adapter.capabilities.has("rotate")).toBe(false);
    // And calling rotate throws NotSupportedError from the base class.
    await expect(adapter.rotate({} as never)).rejects.toThrow(NotSupportedError);
  });
});
