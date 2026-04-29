# LEARN_VIA_WEB — Phân tích kiến trúc web admin VIA để port qua proxy bot

Nguồn: `C:\Users\Admin\Documents\quản lý via, giao via và gửi via qua bot tele\`
Mục tiêu: rút ra pattern + module để áp dụng cho proxy-manager-telebot.

---

## 1. Kiến trúc tổng thể

### Tier flow VIA (5 lớp)

```
┌─────────────────────────────────────────────────────────────────┐
│ Browser  →  Next.js App Router (RSC + 'use client')             │
└──────────────────┬──────────────────────────────────────────────┘
                   │
   ┌───────────────▼───────────────┐
   │ Page (page.tsx, RSC layout)   │  layout: requireAdmin, fetch role
   └───────────────┬───────────────┘
                   │
   ┌───────────────▼───────────────┐
   │ _components/use*.ts (client)  │  useRequestsState, useRequestsData
   │  - useSWRFetch                │  state + URL sync + realtime sub
   │  - useRealtimeSubscription    │
   └───────────────┬───────────────┘
                   │  fetch(/api/...)
   ┌───────────────▼───────────────┐
   │ /api/<resource>/route.ts      │  createHandler({role, csrf,
   │  - Zod validate               │   rateLimit, schema, audit})
   │  - state-machine.validate     │
   └───────────────┬───────────────┘
                   │  call service fn(supabase, params, orgId)
   ┌───────────────▼───────────────┐
   │ src/services/<x>.service.ts   │  pure functions, no HTTP
   │  - throw AppError/Validation/ │
   │    NotFoundError              │
   │  - call supabase.rpc(...)     │
   │  - side-effect: Telegram bot  │
   └───────────────┬───────────────┘
                   │
   ┌───────────────▼───────────────┐
   │ Supabase (Postgres + RLS)     │  org_id-scoped + user_roles guard
   │  - RPC funcs (atomic txn)     │  approve_request, approve_warranty
   │  - audit_logs (v2)            │
   └───────────────────────────────┘
