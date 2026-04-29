# Test Coverage Gap Analysis — proxy-manager-telebot

> Generated: 2026-04-29 | Baseline: 632 tests passing (vitest) | Wave 23B

---

## 1. Heatmap Coverage

### 1.1 API Routes

| File | Test File | Status | Risk |
|------|-----------|--------|------|
| `api/proxies/route.ts` | `proxies.test.ts` | PARTIAL | HIGH |
| `api/proxies/import/route.ts` | MISSING | NO TEST | CRITICAL |
| `api/proxies/[id]/route.ts` | MISSING | NO TEST | HIGH |
| `api/proxies/bulk-edit/route.ts` | `bulk-edit.test.ts` | EXISTS | MEDIUM |
| `api/proxies/export/route.ts` | MISSING | NO TEST | MEDIUM |
| `api/proxies/check/route.ts` | MISSING | NO TEST | MEDIUM |
| `api/proxies/probe-batch/route.ts` | `probe-batch.test.ts` | EXISTS | LOW |
| `api/proxies/probe/route.ts` | MISSING | NO TEST | MEDIUM |
| `api/proxies/stats/route.ts` | MISSING | NO TEST | MEDIUM |
| `api/requests/route.ts` | MISSING | NO TEST | CRITICAL |
| `api/requests/[id]/route.ts` | `request-approval.test.ts` | PARTIAL | HIGH |
| `api/categories/route.ts` | `categories.test.ts` | EXISTS | LOW |
| `api/categories/[id]/route.ts` | MISSING | NO TEST | HIGH |
| `api/categories/[id]/defaults/route.ts` | MISSING | NO TEST | HIGH |
| `api/categories/bulk-assign/route.ts` | MISSING | NO TEST | CRITICAL |
| `api/categories/reorder/route.ts` | MISSING | NO TEST | MEDIUM |
| `api/cron/cleanup/route.ts` | `cron.test.ts` | EXISTS | LOW |
| `api/cron/expire-proxies/route.ts` | `cron.test.ts` | EXISTS | LOW |
| `api/cron/expire-requests/route.ts` | `cron.test.ts` | EXISTS | LOW |
| `api/cron/expiry-warning/route.ts` | `cron.test.ts` | EXISTS | LOW |
| `api/cron/health-check/route.ts` | `cron.test.ts` | EXISTS | LOW |
| `api/users/route.ts` | MISSING | NO TEST | HIGH |
| `api/users/[id]/route.ts` | MISSING | NO TEST | HIGH |
| `api/users/[id]/proxies/route.ts` | MISSING | NO TEST | HIGH |
| `api/settings/route.ts` | MISSING | NO TEST | HIGH |
| `api/bot-simulator/command/route.ts` | MISSING | NO TEST | LOW |
| `api/stats/route.ts` | MISSING | NO TEST | MEDIUM |
| `api/stats/analytics/route.ts` | MISSING | NO TEST | MEDIUM |
| `api/logs/route.ts` | MISSING | NO TEST | LOW |
| `api/health/route.ts` | MISSING | NO TEST | LOW |
| `api/auth/callback/route.ts` | MISSING | NO TEST | MEDIUM |
| `api/auth/track-login/route.ts` | MISSING | NO TEST | MEDIUM |
| `api/telegram/webhook/route.ts` | `webhook-regression.test.ts` | EXISTS | LOW |

### 1.2 Components

