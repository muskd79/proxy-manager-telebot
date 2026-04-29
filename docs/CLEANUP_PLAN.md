# CLEANUP PLAN — proxy-manager-telebot

Ngày: 2026-04-28 | Tool: knip + depcheck + manual grep | Tổng LOC src: 43,370

---

## 1. Quick Wins — XÓA NGAY (không break gì)

| # | File / Symbol | Vấn đề | Action | LOC tiết kiệm |
|---|--------------|---------|--------|--------------|
| 1 | `scripts/seed-test-admin.mjs` | knip: unused file. One-shot script, không có caller nào, không được require bởi build | Delete | ~60 |
| 2 | `src/lib/glossary.ts` | knip: unused file. Export `T` không có importer nào (grep xác nhận — chỉ có file tự tham chiếu). Đã tạo Wave 22M nhưng chưa được dùng | Delete hoặc giữ như reference | ~200 |
| 3 | `src/lib/geoip/country-from-ip.ts` + `src/lib/geoip/__tests__/` | Không có caller nào bên ngoài module. `countryFromIp` chỉ được gọi trong test của chính nó — không có route, không có import trong `src/app/` hay `src/lib/` nào khác | Delete cả folder `src/lib/geoip/` | ~120 (src) + test |
| 4 | `src/proxy.ts` | File này export `async function proxy(...)` + `config` — nhưng Next.js middleware phải có tên `middleware.ts` ở root `src/`. File tên `proxy.ts` không bao giờ được Next.js pick up. Không có importer nào (grep xác nhận). Dead code hoàn toàn | Delete | ~70 |

**Tổng Quick Wins: ~450 LOC**

---

## 2. Unused Exports — CÓ THỂ XÓA (knip confirmed, grep confirmed no-caller)

### 2a. Proxy-labels — badge constants không dùng

| Symbol | File | Vấn đề |
|--------|------|--------|
| `NETWORK_TYPE_BADGE` | `src/lib/proxy-labels.ts:40` | knip: unused. Không có caller ngoài file + test. `proxyStatusBadges()` function thay thế |
| `STATUS_BADGE` | `src/lib/proxy-labels.ts:76` | knip: unused. Tương tự |
| `EXPIRY_BADGE` | `src/lib/proxy-labels.ts:105` | knip: unused. Tương tự |
| `statusLabel` (function) | `src/lib/proxy-labels.ts:87` | knip: unused export. `user-table.tsx` dùng local const cùng tên; `telegram/commands/start.ts` dùng local const cùng tên — KHÔNG import từ proxy-labels |

Action: xóa 4 exports này khỏi `proxy-labels.ts` (~30 LOC).

### 2b. rate-limiter.ts — deprecated function

| Symbol | File | Vấn đề |
|--------|------|--------|
| `checkRateLimit` (HTTP rate limiter) | `src/lib/rate-limiter.ts:37` | knip: unused export. Marked `@deprecated`. Callers dùng `checkAndIncrementUsage` hoặc `checkApiRateLimit`. Không có importer ngoài test + dead proxy.ts |

Action: xóa sau khi xóa `src/proxy.ts` (~40 LOC).

### 2c. auth.ts — requireMinRole

| Symbol | File | Vấn đề |
|--------|------|--------|
| `requireMinRole` | `src/lib/auth.ts:102` | knip: unused export. Tất cả callers dùng wrapper: `requireAdminOrAbove`, `requireSuperAdmin`, `requireAnyRole`. Tuy nhiên đây là internal building block — **cân nhắc** trước khi xóa |

Action: **cần user xác nhận** (xem section 5).

### 2d. Telegram — AUP + confirmKeyboard re-export dư

| Symbol | File | Vấn đề |
|--------|------|--------|
| `AUP_VERSION`, `sendAupPrompt` | `src/lib/telegram/commands/index.ts:13-14` | knip: unused exports từ barrel. `start.ts` import trực tiếp từ `aup.ts`, KHÔNG qua `index.ts` — re-export này dead |
| `confirmKeyboard` | `src/lib/telegram/keyboard.ts:35` | knip: unused. Không có caller nào (grep xác nhận). `revoke.ts` xây keyboard inline |