```

### So với "proxy bot 3-tier đề xuất"

VIA dùng 5 lớp (page → hook → API route → service → DB+RPC). Proposal 3-tier (route → service → DB) thiếu:

- **Hook tách bạch** (`use*.ts`) — gom state + URL sync + SWR + realtime, page chỉ render
- **API factory** (`createHandler`) — tập trung auth/CSRF/rate-limit/audit/schema
- **RPC tier** trong Postgres — atomic transaction (approve_request, approve_warranty_claim) thay vì multi-step JS

Khuyến nghị port: **5-tier giống VIA**, không tự nghĩ ra cấu trúc 3-tier mỏng.

---

## 2. Inventory tab admin

| Tab | Path | Service file | Key features |
|---|---|---|---|
| Dashboard | `app/(admin)/dashboard/` | `services/dashboard/health.service.ts`, `heatmap.service.ts`, `dashboard-attention.service.ts`, `daily-summary.service.ts`, `bot-stats.service.ts`, `stats.service.ts` | KPI + charts + heatmap + activity feed + onboarding checklist + cold-start mode |
| Vias (Accounts) | `app/(admin)/vias/`, `accounts/` | `vias-list.service.ts`, `vias-mutations.service.ts`, `categories.service.ts` | List + filter URL state + bulk recall + import CSV + trash |
| Requests | `app/(admin)/requests/` | `requests.service.ts`, `custom-orders.service.ts`, `approval/helpers.ts` | Unified tabs (standard + custom) + bulk approve/reject + URL `?status=` + presets + realtime |
| Warranty | `app/(admin)/requests/warranty/` (sub-tab via `?tab=warranty`) | `warranty.service.ts` | State machine (pending → approved/rejected/auto_replaced) + auto-mode + force-toggle + bulk |
| Users | `app/(admin)/users/`, `[id]/` | `admin-users.service.ts`, `whitelist.service.ts`, `blacklist-recall.service.ts` | List, detail page, role + limits, whitelist queue, blacklist |
| Admin-users | `app/(admin)/admin-users/` | `admin-users.service.ts` | Web admin role assignment |
| Audit | `app/(admin)/audit/` | `services/audit/audit.service.ts`, `audit-query.service.ts`, `audit-redactor.ts`, `audit-bot-wrapper.ts`, `audit.service.ts` (legacy shim) | Mutating-only filter, target_type, actor_kind, before/after snapshot, redaction |
| Settings | `app/(admin)/settings/` | `settings.service.ts` | Registry-driven validation, changelog, in-process cache invalidation |
| Categories | `app/(admin)/categories/` | `categories.service.ts` | CRUD + inventory stats |
| UID-check | `app/(admin)/uid-check/` (+ `system/`, `watchlist/`) | `uid-check-orchestrator`, `uid-check-html-paste`, `uid-checker-cache`, `uid-checker-core`, `uid-checker-process`, `uid-watchlist-export`, `uid-status-history`, `die-faq-check`, `uid-check-die-faq-probe` (8+ files) | Multi-stage pipeline + cache + watchlist + status history |
| History | `app/(admin)/history/` | uses `audit-query.service.ts` + `vias.queries.ts` | Activity timeline |
| Profile | `app/(admin)/profile/` | (auth/2fa libs) | Self-service (email, password, 2FA, backup codes) |
| Trash | `app/(admin)/trash/` | `trash.service.ts` | Soft-deleted vias + restore |
| Org members | `app/(admin)/org/members/` | route handler in `/api/orgs` | Multi-tenant member management |
| Logs | `app/(admin)/logs/` | (uses `api_request_logs` table) | API request logs |
| Messages | `app/(admin)/messages/` | (`message_logs` table) | Bot↔user messages history |
| Bot | `app/(admin)/bot/` | `bot-stats.service.ts` | Bot health + recent webhooks |

Ngoài tab có 30+ API resource folder dưới `/api/` (custom-orders, broadcast, search, error-report, telegram, notes, login-logs, …).

---

## 3. Service layer pattern

Đọc 5 service: `requests`, `warranty`, `custom-orders`, `settings`, `audit/audit.service`.

### 3.1 Function signature convention

```ts
// Mọi service-fn đều nhận supabase client + params, trả Promise<Result>.
export async function approveRequest(
  supabase: SupabaseClient,
  requestId: string,
  adminEmail: string | undefined,
  categoryId: string | null | undefined,
  orgId: string,                   // ← luôn luôn cuối args
): Promise<{ ok; count; requested; partial; warning?; audit }>
```

**Rule cứng:**
- Không nhận `NextRequest`/`NextResponse` — service "pure", không biết HTTP.
- `orgId` là argument bắt buộc, **không** đọc từ closure/global.
- Trả về object có optional `audit: string` → `createHandler` đọc field này để ghi audit log.
- Trả về optional `auditAction`, `auditEntityId`, `_audit: { after }` để override hành vi mặc định.

### 3.2 Error pattern

**Throw, không Result** — VIA dùng exception, không Result/Either.

| Class | HTTP | Khi dùng |
|---|---|---|
| `ValidationError` | 400 | Input không hợp lệ, blacklist user, status không khớp |
| `NotFoundError` | 404 | Record không tồn tại |
| `AppError(msg, statusCode)` | tùy | Generic — 409 conflict, 500 db error, 400 business rule |

`createHandler` bắt `AppError` → JSON `{error, code}` + `sanitizeErrorMessage` (xóa table/column/constraint khỏi message).

### 3.3 Transaction handling

**Phương án chính: Postgres RPC**, không multi-step JS.

```ts
const { data, error } = await supabase.rpc('approve_request', {
  p_request_id: requestId,
  p_category_id: categoryId,
  p_live_only: liveOnly,
  p_org_id: orgId,
});
```

RPC trả về JSON `{ success, error, chat_id, vias[], count }`. Atomic: select via available + update via.status + insert distribution_history + update request.status trong 1 transaction.

**Nếu cần rollback ngoài transaction**: tách helper riêng (`rollbackFailedDistribution` ở `lib/db/rollback.ts`) — sau khi RPC commit, nếu Telegram delivery fail thì revert vias về `available` + xóa distribution_history. Pattern này được share giữa `requests.service`, `custom-orders.service`, và bot `getvia` handler.

### 3.4 Telegram side-effect handling

Always **wrapped in try/catch**, never block the success return:

```ts
try {
  await sendTelegramHtml(chat_id, message);
} catch (telegramError) {
  // Rollback trên DB
  await rollbackFailedDistribution({...});
  // Notify admins về failed delivery
  await notifyAdmins(bot, `⚠️ Delivery failed...`);
  deliveryWarning = 'Delivery failed, vias rolled back';
}
return { ok: true, count, ..., warning: deliveryWarning };
```

**File-vs-text delivery**: `shouldUseFileDelivery(count, orgId)` quyết định gửi `.txt` attachment khi >threshold hoặc data quá dài. `logFileDelivery` ghi vào `bot_files` để admin có thể resend.

### 3.5 Audit log integration

Hai con đường:

1. **Auto-audit qua `createHandler`**: cấu hình `audit: 'request_action'` hoặc object `{ action, beforeFn }`. Handler return `{ audit: 'detail string', auditEntityId, _audit: { after } }`. Snapshot before/after được redact + insert audit_logs.

2. **Manual `logAudit()`** trong service khi cần action động (bulk operations):
```ts
await logAudit('bulk_approve', `Bulk approve: ${success} ok, ${failed} fail`, user.email, undefined, orgId);
```

Bot context dùng `botAudit({ ctx, action, orgId, entityId, before, after })` — auto-derives `actorEmail` = `bot:<username>`.

---

## 4. Tab Requests — chi tiết

### 4.1 List query — offset pagination

```ts
// useRequestsData.ts
const requestsUrl = `/api/requests?page=1&limit=20&status=pending&search=...`
const { data, mutate } = useSWRFetch<{data, total, blacklistedIds}>(requestsUrl);
```

API route: `query.range(offset, offset + limit - 1)` + `count: 'exact'` khi có filter, `count: 'estimated'` (từ `pg_class.reltuples`) khi list nguyên bảng. Helper: `pickCountMode(searchParams)`.

### 4.2 Bulk approve/reject UX

- POST `/api/requests/bulk` body `{ action: 'approve'|'reject', ids: string[], category_id?, reason? }`.
- Approve: chạy `Promise.allSettled` theo batch 5 (tránh exhaust connection pool); pre-fetch `lang_<userId>` cho tất cả users trong **1 query** (giảm 2N → 1).
- Reject: 1 batch UPDATE + parallel notify.
- Trả về `{ success, failed, errors[] }`.
- Modal confirm dùng `ConfirmDialog` với reason field cho reject.

### 4.3 Filter URL state sync

Hook `useUrlStatusTab` — `?status=pending` là source of truth, sync 2-chiều với state. Pattern:

```ts
const { tab: statusTabUrl, setTab } = useUrlStatusTab({
  onChange: (next) => {
    state.setStatusTab(next);
    state.setPage(1);
    state.setSelected(new Set());
  }
});
useEffect(() => {                         // hydrate state từ URL khi paste link
  if (state.statusTab !== statusTabUrl) state.setStatusTab(statusTabUrl);
}, [statusTabUrl]);
```

Filter presets: `useFilterPresets<Filters>('request-filter-presets')` — lưu localStorage, share-able qua URL.

### 4.4 Search

- Debounce 300ms (`SEARCH_DEBOUNCE_MS`).
- Server-side: `buildIlikeOrFilter(search, ['telegram_username','telegram_first_name','order_code'])` — sanitize ký tự `%`, `_`, `,`, `.`, `(`, `)`, `*`, NUL, CR, LF (PostgREST `.or()` parser). Quan trọng: helper được đùng ở 12+ services để khỏi "miss" như `warranty.service` từng bị (Wave 53 Phase 3.3aw).
- Max length 200 ký tự server-side.

### 4.5 Pagination

Offset (`?page=N&limit=20`). API route clamp `limit` ≤ 100. Client tính `totalPages = Math.ceil(total/limit)`.

Audit module dùng **cursor-based** (`createdAt + id`), giới hạn 200/lần — chỉ áp dụng cho table dày như audit_logs. Requests dùng offset cho UX "go to page N".

### 4.6 Real-time refresh

**Supabase Realtime + debounce**, không polling.

```ts
useRealtimeSubscription('requests', fetchRequests);  // 500ms debounce default
```

`RealtimeProvider` pool 1 channel/table chia sẻ giữa nhiều consumer. Callback ref-based để tránh re-subscribe.

`useSWRFetch` smart-defaults: `revalidateOnFocus: true` (off khi có `refreshInterval`), `keepPreviousData: true`, `dedupingInterval: 5000`, `errorRetryCount: 3`.

### 4.7 Drawer/modal pattern

Single context `RequestsContext` chứa `state` + `actions` + `exporting/exportCsv` để tránh prop-drill 10 level. Modal state ở `useRequestsPageActions`:

```ts
{ approveModal, setApproveModal, rejectModal, setRejectModal,
  bulkApproveModal, bulkRejectModal,
  warrantyRejectModal, bulkWarrantyApproveModal, ... }
