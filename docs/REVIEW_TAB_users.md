# REVIEW Tab "Quản lý user" (Telegram users) — 2026-04-28

> Phạm vi: `/users`, `/users/[id]`, `/api/users/*`, bảng `tele_users`, RLS, indexes, tests.
> Đối chiếu: VIA `quản lý via, giao via và gửi via qua bot tele/src/app/(admin)/users` (mature).

## 0. Inventory

| File | LOC | Vai trò |
|------|----:|--------|
| `src/app/(dashboard)/users/page.tsx` | 343 | Listing + filter status + bulk action + export CSV + realtime |
| `src/app/(dashboard)/users/[id]/page.tsx` | 21 | Wrapper, đọc `?tab=` query |
| `src/components/users/user-detail.tsx` | 275 | Tabs Info/Proxies/Requests/Chat/Rate limits |
| `src/components/users/user-table.tsx` | 340 | Table + sort + checkbox + dropdown actions |
| `src/components/users/user-info-card.tsx` | 172 | Cards Info + Notes |
| `src/components/users/user-rate-limit.tsx` | 263 | Sliders + Approval switch + progress |
| `src/components/users/user-proxies-tab.tsx` | 98 | Bảng proxies assigned |
| `src/components/users/user-chat-panel.tsx` | 227 | Chat realtime |
| `src/components/users/user-sub-tabs.tsx` | 43 | Sub-tab "Người dùng Bot" (list/messages) |
| `src/hooks/use-users.ts` | 143 | CRUD client wrapper |
| `src/app/api/users/route.ts` | 151 | GET list / POST create |
| `src/app/api/users/[id]/route.ts` | 292 | GET / PUT / DELETE (soft+permanent) |
| `src/app/api/users/[id]/proxies/route.ts` | 64 | GET assigned proxies (viewer strip creds) |

**Tests:** `validations.test.ts` 7 case cho `CreateUserSchema` (schema only). 0 file `users.test.ts` cho route handler. 0 component test. 0 hook test cho `use-users`.

## 1. Bug list

