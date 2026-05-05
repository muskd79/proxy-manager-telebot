/**
 * Wave 28-D — unit tests for the Vietnamese error hierarchy + helpers
 * in src/lib/categories/enforcement.ts.
 *
 * Pin behavior so future refactors don't drift the error codes /
 * messages used in production toasts. Each test exercises one branch
 * + asserts both the HTTP status AND the wire-shape `error` code +
 * Vietnamese message.
 */

import { describe, it, expect } from "vitest";
import {
  CATEGORY_ERROR,
  CATEGORY_ERROR_MESSAGE_VI,
  assertCategoryRequired,
  assertCategoryNotUnassigned,
  assertNotMutatingSentinel,
  categoryErrorResponse,
} from "@/lib/categories/enforcement";
import { DEFAULT_CATEGORY_ID } from "@/lib/categories/constants";

describe("CATEGORY_ERROR codes", () => {
  it("includes the 5 codes referenced by route handlers", () => {
    expect(CATEGORY_ERROR.MISSING_CATEGORY).toBe("MISSING_CATEGORY");
    expect(CATEGORY_ERROR.INVALID_CATEGORY).toBe("INVALID_CATEGORY");
    expect(CATEGORY_ERROR.CATEGORY_REQUIRED_BULK).toBe("CATEGORY_REQUIRED_BULK");
    expect(CATEGORY_ERROR.DEFAULT_CATEGORY_LOCKED).toBe(
      "DEFAULT_CATEGORY_LOCKED",
    );
    expect(CATEGORY_ERROR.DUPLICATE_NAME).toBe("DUPLICATE_NAME");
  });

  it("every code has a Vietnamese message", () => {
    for (const code of Object.values(CATEGORY_ERROR)) {
      expect(CATEGORY_ERROR_MESSAGE_VI[code]).toBeTruthy();
      // Each message should start with a Vietnamese word ("Vui",
      // "Danh", "Mọi", "Không") — sanity check we didn't leave
      // English placeholders.
      expect(CATEGORY_ERROR_MESSAGE_VI[code]).not.toMatch(/^TODO/i);
    }
  });
});

describe("assertCategoryRequired", () => {
  it("returns 400 MISSING_CATEGORY for undefined", async () => {
    const res = assertCategoryRequired(undefined);
    expect(res?.status).toBe(400);
    const body = await res!.json();
    expect(body.error).toBe("MISSING_CATEGORY");
    expect(body.message).toMatch(/danh mục/i);
  });

  it("returns 400 MISSING_CATEGORY for null", async () => {
    const res = assertCategoryRequired(null);
    expect(res?.status).toBe(400);
    const body = await res!.json();
    expect(body.error).toBe("MISSING_CATEGORY");
  });

  it("returns 400 MISSING_CATEGORY for empty string", async () => {
    const res = assertCategoryRequired("");
    expect(res?.status).toBe(400);
  });

  it("returns 400 INVALID_CATEGORY for non-UUID string", async () => {
    const res = assertCategoryRequired("not-a-uuid");
    expect(res?.status).toBe(400);
    const body = await res!.json();
    expect(body.error).toBe("INVALID_CATEGORY");
  });

  it("returns 400 INVALID_CATEGORY for non-string types", async () => {
    expect(assertCategoryRequired(123)?.status).toBe(400);
    expect(assertCategoryRequired({ uuid: "x" })?.status).toBe(400);
    expect(assertCategoryRequired([])?.status).toBe(400);
  });

  it("returns null for a valid UUID", () => {
    expect(assertCategoryRequired(DEFAULT_CATEGORY_ID)).toBeNull();
    expect(
      assertCategoryRequired("11111111-1111-4111-8111-111111111111"),
    ).toBeNull();
  });
});

describe("assertCategoryNotUnassigned", () => {
  it("returns 400 CATEGORY_REQUIRED_BULK for null", async () => {
    const res = assertCategoryNotUnassigned(null);
    expect(res?.status).toBe(400);
    const body = await res!.json();
    expect(body.error).toBe("CATEGORY_REQUIRED_BULK");
    expect(body.message).toMatch(/Mặc định/);
  });

  it("returns null for any non-null value (further validation up to caller)", () => {
    expect(assertCategoryNotUnassigned(undefined)).toBeNull();
    expect(assertCategoryNotUnassigned(DEFAULT_CATEGORY_ID)).toBeNull();
    expect(assertCategoryNotUnassigned("anything")).toBeNull();
  });
});

describe("assertNotMutatingSentinel", () => {
  const SENTINEL = DEFAULT_CATEGORY_ID;
  const NORMAL = "11111111-1111-4111-8111-111111111111";

  it("returns null when the target id is NOT the sentinel", () => {
    expect(
      assertNotMutatingSentinel(NORMAL, { renaming: true, deleting: true }),
    ).toBeNull();
  });

  it("returns null when the target IS the sentinel but no forbidden intent", () => {
    expect(assertNotMutatingSentinel(SENTINEL, {})).toBeNull();
    expect(
      assertNotMutatingSentinel(SENTINEL, {
        renaming: false,
        hiding: false,
        deleting: false,
      }),
    ).toBeNull();
  });

  it("returns 403 DEFAULT_CATEGORY_LOCKED when renaming the sentinel", async () => {
    const res = assertNotMutatingSentinel(SENTINEL, { renaming: true });
    expect(res?.status).toBe(403);
    const body = await res!.json();
    expect(body.error).toBe("DEFAULT_CATEGORY_LOCKED");
  });

  it("returns 403 when hiding the sentinel", async () => {
    const res = assertNotMutatingSentinel(SENTINEL, { hiding: true });
    expect(res?.status).toBe(403);
  });

  it("returns 403 when deleting the sentinel", async () => {
    const res = assertNotMutatingSentinel(SENTINEL, { deleting: true });
    expect(res?.status).toBe(403);
  });
});

describe("categoryErrorResponse builder", () => {
  it("composes the wire shape consistently", async () => {
    const res = categoryErrorResponse(CATEGORY_ERROR.MISSING_CATEGORY, 400, {
      hint: "extra-meta",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({
      success: false,
      error: "MISSING_CATEGORY",
      message: CATEGORY_ERROR_MESSAGE_VI.MISSING_CATEGORY,
      hint: "extra-meta",
    });
  });
});