```

Mỗi modal là 1 controlled component nhận `open`, `onClose`, `onConfirm`. Chi tiết drawer (request detail) là route con `[id]/page.tsx` (RSC), không drawer.

---

## 5. Tab Warranty — chi tiết (porting candidate cao priority)

### 5.1 Schema `warranty_claims`

Cột chính (suy từ select queries):

| Column | Type | Note |
|---|---|---|
| id | uuid PK | |
| org_id | uuid | tenant scope |
| via_id | uuid FK → vias | via gốc bị lỗi |
| claimed_by | text | telegram_user_id |
| claimed_username | text | |
| reason | text | user-provided |
| order_code | text | nullable, to track |
| status | enum | pending, approved, rejected, auto_replaced |
| replacement_via_id | uuid FK | via thay thế (sau approve) |
| admin_note | text | nullable |
| processed_by | text | admin email |
| processed_at | timestamptz | |
| is_free | boolean | true = warranty miễn phí |
| price | numeric | 0 nếu free |
| created_at | timestamptz | |
| warranty_status (cột trên `vias`) | text | rejected/etc — track trên via gốc |

FK alias: `warranty_claims_via_id_fkey` (via gốc), `warranty_claims_replacement_via_id_fkey` (via mới) — phải khai báo trong PostgREST select để disambiguate.

### 5.2 State machine

```ts
// lib/state-machine/warranty.ts
{
  initial: 'pending',
  transitions: [
    { from: 'pending', to: 'approved', guard: 'Admin approves' },
    { from: 'pending', to: 'rejected', guard: 'Admin rejects' },
    { from: 'pending', to: 'auto_replaced', guard: 'System auto-replaces' },
    { from: 'approved', to: 'pending', guard: 'RPC reverts on failure' },
  ]
}
```

Validate ở `validateTransition('warranty', from, to)` — gọi từ `/api/warranty/route.ts` POST trước khi vào service.

### 5.3 Admin actions

| Action | Path | Logic |
|---|---|---|
| approve_auto | POST `/api/warranty` | Service chọn replacement via từ same category, available, exclude die khi `distribute_live_only=true`. Check 2 setting: `warranty_auto_mode_force` (super-global) → bypass per-user; nếu không, check `user_limits.auto_approve_warranty` |
| approve_manual | POST `/api/warranty` | Admin chọn `replacement_via_id` thủ công |
| reject | POST `/api/warranty` | UPDATE status='rejected' + revert via gốc về `distributed` (chỉ khi vẫn ở `reported`) + sendWarrantyNotification |
| bulk_approve / bulk_reject | POST `/api/warranty/bulk` | Wave 55 |
| resend (replacement via) | POST `/api/warranty/[id]/resend` | Nếu user block bot lúc đầu, admin resend |
| resend_bulk | POST `/api/warranty/resend-bulk` | |

Approve flow gọi RPC `approve_warranty_claim(p_claim_id, p_replacement_via_id, p_admin_email, p_admin_note, p_is_free, p_price, p_org_id)` — atomic claim status + via assign + distribution row. Sau đó service post-fetch `vias.data` (encrypted), `decryptViaData`, gửi qua Telegram.

**Decryption integrity guard** (Wave 53 Phase 3.3el): không bao giờ ship `[DECRYPTION_FAILED]` sentinel ra user — log error, skip notify, để admin investigate. Đây là precedent quan trọng cho proxy nếu lưu credential.

### 5.4 Customer notification

```ts
sendWarrantyNotification(claim.claimed_by, 'approved'|'rejected', {
  replacementUid, replacementData,  // for approved
  reason,                           // for rejected
})
```

Wrapped try/catch — nếu notify fail, return có `warning: 'Via assigned but notification failed. Resend manually.'`. RPC đã commit nên DB nhất quán; admin UI hiển thị approved + Resend button.

### 5.5 Đánh giá port qua proxy bot

**Cao priority**: Warranty là module hoàn chỉnh, có thể coi là blueprint cho "proxy issue claim" (proxy chết → user khiếu nại → admin replace). Schema giống nhau ~95%, chỉ đổi `via_id` → `proxy_id`. Effort: **M**.

---

## 6. Multi-org pattern

### 6.1 Schema

- `organizations` table: `(id, name, slug)`.
- `user_roles`: `(user_id, email, role, org_id)` — 1 user thuộc nhiều org, mỗi (user, org) 1 row.
- Mọi business table có cột `org_id uuid` + composite PK với `org_id` khi cần (settings: `(key, org_id)` PK).
- RLS chính sách scope theo `org_id` ∈ `user_roles.org_id` của caller.

### 6.2 RLS policy

Migration 174 + 177 (initplan optimisation) — ví dụ pattern:
```sql
USING (org_id IN (SELECT org_id FROM user_roles WHERE user_id = (SELECT auth.uid())))
```
SELECT auth.uid() được wrap để planner cache 1 lần thay vì gọi mỗi row (`initplan`).

### 6.3 OrgContext.tsx pattern

```ts
// contexts/OrgContext.tsx
const ORG_STORAGE_KEY = 'via-active-org';
fetch('/api/orgs') → list orgs user thuộc
localStorage save activeOrgId
useMemo memoise context value (Wave 53 Phase 3.3dw — tránh re-render mọi consumer mỗi state change)
```

Quan trọng: orgId trên client **chỉ để hiển thị + filter UI**. Server resolved từ `user_roles` (LRU cache 30s in-process) — **không tin client header/body**.

```ts
// lib/auth.ts requireAdmin()
const { data: roleData } = await adminClient.from('user_roles')
  .select('role, org_id').eq('user_id', user.id).limit(1).single();
