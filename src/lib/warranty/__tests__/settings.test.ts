import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  DEFAULT_WARRANTY_SETTINGS_FULL,
  loadWarrantySettings,
} from "../settings";

/**
 * Wave 26-D bug hunt — pin the upper-bound clamps on every warranty
 * setting key. Pre-fix loadWarrantySettings accepted ANY positive
 * number (no upper limit), so an admin could set max_pending=999999
 * → effectively no anti-abuse cap.
 *
 * Strategy: mock supabaseAdmin to return tampered values, assert the
 * loader falls back to the safe default for out-of-range inputs.
 */

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

import { supabaseAdmin } from "@/lib/supabase/admin";

function mockSettingsRows(rows: Array<{ key: string; value: unknown }>) {
  // Build the chained Supabase JS query mock: from().select().in()
  // returns { data: rows, error: null }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (supabaseAdmin.from as any).mockReturnValue({
    select: vi.fn().mockReturnValue({
      in: vi.fn().mockResolvedValue({ data: rows, error: null }),
    }),
  });
}

describe("loadWarrantySettings — bounds enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns defaults when DB has no rows", async () => {
    mockSettingsRows([]);
    const out = await loadWarrantySettings();
    expect(out).toEqual(DEFAULT_WARRANTY_SETTINGS_FULL);
  });

  it("accepts in-range values", async () => {
    mockSettingsRows([
      { key: "warranty_eligibility_unlimited", value: { value: true } },
      { key: "warranty_max_pending", value: { value: 5 } },
      { key: "warranty_max_per_30d", value: { value: 20 } },
      { key: "warranty_cooldown_minutes", value: { value: 120 } },
      { key: "warranty_reliability_decrement", value: { value: 50 } },
    ]);
    const out = await loadWarrantySettings();
    expect(out.eligibility_unlimited).toBe(true);
    expect(out.max_pending).toBe(5);
    expect(out.max_per_30d).toBe(20);
    expect(out.cooldown_minutes).toBe(120);
    expect(out.reliability_decrement).toBe(50);
  });

  it("rejects max_pending=0 (would block all users) → falls back to default", async () => {
    mockSettingsRows([{ key: "warranty_max_pending", value: { value: 0 } }]);
    const out = await loadWarrantySettings();
    expect(out.max_pending).toBe(DEFAULT_WARRANTY_SETTINGS_FULL.max_pending);
  });

  it("rejects max_pending=21 (above sane upper bound 20) → fallback", async () => {
    mockSettingsRows([{ key: "warranty_max_pending", value: { value: 21 } }]);
    const out = await loadWarrantySettings();
    expect(out.max_pending).toBe(DEFAULT_WARRANTY_SETTINGS_FULL.max_pending);
  });

  it("rejects max_per_30d=0 → fallback", async () => {
    mockSettingsRows([{ key: "warranty_max_per_30d", value: { value: 0 } }]);
    const out = await loadWarrantySettings();
    expect(out.max_per_30d).toBe(DEFAULT_WARRANTY_SETTINGS_FULL.max_per_30d);
  });

  it("rejects max_per_30d=101 (above 100) → fallback", async () => {
    mockSettingsRows([{ key: "warranty_max_per_30d", value: { value: 101 } }]);
    const out = await loadWarrantySettings();
    expect(out.max_per_30d).toBe(DEFAULT_WARRANTY_SETTINGS_FULL.max_per_30d);
  });

  it("accepts cooldown_minutes=0 (admin can disable cooldown)", async () => {
    mockSettingsRows([
      { key: "warranty_cooldown_minutes", value: { value: 0 } },
    ]);
    const out = await loadWarrantySettings();
    expect(out.cooldown_minutes).toBe(0);
  });

  it("rejects cooldown_minutes=99999 (effectively permanent ban) → fallback", async () => {
    mockSettingsRows([
      { key: "warranty_cooldown_minutes", value: { value: 99999 } },
    ]);
    const out = await loadWarrantySettings();
    expect(out.cooldown_minutes).toBe(
      DEFAULT_WARRANTY_SETTINGS_FULL.cooldown_minutes,
    );
  });

  it("accepts cooldown_minutes=1440 (24h max boundary)", async () => {
    mockSettingsRows([
      { key: "warranty_cooldown_minutes", value: { value: 1440 } },
    ]);
    const out = await loadWarrantySettings();
    expect(out.cooldown_minutes).toBe(1440);
  });

  it("rejects cooldown_minutes=1441 (just past 24h) → fallback", async () => {
    mockSettingsRows([
      { key: "warranty_cooldown_minutes", value: { value: 1441 } },
    ]);
    const out = await loadWarrantySettings();
    expect(out.cooldown_minutes).toBe(
      DEFAULT_WARRANTY_SETTINGS_FULL.cooldown_minutes,
    );
  });

  it("rejects negative cooldown → fallback", async () => {
    mockSettingsRows([
      { key: "warranty_cooldown_minutes", value: { value: -5 } },
    ]);
    const out = await loadWarrantySettings();
    expect(out.cooldown_minutes).toBe(
      DEFAULT_WARRANTY_SETTINGS_FULL.cooldown_minutes,
    );
  });

  it("rejects reliability_decrement above 100 → fallback", async () => {
    mockSettingsRows([
      { key: "warranty_reliability_decrement", value: { value: 150 } },
    ]);
    const out = await loadWarrantySettings();
    expect(out.reliability_decrement).toBe(
      DEFAULT_WARRANTY_SETTINGS_FULL.reliability_decrement,
    );
  });

  it("ignores non-number / non-boolean values silently", async () => {
    mockSettingsRows([
      { key: "warranty_eligibility_unlimited", value: { value: "true" } },
      { key: "warranty_max_pending", value: { value: "5" } },
    ]);
    const out = await loadWarrantySettings();
    expect(out).toEqual(DEFAULT_WARRANTY_SETTINGS_FULL);
  });

  it("floor()'s fractional inputs", async () => {
    mockSettingsRows([
      { key: "warranty_max_pending", value: { value: 3.7 } },
    ]);
    const out = await loadWarrantySettings();
    expect(out.max_pending).toBe(3);
  });
});
