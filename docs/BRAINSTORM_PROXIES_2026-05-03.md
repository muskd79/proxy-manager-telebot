# Brainstorm review — Quản lý proxy & các nhánh phụ
**Date:** 2026-05-03
**Author:** wave-26-c-proxies-polish branch
**Status:** Draft for user review (NOT a sprint plan yet)

> User asked (verbatim): *"trang chi tiết proxy phải hiện full tất cả mọi
> thứ và lịch sử giao proxy. Cột loại mạng hình như đang không đồng bộ.
> Tab Quản lý proxy / Danh mục / Thùng rác cần mạnh hơn. Cần thêm cơ chế
> bảo hành (logic + workflow). Yêu cầu proxy cần thêm sub-tab ngoài 'Chờ
> xử lý' và 'Gần đây 7 ngày'. Brainstorm review tổng thể tất cả các tab —
> logic, file structure, ui/ux."*

This document is a **menu of options**, not a plan. Every section has a
recommendation and a rough cost estimate, but the user picks the order.

---

## Glossary (terms used below)

- **Giới hạn yêu cầu** (tên trước: "quota" — đã thống nhất với bot
  vocab 2026-05-03 theo yêu cầu user). Số lượng proxy tối đa mà mỗi
  user Telegram được phép có cùng lúc / lấy trong 1 giờ / 1 ngày /
  tổng cộng. Cấu hình ở `/settings` admin web (4 trường:
  `rate_limit_hourly`, `rate_limit_daily`, `rate_limit_total`,
  `max_concurrent_proxies`).
  Lấy proxy → cộng counter `proxies_used_*` lên 1; vượt giới hạn →
  bot từ chối với message "Bạn đã vượt giới hạn yêu cầu". Trả proxy
  (`/return`) → counter giảm 1.
  **Liên quan tới Bảo hành (Section 4):** khi proxy hỏng và admin
  duyệt cấp proxy mới thay thế → tôi đề xuất KHÔNG cộng thêm 1 vào
  counter (proxy hỏng không phải lỗi user) — chỉ track riêng qua
  `warranty_claims.replacement_proxy_id` để báo cáo doanh thu khỏi
  nhầm "1 lần bán = 2 proxy đã giao".
- **Sub-tab** — tab con bên trong 1 page (vd `<Tabs>` trong page
  `/requests` hiện đang có "Chờ xử lý" + "Gần đây 7 ngày"). Sau
  feedback của user 2026-05-03, doc khuyến cáo CHỈ DÙNG 2 sub-tab
  top-level (Yêu cầu / Bảo hành), trong mỗi tab dùng filter
  dropdown mạnh thay vì đẻ tab con (Section 5 REVISED).

---

## 0. What Wave 26-C just shipped (already addressed)

- **Cột loại mạng "không đồng bộ"** — fixed in Wave 26-C/3 (commit
  `7aebe0d`). `normalizeNetworkType` alias map applied on every write
  path; migration 055 cleans existing rows; `networkTypeLabel`
  normalises before rendering so legacy data still displays correctly.
  *Status: SHIPPED — verify on production with the user.*

- **Realtime banner false positive** — fixed in Wave 26-C/1.
- **30 ngày trước on Thời gian giao** — fixed in Wave 26-C/3.
- **import_batch_id deep link** — shipped in Wave 26-C/4.
- **SWR-style cache** — shipped in Wave 26-C/5.

The remaining items in this doc are NEW work for Wave 26-D and beyond.

---

## 1. Proxy detail page — `/proxies/[id]`

### Current state (audit)

`src/components/proxies/proxy-detail.tsx` (288 lines) shows:
- Header: host:port, copy button, Edit / Health Check / Delete
- 4-column grid: Type, Status, Speed, Last Checked
- 4-column grid: Country, Assigned To, Expires, *(authentication block)*
- Notes section
- Assignment History table (User / Status / Requested / Processed)

### Gaps observed

| # | Gap | Severity | Notes |
|---|-----|----------|-------|
| 1.1 | English labels mixed with Vietnamese ("Created", "Edit", "Health Check", "Status", "Speed", "Last Checked", "Country", "Assigned To", "Expires", "Authentication", "Notes", "Assignment History") | HIGH | inconsistent with `proxy-table.tsx` (fully Vietnamese since Wave 22J) |
| 1.2 | No `network_type`, `category`, `vendor_label`, `cost_usd`, `sale_price_usd`, `purchase_date`, `import_batch_id`, `created_by`, `distribute_count`, `last_distributed_at` | HIGH | half of the row's metadata is missing. User can't see margin per proxy without crossing back to /proxies bulk-edit |
| 1.3 | `Authentication` shows `username:********` — admin can't reveal password to read it back to a customer. The list view's `<CredentialCell>` already supports click-to-reveal | MEDIUM | port the CredentialCell into detail |
| 1.4 | `Status` chip uses raw enum value ("available", "assigned") not the Vietnamese label | MEDIUM | use `proxyStatusBadges()` from `proxy-labels.ts` |
| 1.5 | Assignment History fetches from `/api/requests?proxyId=…` — only shows REQUEST rows. A proxy can be assigned via direct admin action (no request) and that history is invisible | HIGH | need a true assignment-event log; `activity_logs` already records `proxy.assign` / `proxy.revoke` / `proxy.expire` (verify) |
| 1.6 | Health-check history (last 5 probes with speed_ms) is invisible — only the latest is shown | MEDIUM | `proxy_health_logs` table or similar needed |
| 1.7 | No "Quick actions" — toggle hidden, force expire, mark banned, unassign without going to bulk-edit | MEDIUM | a row of admin-only buttons with confirms |
| 1.8 | No "Notes timeline" — admin notes today are a single textarea; revoking + recreating notes loses history | LOW | small `proxy_notes` table |
| 1.9 | Mobile layout on `/proxies/[id]` uses 2-column grid that breaks at <380px | MEDIUM | switch to single column at <md |
| 1.10 | No "Lô import" link surfacing `import_batch_id` so admin can jump to the rest of the batch | MEDIUM | trivial after Wave 26-C/4 |

