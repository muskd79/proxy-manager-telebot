# ARCHITECTURE — Service Layer Refactor (Wave 23C+)

> Source: architect agent, 2026-04-29.
> Mục tiêu: tách 48 route handlers (file lớn nhất 612 LOC) thành service layer như sibling VIA project (28 service file, 7.5k LOC).

## 0. Hiện trạng

- 48 route handlers tại `src\app\api\**\route.ts`. File nặng nhất: `requests\[id]\route.ts` 612 LOC mix auth + CSRF + state-machine + RPC + Telegram + audit + DB-update.
- Mỗi route lặp 6-7 boilerplate: `assertSameOrigin` → `requireXxxRole` → `safeParse` → DB → Telegram → `logActivity` → `NextResponse`.
- VIA reference: `C:\Users\Admin\Documents\quản lý via, giao via và gửi via qua bot tele\src\services\` — pattern service nhận `SupabaseClient` + params, throw `AppError`, route chỉ là vỏ.
- Test mock đã sẵn (`createChainableMock`, `createMockSupabaseAdmin`) — service-shape rất hợp.

## 1. Kiến trúc đích — 3-tier

```
+------------------------------------------------------------------+
| Tier 1: ROUTE (src/app/api/**/route.ts)                          |
|   - HTTP shell: NextRequest, NextResponse                        |
|   - Tối đa 30 LOC/handler                                        |
|   - Gọi createHandler({ role, csrf, schema, audit, handler })    |
|   - KHÔNG chứa business rule                                     |
+------------------------------------------------------------------+
                               |
                               v
+------------------------------------------------------------------+
| Tier 2: SERVICE (src/services/<domain>.service.ts)               |
|   - Pure async function: (supabase, params, ctx) => result       |
|   - Throw AppError/ValidationError/NotFoundError/ConflictError   |
|   - Side-effect: gọi notifications.service, logger, telegram     |
|   - KHÔNG biết NextRequest/NextResponse/cookies/headers          |
+------------------------------------------------------------------+
                               |
                               v
+------------------------------------------------------------------+
| Tier 3: REPOSITORY (src/lib/db/<entity>.repo.ts) — optional      |
|   - Đóng gói query Supabase phức tạp (joins, RPC wrappers)       |
|   - Trả raw row DTO                                              |
|   - KHÔNG throw HTTP error, KHÔNG decrypt, KHÔNG gửi Telegram    |
+------------------------------------------------------------------+
                               |
                               v
                        Supabase / RPC
```

## 2. Convention service file

### 2.1 Naming
- File: `src/services/<domain>.service.ts` (kebab-domain, suffix `.service`).
- Sub-folder `src/services/<domain>/<verb-or-aspect>.ts` chỉ khi domain >500 LOC.
- Function: verb-camelCase mô tả use-case. `approveRequest`, `assignProxy`, `bulkAssignProxies`, `importProxies`, `revokeProxy`, `listProxies`.
- Cấm: `handleXxx`, `doStuff`, `process`, `manage`.

### 2.2 Function signature

```typescript
import type { SupabaseClient } from '@supabase/supabase-js'

export interface ApproveRequestParams {
  requestId: string
  proxyId?: string | null
  autoAssign: boolean
  rejectedReason?: string | null
}

export interface ApproveRequestResult {
  ok: true
  count: number
  audit: string
}