| File | Test File | Status | Risk |
|------|-----------|--------|------|
| `components/proxies/category-picker.tsx` | MISSING | NO TEST | CRITICAL |
| `components/proxies/proxy-import.tsx` | MISSING | NO TEST | CRITICAL |
| `components/proxies/proxy-table.tsx` | MISSING | NO TEST | HIGH |
| `components/proxies/proxy-form.tsx` | MISSING | NO TEST | HIGH |
| `components/proxies/proxy-filters.tsx` | MISSING | NO TEST | MEDIUM |
| `components/proxies/proxy-bulk-edit.tsx` | MISSING | NO TEST | HIGH |
| `components/proxies/proxy-detail.tsx` | MISSING | NO TEST | HIGH |
| `components/proxies/credential-cell.tsx` | MISSING | NO TEST | MEDIUM |
| `components/requests/request-actions.tsx` | MISSING | NO TEST | CRITICAL |
| `components/requests/request-table.tsx` | MISSING | NO TEST | HIGH |
| `components/shared/confirm-dialog.tsx` | MISSING | NO TEST | MEDIUM |
| `components/shared/dangerous-confirm-dialog.tsx` | `dangerous-confirm-dialog.test.tsx` | EXISTS | LOW |
| `components/shared/pagination.tsx` | MISSING | NO TEST | LOW |
| `components/shared/search-input.tsx` | MISSING | NO TEST | LOW |
| `components/categories/CategoryFormDialog.tsx` | MISSING | NO TEST | HIGH |
| `components/users/user-detail.tsx` | MISSING | NO TEST | MEDIUM |
| `components/users/user-proxies-tab.tsx` | MISSING | NO TEST | HIGH |
| `components/users/user-rate-limit.tsx` | MISSING | NO TEST | MEDIUM |

### 1.3 Lib / Logic

| File | Test File | Status | Risk |
|------|-----------|--------|------|
| `lib/csrf.ts` | `csrf.test.ts` | EXISTS (full) | LOW |
| `lib/auth.ts` | `auth.test.ts` | EXISTS | LOW |
| `lib/auth-helpers.ts` | `auth-helpers.test.ts` | EXISTS | LOW |
| `lib/validations.ts` | `validations.test.ts` | EXISTS | LOW |
| `lib/proxy-detect.ts` | `proxy-detect.test.ts` | EXISTS | LOW |
| `lib/proxy-labels.ts` | `proxy-labels.test.ts` | EXISTS | LOW |
| `lib/proxy-checker.ts` | MISSING | NO TEST | HIGH |
| `lib/csv.ts` | `csv.test.ts` | EXISTS | LOW |
| `lib/rate-limiter.ts` | `rate-limiter.test.ts` | EXISTS | LOW |
| `lib/state-machine/proxy.ts` | `state-machine.test.ts` | EXISTS | LOW |
| `lib/state-machine/request.ts` | `state-machine.test.ts` | EXISTS | LOW |
| `lib/telegram/commands/admin-approve.ts` | MISSING | NO TEST | CRITICAL |
| `lib/telegram/commands/bulk-proxy.ts` | MISSING | NO TEST | HIGH |
| `lib/telegram/commands/check-proxy.ts` | MISSING | NO TEST | MEDIUM |
| `lib/telegram/commands/my-proxies.ts` | MISSING | NO TEST | MEDIUM |
| `lib/telegram/commands/history.ts` | MISSING | NO TEST | MEDIUM |
| `lib/telegram/commands/language.ts` | MISSING | NO TEST | LOW |
| `lib/telegram/commands/cancel.ts` | MISSING | NO TEST | MEDIUM |
| `lib/telegram/commands/status.ts` | MISSING | NO TEST | MEDIUM |
| `lib/telegram/commands/aup.ts` | MISSING | NO TEST | LOW |
| `lib/telegram/commands/support.ts` | MISSING | NO TEST | LOW |
| `lib/telegram/format-proxies.ts` | MISSING | NO TEST | HIGH |
| `lib/telegram/keyboard.ts` | MISSING | NO TEST | LOW |
| `lib/telegram/simulator.ts` | MISSING | NO TEST | LOW |
| `lib/telegram/user.ts` | MISSING | NO TEST | MEDIUM |
| `lib/telegram/send.ts` | MISSING (unit) | INDIRECT | MEDIUM |
| `lib/error-tracking.ts` | MISSING | NO TEST | LOW |
| `lib/i18n.tsx` | MISSING | NO TEST | MEDIUM |
| `lib/role-context.tsx` | MISSING | NO TEST | MEDIUM |
| `hooks/use-pending-requests.ts` | MISSING | NO TEST | HIGH |
| `hooks/use-chat.ts` | MISSING | NO TEST | LOW |
| `hooks/use-users.ts` | MISSING | NO TEST | MEDIUM |