Action: xóa 2 dòng re-export trong `index.ts`; xóa function `confirmKeyboard` (~10 LOC).

### 2e. types/telegram.ts — interfaces không dùng

| Symbol | Vấn đề |
|--------|--------|
| `TelegramUser`, `TelegramChat`, `TelegramMessage`, `TelegramMessageEntity`, `TelegramCallbackQuery`, `TelegramUpdate`, `BotCommand`, `WebhookInfo`, `BilingualMessages` | knip: toàn bộ file gần như unused. Chỉ `SupportedLanguage` type được dùng. grammy cung cấp types tương đương |

Action: xóa toàn bộ interfaces thừa, giữ `SupportedLanguage` export (~65 LOC giảm, hoặc xóa hẳn file và move `SupportedLanguage` vào nơi dùng).

### 2f. use-pending-requests.ts — notification helpers

| Symbol | File |
|--------|------|
| `requestNotificationPermission`, `isNotificationEnabled`, `setNotificationEnabled` | `src/hooks/use-pending-requests.ts` |

knip: unused. Không có component nào import 3 functions này.

Action: xóa 3 exports (~20 LOC).

---

## 3. Test Setup — Cần cẩn thận

| File | Vấn đề | Action |
|------|--------|--------|
| `src/__tests__/setup/index.ts` | knip: unused file. NHƯNG: đây là barrel export cho alias `@test`. Tests import `@test/factories/...`, `@test/mocks/...` trực tiếp (không qua barrel). Barrel không được dùng nhưng không gây hại | Có thể delete nếu không có test nào import `@test` (không có `@test` bare import — xác nhận bằng grep) |
| `src/__tests__/setup/factories/admin.factory.ts` | knip: unused. Không có test nào import `createAdmin` | Delete sau khi xác nhận |
| `src/__tests__/setup/helpers/api-tester.ts` | knip: unused. `createMockRequest` không được import | Delete sau khi xác nhận |
| `src/__tests__/setup/mocks/auth.ts` | knip: unused. `testAdmins` không được import | Delete sau khi xác nhận |

**Lưu ý:** `createMockSupabaseAdmin` và `createProxies`, `createProxyRequests` trong `src/__tests__/setup/mocks/supabase.ts` và factories khác cũng bị knip flag là unused exports — nhưng chúng được import bởi tests dùng alias `@test/mocks/supabase` (không phải `@test`). **Đây là false positive của knip** do alias resolution. Không xóa.

---

## 4. Files >500 LOC — Cần Split

| File | LOC | Vấn đề | Đề xuất split |
|------|-----|--------|---------------|
| `src/app/api/docs/openapi.ts` | 1213 | Pure data (JSON spec), không logic. Không cần split khẩn nhưng nặng khi load | Tách theo domain: `openapi-proxies.ts`, `openapi-users.ts`, `openapi-requests.ts` rồi merge trong `openapi.ts`. Tiết kiệm cognitive load |
| `src/app/api/__tests__/cron.test.ts` | 1081 | Test file lớn nhất. Nhiều `describe` block độc lập | Tách: `cron-expire-proxies.test.ts`, `cron-expiry-warning.test.ts`, v.v. |
| `src/app/(dashboard)/profile/page.tsx` | 838 | 1 page chứa 4 tab (Profile, Security, 2FA, Sessions), mỗi tab có state và handlers riêng | Tách: `ProfileTab.tsx`, `SecurityTab.tsx`, `TwoFaTab.tsx`, `SessionsTab.tsx` → page.tsx chỉ còn ~100 LOC |
| `src/components/proxies/proxy-import.tsx` | 767 | Import wizard nhiều step | Tách step components |
| `src/app/(dashboard)/bot/simulator/page.tsx` | 625 | Simulator UI + state logic | Tách `SimulatorInput.tsx`, `SimulatorOutput.tsx` |
| `src/app/api/requests/[id]/route.ts` | 604 | GET + PUT (rất dài, có `pickNextProxy` async helper 250+ LOC) | Tách `pickNextProxy` ra `src/lib/proxy-assignment.ts` (~200 LOC) |
| `src/app/(dashboard)/settings/page.tsx` | 603 | Multi-section settings | Tách section components |
| `src/app/(dashboard)/proxies/page.tsx` | 567 | Table page với nhiều state | Tách filter logic |
| `src/app/(dashboard)/admins/[id]/page.tsx` | 523 | Admin detail với nhiều sections | Tách sections |