export async function approveRequest(
  supabase: SupabaseClient,
  params: ApproveRequestParams,
  ctx: { adminId: string; adminLabel: string },
): Promise<ApproveRequestResult> { /* ... */ }
```

Quy tắc:
- Tham số đầu LUÔN là `SupabaseClient` (caller inject).
- Tham số 2 là `params` object. Không positional 5+ args.
- Tham số 3 là `ctx` (admin info, ip, ua) — optional.
- Return type explicit, có field `audit: string`.
- Async, return Promise. KHÔNG trả `Response` hay `NextResponse`.

### 2.3 Error pattern: throw, không Result

```typescript
// src/lib/api/errors.ts (port từ VIA)
export class AppError extends Error {
  constructor(message: string, public statusCode = 500, public code?: string) {
    super(message)
    this.name = 'AppError'
  }
}
export class ValidationError extends AppError { /* 400 */ }
export class NotFoundError extends AppError { /* 404 */ }
export class ForbiddenError extends AppError { /* 403 */ }
export class ConflictError extends AppError { /* 409 */ }
export class RateLimitError extends AppError { /* 429 */ }
```

### 2.4 Dependency injection
- **Singleton-import** cho infra cố định: `bot`, `logger`, `supabaseAdmin`.
- **Param-inject** cho thứ thay đổi theo request: `supabase`, `ctx.adminId`, `ctx.ip`.
- KHÔNG factory class. Pure function.

### 2.5 Test mocking
Tận dụng `createMockSupabaseAdmin` đã có. Mỗi `*.service.ts` có file test cùng tên `__tests__/<domain>.service.test.ts`, ≥80%.

## 3. 18 service file đề xuất

| # | File | Public functions | Owner | Dep |
|---|------|---|---|---|
| 1 | `services/requests.service.ts` | `approveRequest`, `rejectRequest`, `cancelRequest`, `listRequests`, `getRequestById` | requests-team | notifications, logger, state-machine/request, repo/proxies |
| 2 | `services/proxies.service.ts` | `listProxies`, `getProxyById`, `createProxy`, `updateProxy`, `softDeleteProxy`, `bulkEditProxies`, `bulkAssignProxies` | proxies-team | repo/proxies, state-machine/proxy |
| 3 | `services/proxy-import.service.ts` | `importProxies`, `previewImport` | proxies-team | csv, validations |
| 4 | `services/proxy-export.service.ts` | `exportProxiesCsv`, `exportProxiesJson` | proxies-team | csv |
| 5 | `services/proxy-check.service.ts` | `checkSingleProxy`, `probeProxy`, `probeBatch` | proxies-team | proxy-checker |
| 6 | `services/categories.service.ts` | `listCategories`, `createCategory`, `updateCategory`, `deleteCategory`, `reorderCategories`, `bulkAssignCategory` | categories-team | repo/categories |
| 7 | `services/users.service.ts` | `listTeleUsers`, `getTeleUserById`, `updateTeleUser`, `listUserProxies` | users-team | repo/tele-users |
| 8 | `services/admins.service.ts` | `listAdmins`, `createAdmin`, `updateAdmin`, `deleteAdmin`, `resetAdminPassword`, `disableAdmin2fa`, `revokeAdminSessions` | admins-team (super-admin) | supabaseAdmin, auth |
| 9 | `services/profile.service.ts` | `getProfile`, `updatePassword`, `updateEmail`, `revokeOwnSessions` | profile-team | supabaseAdmin |
| 10 | `services/two-factor.service.ts` | `enroll2fa`, `verify2fa`, `disable2fa`, `regenerateBackupCodes`, `recover2fa` | profile-team (security-locked) | backup-codes |
| 11 | `services/settings.service.ts` | `getSettings`, `updateSetting`, `listSettingsChangelog` | settings-team (super-admin) | supabaseAdmin |
| 12 | `services/notifications.service.ts` | `sendTelegramHtml`, `sendTelegramDocument`, `notifyOtherAdmins`, `notifyUser*` | bot-team | telegram/send |
| 13 | `services/audit.service.ts` | `logActivity`, `listLogs`, `inferTargetType` | core-team (security-locked) | supabaseAdmin |
| 14 | `services/stats.service.ts` | `getDashboardStats`, `getProxyStats`, `getAnalytics` | dashboard-team | repo/* |
| 15 | `services/bot-simulator.service.ts` | `runSimulatorCommand`, `runSimulatorCallback` | bot-team | telegram/commands |
| 16 | `services/cron.service.ts` | `runHealthCheck`, `runExpireProxies`, `runExpireRequests`, `runCleanup`, `runExpiryWarning` | cron-team (security-locked) | supabaseAdmin, advisory-lock |
| 17 | `services/auth-track.service.ts` | `trackLogin`, `recover2faToken` | auth-team (security-locked) | supabaseAdmin |
| 18 | `services/chat.service.ts` | `listChatMessages`, `sendChatMessage`, `markRead` | bot-team | telegram/send |

Helper layer (repository):
- `lib/db/proxies.repo.ts` — `pickAvailableProxy`, `getProxiesForBulkAssign`
- `lib/db/requests.repo.ts` — `getRequestWithJoins`, `updateRequestStatus`
- `lib/db/tele-users.repo.ts` — `getRateLimitState`, `incrementUsage`

## 4. Migration plan — 3 phase ship-được standalone

### Phase 1 — Pure helpers, zero risk
1. `src/lib/api/errors.ts` (AppError family)
2. `src/lib/api/response.ts` — `okResponse(data)`, `errorResponse(err)`
3. `src/lib/api/sanitize.ts` — `sanitizeErrorMessage`
4. Extract pure helpers: `pickRequestUpdateData`, `formatProxiesAsText`

### Phase 2 — Domain services (Wave B-C-D)

Thứ tự (mỗi sub-wave merge riêng):
1. **Wave B1**: `notifications.service.ts` (đụng nhiều nơi nhất, làm xong unblock)
2. **Wave B2**: `categories`, `users`, `profile` (CRUD đơn giản)
3. **Wave C1**: `proxies.service.ts` + `proxies.repo.ts`
4. **Wave C2**: `proxy-import`, `proxy-export`, `proxy-check`
5. **Wave D1**: `requests.service.ts` (cao rủi ro nhất — `approveRequest` 250 LOC)
6. **Wave D2**: `cron`, `audit`, `stats`, `admins`, `two-factor`, `settings`, `bot-simulator`, `chat`, `auth-track`

Mỗi service ship kèm test ≥80% + cập nhật ≥1 route gọi service.

### Phase 3 — Route thin shell
1. `src/lib/api/create-handler.ts` (port từ VIA, adapt Next 16)
2. Migrate batch theo domain, mỗi PR 5-10 route
3. Route mới look like:
```typescript
export const PUT = createHandler({
  role: 'admin',
  csrf: true,
  schema: UpdateRequestSchema,
  audit: 'request.update',
  handler: ({ supabase, body, params, user }) =>
    updateRequest(supabase, { requestId: params!.id, ...body }, { adminId: user.id, adminLabel: user.email }),
})
```

## 5. Multi-agent workflow rules

### 5.1 Lock-by-domain
Mỗi service ↔ 1 owner team. Cross-team PR phải tag owner + code-reviewer.

### 5.2 Conflict-avoidance
- Service file ≤500 LOC; vượt → tách sub-folder `services/<domain>/`
- Public function header `// PUBLIC: <description>` — git diff dễ đọc
- Internal helper cuối file, prefix `_`
- `git pull --rebase` trước commit