| # | Mức | Bug | Path | Ghi chú |
|---|-----|-----|------|--------|
| 1 | **CRITICAL** | Schema-DB enum drift: `CreateUserSchema`/`UpdateUserSchema` chỉ accept `["active","banned","limited"]` nhưng DB enum `tele_user_status` = `('active','blocked','pending','banned')`. Gửi `status: "limited"` từ tool nội bộ → DB error 22P02. UI chọn `blocked`/`pending` → 400 "Validation failed". | `src/lib/validations.ts:160,169` vs `migrations/001_create_tables.sql:15` | Sync về `["active","blocked","pending","banned"]`. UI trong `users/page.tsx:233-236` đã render `blocked`/`pending`. |
| 2 | **CRITICAL** | `users/route.ts` GET có search OR-filter `telegram_id.eq.${isNaN ? 0 : Number(...)}`. Khi `search` = chuỗi rỗng-sau-trim (vd `" "`), Supabase JS `or()` truyền nguyên dấu `,` & `%` không escape. Nếu `search` chứa `,` (vd "abc,def") → break filter syntax, có thể trả 500. | `src/app/api/users/route.ts:38-40` | Sanitize: regex `[,()]` → underscore, hoặc dùng `textSearch` index. |
| 3 | **HIGH** | Bulk action chạy sequential `for (id of selectedIds) await blockUser(id)` — N round-trip cho N users, không có endpoint `/api/users/bulk`. 100 user = 100 PUT. | `src/app/(dashboard)/users/page.tsx:107-121` | Thêm `POST /api/users/bulk` với array `ids[]` + action + `Promise.allSettled`. VIA có `bulk-whitelist/route.ts`. |
| 4 | **HIGH** | `admin` destructured ở `route.ts:14, 93` nhưng **không dùng** — GET list & POST create không log activity (DELETE/PUT có log). Audit gap: tạo user mới không trace được "ai tạo". | `src/app/api/users/route.ts:14, 93` | Thêm `logActivity({action: "user.create", ...})` sau insert, `action: "user.list_export"` cho list (optional). |
| 5 | **HIGH** | UI Select status có `pending` (mig 001 default), nhưng action duy nhất từ admin để approve user pending là toggle status — không có "Approve" button rõ ràng trong bulk. Bot-side AUP gate (`commands/aup.ts`) là gate thật, admin web không thấy `aup_accepted_at` cột nào. | `src/components/users/user-table.tsx`, `user-info-card.tsx` | Thêm column "AUP" (✓ vX.X / ✗) + filter `aup_pending`. |
| 6 | **HIGH** | `Tabs defaultValue={initialTab}` không sync tab state với URL khi user click tab khác → reload mất tab, bookmark không hoạt động. URL `?tab=rate-limits` chỉ áp dụng lần đầu. | `src/components/users/user-detail.tsx:176` | Dùng `useRouter().replace` khi tab thay đổi (giống VIA `updateQuery`). |
| 7 | **MEDIUM** | Realtime channel `users-changes` debounce 2s mỗi event nhưng debounce ref **không reset** giữa các event — chỉ thay clearTimeout, vẫn đúng. **Tuy nhiên** mỗi user mở tab giữ một subscription riêng → 50 admin = 50 channel. Không có channel pool. | `src/app/(dashboard)/users/page.tsx:62-85` | Singleton channel ở context, hoặc chỉ subscribe khi tab visible. |
| 8 | **MEDIUM** | Hard delete (`?permanent=true`) không kiểm tra user có proxy đang assigned. ON DELETE SET NULL ở `proxies.assigned_to` (mig 001:86) sẽ cắt assignment lặng lẽ — proxy còn `status='assigned'` mà `assigned_to=NULL`. | `src/app/api/users/[id]/route.ts:218-247` | Pre-check `SELECT count(*) FROM proxies WHERE assigned_to = id AND is_deleted = false`, từ chối nếu > 0 hoặc revoke trước. |
| 9 | **MEDIUM** | `UpdateUserSchema.refine` validate hourly ≤ daily ≤ total, **nhưng** chỉ khi cả hai cùng có trong payload. UI chỉ gửi field đổi → có thể up `rate_limit_total` < `rate_limit_hourly` đang lưu trong DB (skip validation). | `src/lib/validations.ts:183-196`, `src/app/api/users/[id]/route.ts:108-138` | Fetch current values rồi merge trước khi validate hierarchy server-side. |
| 10 | **MEDIUM** | `UserProxiesTab` không strip credential cho `viewer` ở **client** display nhưng server đã strip — **không phải bug**. Tuy nhiên `UserProxiesTab` không render col `username/password` ở table → chữ thừa. Không có loading skeleton, fail silent (`return` không error toast) ở `fetchProxies`. | `src/components/users/user-proxies-tab.tsx:25-36` | Thêm `isLoading` state + `Skeleton` + toast on error. |
| 11 | **MEDIUM** | `user-detail.tsx` fetch `requests` qua `/api/requests?teleUserId=...` với `pageSize=50` — fetch lần đầu không phân trang, count badge `Requests ({requests.length})` luôn ≤ 50 dù user có 1000 request. | `src/components/users/user-detail.tsx:60-72` | Dùng count từ API meta (`json.data.total`) thay `length`. |
| 12 | **LOW** | `user-table.tsx` hardcode tiếng Anh ("Telegram ID", "Username", "Status", "View Details", "Block User"...) trong khi tab user đã có i18n vi/en. Không gọi `useI18n` ở component này. | `src/components/users/user-table.tsx:186-205, 270-306` | Wrap với `t("users.*")` keys (đã có nhiều trong `vi.json:117-161`). |
| 13 | **LOW** | `user-info-card.tsx`, `user-rate-limit.tsx` cùng vấn đề hardcode English. | Như trên | Extract i18n. |
| 14 | **LOW** | `user-rate-limit.tsx:251` button `disabled={... || hourlyLimit > dailyLimit ...}` đúng, nhưng error message `errors[]` chỉ display, không block save khi `hourlyLimit === 0` (chỉ warn) — UX nhẹ nhưng có thể gây confusion. | `src/components/users/user-rate-limit.tsx:251` | Tách "block" vs "warn" array, chỉ disable cho block. |
| 15 | **LOW** | `Skeleton`, `Inbox` import nhưng `Skeleton` không dùng ở `user-table.tsx`. Dead import. | `src/components/users/user-table.tsx:43` | Remove. |
| 16 | **LOW** | `import type { UserFilters } from "@/types/api"` rồi `import type { UserFilters } from "@/types/api"` ở 2 file — OK. Nhưng `useUsers` không expose `error` cho UI hiển thị. | `src/hooks/use-users.ts:14, 31` | Truyền error ra `<Alert>` thay vì silent toast. |
| 17 | **LOW** | Export CSV cap 500 hard-coded. Không có warning UX nếu total > 500 (silent truncate). | `src/app/(dashboard)/users/page.tsx:138` | Toast warn "showing 500/N — refine filter" hoặc paginated export. |
| 18 | **LOW** | `notes` save POST PUT không log activity riêng — gộp vào "user.update" details `{...updateData}`, không có "previous notes". Audit trail kém vs PUT rate_limits có `previous`. | `src/app/api/users/[id]/route.ts:154-173` | Thêm `previous.notes` vào details. |