### Recommended Wave 26-D scope (1 commit)

Rebuild `proxy-detail.tsx` as a 3-card layout:
1. **Card 1 — Thông tin proxy** (host, port, type, network_type,
   country/city, category, status badges, expiry with relative + absolute,
   assigned-to, notes, credentials with click-to-reveal)
2. **Card 2 — Thông tin mua bán** (vendor_label, purchase_date,
   cost_usd, sale_price_usd, **margin**, import_batch_id link, created_by)
3. **Card 3 — Lịch sử**
   - Sub-tab A: Lịch sử giao (proxy_assignments OR activity_logs derivation)
   - Sub-tab B: Lịch sử health check (last 20 probes)
   - Sub-tab C: Yêu cầu (current /api/requests behaviour)

Quick actions row at top:
- Toggle hidden (with confirm)
- Force expire now
- Mark banned (with reason input)
- Unassign current user

Estimate: 1 day (component refactor + new tabs primitive reuse) + 1
small migration (`proxy_health_logs` if the pull-the-data path doesn't
exist).

---

## 2. Tab "Quản lý proxy" - top-level structure

### Current sub-tabs (`proxy-sub-tabs.tsx`)
- Danh sách proxy (`/proxies`)
- Danh mục (`/categories`)
- Thùng rác (`/trash`)

### Suggestions (none are blocking)

| Idea | Pros | Cons |
|------|------|------|
| Add **"Lô import"** sub-tab — list every import batch, click to filter `/proxies?import_batch_id=…` | Discoverability for the `import_batch_id` we just added | New page + new endpoint; small `proxy_import_batches` table needed |
| Add **"Sắp hết hạn"** sub-tab — `expires_at` within 7 days | Pre-empts revenue gap | Already covered by the existing filter dropdown — sub-tab might be redundant |
| Add **"Bảo hành"** sub-tab — see warranty claims (depends on Section 4) | Operational visibility | Only useful AFTER Section 4 ships |

**Recommendation:** add "Lô import" + "Bảo hành" once Sections 4 + the
batches table land. Don't add "Sắp hết hạn" (filter does the job).

---

## 3. Tab "Danh mục" - audit

### Wins observed
- CategoryFormDialog is solid, default propagation works after Wave 26-C/3
- `proxy_count` trigger keeps the counter accurate
- Reorder via drag is functional

### Gaps

| # | Gap | Fix cost |
|---|-----|----------|
| 3.1 | No filter "Hiện danh mục ẩn" toggle — admin has to know to add `?include_hidden=1` to the URL | XS — checkbox |
| 3.2 | No bulk actions on categories (rename prefix, bulk-hide, bulk-delete) | M |
| 3.3 | Category detail page (`/categories/[id]`) doesn't exist — admin can only edit via the dialog. A detail page would show "all proxies in this category" + stats | M |
| 3.4 | No "Tách danh mục" — admin can't move 50 of 200 proxies into a new category from the category UI; has to go to /proxies bulk-edit | M |
| 3.5 | `default_*` defaults silently dropped on Create until Wave 26-C/3 fix — a regression test for category POST is needed | XS (test only) |

**Recommendation:** ship 3.1 + 3.5 as a hardening commit, defer 3.2-3.4
until user explicitly asks.

---

## 4. Cơ chế bảo hành (Warranty) — design proposal

### Problem statement

Today the bot's "Trả proxy" button (renamed from "Bảo hành proxy" in
Wave 25-pre2) runs the **revoke flow only** — user gets giới hạn yêu cầu refund,
no replacement. There is no path for "this proxy is dead, give me a
working one without consuming my giới hạn yêu cầu again". Decision log has this
as `warranty-schema` deferred to Wave 26.

### Proposed flow