---

## 2. Top 20 File Thiếu Test — Rủi Ro Cao

| # | File | Tại sao CRITICAL | Effort |
|---|------|-----------------|--------|
| 1 | `components/proxies/category-picker.tsx` | Mới thêm Wave 23B; inline create category — logic fetch + dialog + onValueChange + onCategoryCreated callback chưa có test nào | S (3-4 it) |
| 2 | `components/proxies/proxy-import.tsx` | Core workflow nhập 1000 proxy; `parseProxyLine()` là pure func dễ test; Wave 23B bỏ "Phân tích" button — cần regression | M (5-7 it) |
| 3 | `api/proxies/import/route.ts` | POST không có test: CSRF check, validation (Zod), upsert-on-conflict batch, category_id mapping, Wave 22K purchase fields | M (6-8 it) |
| 4 | `api/requests/route.ts` | GET list requests (status multi-filter, proxyId filter Wave 22W) + POST create request — zero coverage | M (5-6 it) |
| 5 | `api/requests/[id]/route.ts` | Approve single (safe_assign_proxy RPC + retry loop), bulk approve (bulk_assign_proxies RPC), reject (Telegram notify), state machine guard — chỉ có 1 file test nhỏ về rate limit | L (8-10 it) |
| 6 | `lib/telegram/commands/admin-approve.ts` | Bot admin approve flow — phê duyệt proxy từ Telegram, logic phức tạp, zero test | M (4-6 it) |
| 7 | `api/categories/bulk-assign/route.ts` | Bulk assign category_id cho N proxy — thay đổi inventory lớn, zero test | S (3-4 it) |
| 8 | `api/categories/[id]/defaults/route.ts` | GET/PUT category defaults — prefill logic quan trọng cho proxy-import, zero test | S (3-4 it) |
| 9 | `components/requests/request-actions.tsx` | Approve/Reject actions từ UI — CSRF mutation, state machine enforcement | M (4-5 it) |
| 10 | `lib/proxy-checker.ts` | TCP probe logic — dùng trong health-check cron và probe-batch; không có direct unit test | M (4-5 it) |
| 11 | `api/proxies/[id]/route.ts` | GET/PUT/DELETE single proxy; state machine transition guard, CSRF | M (5-6 it) |
| 12 | `lib/telegram/format-proxies.ts` | Format proxy text/buffer cho Telegram — dùng trong bulk approve notify, zero test | S (3 it) |
| 13 | `components/users/user-proxies-tab.tsx` | Tab proxy của user — show assigned proxies, revoke action | S (3-4 it) |
| 14 | `api/users/[id]/proxies/route.ts` | List/assign proxy to user từ admin UI | S (3-4 it) |
| 15 | `api/settings/route.ts` | GET/PUT app settings — ảnh hưởng toàn bộ system (rate limit defaults, etc.) | S (3-4 it) |
| 16 | `hooks/use-pending-requests.ts` | Hook polling pending requests — dùng trong badge notification header | S (3 it) |
| 17 | `lib/telegram/commands/bulk-proxy.ts` | Bot bulk proxy command — phức tạp, zero test | M (4-5 it) |
| 18 | `lib/i18n.tsx` | i18n provider — render behavior, lang switch | S (3 it) |
| 19 | `components/proxies/proxy-table.tsx` | Main proxy table — sort, filter, bulk select | M (4-5 it) |
| 20 | `api/proxies/export/route.ts` | CSV export — data integrity quan trọng | S (3 it) |

> Effort: S=0.5-1h, M=1-2h, L=2-4h

---

## 3. Spec Mẫu — 5 Test Quan Trọng Nhất

### 3.1 CategoryPicker component

**File:** `src/components/proxies/__tests__/category-picker.test.tsx`

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CategoryPicker } from "../category-picker";