### 5.3 Security-locked services
**Agent nhỏ KHÔNG được tự ý sửa**, phải qua security-reviewer + architect:
- `services/two-factor.service.ts`
- `services/admins.service.ts`
- `services/settings.service.ts`
- `services/audit.service.ts`
- `services/cron.service.ts`
- `services/auth-track.service.ts`
- `lib/auth.ts`, `lib/csrf.ts`, `lib/cron/advisory-lock.ts`

Marker: `// SECURITY-LOCKED — require security-reviewer + architect approval` đầu file.

### 5.4 Test gate trước merge
- PR đụng `services/*.service.ts` MUST kèm test cùng wave
- CI block nếu coverage tổng giảm >2%
- CI block nếu service mới import `NextResponse`/`next/server`
- CI block nếu service >500 LOC mà chưa tách

### 5.5 ADR
Quyết định kiến trúc lớn → ADR `docs/adr/NNN-title.md` (Context/Decision/Consequences). Tag architect + senior dev.

## 6. Anti-pattern CẤM trong service

1. **Cấm import `NextResponse`/`NextRequest`/`next/server`.** CI grep: `rg 'from .next/(server|headers)' src/services/` → zero.
2. **Cấm `cookies()`, `headers()`, `redirect()`** — `ctx` đã carry `ip`, `userAgent`, `adminId`.
3. **Cấm tự `createClient()`.** Service nhận Supabase qua param.
4. **Cấm trả `Response`/status code.** Throw `AppError` thay vì return null mơ hồ.
5. **Cấm `console.*`.** Dùng `logger`.
6. *(bonus)* **Cấm import `@/components/*`.**
7. *(bonus)* **Cấm `fetch('/api/...')`** — import service trực tiếp.

## 7. UI/UX file structure (FE đồng bộ)

```
src/app/(dashboard)/<domain>/
  page.tsx                    # server, fetch via service hoặc API
  loading.tsx, error.tsx      # Next 16 boundaries
  _components/                # private to route
src/components/<domain>/      # shared cross-route
src/hooks/use-<domain>.ts     # client-side data hooks
src/types/<domain>.ts         # DB row + DTO types
```

Convention:
- Server component fetch initial state → pass props
- Client `'use client'` chỉ chứa interaction
- Không gọi Supabase trực tiếp từ client → luôn qua `/api/*`
- Form schema ở `lib/validations.ts` dùng chung client + server

## 8. Acceptance checklist mỗi service mới

- [ ] Path `src/services/<domain>.service.ts`
- [ ] TS interface explicit cho params + result
- [ ] First param `SupabaseClient`
- [ ] Throw `AppError` family
- [ ] File test cùng tên ≥80% coverage
- [ ] Không `console.*`, `NextResponse`, `cookies()`, `headers()`
- [ ] File ≤500 LOC, function ≤50 LOC
- [ ] Header comment: use-case + Wave number
- [ ] Security-locked → marker comment + tag reviewer

## 9. Next 16 caveat

Per `AGENTS.md`: "This is NOT the Next.js you know." Handler factory phải re-verify against `node_modules/next/dist/docs/` trước khi viết — VIA dùng Next 15, có thể có deprecation cần tránh khi port qua Next 16. **Gate trước Phase 3.**