```
USER (Telegram)                     SYSTEM                           ADMIN (web)
───────────────                     ──────                           ───────────
  /myproxies → Proxy X
       │
       ▼
  Tap "Báo lỗi proxy"
       │ (callback: warranty:claim:<proxy_id>)
       ▼
  Bot asks "Lý do?" with 3 buttons:
    a) Không kết nối được
    b) Tốc độ chậm
    c) IP đã bị block
       │
       ▼
  Tap reason
       │
       ▼ INSERT INTO warranty_claims (status='pending')
                                    │
                                    ▼
                          Toast notification to admin web
                          + sidebar badge counter
                                    │
                                    ▼
                          Admin opens /warranty (new page)
                                    │
                                    ▼
                          Sees claim card:
                            • User name + telegram_id
                            • Proxy host:port + age
                            • Reason
                            • Health check button (re-test)
                            • [Chấp nhận] [Từ chối]
                                    │
                              ┌─────┴─────┐
                              ▼           ▼
                          Chấp nhận    Từ chối (lý do)
                              │           │
                              ▼           ▼
                  Allocate replacement     Notify user "Lý do bị từ chối"
                  from same category       Update claim.status='rejected'
                  Same expiry copied
                  Original proxy: status='banned'
                  New assignment: NO giới hạn yêu cầu consumed
                  Notify user "Proxy mới đã được giao"
                              │
                              ▼
                  Update claim.status='approved'
                  Update warranty_replacements (audit trail)
```

### Schema sketch (`057_wave26d_warranty.sql`)

```sql
CREATE TYPE warranty_claim_status AS ENUM
  ('pending','approved','rejected','expired');

CREATE TABLE warranty_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proxy_id uuid NOT NULL REFERENCES proxies(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES tele_users(id) ON DELETE RESTRICT,
  reason_code text NOT NULL CHECK (reason_code IN ('no_connect','slow','ip_blocked','other')),
  reason_text text NULL,
  status warranty_claim_status NOT NULL DEFAULT 'pending',
  replacement_proxy_id uuid NULL REFERENCES proxies(id) ON DELETE SET NULL,
  resolved_by uuid NULL REFERENCES admins(id),
  resolved_at timestamptz NULL,
  rejection_reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX warranty_claims_pending_idx
  ON warranty_claims (created_at DESC)
  WHERE status = 'pending';
```

### Business rules

1. **Eligibility window:** claim only allowed within 50% of the proxy's
   lifetime since assignment. Past that, "Báo lỗi" hidden.
2. **Cool-down:** one user can have ≤2 pending claims at once.
3. **Auto-reject after 72h:** unresolved claims auto-reject + notify
   user. (Cron job — extends `cron/expire-requests/route.ts` pattern.)
4. **Replacement giới hạn yêu cầu:** the new proxy does NOT consume giới hạn yêu cầu even
   though it's a "fresh" assignment. Audit table tracks this so revenue
   reports stay accurate.
5. **Same category required:** replacement allocator filters by the
   same `category_id`, then by `network_type`, then anything.
6. **Health re-check before approval:** admin sees a "Re-check now"
   button so they don't grant warranty for a proxy that just had a
   blip.
7. **Banned cascade:** approved warranty → original proxy gets
   `status='banned'` (not just `expired`) so it can't be re-distributed.

### UI sketch (REVISED 2026-05-03 per user feedback)

User pushed back on the original "5-7 sub-tabs" sketch — đúng, mỗi
"loại sub-tab" tôi list ra trước đây đều là cùng một loại đối tượng
(claim hoặc request), chỉ khác trạng thái. Filter dropdown gọn hơn
nhiều so với việc đẻ tab con.

**Final UI: 1 page `/warranty`, 1 bảng duy nhất, dropdown filter.**

Bảng cột:
| User | Proxy | Lý do | Trạng thái | Tạo lúc | Hành động |

Filter row trên cùng:
- **Trạng thái:** [Tất cả] / Chờ duyệt / Đã duyệt / Từ chối / Hết hạn
- **Khoảng thời gian:** [7 ngày] / 30 ngày / Tất cả
- **Tìm kiếm:** user / proxy host:port

Sidebar badge: count of `pending` claims (red dot when > 0).

Default filter khi mở page: `Trạng thái = Chờ duyệt + 7 ngày` —
admin thấy queue cần xử lý ngay, switch dropdown khi cần audit cũ.

### Estimate

- Migration: 1h
- Bot side (callback parser + reason buttons + notifications): 4h
- Admin web (/warranty page + claim card + actions + cron): 1 day
- Replacement allocator (reuse `pickProxyFor` from custom-order): 2h
- Tests: half-day
**Total: ~3 days.** Big enough to deserve its own wave (Wave 26-D).

---

## 5. Tab "Yêu cầu proxy" + tab "Bảo hành" — REVISED 2026-05-03

### User feedback (verbatim)

> "Sao mục lắm sub-tab vậy bro, mọi sub-tab đều cùng 1 loại là Yêu cầu
> proxy hoặc Bảo hành mà, thì về cơ bản chỉ có 2 sub-tab là Yêu cầu và
> Bảo hành, trong từng sub-tab thì có cột riêng là đã duyệt, từ chối,…
> chứ sao lại chia lắm tab vậy khó quản hơn không."

User đúng. Tôi đã over-engineer. Logic chuẩn:
- **2 top-level pages**: `/requests` (Yêu cầu) + `/warranty` (Bảo hành).
- **Trong mỗi page, 1 bảng duy nhất** với filter dropdown thay vì sub-tabs.
- Default filter mở ra hợp lý (e.g. "Chờ xử lý + 7 ngày") để admin
  thấy queue cần xử lý ngay; switch dropdown khi cần audit cũ.