const mockCategories = [
  { id: "cat-1", name: "VN Mobile", default_country: "VN", default_proxy_type: "socks5" },
  { id: "cat-2", name: "US Static", default_country: "US", default_proxy_type: null },
];

describe("CategoryPicker", () => {
  it("renders none label as default option", () => {
    render(
      <CategoryPicker value="" onValueChange={vi.fn()} categories={mockCategories} onCategoryCreated={vi.fn()} />,
    );
    expect(screen.getByText("Không phân loại")).toBeInTheDocument();
  });

  it("shows category name + proxy_type + country suffix in dropdown", async () => {
    // render, open select, find "VN Mobile · SOCKS5 · VN"
  });

  it("calls onValueChange with '' when NONE option selected", () => {
    // select NONE → onValueChange called with ""
  });

  it("opens create dialog when '+ Tạo danh mục mới' selected", async () => {
    // select CREATE_NEW → dialog visible
  });

  it("calls POST /api/categories and fires onCategoryCreated + onValueChange on success", async () => {
    // mock fetch, type name, click Tạo
    // verify onCategoryCreated called with new cat
    // verify onValueChange called with new id
  });

  it("shows toast.error and does NOT close dialog when API returns error", async () => {
    // mock fetch returning { success: false, error: "Trùng tên" }
    // dialog stays open, onCategoryCreated NOT called
  });

  it("disables Tạo button when name is empty whitespace", () => {
    // open dialog, input " ", Tạo button disabled
  });

  it("regression: Enter key in input triggers handleCreate (no double-submit)", async () => {
    // open dialog, type name, press Enter, verify single fetch call
  });
});
```

### 3.2 parseProxyLine (proxy-import pure logic)

**File:** `src/components/proxies/__tests__/proxy-import-parser.test.ts`

```typescript
import { describe, it, expect } from "vitest";
// Export parseProxyLine from proxy-import.tsx OR extract to lib/proxy-parser.ts
// Preferred: extract to src/lib/proxy-parser.ts for direct unit-testability

describe("parseProxyLine", () => {
  it("parses host:port format", () => {
    // parseProxyLine("203.0.113.1:8080", 1)
    // expect { host: "203.0.113.1", port: 8080, valid: true }
  });

  it("parses host:port:user:pass format", () => {
    // expect { username: "user", password: "pass", valid: true }
  });

  it("supports tab-delimited format", () => {
    // "203.0.113.1\t8080\tuser\tpass"
  });

  it("supports semicolon-delimited format", () => {
    // "203.0.113.1;8080;user;pass"
  });

  it("returns invalid for port 0", () => {
    // parseProxyLine("host:0", 1) → valid: false, error: "Invalid port"
  });

  it("returns invalid for port 65536", () => { });

  it("returns invalid for empty host", () => { });

  it("returns invalid for empty line", () => { });

  it("regression: non-numeric port does not throw, returns invalid", () => {
    // parseProxyLine("host:abc", 1) → valid: false
  });

  it("handles unicode hostname without crash", () => {
    // parseProxyLine("日本語.example.com:8080", 1) → valid: true (no throw)
  });
});
```

### 3.3 POST /api/proxies/import

**File:** `src/app/api/__tests__/proxy-import-route.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Mock supabase, auth, logger, csrf (NODE_ENV=test bypasses csrf)
vi.mock("@/lib/supabase/server", ...);
vi.mock("@/lib/auth", ...);
vi.mock("@/lib/logger", ...);

