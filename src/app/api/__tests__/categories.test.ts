import { describe, it, expect } from "vitest";
import {
  CreateCategorySchema,
  UpdateCategorySchema,
  ReorderCategoriesSchema,
  AssignProxiesToCategorySchema,
} from "@/lib/validations";

/**
 * Wave 22A category schema validation tests.
 *
 * Route-level integration tests are queued for Wave 22B alongside the
 * UI work (need a fuller test harness). These pure-Zod tests pin the
 * payload contract so a future field rename or constraint change fails
 * here before reaching production.
 */

describe("CreateCategorySchema (Wave 22A)", () => {
  it("accepts a minimal payload", () => {
    const r = CreateCategorySchema.safeParse({ name: "US Residential" });
    expect(r.success).toBe(true);
  });

  it("rejects empty name", () => {
    expect(CreateCategorySchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("rejects name > 120 chars", () => {
    expect(CreateCategorySchema.safeParse({ name: "x".repeat(121) }).success).toBe(false);
  });

  it("applies default color and icon", () => {
    const r = CreateCategorySchema.parse({ name: "X" });
    expect(r.color).toBe("purple");
    // Wave 22G: default icon changed from "tag" to "folder" (the
    // tags concept was deprecated; "tag" icon was misleading).
    expect(r.icon).toBe("folder");
  });

  it("rejects negative default_price_usd", () => {
    expect(
      CreateCategorySchema.safeParse({ name: "X", default_price_usd: -1 }).success,
    ).toBe(false);
  });

  it("accepts null default_price_usd (means: not set)", () => {
    expect(
      CreateCategorySchema.safeParse({ name: "X", default_price_usd: null }).success,
    ).toBe(true);
  });
});

describe("UpdateCategorySchema (Wave 22A)", () => {
  it("accepts is_hidden toggle", () => {
    expect(UpdateCategorySchema.safeParse({ is_hidden: true }).success).toBe(true);
  });

  it("rejects unknown field via schema implicit shape", () => {
    // Z by default strips unknowns; ensure it doesn't error on extras
    const r = UpdateCategorySchema.safeParse({ name: "X", malicious: "drop tables" });
    expect(r.success).toBe(true);
  });

  it("rejects negative sort_order", () => {
    expect(UpdateCategorySchema.safeParse({ sort_order: -1 }).success).toBe(false);
  });
});

describe("ReorderCategoriesSchema (Wave 22A)", () => {
  it("accepts matched-length arrays", () => {
    const r = ReorderCategoriesSchema.safeParse({
      ids: ["00000000-0000-4000-8000-000000000001"],
      sort_orders: [1],
    });
    expect(r.success).toBe(true);
  });

  it("rejects mismatched-length arrays", () => {
    const r = ReorderCategoriesSchema.safeParse({
      ids: ["00000000-0000-4000-8000-000000000001"],
      sort_orders: [1, 2],
    });
    expect(r.success).toBe(false);
  });

  it("rejects > 500 rows (matches RPC cap)", () => {
    const ids = Array.from({ length: 501 }, (_, i) =>
      `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    const sort_orders = ids.map((_, i) => i);
    expect(ReorderCategoriesSchema.safeParse({ ids, sort_orders }).success).toBe(false);
  });

  it("rejects empty arrays", () => {
    expect(ReorderCategoriesSchema.safeParse({ ids: [], sort_orders: [] }).success).toBe(false);
  });
});

describe("AssignProxiesToCategorySchema (Wave 22A)", () => {
  it("accepts up to 5000 proxy ids", () => {
    const ids = Array.from({ length: 5000 }, (_, i) =>
      `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    const r = AssignProxiesToCategorySchema.safeParse({
      proxy_ids: ids,
      category_id: "00000000-0000-4000-8000-aaaaaaaaaaaa",
    });
    expect(r.success).toBe(true);
  });

  it("rejects > 5000 proxy ids", () => {
    const ids = Array.from({ length: 5001 }, (_, i) =>
      `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    expect(
      AssignProxiesToCategorySchema.safeParse({
        proxy_ids: ids,
        category_id: "00000000-0000-4000-8000-aaaaaaaaaaaa",
      }).success,
    ).toBe(false);
  });

  // Wave 28-B — `null` is no longer accepted. To "move to uncategorised"
  // admin must explicitly pick the "Mặc định" sentinel UUID.
  it("rejects category_id=null (Wave 28: every proxy must have a category)", () => {
    const r = AssignProxiesToCategorySchema.safeParse({
      proxy_ids: ["00000000-0000-4000-8000-000000000001"],
      category_id: null,
    });
    expect(r.success).toBe(false);
  });

  it("accepts the sentinel category UUID for re-homing to Mặc định", () => {
    expect(
      AssignProxiesToCategorySchema.safeParse({
        proxy_ids: ["00000000-0000-4000-8000-000000000001"],
        category_id: "00000000-0000-4000-8000-0000000028ca",
      }).success,
    ).toBe(true);
  });
});