### Page `/requests` — proposed final layout (REVISED 2026-05-03 round 2)

User yêu cầu filter "thật sự mạnh". Filter dropdown đầy đủ:

Bảng cột:
| User | Proxy | Loại | Loại mạng | Quốc gia | Danh mục | Trạng thái | Tạo lúc | Xử lý lúc | Hành động |

Filter row (responsive — collapse vào "More filters" trên mobile):
- **Trạng thái:** Đang đợi / Đã duyệt (auto+manual) / Từ chối / Hết hạn / Sắp hết hạn (≤24h) / Tất cả
- **Khoảng thời gian:** Hôm nay / 7 ngày / 30 ngày / Tự chọn (date-from + date-to)
- **Loại proxy:** Tất cả / HTTP / HTTPS / SOCKS5
- **Loại mạng:** Tất cả / Datacenter IPv4 / Datacenter IPv6 / Residential / Mobile / ISP / Static Residential
- **Quốc gia:** dropdown các country code thực có trong DB
- **Danh mục:** dropdown các proxy_category thực có
- **Nguồn (vendor):** dropdown vendor_label thực có
- **Cách duyệt:** Tất cả / Auto / Manual
- **Search free-text:** user_id (Telegram) hoặc username hoặc proxy host:port hoặc lý do từ chối

Default filter khi mở page: `Trạng thái = Đang đợi + Khoảng thời gian = 7 ngày`.

URL state — filter encoded vào query string (e.g.
`/requests?status=pending&within=7d&type=http&country=US`) → admin
share link với colleague trực tiếp; bookmark cho saved view; back/forward
browser navigation hoạt động.

**KHÔNG đẻ thêm sub-tabs.** Mọi use case dùng filter:
- "Đang đợi" → Trạng thái = Đang đợi
- "Sắp hết hạn 24h" → Trạng thái = Sắp hết hạn
- "Đã hết hạn chưa thu hồi" → Trạng thái = Hết hạn
- "Bị từ chối + lý do" → Trạng thái = Từ chối + Khoảng thời gian = Tất cả + search free-text "lý do"
- "Theo nguồn" → dropdown Nguồn

### Page `/warranty` — proposed final layout (REVISED 2026-05-03 round 2)

Bảng cột:
| User | Proxy | Lý do báo lỗi | Trạng thái | Tạo lúc | Admin xử lý | Proxy thay thế | Hành động |

Filter row (mirror /requests + 1 filter riêng cho warranty):
- **Trạng thái:** Đang đợi / Đã duyệt / Từ chối / Hết hạn không xử lý (auto-rejected) / Tất cả
- **Khoảng thời gian:** giống /requests
- **Lý do báo lỗi:** Tất cả / Không kết nối / Chậm / IP bị block / Khác
- **Loại proxy / Loại mạng / Quốc gia / Danh mục / Nguồn:** giống /requests
- **Có proxy thay thế:** Tất cả / Có / Không (cho admin filter ra claim duyệt nhưng chưa allocate được proxy mới)
- **Admin xử lý:** dropdown các admin (filter "claim của admin X")
- **Search free-text:** user / proxy / lý do text

Default filter: `Trạng thái = Đang đợi + Khoảng thời gian = 7 ngày`.

### Why filter dropdown beats sub-tabs

| Yếu tố | Sub-tabs | Filter dropdown |
|--------|----------|------------------|
| Add new view (vd "Bị từ chối tuần này") | Phải code thêm tab + URL route + filter logic | KHÔNG cần code — admin tự switch dropdown |
| Combine 2 dimension (vd "Từ chối + tuần này + HTTP") | Phải đẻ thêm cross-tab → vỡ tab bar | Switch nhiều dropdown cùng lúc |
| Share link cho admin khác | Mỗi tab = 1 URL, ổn | URL có query string đầy đủ → share trực tiếp |
| Học | Phải nhớ "tab nào chứa cái gì" | Chỉ cần học filter row 1 lần |
| Mở rộng tương lai (vd thêm filter "vendor") | Mỗi vendor = 1 tab → vỡ | Thêm 1 dropdown |

### Migration path từ trang `/requests` hiện tại

Page hiện tại dùng `<Tabs>` với 2 trigger ("Chờ xử lý" / "Gần đây 7 ngày").
Refactor sang single-table + filter:
- Bỏ `<Tabs>`, giữ filter row hiện có (search) + thêm 4 dropdown.
- Server filter hoá: `/api/requests?status=…&within=…&type=…&vendor=…&q=…`.
- "Sắp hết hạn" + "Hết hạn" tính từ `assigned_proxy.expires_at` (cần JOIN proxy table — schema đã sẵn).

### Estimate

- Refactor `/requests` page (bỏ Tabs, thêm filter): half-day.
- Backend extend `/api/requests` với 2 filter mới (`status='expiring_soon'`, `status='expired_unrevoked'`): 2h.
- Tests: 1h.
**Total: ~1 day.** Có thể ship cùng Wave 26-D hoặc tách Wave 26-E nhỏ.