// orgId = roleData.org_id; cache 30s.
```

(Hạn chế hiện tại: nếu user thuộc 2 org thì server lấy `.limit(1)` — tức server-side org switch chưa có; client switcher chỉ ảnh hưởng SWR URL filter. Đây là tech debt, không phải feature.)

### 6.4 Org switcher UI

`components/layout/OrgSwitcher.tsx` — chỉ render khi `isMultiOrg=true`. Keyboard nav (Up/Down/Enter/Esc/Home/End), `aria-listbox`, role badge per org.

---

## 7. Audit module

### 7.1 Schema `audit_logs` v2 (migration 182)

| Column | Type | Note |
|---|---|---|
| id | uuid PK | |
| org_id | uuid | tenant |
| action | text | e.g. `via_create`, `request_approve` |
| user_email | text | actor identity (email or `bot:<u>` or `system`) |
| actor_id | uuid | auth.users UUID (web only) |
| actor_kind | text | `admin`, `system`, `bot`, `cron` (CHECK) |
| target_type | text | `via`, `request`, `warranty`, `setting`... (CHECK, 15 values) |
| entity_id | text | string ID (legacy) |
| target_id_uuid | uuid | derived khi entity_id là UUID — index riêng |
| details | text | human readable |
| before | jsonb | snapshot trước (redacted) |
| after | jsonb | snapshot sau (redacted) |
| metadata | jsonb | extra context |
| ip | text | |
| user_agent | text | |
| created_at | timestamptz | |

Index: `idx_audit_logs_entity_lookup (org_id, target_type, target_id_uuid, created_at desc)`, `idx_audit_logs_actor (org_id, actor_id, created_at desc)`. Immutability trigger (mig 175) — không cho UPDATE/DELETE rows ngoài cron purge.

### 7.2 Service shape

```
src/services/audit/
├── audit.service.ts          # logAudit(input) — write path duy nhất
├── audit-actions.ts          # TARGET_TYPES, ACTOR_KINDS const, inferTargetType()
├── audit-redactor.ts         # redactSnapshot — strip data/password/secret/token/*key
├── audit-bot-wrapper.ts      # botAudit({ctx, action, ...}) cho grammY bot
├── audit-query.service.ts    # queryAuditForTarget, queryAuditByActor (cursor)
└── index.ts                  # barrel
```

`logAudit` never throws — try/catch internal + logger.error. Audit failure không bao giờ crash user action.

Redaction list: `data, password, secret, token, bot_token, webhook_secret, encryption_key_id` + suffix `key$/i`. Áp dụng recursive vào nested JSON. Trigger trong DB (mig 182) là defense-in-depth.

### 7.3 createHandler integration

Config:
- String form `audit: 'action_name'` → legacy `logAuditLegacy(action, detail, email, entityId, orgId)`.
- Object form `audit: { action, beforeFn }` → V2 với before/after snapshot.

Handler return:
- `audit: 'human detail'` → `details` column
- `auditAction: 'override_action'` → override `action` (vd `force_auto_enabled`)
- `auditEntityId: '...'` → `entity_id` column
- `_audit: { after: {...} }` → `after` snapshot

`isClientErrorResponse` (4xx) skip audit — chỉ audit 2xx success + 5xx server error.

### 7.4 Retention cron

Migration 183 — `purge_old_audit_logs(p_org_id, p_older_than_days DEFAULT 180)`. Two-tier khi gọi với default:

| target_type / actor_kind | TTL |
|---|---|
| `actor_kind='cron'` hoặc `target_type='session'` | 30 days |
| `target_type='setting'` | 365 days (compliance) |
| còn lại | 90 days |

Org-membership guard (mig 180): caller phải có row trong `user_roles` ứng với `p_org_id`, nếu không RAISE. Cron tick gọi `purge_old_audit_logs(orgId)` cho mỗi org độc lập.

---

## 8. Top 10 pattern đáng port qua proxy bot

| # | Pattern | Path nguồn | Effort | Priority | Lý do |
|---|---|---|---|---|---|
| 1 | `createHandler` API factory (auth + CSRF + rate-limit + Zod + audit) | `lib/api/create-handler.ts` | M | **P0** | Không có nó, mỗi route lặp 80 LOC boilerplate. Phải port trước khi viết route mới. |
| 2 | State machine + `validateTransition` | `lib/state-machine/` | S | **P0** | Bắt buộc để tránh race-condition double-approve. Áp cho proxy: pending→active→expired→reclaimed. |
| 3 | Audit v2 (services/audit/) + redactor + retention | `services/audit/`, mig 182/183 | M | **P0** | Compliance + forensic. Wave 18+ proxy cần audit trail cho purchase saga. |
| 4 | `OrgContext` + `requireAdmin`-with-orgId + RLS pattern | `contexts/OrgContext.tsx`, `lib/auth.ts`, mig 177 | M | **P0** | Multi-tenant từ đầu rẻ hơn add sau. Schema phải có org_id từ wave 1. |
| 5 | Warranty module (state machine + RPC + auto/manual + reject revert) | `services/warranty.service.ts`, mig 173, state-machine/warranty.ts | M | **P0** | 1-1 mapping cho proxy claim/replacement. Schema gần như identical. |
| 6 | `useSWRFetch` + `RealtimeProvider` + `useRealtimeSubscription` | `hooks/`, `lib/realtime` | S | **P1** | Stale-while-revalidate UX + 1 channel/table. Loại bỏ polling. |
| 7 | URL state sync (`useUrlStatusTab`, `useFilterPresets`, `useUrlFilterPresets`) | `hooks/use*` | S | **P1** | Share-able link cho admin, preset cho power user. |
| 8 | Cron advisory lock (`withCronLock`) | `lib/cron/advisory-lock.ts` | S | **P1** | Vercel cron tick chồng chéo — proxy expiry/check cron cần lock này. |
| 9 | Settings registry + `updateSetting` + cache invalidation + changelog | `lib/settings/registry`, `services/settings.service.ts`, `settings_changelog` table | M | **P1** | Schema-validated config (boolean/numeric/enum/maxLength) + audit-friendly changelog. |
| 10 | RPC for atomic distribution + `rollbackFailedDistribution` shared helper | `lib/db/rollback.ts`, RPC `approve_request`, `approve_custom_order` | L | **P2** | Pattern cho proxy purchase saga (debit balance + assign proxy + send TG). RPC giải atomic, helper rollback chia sẻ giữa request/custom-order/bot. |

### Bonus pattern (P2)

- **`buildIlikeOrFilter` + `sanitizeIlikeTerm`** (`lib/api/sanitize.ts`) — chống PostgREST `.or()` injection. **S** — copy nguyên.
- **Count mode estimation** (`lib/api/count-mode.ts` + `pickCountMode`) — `pg_class.reltuples` cho list không filter, exact khi có filter. **S**.
- **`useSelectionState`** (`hooks/useSelectionState.ts`) — bulk selection với filter (chỉ select rows match predicate). **S**.
- **File-vs-text Telegram delivery** (`lib/bot/file-delivery.ts`) — auto switch sang `.txt` attachment khi nhiều/dài. **S**.
- **API request log table** (`api_request_logs` + `logApiRequest`) — observability tier ngoài audit. **S**.

---

## Kết luận tóm tắt

VIA web admin là codebase trưởng thành với 5-tier rõ ràng, RPC-first transaction, Zod-validated API, multi-tenant đầy đủ, audit v2 redacted, state machine bắt mọi entity. Cấu trúc hook + context + SWR + Realtime tạo UX không-spinner-flash. Port theo thứ tự P0 → P1 → P2; **không bỏ qua** state machine, audit, multi-tenant, createHandler — đó là 4 nền móng.

File đã ghi: `C:\Users\Admin\Documents\quản lý proxy trên web và giao proxy qua bot tele cho user tele\proxy-manager-telebot\docs\LEARN_VIA_WEB.md`