## 2. UX

- **Tab list rời rạc.** UI dùng layout `Tabs`-`TabsContent` trong client component → không SSR, fetch sequence chạy sau hydration, blank flash. VIA dùng split-pane (drawer + panel) load đồng thời, prefetch on hover.
- **Bulk action** chỉ 3 lựa chọn: block / unblock / delete. Thiếu: change `approval_mode`, set `max_proxies`, gán/bỏ tag. VIA có `UsersBulkActionBar` đa dạng + segments.
- **Không có "Add user" button** dù API POST có. Phải tạo qua bot `/start` mới có user.
- **Filter**: chỉ status. Không có activity filter (24h/7d/30d/inactive — VIA có), không có AUP filter, không có max-proxies range.
- **Search debounce**: phải ấn Enter hoặc click nút Search. UX hiện đại expect type-as-you-go (300ms debounce). VIA `useUsersList` có debounce.
- **Sort UI**: ArrowUpDown icon mọi cột nhưng không phân biệt cột đang active (asc/desc). User không biết cột nào đang sort.
- **Detail page** tab đếm `Requests ({requests.length})` luôn ≤ 50 do pageSize fetch — gây nhầm.
- **Rate limit tab** progress bar custom đè lên `<Progress>` shadcn — dùng `style={{ width: `${pct}%` }}` overlay, fragile khi parent flex.
- **Chat tab**: không send message từ admin web (chỉ view). VIA `SendMessageModal.tsx` cho phép admin reply.
- **No empty state khác nhau** cho "filter ra 0" vs "user table trống". Cùng một message.
- **Block toggle confusion**: `user.status === "blocked"` show "Unblock", nhưng nếu `status === "banned"` cũng show "Unblock" → unblock-from-banned set thành `active` (`user-detail.tsx:83`). DB enum `banned` thường là vĩnh viễn — gộp UX khó hiểu.

## 3. Security