---

## 6. File structure & maintainability — proxies/

### Current
```
src/components/proxies/
  ├── category-picker.tsx
  ├── credential-cell.tsx
  ├── proxy-bulk-edit.tsx
  ├── proxy-detail.tsx       (288 lines — bloating after Wave 26-D)
  ├── proxy-filters.tsx
  ├── proxy-form.tsx         (~700 lines)
  ├── proxy-import.tsx       (~1300 lines — concerning)
  ├── proxy-sub-tabs.tsx
  └── proxy-table.tsx        (~460 lines)
```

### Concerns
- `proxy-import.tsx` at 1300+ lines is too big. The wizard has 3 steps,
  each ~400 lines. Should split into `import/StepUpload.tsx`,
  `import/StepReview.tsx`, `import/StepResult.tsx`.
- `proxy-form.tsx` mixes the schema, the build-initial helper, the
  category-defaults effect, and the JSX. Extracting `proxy-form-schema.ts`
  + `proxy-form-fields.tsx` would help.
- `proxy-detail.tsx` will balloon when Wave 26-D adds 3 cards + 3
  sub-tabs. Plan to split similarly: `detail/InfoCard.tsx`, `detail/PurchaseCard.tsx`,
  `detail/HistoryTabs.tsx`.

**Recommendation:** schedule a "structure" commit BEFORE shipping Wave
26-D so we don't compound the bloat. ~half-day refactor with ample test
coverage already in place.

---

## 7. Ship order suggestion

If user gives green light, suggest this sequence (each is one wave):

1. **Wave 26-D-pre1** — `proxy-detail.tsx` rebuild (Section 1) + add
   missing fields + Vietnamese labels + click-to-reveal credentials.
   *Visible win immediately on every proxy detail click.*
2. **Wave 26-D-pre2** — Component split: import wizard + form (Section 6).
   *Foundation for Wave 26-D and beyond.*
3. **Wave 26-D** — Warranty mechanism (Section 4).
   *The big-ticket feature.*
4. **Wave 26-E** — `/requests` refactor (Tabs → single-table + filter
   dropdown, Section 5 REVISED) + warranty surfacing in sidebar.
5. **Wave 26-F** — Categories detail page + bulk actions (Section 3.3-3.4).

Total ~7-8 days of work end-to-end.

---

## Đáp án vòng 1 (2026-05-03)

| Câu | Bro chốt | Kéo theo decision/schema |
|-----|----------|---------------------------|
| **A1 — replacement giới hạn** | (a) KHÔNG trừ | `warranty_claims.replacement_proxy_id` track riêng; counter `proxies_used_*` không cộng |
| **A2 — eligibility window** | **HYBRID:** setting `warranty_unlimited_window` boolean (admin toggle ở /settings). Default = false → eligibility = 1 ngày sau `assigned_at`. Khi toggle = true → bất kỳ proxy đang giao đều được báo lỗi. **CỘNG THÊM:** state machine — khi user báo lỗi → proxy.status `assigned` → `reported_broken` (status mới, cần thêm vào enum) | (1) Migration mở rộng enum `proxy_status` thêm `reported_broken`. (2) Settings row `warranty_unlimited_window`. (3) State machine `proxy.ts` thêm transition `assigned → reported_broken` (user-triggered), `reported_broken → banned` (admin approve), `reported_broken → assigned` (admin reject = phục hồi) |
| **B2 — health-check history** | (b) N=20 lần gần nhất | Bảng mới `proxy_health_logs (proxy_id, ok, speed_ms, error_msg, checked_at)`. Trigger sau insert: keep last 20 per proxy_id, delete older |
| **C1 — assignment + audit history** | **FULL AUDIT** — không chỉ assign/revoke. Bro: "1 proxy có thể giao cho vài người, người này báo lỗi xong có khi tao lại giao cho người khác — cần biết lịch sử chi tiết, ai giao ai dùng khi nào, trạng thái ra sao, mọi thay đổi" | Tạo bảng mới `proxy_events` consolidate mọi event lifecycle (xem schema dưới). Hiển thị timeline ở /proxies/[id] |
| **G2 — import batches metadata** | KHÔNG — "chỉ cần import như hiện tại" | Giữ nguyên Wave 26-C. KHÔNG đẻ bảng `proxy_import_batches`. Filter `?import_batch_id=` đã đủ |

### Schema sketch cho `proxy_events` (đáp ứng C1)

Hiện trạng codebase sau audit:
- `activity_logs` ghi `proxy.create / proxy.update / proxy.delete / proxy.bulk_edit / proxy.import` từ web admin.
- Bot ghi `proxy_auto_assigned / proxy_request_created / proxy_revoked / proxy_revoke_failed`.
- **Vấn đề:** `proxy.update` overloaded — không phân biệt "đổi status banned→available" vs "sửa country". Detail JSONB không structured. Web UI hiện không có timeline page.

Đề xuất bảng mới — không thay thế `activity_logs` (vẫn dùng cho audit chung) mà specialized cho proxy lifecycle:

```sql
CREATE TYPE proxy_event_type AS ENUM (
  'created',                  -- admin tạo proxy mới (manual hoặc import)
  'imported',                 -- thuộc lô import (kèm import_batch_id trong details)
  'edited',                   -- field thay đổi (chi tiết before/after trong details JSONB)
  'category_changed',         -- riêng — vì hay query "proxy đã chuyển category nào"
  'status_changed',           -- riêng — vì user thường tra "proxy này từng banned chưa"
  'assigned',                 -- giao cho 1 user (kèm user_id + assigned_at)
  'unassigned',               -- thu hồi (kèm reason: expired/revoked_by_user/admin_unassign/banned)
  'reported_broken',          -- user báo lỗi qua bot → status=reported_broken
  'warranty_approved',        -- admin duyệt warranty → tạo replacement
  'warranty_rejected',        -- admin từ chối warranty
  'warranty_replacement_for', -- proxy này được cấp THAY THẾ cho proxy hỏng nào (link 2 chiều)
  'health_check_passed',
  'health_check_failed',
  'expired',                  -- trigger cron khi expires_at < now
  'soft_deleted',             -- chuyển vào thùng rác
  'restored'                  -- khôi phục từ thùng rác
);

CREATE TABLE proxy_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proxy_id      uuid NOT NULL REFERENCES proxies(id) ON DELETE CASCADE,
  event_type    proxy_event_type NOT NULL,
  actor_type    actor_type,                                            -- 'admin' / 'user' / 'system' (cron)
  actor_id      uuid,                                                  -- admin id hoặc tele_user id
  related_user_id uuid REFERENCES tele_users(id) ON DELETE SET NULL, -- "ai dùng proxy này khi sự kiện xảy ra"
  related_proxy_id uuid REFERENCES proxies(id) ON DELETE SET NULL,    -- linkage sang proxy thay thế (warranty)
  details       jsonb NOT NULL DEFAULT '{}',                          -- before/after diff cho 'edited'; reason cho 'unassigned'; speed_ms cho health
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX proxy_events_proxy_idx ON proxy_events (proxy_id, created_at DESC);
CREATE INDEX proxy_events_user_idx  ON proxy_events (related_user_id, created_at DESC) WHERE related_user_id IS NOT NULL;
CREATE INDEX proxy_events_type_idx  ON proxy_events (event_type, created_at DESC);
```

UI: trong `/proxies/[id]` tab "Lịch sử" hiển thị timeline (newest first) — mỗi event 1 dòng:
- icon theo event_type
- "User X nhận proxy lúc 2026-04-25 14:32"
- "User X báo lỗi proxy lúc 2026-04-26 09:15 (lý do: chậm)"
- "Admin Y duyệt bảo hành — cấp proxy thay thế Z lúc 2026-04-26 11:00"
- "Proxy này thay thế cho proxy ABC (warranty)" (cross-link 2 chiều)
- "Admin Y giao lại cho User M lúc 2026-04-30 10:00"
- "User M /return proxy lúc 2026-05-01 14:00"
- "Field 'expires_at' đổi từ 2026-05-15 sang 2026-05-30 (admin Y)"

Cộng thêm: filter trong tab Lịch sử (theo loại event, theo user, theo khoảng thời gian).

### State machine `proxies.status` mới (đáp ứng A2)

Migration `057_wave26d_warranty.sql`:
```sql
ALTER TYPE proxy_status ADD VALUE IF NOT EXISTS 'reported_broken' BEFORE 'expired';
```

State machine cập nhật ở `src/lib/state-machine/proxy.ts`:
```
available  ──[admin assign|getproxy]──> assigned
assigned   ──[user /return|admin unassign|expired]──> available
assigned   ──[user "Báo lỗi" (bot)]──> reported_broken    ← MỚI
reported_broken ──[admin duyệt warranty]──> banned        ← MỚI (proxy gốc bị ban, không cấp lại)
reported_broken ──[admin từ chối warranty]──> assigned    ← MỚI (revert, user vẫn giữ proxy đó)
assigned   ──[admin "Mark banned"]──> banned
banned     ──[admin "Restore"]──> available
* (any)    ──[admin maintenance toggle]──> maintenance
maintenance ──> available
```

Settings row mới:
```sql
INSERT INTO settings (key, value, description) VALUES (
  'warranty_eligibility_unlimited',
  '{"value": false}'::jsonb,
  'Wave 26-D — Khi true: user được báo lỗi proxy bất kỳ lúc nào còn HSD. Khi false (default): chỉ trong 24h sau assigned_at.'
);
```

UI badge mới ở proxy table cho status `reported_broken`: badge màu cam "Đang báo lỗi" với tooltip "User đã báo lỗi, đang chờ admin xử lý".

---

## Câu hỏi cần bro chốt trước khi code

### A. Cơ chế bảo hành (Wave 26-D)

**A1. Proxy thay thế có tốn giới hạn yêu cầu không?**
Khi user báo lỗi proxy → admin duyệt → cấp proxy mới. Có 2 lựa chọn:
- (a) **KHÔNG trừ giới hạn** — proxy mới = thay thế proxy hỏng, không tính counter `proxies_used_*`. Công bằng vì proxy hỏng đâu phải lỗi user. *(tôi đề xuất)*
- (b) **Trừ giới hạn như bình thường** — đơn giản cho code (không cần flag riêng) nhưng user thiệt.
*Bro chọn?*