**Ước tính LOC có thể giảm qua split**: không giảm tổng LOC nhưng cải thiện maintainability. Không bắt buộc làm ngay.

---

## 5. Migration Trùng Prefix — Xử lý

| Cặp file | Vấn đề | Đề xuất |
|----------|--------|---------|
| `010_fix_function_signatures.sql` vs `010_webhook_dedup.sql` | Cùng prefix 010. README đã note: "applied in alphabetical order". Supabase đã apply cả hai, không rename được | **KHÔNG rename** — README giải thích rõ, đây là known issue đã documented. Chỉ cần thêm CI check để tránh lặp lại |
| `015_connection_pool_index.sql` vs `015_cursor_pagination_index.sql` | Cùng prefix 015. `039_wave22q_cleanup.sql` đã DROP INDEX dư (`idx_proxies_created_desc`) | **KHÔNG rename** — 039 đã xử lý hậu quả. README cũng documented |

Action thực tế: **chỉ thêm comment** vào README để prevent future confusion. File đã applied, không chỉnh sửa.

---

## 6. Unused npm Dependencies

| Package | Vấn đề | Action |
|---------|--------|--------|
| `shadcn` | depcheck: "unused". NHƯNG: `globals.css` dùng `@import "shadcn/tailwind.css"` — đây là CSS import, depcheck không scan CSS | **Giữ nguyên** — false positive |
| `tw-animate-css` | depcheck: "unused". NHƯNG: `globals.css` dùng `@import "tw-animate-css"` | **Giữ nguyên** — false positive |
| `@tailwindcss/postcss`, `tailwindcss` | depcheck: "devDependencies unused". Nhưng đây là build tools cần thiết | **Giữ nguyên** — false positive |
| `postcss` | knip: unlisted dependency. Dùng bởi `postcss.config.mjs` | Thêm vào `devDependencies` trong `package.json` để explicit |

---

## 7. Duplicate Logic

| Vấn đề | File A | File B | Mức độ |
|--------|--------|--------|--------|
| `statusLabel` local const | `user-table.tsx:73` (dùng user status: active/blocked/pending/banned) | `proxy-labels.ts:87` export `statusLabel` (dùng proxy status: available/assigned/...) | **Khác domain** — KHÔNG phải duplicate thực sự. Không cần merge |
| `checkRateLimit` có 2 function cùng tên | `src/lib/rate-limiter.ts` (HTTP API, async, DB) | `src/lib/telegram/rate-limit.ts` (Telegram, pure function, no DB) | **Khác mục đích** — naming conflict gây nhầm lẫn. Đề xuất rename HTTP version thành `checkApiRateLimit` (đã có tên đó ở export khác) |
| Proxy type keyboard labels VI/EN giống hệt nhau | `keyboard.ts:proxyTypeKeyboard` | | HTTP/HTTPS/SOCKS5 cùng label 2 ngôn ngữ → nhánh `lang === 'vi'` thừa |

---

## 8. Unused Exported Types (knip)

Các types sau được export nhưng không có consumer bên ngoài file. Phần lớn là utility types trong `database.ts` và `telegram.ts` — có thể hữu ích cho future use hoặc type-narrowing:

| Type | File | Recommendation |
|------|------|----------------|
| `ParsedProxyRow` | `src/lib/csv.ts` | Dùng nội bộ trong `csv.ts` — xóa `export` keyword, giữ type |
| `BackupCodeRow` | `src/lib/backup-codes.ts` | Tương tự — dùng nội bộ |
| `DetectedProxyType`, `ProbeOutcome`, `GeoIpResult` | `src/lib/proxy-detect.ts` | Nếu xóa geoip module, `GeoIpResult` mất theo. Các loại khác — xóa `export` keyword |
| `ProxyStatusValue`, `ExpiryStatus`, `StatusBadge` | `src/lib/proxy-labels.ts` | Xóa `export` nếu không expose public API |
| `AdminRole` enum | `src/types/database.ts` | Xóa nếu dùng string literal union thay enum |
| `Admin`, `Setting`, `AdminInsert`, etc. | `src/types/database.ts` | Database types — **giữ nguyên export**, có thể cần cho future |
| `StateMachineDefinition`, `StateMachine` | `src/lib/state-machine/create-machine.ts` | Xóa `export` — chỉ dùng nội bộ |
| `RateLimitCheckUser`, `GlobalCaps`, `RateLimitDecision` | `src/lib/telegram/rate-limit.ts` | Xóa `export` — internal types |
| Toàn bộ interfaces trong `types/telegram.ts` | `src/types/telegram.ts` | Xem mục 2e |

---

## 9. Tổng Kết

| Category | Files/Symbols | LOC Có Thể Giảm |
|----------|--------------|-----------------|
| Quick wins (delete files) | 4 files | ~450 |
| Unused exports (xóa symbols) | ~25 symbols | ~100 |
| Test setup dead files | 3-4 files | ~60 |
| Unused export keyword (internal types) | ~15 types | 0 (chỉ clean up) |
| **Tổng** | | **~610 LOC** |

LOC hiện tại: 43,370 → ước tính sau cleanup: ~42,760 (~1.5% giảm)

---

## 10. Thứ Tự Thực Hiện

### Batch 1 — Safe, không cần review (làm trước)
1. Delete `scripts/seed-test-admin.mjs`
2. Delete `src/proxy.ts`
3. Delete `src/lib/geoip/` (cả folder)
4. Xóa `confirmKeyboard` khỏi `keyboard.ts`
5. Xóa 2 dòng re-export `AUP_VERSION` + `sendAupPrompt` trong `commands/index.ts`
6. Xóa unused exports trong `types/telegram.ts` (giữ `SupportedLanguage`)
7. Xóa `export` keyword trên internal types: `StateMachineDefinition`, `StateMachine`, `RateLimitCheckUser`, `GlobalCaps`, `RateLimitDecision`
8. Thêm `postcss` vào `devDependencies`
9. Xóa `requestNotificationPermission`, `isNotificationEnabled`, `setNotificationEnabled` trong `use-pending-requests.ts`

### Batch 2 — Cần xác nhận (xem mục 11)
- `src/lib/glossary.ts`
- `src/__tests__/setup/` dead files
- `src/lib/rate-limiter.ts` deprecated `checkRateLimit`

---

## 11. Cần Xác Nhận Của User

| # | Câu hỏi | File |
|---|---------|------|
| A | `src/lib/glossary.ts` (200 LOC, Wave 22M) — chưa dùng nhưng là design artifact. Mày có plan tích hợp `T.xxx` vào UI không? Nếu không, xóa | `src/lib/glossary.ts` |
| B | 3 test helper files trong `src/__tests__/setup/` (admin.factory, api-tester, mocks/auth) — knip confirm không có test nào import. Xóa? | `src/__tests__/setup/factories/admin.factory.ts`, `helpers/api-tester.ts`, `mocks/auth.ts` |
| C | `requireMinRole` trong `auth.ts` — deprecated nhưng là implementation của tất cả `requireXxx` wrappers. Knip flag là "unused export" vì không ai import trực tiếp nó. Giữ export để public API hay đổi thành internal? | `src/lib/auth.ts:102` |
| D | `NETWORK_TYPE_BADGE`, `STATUS_BADGE`, `EXPIRY_BADGE` trong `proxy-labels.ts` — đây là badge style maps (CSS class strings). Có component nào sắp dùng không, hay xóa? | `src/lib/proxy-labels.ts` |
