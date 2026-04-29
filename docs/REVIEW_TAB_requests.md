# REVIEW Tab "Quản lý Request" — 2026-04-28

Phạm vi:
- UI: `src/app/(dashboard)/requests/page.tsx` (324 LOC) + `src/components/requests/{request-actions,request-table}.tsx`
- API: `src/app/api/requests/route.ts` (179 LOC) + `src/app/api/requests/[id]/route.ts` (604 LOC — tech-debt #1)
- DB: `proxy_requests` (mig 001) + indexes (002/006/008/013/017) + RLS (003) + RPC `safe_assign_proxy` (008/027), `bulk_assign_proxies` (013), `smart_pick_proxy` (027)
- State machine: `src/lib/state-machine/request.ts`
- Tests: `src/app/api/__tests__/{request-approval,proxy-expiry-filter}.test.ts`

---

## 1. Bug list

| # | Mức | Bug | Path / dòng | Triệu chứng |
|---|-----|-----|-------------|-------------|
| B1 | CRITICAL | **Saga không idempotent** — bulk approve sau khi `bulk_assign_proxies` RPC succeed nhưng request UPDATE fail (network blip), N proxy đã bị assigned nhưng request gốc vẫn `pending`. Lần retry tiếp sẽ assign thêm N proxy nữa → user nhận 2N proxies cho 1 request | `[id]/route.ts:159-183` | Double-assignment |
| B2 | CRITICAL | **Race condition 2 admin approve cùng 1 request** — single-approve path không check `status='pending'` ở client side; nhưng `safe_assign_proxy` RPC bên trong CHỈ kiểm `status='pending'` ở `proxy_requests` (line 67-69 mig 008) — tốt. **Tuy nhiên** path RPC chỉ chạy khi `quantity=1`. Bulk path (B1) **không check** `status='pending'` trước khi UPDATE. 2 admin bấm "Batch approve" cùng lúc → cả 2 cùng chạy `bulk_assign_proxies` → 2× quantity proxies, request gốc bị UPDATE 2 lần (last-write-wins, mất `batch_id` đầu) | `[id]/route.ts:175-183` (`bulkResult.success` không guard pending) | Over-assign |
| B3 | CRITICAL | **`filters.search` parse nhưng KHÔNG áp dụng** — GET API đọc `searchParams.get("search")` (line 19) nhưng không có `query.ilike(...)` hay text-search filter nào. UI search box tại `page.tsx:217-225` gửi param vô tác dụng → users gõ tìm xong vẫn ra full list | `route.ts:19, 37-89` | Search hoàn toàn dead |
| B4 | HIGH | **Telegram fanout fail không rollback** — sau khi assign proxy xong (RPC commit), `sendTelegramMessage` throw 429/timeout → block try/catch nuốt lỗi, log `console.error`, request vẫn ở status `approved`. User KHÔNG biết mình có proxy mới. Không có outbox/retry queue | `[id]/route.ts:241-243, 407-409, 506-508` | Silent delivery loss |
| B5 | HIGH | **Pagination = OFFSET** thay vì cursor — `range(offset, offset+pageSize-1)` (line 88) trên table dự kiến tăng vô hạn. Page 1000 sẽ scan 20k rows. Mig 015 `cursor_pagination_index` đã tồn tại cho proxies nhưng **chưa apply cho proxy_requests** | `route.ts:34-88` | Slow tail-pagination |
| B6 | HIGH | **Missing FK index** — `proxy_requests.proxy_id` (FK→proxies) và `proxy_requests.approved_by` (FK→admins) **không có index**. Khi xoá hoặc cập nhật proxy/admin, Postgres scan toàn bộ `proxy_requests` để check FK. Mig 002+006+008+013+017 chỉ index status, tele_user_id, requested_at, processed_at, batch_id, (user,status,date) | `mig 002, 006, 008` | Slow proxy/admin delete |
| B7 | HIGH | **Bulk reject N+1** — UI loop `for (const id of selectedIds) await fetch PUT` (line 171-182, page.tsx). 50 request → 50 round-trip. Không có endpoint `/api/requests/bulk-reject` | `page.tsx:169-186, request-actions.tsx:281-295` | Slow batch ops |
| B8 | HIGH | **Realtime subscribe không lọc filter** — channel listen `event: "*"` toàn table, debounced 2s → mỗi UPDATE ở bất kỳ row nào (kể cả không nằm trong filter) đều trigger refetch full page. 50 admin online, 1 user spam request → 50× refetch | `page.tsx:107-125` | Realtime amplification |
| B9 | MEDIUM | **State machine không enforce ở bulk path** — line 98-110 chỉ check `requestMachine.canTransition` cho single update path. Bulk approve (line 157-261) bypass guard (chạy RPC trực tiếp). Một request đã `rejected` vẫn có thể bị retry approve (RPC tự return `Request not found or already processed` — *may mắn* thoát, nhưng API trả 400 generic, không rõ "đã xử lý") | `[id]/route.ts:98-110` vs `155-183` | Inconsistent guard |
| B10 | MEDIUM | **`cancelled` không log activity** — line 434-437 set status=cancelled, line 454/472/480 chỉ log/notify cho `rejected`. Cancel biến mất khỏi audit trail | `[id]/route.ts:434-437, 454, 472, 480` | Missing audit |
| B11 | MEDIUM | **`auto_approved` không có UI flow** — RequestStatus enum có `auto_approved`, table render được, nhưng `UpdateRequestSchema.status` (validations.ts:137) chỉ chấp nhận `approved/rejected/cancelled`. Bot tự auto-approve tạo row `auto_approved`, web admin không thể chuyển thủ công | `validations.ts:137` | Status disconnect |
| B12 | MEDIUM | **Realtime `as any`** — line 113 page.tsx dùng `as any` để bypass Supabase type, vi phạm coding rule | `page.tsx:113` | Type leak |
| B13 | MEDIUM | **Sort `requested_at` mất index khi tab `recent`** — tab "recent" override `sortBy=processed_at` (page.tsx:82), filter `dateFrom=now-7d`. Index `idx_proxy_requests_processed_at` (mig 006) là `WHERE processed_at IS NOT NULL` — đúng partial. Nhưng query bổ sung `is_deleted=false AND status IN (...)` → planner có thể chọn idx_requests_status thay vì idx_proxy_requests_processed_at. Cần composite `(status, processed_at DESC) WHERE is_deleted=false AND processed_at IS NOT NULL` | `route.ts:84-88` | Slow recent-tab |
| B14 | MEDIUM | **`bulk_assign_proxies` ignore `country` filter** — RPC body (mig 013, line 30-37) chỉ filter `type` + `status='available'`. Request có `country='VN'`, bulk approve sẽ assign proxy bất kỳ country. Mig 027 `smart_pick_proxy` có hỗ trợ country nhưng KHÔNG được gọi | `mig 013:30-37, [id]/route.ts:159-165` | Wrong proxy assigned |
| B15 | MEDIUM | **`bulk_assign_proxies` hard-code TTL 30 ngày** — `v_expires_at := now() + INTERVAL '30 days'` (mig 013:25). Single-approve path qua `safe_assign_proxy` không set expires_at → hai path inconsistent về TTL | `mig 013:25` vs `mig 027:54-66` | Inconsistent TTL |
| B16 | LOW | **`requireAnyRole` cho POST** — POST `/api/requests` (route.ts:125-178) dùng `requireAdminOrAbove` đúng. Nhưng GET dùng `requireAnyRole` (route.ts:14) → role `viewer` cũng đọc được proxy_requests. RLS line 153-156 cũng `is_admin_or_viewer()`. Có ý đồ, nhưng nên double-check viewer được phép xem credentials proxy không (JOIN load `proxy.host:port`) | `route.ts:14`, `[id]/route.ts:24` | Possibly leaks proxy creds to viewer |
| B17 | LOW | **Tab counter không hiển thị** — TabsTrigger "Pending"/"Recent" không có badge số lượng. Admin không biết có bao nhiêu pending từ xa | `page.tsx:211-213` | UX |
| B18 | LOW | **`processed_at` không filter** — recent tab filter `dateFrom` map vào `requested_at` (route.ts:75) chứ không phải `processed_at` mặc dù sortBy là `processed_at`. UI nói "7 ngày gần nhất" nhưng thực tế là 7 ngày tính từ `requested_at` | `route.ts:74-79, page.tsx:79-83` | Wrong date semantics |
| B19 | LOW | **`page.tsx` import `useRole` nhưng `canWrite` chỉ guard bulk button** — single approve/reject dropdown (`request-table.tsx:257-272`) không check `canWrite` → viewer thấy nút nhưng API sẽ 403. Confusing UX | `request-table.tsx:257-272` | Permission UX |
| B20 | LOW | **Hard-coded ASCII status text VN** — line 491 `[X] Yeu cau proxy bi tu choi` thay vì dùng `msg.requestRejected[lang]` template như approve flow | `[id]/route.ts:489-492` | i18n inconsistency |

---

## 2. UX

| Issue | Mức | Note |
|-------|-----|------|
| Search input không debounce, phải Enter/click Filter | LOW | UX rườm rà, nên debounce 400ms |
| `pendingSelected` đếm dư selectedIds bao gồm row không pending → nút batch hiển thị nhưng count sai | MEDIUM | `page.tsx:188-190` filter sau, count chính xác nhưng có thể có trường hợp `requests` đã refetch xong mất rows gốc |
| Approve dialog load `?pageSize=100` proxy available — nếu kho >100, admin chỉ thấy 100 đầu, không có search proxy theo host/country | HIGH | `request-actions.tsx:50` — cần search/filter proxy |
| Reject reason 500 char limit (validations.ts:139) nhưng UI textarea không hiển thị counter | LOW | UX |
| Không có "View details" panel — onView chỉ set state, không mở dialog | HIGH | `page.tsx:163-167` — dead handler, dropdown menu "View Details" không làm gì |
| Bulk approve không có preview "sẽ assign N proxy thuộc type X" trước khi confirm | MEDIUM | `request-actions.tsx:308-333` chỉ hiện count |
| Empty state khi không có pending → chỉ hiển thị bảng rỗng + "No requests found" | LOW | Có thể CTA "View recent" |
| Realtime debounce 2s — nếu admin đang gõ filter, fetchRequests ghi đè state có thể flicker | LOW | `page.tsx:113-118` |
| Không có column "Quantity" mặc dù schema có `quantity` (mig 013) | MEDIUM | Bulk request hiển thị như single |

---

## 3. Security

| Issue | Mức | Note |
|-------|-----|------|
| **Viewer role đọc plaintext proxy host/port qua JOIN** | HIGH | `route.ts:40` JOIN `proxies(id, host, port, type)`. Mặc dù pgsodium chưa apply (REVIEW gốc đã flag), vẫn nên restrict viewer chỉ thấy `id, type, country` không host:port. RLS hiện tại `is_admin_or_viewer` cho phép full read |
| **Telegram message text log nguyên proxy credentials** vào `chat_messages.message_text` | HIGH | `[id]/route.ts:232-239, 397-405` — credentials lưu plaintext vào DB. Nếu admin/viewer đọc chat_messages tab → leak |
| `notifyOtherAdmins(null, ...)` — `actorTelegramId=null` → không exclude admin thực hiện. Admin tự mình spam Telegram của mình | LOW | `[id]/route.ts:245-248, 412-415, 473-476` — nên truyền `admin.telegram_id` |
| `ipAddress: x-forwarded-for` không sanitize chuỗi đầu (có thể là spoofed multi-IP) | LOW | `[id]/route.ts:199, 363, 466`. Có util `lib/ip.ts` chưa được dùng |
| `permanent=true` DELETE hard-delete không log activity | MEDIUM | `[id]/route.ts:554-572` — destructive op không audit |
| `safe_assign_proxy` SECURITY DEFINER nhưng không check `p_admin_id` thật sự là admin → caller controlled, có thể giả mạo nếu RLS bypass | LOW | mig 008/027 — minor vì authenticated path đã check `requireAdminOrAbove` |
| State machine cho phép `pending → cancelled` từ admin web (line 28-29 state-machine/request.ts) — nhưng cancellation thông thường là user-side action. Admin cancel = soft delete? semantic mờ | LOW | Cần làm rõ ai được cancel |

---

## 4. Performance

| Issue | Mức | Note |
|-------|-----|------|
| **B1/B2 saga non-idempotent** — root cause ở line 159-183, chia transaction RPC + UPDATE thành 2 round-trip | CRITICAL | Cần atomic: RPC tự update request luôn |
| **B5 OFFSET pagination** scale O(N) | HIGH | `range(offset, offset+pageSize-1)` |
| **B6 missing FK index** trên `proxy_id`, `approved_by` | HIGH | Slow proxy delete (cascade SET NULL phải scan full table) |
| **B7 N+1 bulk reject** | HIGH | UI 50 round-trip |
| **B8 realtime full-table broadcast** không filter | HIGH | 50 admin × N changes |
| Admin GET re-fetch `proxy_requests` 2 lần sau approve (line 250-254 + 418-422) | MEDIUM | Single roundtrip với `RETURNING *` từ RPC |
| `getAdminTelegramIds` query `admins` mỗi lần fanout, không cache | MEDIUM | 50 admin × mỗi approve event |
| `bulk_assign_proxies` LOOP từng row, không dùng UPDATE FROM SELECT | LOW | mig 013:29-72. Ổn với N nhỏ, không scale với batch lớn |
| Bulk dialog gọi RPC tuần tự N request (1 RPC per request) chứ không group thành 1 RPC `bulk_approve_requests(req_ids[])` | HIGH | 50 request approve = 50 RPC |
| `idx_requests_user_status_date` (mig 008) `(tele_user_id, status, created_at DESC)` không cover sort theo `requested_at` mặc định | MEDIUM | API default sort=`requested_at`, index đang sort `created_at`. Hai cột thường giống nhau (DEFAULT now()) nhưng không guarantee |
| Không có cron expire pending request quá hạn | LOW | Mig roadmap có `cron/expire-requests` nhưng không có file mig — chỉ có nhánh code |

---

## 5. Top 5 đề xuất ưu tiên

### #1 — Atomic bulk-approve RPC + state-machine guard (giải B1, B2, B9, B14)
Tạo mig `041_wave22_atomic_bulk_approve.sql`:
```sql
CREATE OR REPLACE FUNCTION approve_request_atomic(
  p_request_id UUID, p_admin_id UUID,
  p_proxy_id UUID DEFAULT NULL,    -- single mode
  p_auto_assign BOOLEAN DEFAULT false
) RETURNS JSON AS $$
-- Bên trong:
-- 1. SELECT FOR UPDATE proxy_requests WHERE id=p_request_id AND status='pending'
--    → nếu NULL → return {error:"already_processed"}
-- 2. Đọc quantity, country, type
-- 3. Nếu quantity=1: pick proxy (with country filter), atomic update
-- 4. Nếu quantity>1: loop pick N proxies (with country filter), update request 1 lần cuối
-- 5. RETURN {success, batch_id, proxies[], request_status='approved'}
```
- Saga giảm về 1 round-trip, idempotent (status guard chặn double-fire).
- Bulk path qua state machine: UPDATE proxy_requests SET status='approved' WHERE status='pending' (no-op nếu đã approved).
- API route giảm 604 LOC → ~200 LOC, chỉ orchestrate notify.

### #2 — Outbox table cho Telegram fanout (giải B4)
Tạo `notification_outbox(id, kind, payload jsonb, attempts, next_retry_at, sent_at)`:
- Trong RPC `approve_request_atomic`, INSERT vào outbox luôn (cùng transaction).
- Cron `/api/cron/dispatch-outbox` mỗi 30s pick batch unsent, gửi Telegram, mark sent.
- Telegram 429 → tăng `next_retry_at` exponential backoff.
- Side effect: bulk-reject Telegram cũng đi qua outbox → consistent.
- Bonus: drop `chat_messages.insert` inline khỏi route, push vào outbox handler.

### #3 — Bulk approve/reject API + cursor pagination (giải B3, B5, B7)
- `POST /api/requests/bulk` `{action: 'approve'|'reject', ids: [], reason?, auto_assign?}` — wrap N approves trong 1 transaction.
- Áp dụng `search` filter: thêm `query.or('tele_user.username.ilike.%X%,tele_user.first_name.ilike.%X%')` (cần Supabase nested filter syntax) hoặc precomputed search_vector.
- Cursor: thêm `?cursor=<requested_at>:<id>` pattern, drop offset cho list lớn. Dùng `idx_requests_pending_queue` (mig 017) làm seek index.

### #4 — Index hardening + composite cho recent-tab (giải B6, B13)
Tạo mig `042_request_index_hardening.sql`:
```sql
CREATE INDEX idx_proxy_requests_proxy_id ON proxy_requests(proxy_id) WHERE proxy_id IS NOT NULL;
CREATE INDEX idx_proxy_requests_approved_by ON proxy_requests(approved_by) WHERE approved_by IS NOT NULL;
CREATE INDEX idx_proxy_requests_recent
  ON proxy_requests(processed_at DESC, status)
  WHERE is_deleted = false AND processed_at IS NOT NULL;
```
- 2 FK index closing slow-cascade delete.
- Composite recent-tab: covering query của tab "recent" tại page.tsx:78-83.

### #5 — Refactor route handler + RLS lock-down viewer
- Tách `[id]/route.ts` (604) thành:
  - `services/requests/approve.service.ts` (saga orchestration)
  - `services/requests/reject.service.ts`
  - `services/requests/notify.service.ts` (outbox push)
  - `route.ts` (~80 LOC, chỉ auth + parse + delegate)
- Thay `requireAnyRole` cho GET bằng split:
  - viewer chỉ thấy `id, status, requested_at, processed_at, proxy_type, country, tele_user_id` (KHÔNG join `proxies.host:port`).
  - admin/super_admin thấy đầy đủ join.
  - Update RLS `requests_select` + thêm view `proxy_requests_viewer_safe`.
- Đồng nhất `UpdateRequestSchema` chấp nhận đủ status enum (B11).
- Gắn `canWrite` guard cho dropdown action trong `request-table.tsx` (B19).

---

## Test gap (bonus)

| Module | Status |
|--------|--------|
| `request-approval.test.ts` (303 LOC) | Cover bulk rate-limit + single approve happy path. **Thiếu:** B1/B2 (idempotent retry), B9 (state machine guard ở bulk), B14 (country filter), Telegram fanout fail flow |
| `proxy-expiry-filter.test.ts` (55 LOC) | Đã cover Wave 22AB threshold. Không liên quan request tab |
| **Thiếu** | `route.ts` GET filter test (B3 search dead), realtime debounce test, RLS viewer leak test, bulk reject N+1 test, OFFSET vs cursor benchmark |

---

## Tóm tắt rủi ro

- **Saga non-idempotent** (B1, B2, B9): nguy cơ over-assign proxy, mất tiền. **Phải fix trước khi mở rộng admin pool**.
- **Telegram silent loss** (B4): user không nhận proxy, mở support ticket → drain admin time.
- **Search dead** (B3): dead feature, admin tưởng filter có hiệu lực.
- **Missing FK index** (B6): chưa nổ ngày nay vì DB nhỏ, sẽ nổ khi proxy table ≥ 100k.
- **604-LOC monster** đúng là tech-debt #1 — refactor song song với #1 (atomic RPC) để giảm risk.

Path file output: `docs/REVIEW_TAB_requests.md`.