describe("POST /api/proxies/import", () => {
  it("rejects unauthenticated request", async () => {
    // requireAdminOrAbove returns authError
    // expect 401
  });

  it("returns 400 when validation fails (missing host)", async () => {
    // body: { proxies: [{ port: 8080 }] }
    // expect 400 + details.fieldErrors
  });

  it("upserts valid proxies in batches and returns imported count", async () => {
    // body with 3 valid proxies
    // mock upsert returns count: 3
    // expect { imported: 3, skipped: 0, failed: 0 }
  });

  it("counts skipped on upsert conflict (duplicate host:port)", async () => {
    // mock upsert count: 2 for batch of 3 → skipped: 1
  });

  it("persists category_id to all proxies in batch", async () => {
    // body includes category_id: "cat-uuid"
    // assert upsert called with category_id on each row
  });

  it("persists Wave 22K purchase metadata (network_type, vendor_source, purchase_price_usd)", async () => {
    // verify fields mapped correctly in upsert payload
  });

  it("handles DB upsert error: marks batch as failed, continues next batch", async () => {
    // first upsert errors, second succeeds
    // expect failed > 0, imported > 0
  });

  it("regression: SSRF guard rejects private IP in proxy host", async () => {
    // proxies: [{ host: "192.168.1.1", port: 8080 }]
    // expect 400 + SSRF validation error
  });
});
```

### 3.4 GET /api/requests (list + multi-status filter)

**File:** `src/app/api/__tests__/requests-list.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("GET /api/requests", () => {
  it("returns paginated requests for authenticated admin", async () => {
    // mock from("proxy_requests").select(...) → data: [req1, req2]
    // expect { success: true, data: { data, total, page, pageSize } }
  });

  it("filters by single status=pending", async () => {
    // verify .eq("status", "pending") called
  });

  it("filters by multi-status: status=pending,approved (Wave: comma-split)", async () => {
    // verify .in("status", ["pending", "approved"]) called
  });

  it("filters by proxyId (Wave 22W regression fix)", async () => {
    // ?proxyId=proxy-uuid → verify .eq("proxy_id", "proxy-uuid") called
  });

  it("applies sortBy allowlist (rejects arbitrary column)", async () => {
    // ?sortBy=password → safeSort fallback → no leak
  });

  it("returns 401 for unauthenticated request", async () => { });

  it("regression: proxyId filter ignored caused all requests returned (Wave 22W)", () => {
    // This existed: the filter was parsed but never applied to query.
    // regression test: verify proxyId param applies .eq("proxy_id") predicate.
  });
});
```

### 3.5 PUT /api/requests/[id] — state machine guard + approve

**File:** `src/app/api/__tests__/request-state-machine.test.ts`

```typescript
import { describe, it, expect, vi } from "vitest";

describe("PUT /api/requests/[id] — state machine guard", () => {
  it("returns 409 when transitioning approved -> rejected (invalid)", async () => {
    // currentRequest.status = "approved", body.status = "rejected"
    // expect 409 + "Invalid transition: approved -> rejected"
  });

  it("returns 409 when transitioning rejected -> pending (invalid)", async () => { });

  it("allows pending -> approved transition", async () => {
    // mock safe_assign_proxy RPC returns success
    // expect 200
  });

  it("allows pending -> rejected transition", async () => { });

  it("regression: double-approve attempt blocked by state machine (not just DB)", () => {
    // First approve succeeds (status becomes approved).
    // Second approve on same request → 409 from requestMachine.canTransition.
    // Ensures no duplicate proxy assignment or Telegram notification.
  });

  it("returns 400 when auto_assign=true but no available proxy", async () => {
    // pickNextProxy returns null
    // expect 400 + "No matching proxy available"
  });

  it("retries up to 3 times on race-condition (RPC returns 'no longer available')", async () => {
    // RPC returns { success: false, error: "no longer available" } × 2, then success
    // expect 200 after 3 RPC calls
  });
});
```

---

## 4. Playwright E2E Plan — 5 Critical User Flows

> Setup: dùng `e2e-runner` agent. Config tại `e2e/playwright.config.ts`.
> Base URL: `http://localhost:3000`. Auth: seeded admin user fixture.

### Flow 1: Import 1000 Proxy (Wave 23B)

```
File: e2e/proxies/import.spec.ts
Steps:
  1. Login as admin
  2. Navigate to /proxies/import?mode=paste
  3. Paste 5 proxy lines vào textarea
  4. Assert: preview table xuất hiện ngay (debounce 250ms) — không cần click button
  5. Assert: "5 hợp lệ" count hiển thị
  6. Click "Import 5 proxy"
  7. Assert: kết quả card xuất hiện với imported >= 1
Critical assertion: KHÔNG có "Phân tích" button trên trang (Wave 23B regression)
```