**A2. User được báo bảo hành trong khoảng thời gian nào sau khi nhận proxy?**
Ví dụ user nhận proxy hôm nay HSD 30 ngày:
- (a) **Trong 24h sau khi nhận** — chặt nhất, chỉ proxy hỏng ngay từ đầu mới claim được.
- (b) **Trong 7 ngày** — hợp lý cho đa số use case, giống chính sách bán điện tử.
- (c) **Trong 50% lifetime** — proxy 30 ngày → claim được 15 ngày đầu.
- (d) **Cho đến trước khi HSD còn ≤24h** — gần như cả lifetime, dễ nhất cho user nhưng tốn proxy thay thế.
- (e) **Vô thời hạn cho đến khi HSD** — bất cứ lúc nào còn HSD đều claim được.
*Bro chọn?*

**A3. Giới hạn số claim cho 1 user?**
Để tránh user lạm dụng (báo lỗi liên tục để đổi proxy mới):
- (a) **Tối đa N claim đang chờ duyệt cùng lúc** (vd N=2)
- (b) **Tối đa N claim trong X ngày** (vd 5 claim/30 ngày)
- (c) **Không giới hạn** — để admin tự xử lý
- (d) **Cooldown sau mỗi claim** — claim xong phải đợi 1h mới claim được proxy khác
*Bro chọn?*

**A4. Auto-reject sau bao lâu nếu admin không xử lý?**
Claim treo lâu = user chờ bực. Auto-reject sau 24h / 48h / 72h / không auto-reject?

**A5. Proxy thay thế lấy từ đâu?**
- (a) **Cùng category** — replacement allocator filter `category_id = original.category_id`
- (b) **Cùng category + cùng loại mạng (network_type)** — chặt hơn nhưng có thể hết hàng
- (c) **Cùng category + cùng loại mạng + cùng quốc gia** — chặt nhất
- (d) **Bất kỳ proxy nào available** — không filter
- (e) **Admin chọn tay từ list** — admin click chọn từ dropdown khi duyệt claim, không auto-allocate

Nếu hết proxy thoả điều kiện → fallback về cấp ít chặt hơn? Hay từ chối + báo "hết hàng"?

**A6. HSD proxy thay thế tính thế nào?**
- (a) **Copy đúng HSD còn lại của proxy gốc** (vd proxy gốc còn 10 ngày → proxy mới HSD 10 ngày)
- (b) **Reset HSD đầy đủ** (vd HSD 30 ngày từ ngày cấp lại)
- (c) **Cộng thêm bonus 1-2 ngày** để bù thời gian user không dùng được
*Bro chọn?*

**A7. Proxy gốc sau khi duyệt warranty xử lý sao?**
- (a) **Set status='banned'** — không cấp lại được nữa
- (b) **Set status='maintenance'** — admin có thể test sau, nếu lại sống thì re-issue
- (c) **Soft-delete (chuyển vào thùng rác)** — coi như mất hẳn
*Bro chọn?*

### B. Lịch sử test proxy (health-check history)

**B1. Mỗi proxy được hệ thống tự test sống/chết bao lâu 1 lần?**
Hiện tại có cron health-check trong `/api/cron/health-check/route.ts`. Cần biết tần suất hiện tại + có muốn admin trigger thủ công.

**B2. Lưu lịch sử test thế nào?**
- (a) **Lưu hết** — 1000 proxy × 1 lần/ngày × 365 ngày = 365k row/năm. Tốn storage nhưng audit đầy đủ.
- (b) **Chỉ giữ N lần gần nhất** mỗi proxy (vd N=20). Tự động xoá lần cũ. Storage nhỏ.
- (c) **Giữ tất cả lần FAIL + 5 lần PASS gần nhất** — focus vào lần lỗi để debug.
- (d) **Lưu hết, archive sau 90 ngày sang bảng cold storage** — cân bằng audit + cost.
*Bro chọn?*

**B3. Hiển thị ở đâu?**
- (a) **Card riêng trong /proxies/[id]** (proxy detail page)
- (b) **Sub-tab trong /proxies/[id]**
- (c) **Tooltip khi hover icon "Đã kiểm tra X giờ trước"** ở bảng proxy

### C. Lịch sử giao proxy (assignment history)

**C1. Lưu vào đâu?**
Hiện tại "ai nhận proxy nào lúc nào" rải rác giữa `proxies.assigned_at/assigned_to` (chỉ giữ lần GẦN NHẤT) + `activity_logs` (chứa đủ loại event lẫn lộn). Để query "proxy này đã giao bao lần, ai nhận, lúc nào, thu hồi lúc nào" rất khổ.
- (a) **Tạo bảng `proxy_assignments` riêng** — mỗi event giao/thu hồi là 1 row. Schema đơn giản: `proxy_id, user_id, assigned_at, revoked_at, reason`. Query 1 phát ra ngay. *(tôi đề xuất)*
- (b) **Reuse `activity_logs`** — tiết kiệm bảng nhưng query phức tạp + dễ sai.
*Bro chọn?*