| # | Mức | Issue | Path |
|---|-----|-------|------|
| S1 | HIGH | Không có rate-limit middleware ở `/api/users/*`. Admin có thể spam bulk delete N users. | `src/app/api/users/**` |
| S2 | HIGH | Search query truyền raw vào `or()` — Supabase JS escape `%` `_` nhưng KHÔNG escape `,` `(` `)`. Test với `search=)or(1=1` xem có 500/leak. | `src/app/api/users/route.ts:38` |
| S3 | MED | Hard delete bypass FK ON DELETE SET NULL trên `proxies.assigned_to` → orphan assignment. Không pre-check. | `src/app/api/users/[id]/route.ts:218` |
| S4 | MED | RLS `tele_users_select` = `is_admin_or_viewer()` — viewer đọc full row gồm `phone`, `notes`, `aup_accepted_at`. PII chưa redact. | `migrations/003_create_rls.sql:122` |
| S5 | MED | `notes` cap 2000 ký tự nhưng admin web chưa sanitize XSS. Hiện chỉ render qua React (auto escape) → OK nhưng nếu sau này dump qua report PDF / email là risk. | `src/lib/validations.ts:175` |
| S6 | MED | CSV export sanitized formula injection (Wave 22D-6, comment dòng 147-152) ✓ — đã fix. **Không có vấn đề**. |  |
| S7 | LOW | `phone` lưu plaintext, không format check `+E164`, không hash. | `migrations/001:50` |
| S8 | LOW | `actorLabel(admin)` được dùng nhưng `getuser route` không log → audit gap. | `route.ts:14, 93` |
| S9 | LOW | Realtime channel xem `tele_users` đầy đủ — viewer subscribe sẽ nhận PII updates qua WebSocket (đi qua RLS). Nếu RLS đúng thì OK, nhưng cần test policy với role `viewer`. | `src/app/(dashboard)/users/page.tsx:64-78` |

**2FA**: tele_users không có 2FA (đúng — họ là Telegram bot user, auth qua Telegram chính nó). 2FA enforcement chỉ áp dụng cho admin, không phải scope tab này.

**Session/login tracking cho tele_users: KHÔNG TỒN TẠI.** Mig 016 chỉ thêm `last_login_at`/`last_login_ip` cho `admins`. Telegram user không có cột `last_active_at`/`last_seen_at` — không thể filter "inactive 30 ngày" để cleanup.

## 4. Performance