### Flow 2: Admin Approve Request (Single Proxy)

```
File: e2e/requests/approve.spec.ts
Steps:
  1. Seed: 1 pending request + 1 available proxy
  2. Navigate to /requests
  3. Click approve trên request đầu tiên
  4. Chọn proxy từ picker
  5. Confirm approve
  6. Assert: request status = "approved" trong table
  7. Assert: proxy status badge = "assigned"
```

### Flow 3: CategoryPicker — Create Inline Category

```
File: e2e/proxies/category-picker.spec.ts
Steps:
  1. Navigate to /proxies/import
  2. Open "Danh mục" dropdown
  3. Click "+ Tạo danh mục mới"
  4. Dialog mở, type "Test Category E2E"
  5. Click "Tạo"
  6. Assert: toast "Đã tạo danh mục" xuất hiện
  7. Assert: dropdown now shows "Test Category E2E" và được chọn
```

### Flow 4: Proxy Expiry Filter (Wave 22L regression)

```
File: e2e/proxies/expiry-filter.spec.ts
Steps:
  1. Seed: 1 proxy expires_at = 3 days from now, 1 = 10 days, 1 = null
  2. Navigate to /proxies?expiryStatus=expiring_soon
  3. Assert: chỉ thấy proxy 3-ngày trong bảng (proxy 10-ngày + null KHÔNG xuất hiện)
  4. Navigate to /proxies?expiryStatus=valid
  5. Assert: proxy 10-ngày VÀ proxy null đều xuất hiện; proxy 3-ngày KHÔNG xuất hiện
Critical regression (Wave 22L): ?expiryStatus=valid trước đây bỏ qua proxies còn 1-6 ngày.
```

### Flow 5: Bot Simulator — /getproxy Command

```
File: e2e/bot/getproxy.spec.ts
Steps:
  1. Seed: 1 available proxy type=http, 1 registered user
  2. Navigate to /bot-simulator
  3. Input telegram_id của user seed
  4. Type command: /getproxy http
  5. Click Send
  6. Assert: response chứa "Yêu cầu đã được gửi" (pending) hoặc proxy details (auto-approve)
  7. Assert: request row mới trong /requests
```

---

## 5. Quy Ước Test Mới

### 5.1 File Naming

```
Unit (lib/utils):    src/lib/__tests__/<module>.test.ts
Unit (component):    src/components/<domain>/__tests__/<component>.test.tsx
Integration (route): src/app/api/__tests__/<resource>[-<action>].test.ts
E2E:                 e2e/<domain>/<flow>.spec.ts
```

### 5.2 Mock Pattern — Supabase

```typescript
// ALWAYS dùng createChainableMock từ @test/mocks/supabase
import { createChainableMock } from "@test/mocks/supabase";

const mockSupabase = {
  from: vi.fn((table: string) => createChainableMock({ data: [], error: null })),
  rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
};
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => mockSupabase),
}));
```

### 5.3 Factory Pattern

```typescript
// Dùng factory từ @test/factories/*
import { createProxy }       from "@test/factories/proxy.factory";
import { createProxyRequest } from "@test/factories/request.factory";
import { createTeleUser }    from "@test/factories/user.factory";
import { createAdmin }       from "@test/factories/admin.factory";

// CategoryOption factory — cần thêm:
// src/__tests__/setup/factories/category.factory.ts
export function createCategory(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    name: "Test Category",
    default_country: null,
    default_proxy_type: null,
    default_isp: null,
    default_network_type: null,
    default_vendor_source: null,
    default_purchase_price_usd: null,
    default_sale_price_usd: null,
    is_hidden: false,
    sort_order: 0,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}
```

### 5.4 Regression Naming Convention

Mỗi bug fix PHẢI kèm 1 test đặt tên theo pattern:

```typescript
it("regression: <bug short description>", () => { ... });

// Ví dụ thực tế đã có:
// it("regression: csrf same-origin check broke Vercel preview URLs (Wave 23B)", ...)
// it("regression: proxyId filter ignored returned all requests (Wave 22W)", ...)
// it("regression: double-approve attempt blocked by state machine", ...)
// it("regression: parseProxyLine non-numeric port throws NaN crash", ...)
// it("regression: expiryStatus=valid excluded proxies with 1-6 days left (Wave 22L)", ...)
```

### 5.5 Auth Mock Pattern (routes)

```typescript
// Reuse pattern từ request-approval.test.ts:
vi.mock("@/lib/auth", () => ({
  requireAnyRole: vi.fn(async () => ({ admin: mockAdmin, error: null })),
  requireAdminOrAbove: vi.fn(async () => ({ admin: mockAdmin, error: null })),
  actorLabel: (a: { full_name?: string | null; email?: string | null }) =>
    a?.full_name || a?.email || "Admin",
}));
// Telegram + logger luôn mock:
vi.mock("@/lib/telegram/send", () => ({
  sendTelegramMessage: vi.fn().mockResolvedValue({ success: true }),
  sendTelegramDocument: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock("@/lib/logger", () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));
```

### 5.6 Component Test Setup

```typescript
// vitest.config.ts đã có environment: "jsdom"
// Cần thêm @testing-library/react nếu chưa có:
// npm install -D @testing-library/react @testing-library/user-event

// Mock fetch cho component tests:
global.fetch = vi.fn();
beforeEach(() => vi.mocked(fetch).mockReset());
```

---

## 6. Files Cần Tạo Ngay (Priority Order)

| Priority | File cần tạo | Dựa trên spec trên |
|----------|-------------|-------------------|
| P0 | `src/components/proxies/__tests__/category-picker.test.tsx` | Spec 3.1 |
| P0 | `src/components/proxies/__tests__/proxy-import-parser.test.ts` | Spec 3.2 |
| P0 | `src/app/api/__tests__/proxy-import-route.test.ts` | Spec 3.3 |
| P1 | `src/app/api/__tests__/requests-list.test.ts` | Spec 3.4 |
| P1 | `src/app/api/__tests__/request-state-machine.test.ts` | Spec 3.5 |
| P1 | `src/__tests__/setup/factories/category.factory.ts` | Factory 5.3 |
| P2 | `src/app/api/__tests__/categories-[id]-defaults.test.ts` | Top-20 #8 |
| P2 | `src/app/api/__tests__/categories-bulk-assign.test.ts` | Top-20 #7 |
| P2 | `src/lib/__tests__/proxy-checker.test.ts` | Top-20 #10 |
| P3 | `e2e/proxies/import.spec.ts` | E2E Flow 1 |
| P3 | `e2e/requests/approve.spec.ts` | E2E Flow 2 |

---

## 7. E2E Setup Notes (dùng `e2e-runner` agent)

```bash
# Install Playwright
npm install -D @playwright/test
npx playwright install chromium

# Tạo file config
# e2e/playwright.config.ts
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://localhost:3000" },
  webServer: { command: "npm run dev", url: "http://localhost:3000", reuseExistingServer: true },
});

# Thêm script vào package.json:
# "test:e2e": "playwright test"
```

Dùng `/e2e-runner` agent để scaffold 5 flows ở Section 4.

---

## 8. Số Liệu Tóm Tắt

| Category | Source Files | Test Files | Coverage % (est.) |
|----------|-------------|------------|-------------------|
| API Routes | 33 | 13 | ~39% |
| Components | 48 | 2 | ~4% |
| Lib/Logic | 45 | 28 | ~62% |
| Telegram Commands | 16 | 4 | ~25% |
| Hooks | 3 | 0 | 0% |
| **Total** | **145** | **47** | **~32%** |

> Target: 80%+ theo rule `common/testing.md`. Gap lớn nhất: components (4%) và API routes (39%).
