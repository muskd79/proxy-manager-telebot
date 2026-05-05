/**
 * Wave 28-B — central enforcement helpers for the
 * "every proxy must have a category" rule.
 *
 * One file = one place to read for any future dev or agent that
 * wants to know "where is the category-required logic?". Each
 * route handler imports from here so the Vietnamese error message
 * hierarchy stays consistent across:
 *   - POST   /api/proxies               (single create)
 *   - PATCH  /api/proxies/[id]          (single edit)
 *   - POST   /api/proxies/bulk-edit     (bulk edit RPC)
 *   - POST   /api/proxies/import        (CSV / paste import)
 *   - PATCH  /api/categories/[id]       (sentinel guard)
 *   - DELETE /api/categories/[id]       (sentinel guard)
 *   - POST   /api/categories/bulk-assign (assign N proxies to category)
 *
 * Defence-in-depth — the DB also enforces:
 *   - proxies.category_id NOT NULL with column DEFAULT = sentinel
 *     (mig 068 — silently re-homes any forgotten insert)
 *   - FK ON DELETE SET DEFAULT → orphans re-home automatically
 *   - sentinel-protect triggers — block rename / delete / hide
 *
 * The Zod + helper-function layer here is the early-exit + pretty-
 * error layer; the DB layer is the safety net.
 */

import { NextResponse } from "next/server";
import {
  DEFAULT_CATEGORY_ID,
  DEFAULT_CATEGORY_NAME,
} from "./constants";

// ─── Error codes (machine-readable) ──────────────────────────
// All categories enforcement codes are prefixed CATEGORY_ so log
// search + UI mapping is greppable.
export const CATEGORY_ERROR = {
  MISSING_CATEGORY: "MISSING_CATEGORY",
  INVALID_CATEGORY: "INVALID_CATEGORY",
  CATEGORY_REQUIRED_BULK: "CATEGORY_REQUIRED_BULK",
  DEFAULT_CATEGORY_LOCKED: "DEFAULT_CATEGORY_LOCKED",
  DUPLICATE_NAME: "DUPLICATE_NAME",
} as const;

export type CategoryErrorCode =
  (typeof CATEGORY_ERROR)[keyof typeof CATEGORY_ERROR];

// ─── Vietnamese message hierarchy ────────────────────────────
// One source of truth so a future label tweak lands in 1 file.
export const CATEGORY_ERROR_MESSAGE_VI: Record<CategoryErrorCode, string> = {
  [CATEGORY_ERROR.MISSING_CATEGORY]:
    "Vui lòng chọn danh mục cho proxy. Mỗi proxy phải thuộc một danh mục.",
  [CATEGORY_ERROR.INVALID_CATEGORY]:
    "Danh mục không tồn tại hoặc đã bị xoá. Tải lại danh sách danh mục và thử lại.",
  [CATEGORY_ERROR.CATEGORY_REQUIRED_BULK]:
    'Mọi proxy phải có danh mục — không thể bỏ trống. Chọn "Mặc định" nếu cần proxy không phân loại.',
  [CATEGORY_ERROR.DEFAULT_CATEGORY_LOCKED]:
    `Không thể đổi tên, ẩn, hoặc xoá danh mục hệ thống "${DEFAULT_CATEGORY_NAME}".`,
  [CATEGORY_ERROR.DUPLICATE_NAME]:
    "Danh mục với tên này đã tồn tại.",
};

// ─── Response builders ───────────────────────────────────────
// Routes call these instead of hand-rolling NextResponse.json so
// the wire shape (`{ success: false, error, message, code }`) stays
// uniform with the Wave 27 ApiResponse type.

export function categoryErrorResponse(
  code: CategoryErrorCode,
  status = 400,
  extra?: Record<string, unknown>,
) {
  return NextResponse.json(
    {
      success: false,
      error: code,
      message: CATEGORY_ERROR_MESSAGE_VI[code],
      ...extra,
    },
    { status },
  );
}

// ─── Validation helpers ──────────────────────────────────────

/**
 * Returns null if `category_id` is a valid UUID; returns a
 * `NextResponse` 400 otherwise. Use early-return-pattern in route
 * handlers:
 *
 *   const err = assertCategoryRequired(body.category_id);
 *   if (err) return err;
 *
 * - undefined → 400 MISSING_CATEGORY (caller didn't send the field)
 * - null      → 400 MISSING_CATEGORY (explicit "no category")
 * - ""        → 400 MISSING_CATEGORY
 * - "abc"     → 400 INVALID_CATEGORY (not a UUID; existence check
 *                deferred to DB layer)
 * - valid UUID → null (proceed)
 */
export function assertCategoryRequired(
  category_id: unknown,
): NextResponse | null {
  if (category_id === undefined || category_id === null || category_id === "") {
    return categoryErrorResponse(CATEGORY_ERROR.MISSING_CATEGORY, 400);
  }
  if (typeof category_id !== "string") {
    return categoryErrorResponse(CATEGORY_ERROR.INVALID_CATEGORY, 400);
  }
  // Lightweight UUID shape check — matches what `z.string().uuid()`
  // accepts. Existence-in-DB check is implicit via the FK.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    category_id,
  )) {
    return categoryErrorResponse(CATEGORY_ERROR.INVALID_CATEGORY, 400);
  }
  return null;
}

/**
 * For bulk surfaces (bulk-edit, bulk-assign): explicit-null in the
 * payload means "remove the category" — that's no longer allowed
 * in Wave 28. Returns the typed 400 if `null` was sent.
 */
export function assertCategoryNotUnassigned(
  category_id: unknown,
): NextResponse | null {
  if (category_id === null) {
    return categoryErrorResponse(CATEGORY_ERROR.CATEGORY_REQUIRED_BULK, 400);
  }
  return null;
}

/**
 * Block mutations on the sentinel category. Returns 403 if the
 * caller targets the sentinel with a forbidden field; null if the
 * change is allowed (e.g., editing the default prices is fine —
 * only rename / hide / delete are blocked).
 */
export function assertNotMutatingSentinel(
  categoryId: string,
  intent: { renaming?: boolean; hiding?: boolean; deleting?: boolean },
): NextResponse | null {
  if (categoryId !== DEFAULT_CATEGORY_ID) return null;
  if (intent.renaming || intent.hiding || intent.deleting) {
    return categoryErrorResponse(CATEGORY_ERROR.DEFAULT_CATEGORY_LOCKED, 403);
  }
  return null;
}