| # | Vấn đề | Path | Action |
|---|--------|------|--------|
| P1 | `select("*")` GET list trả full row gồm `notes` (2KB) — pageSize 100 = 200KB. | `route.ts:33` | `.select("id,telegram_id,username,first_name,last_name,status,approval_mode,max_proxies,proxies_used_*,rate_limit_*,created_at,is_deleted")` |
| P2 | Search `or()` 4 condition scan toàn bảng, không có index trên `first_name`/`last_name`. Mig 006 chỉ index `username WHERE NOT NULL`. | mig 002, 006 | Trigram GIN index trên `username || first_name || last_name`, hoặc `pg_trgm` op class. |
| P3 | Bulk action N round-trip (Bug #3). | UI | Bulk RPC. |
| P4 | Realtime subscription per-tab không pool. | UI | Singleton hoặc presence-based. |
| P5 | `UserDetail` fetch user + requests serial trong `useEffect` — 2 RTT. | `user-detail.tsx:74-77` | `Promise.all([fetchUser(), fetchRequests()])`. |
| P6 | `UserProxiesTab` order `assigned_at DESC` nhưng không index. | mig 002 | Index `proxies(assigned_to, assigned_at DESC) WHERE is_deleted = false`. |
| P7 | Export CSV fetch 500 row cùng lúc, JSON parse + buildCsv blocking main thread. | `page.tsx:141-162` | Stream qua `ReadableStream`, hoặc cron-generated S3 link. |
| P8 | Update PUT có thêm 1 query "fetch current" để audit trail (`route.ts:73-77`) — 2 RTT cho mọi PUT. Acceptable nhưng có thể dùng `RETURNING` cũ (Postgres trigger). | `route.ts` | Trigger `audit_tele_users_update` viết vào `activity_logs`. |
| P9 | Index `idx_tele_users_status WHERE is_deleted = false` (mig 002:26) tốt. Nhưng filter `is_deleted=true` (trash) không có index riêng. | mig 002 | Partial index cho `WHERE is_deleted = true`. |
| P10 | `count: "exact"` trên list query — full scan mỗi request. ≥ 100K rows = chậm. | `route.ts:34` | Switch `count: "estimated"` cho list, `exact` chỉ khi page 1. |

## 5. Compare VIA

| Tiêu chí | Proxy (this) | VIA | Gap |
|---|---|---|---|
| Layout | Page → Table → Detail page | Page → 3-pane (List + Drawer + Panel) | Drawer pattern cho fast preview |
| Bulk action | block/unblock/delete | bulk-whitelist + segments + activity + columns picker + multi-action | Cần `UsersBulkActionBar` clone |
| Filter | status | bot_filter (all/via/uid_check), activity (24h/7d/30d/inactive), whitelist (all/approved/pending/rejected/none), status, search debounce, URL-shareable | Filter URL sync, activity filter, whitelist gate |
| Trust score | none | `/api/users/trust-score/route.ts` | Wave 18+ feature: trust score per user dựa rate quality |
| Send message | view-only | `SendMessageModal.tsx` admin → user | Admin reply UX |
| Columns picker | none (fixed columns) | `UsersColumnsPicker` localStorage | UX customizable |
| Whitelist/blacklist | none (chỉ status enum) | dedicated `whitelist`/`blacklist` table + state hook | Granular gate |
| API factory | `requireMinRole` + `try/catch` boilerplate | `createHandler({role, rateLimit, cache, handler})` | Cần factory pattern (đã note REVIEW_2026-04-28) |
| Multi-tenant | none (single org) | `orgId` injected in handler | N/A cho proxy nhưng nên ý thức |
| RPC aggregation | client-side aggregate | `get_user_stats(p_org_id)` RPC + JS fallback | Performance: fast path SQL agg |
| Tests | 7 schema test, 0 route | có route test (cần xác nhận) | Coverage tăng |
| AUP | DB cột có (mig 018) + bot prompt; **UI không hiển thị** | N/A (VIA scope khác) | Hiển thị + filter AUP pending |

## 6. Heatmap test coverage

| Module | Files | Test files | Đánh giá |
|---|---|---|---|
| `api/users/route.ts` | 1 (151 LOC) | 0 | Trống. Cần GET filter, POST validation, bulk path. |
| `api/users/[id]/route.ts` | 1 (292 LOC) | 0 | Soft + permanent + restore + global cap, 0 test. |
| `api/users/[id]/proxies/route.ts` | 1 (64 LOC) | 0 | Viewer credential strip cần test. |
| `components/users/*` | 7 component | 0 | Bulk dialog, sort, select-all, rate-limit hierarchy. |
| `hooks/use-users.ts` | 1 | 0 | filter URL sync, error path. |
| `validations CreateUserSchema` | — | 7 case | Drift status enum chưa test. |

## 7. Đề xuất Top 5 (priority)

1. **[CRITICAL] Fix schema-DB enum drift** (Bug #1).
   - Sửa `CreateUserSchema`/`UpdateUserSchema` thành `z.enum(["active","blocked","pending","banned"])`. Loại bỏ `limited`. Add unit test cover 4 status. Gắn migration test fixture.
   - Risk nếu để lâu: bất kỳ tool dev nào muốn POST user với status non-default sẽ fail; UI Select cho `blocked`/`pending` đang câm 400 trên đường truyền.

2. **[HIGH] Bulk endpoint + audit log đầy đủ** (Bug #3, #4).
   - Tạo `POST /api/users/bulk` `{ ids: string[], action: "block"|"unblock"|"delete"|"set_max_proxies"|"set_approval_mode", payload?: ... }`.
   - Single-tx via Supabase `.in("id", ids)` cho block/unblock/delete-soft. Permanent delete vẫn loop với pre-check (Bug #8).
   - Log mỗi action vào `activity_logs` với `resource_id_list`. Add `user.create` log ở POST.
   - Lượng RTT: 100 → 1.

3. **[HIGH] AUP UX surface** (Bug #5, gap VIA).
   - Cột "AUP" trong table: badge ✓ v1.0 / ✗ Pending.
   - Filter `?aup=pending` trỏ index `idx_tele_users_aup_pending` đã có (mig 018:29-31).
   - Detail tab "Compliance": `aup_accepted_at`, `aup_version`, button "Force re-accept" (set `aup_version = null`).
   - Required cho Wave 19+ vendor downstream.

4. **[HIGH] i18n + URL-state sync** (Bug #6, #12, #13).
   - Wrap toàn bộ hardcode English trong `user-table/info-card/rate-limit/proxies-tab` qua `useI18n()`.
   - Detail page: `?tab=` sync hai chiều — `onValueChange={(v) => router.replace("?tab=" + v)}`.
   - Filter `status`/`search`/`page` cũng sync URL (giống VIA `updateQuery`) → bookmark, share, back-button.

5. **[MEDIUM] Test harness cho users API** (test coverage 0 → 80%).
   - `users.test.ts`: GET filter (status/search/sort/pagination), 401 viewer cố POST, 400 schema fail, 500 DB error path.
   - `users-id.test.ts`: PUT global cap clamp (rate_limit_total), DELETE soft+permanent, restore, 404, audit log assertion.
   - `users-id-proxies.test.ts`: viewer strip creds, admin full creds, isolation by `assigned_to`.
   - `use-users.test.ts`: filter param URL encode, error path expose.
   - Thêm hook test `useUsers` với MSW mock.

## Phụ lục: data flow

```
Admin → /users (page.tsx) → useUsers → fetch /api/users
                                            └─▶ requireAnyRole → tele_users select
                          → realtime channel "users-changes" → debounce 2s → re-fetch
       ↓ click row
       /users/[id] → UserDetail → 5 tabs → /api/users/[id], /api/users/[id]/proxies, /api/requests, /api/chat
                                              └─▶ PUT/DELETE → logActivity (PUT/DELETE only)
       ↓ bulk select
       handleBulkAction → loop sequential PUT/DELETE → no audit aggregation
       ↓ Export
       fetch /api/users?pageSize=500 → buildCsv (sanitized) → blob download
```

## Path liên quan (absolute)

- `C:\Users\Admin\Documents\quản lý proxy trên web và giao proxy qua bot tele cho user tele\proxy-manager-telebot\src\app\(dashboard)\users\page.tsx`
- `C:\Users\Admin\Documents\quản lý proxy trên web và giao proxy qua bot tele cho user tele\proxy-manager-telebot\src\app\(dashboard)\users\[id]\page.tsx`
- `C:\Users\Admin\Documents\quản lý proxy trên web và giao proxy qua bot tele cho user tele\proxy-manager-telebot\src\app\api\users\route.ts`
- `C:\Users\Admin\Documents\quản lý proxy trên web và giao proxy qua bot tele cho user tele\proxy-manager-telebot\src\app\api\users\[id]\route.ts`
- `C:\Users\Admin\Documents\quản lý proxy trên web và giao proxy qua bot tele cho user tele\proxy-manager-telebot\src\app\api\users\[id]\proxies\route.ts`
- `C:\Users\Admin\Documents\quản lý proxy trên web và giao proxy qua bot tele cho user tele\proxy-manager-telebot\src\components\users\` (7 files)
- `C:\Users\Admin\Documents\quản lý proxy trên web và giao proxy qua bot tele cho user tele\proxy-manager-telebot\src\hooks\use-users.ts`
- `C:\Users\Admin\Documents\quản lý proxy trên web và giao proxy qua bot tele cho user tele\proxy-manager-telebot\src\lib\validations.ts:154-196`
- `C:\Users\Admin\Documents\quản lý proxy trên web và giao proxy qua bot tele cho user tele\proxy-manager-telebot\supabase\migrations\001_create_tables.sql:15,44-68`
- `C:\Users\Admin\Documents\quản lý proxy trên web và giao proxy qua bot tele cho user tele\proxy-manager-telebot\supabase\migrations\002_create_indexes.sql:22-28`
- `C:\Users\Admin\Documents\quản lý proxy trên web và giao proxy qua bot tele cho user tele\proxy-manager-telebot\supabase\migrations\003_create_rls.sql:122-146`
- `C:\Users\Admin\Documents\quản lý proxy trên web và giao proxy qua bot tele cho user tele\proxy-manager-telebot\supabase\migrations\018_wave18b_security.sql`
- VIA: `C:\Users\Admin\Documents\quản lý via, giao via và gửi via qua bot tele\src\app\(admin)\users\` + `src\app\api\users\`