**C2. Có cần lưu LÝ DO mỗi lần thu hồi không?**
- (a) Có — enum: `expired, revoked_by_user, revoked_by_admin, banned, warranty_replaced, manual_unassign`
- (b) Không — chỉ cần biết "ai nhận lúc nào, đến khi nào"

### D. Proxy detail page (Wave 26-D-pre1)

**D1. Bro muốn thấy gì ở /proxies/[id]?**
Tôi đề xuất 3 card (xem Section 1) nhưng bro muốn rearrange?

**D2. Click-to-reveal password — mặc định ẩn hay hiện?**
- (a) **Mặc định ẩn**, click mới hiện 5s rồi tự ẩn lại (giống /proxies list view hiện tại).
- (b) **Mặc định hiện** — vì admin đã vào tới detail page rồi, tin tưởng level cao.
- (c) **Reveal phải nhập mật khẩu admin lần nữa** — strict security.

**D3. Quick actions row — bro muốn nút gì?**
Tôi đề xuất: Toggle ẩn / Force expire / Mark banned / Unassign current user / Revoke với lý do. Còn thiếu nút nào?

### E. UI/UX

**E1. Filter row của /requests + /warranty trên mobile xử lý sao?**
Filter có 7-9 dropdown. Mobile width hẹp.
- (a) **Sticky bar trên cùng có nút "Bộ lọc (3)"** mở dialog full-screen chứa hết dropdown (giống Shopee filter)
- (b) **Carousel ngang scroll-able** — admin scroll ngang để chọn dropdown
- (c) **Accordion "Hiện thêm bộ lọc"** — chỉ show 2-3 dropdown thường dùng, ẩn còn lại

**E2. Filter mới lưu thành "saved view" không?**
Admin filter "Đang đợi + 7 ngày + Vendor X" rất nhiều lần → có nút "Lưu bộ lọc" để mở lần sau khỏi click lại?

**E3. Realtime update khi có claim/request mới?**
- (a) Có — toast "Bạn có 1 yêu cầu mới" + counter sidebar tăng
- (b) Có — chỉ cập nhật bảng silent
- (c) Không — admin tự refresh

### F. Operational concerns

**F1. Notification cho user khi claim bảo hành được duyệt/từ chối?**
- (a) Bot Telegram gửi tin nhắn cho user
- (b) Email (nếu có)
- (c) Cả 2
- (d) Chỉ silent — user phải tự /status check

**F2. Nếu admin từ chối claim → user có được phản đối / khiếu nại không?**
- (a) Có — bot có nút "Khiếu nại" → vào queue khiếu nại admin xử lý lại
- (b) Không — từ chối là quyết định cuối cùng
- (c) Có nhưng giới hạn (vd 1 lần khiếu nại / claim)

**F3. Admin nào được duyệt claim bảo hành?**
- (a) Mọi admin role >= "admin"
- (b) Chỉ "super_admin"
- (c) Có thể cấu hình ở /settings (default = admin trở lên)

**F4. Lịch sử "Lô import" — admin có thể XOÁ cả lô không?**
Vd admin import nhầm 200 proxy spam → muốn xoá hết 1 phát thay vì select-all-checkbox. Có nên thêm nút "Xoá cả lô" trong banner `import_batch_id`?

### G. Schema / data choices

**G1. `warranty_claims.reason_code` enum — list đề xuất:**
`no_connect` (không kết nối được), `slow` (chậm), `ip_blocked` (IP bị block), `wrong_country` (sai quốc gia), `auth_fail` (sai user/pass), `other` (lý do khác — kèm `reason_text`).
Bro thấy đủ không? Cần thêm code nào?

**G2. `import_batch_id` có cần lưu thêm metadata?**
Hiện tại chỉ là UUID. Có nên bổ sung bảng `proxy_import_batches`?
- `id, created_at, created_by, total, imported, skipped, failed, source_filename, notes`
- Cho phép admin XEM tất cả lô đã import + ai import + lúc nào + thành công bao nhiêu
- Là tiền đề cho UI "Lịch sử import" sau này
*Có ship cùng Wave 26-D không?*

**G3. Bảo hành — tăng giới hạn yêu cầu của user lên trong khi xử lý?**
Trong khi admin xử lý claim (có thể mất 24-72h), user có cần được tăng giới hạn yêu cầu tạm thời để lấy proxy khác không, hay phải đợi xong claim?
- (a) Không tăng — user chấp nhận mất proxy đó cho đến khi xử lý
- (b) Tăng tạm thời 1 slot — bồi thường thời gian chờ
- (c) "Đóng băng" proxy hỏng (không tính vào counter `proxies_used_*` nữa) — user dùng counter đó đi lấy proxy khác

---

**Phương án ưu tiên ship:** chốt A1 + A2 + A3 + B2 + C1 + D2 + E1 + F1 + G2 trước. 9 câu này quyết định 80% schema và UX. Còn lại có thể chốt sau khi prototype xong.
