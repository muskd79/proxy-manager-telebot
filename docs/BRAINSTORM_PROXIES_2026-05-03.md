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
Wave 25-pre2) runs the **revoke flow only** — user gets quota refund,
no replacement. There is no path for "this proxy is dead, give me a
working one without consuming my quota again". Decision log has this
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
                  New assignment: NO quota consumed
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
4. **Replacement quota:** the new proxy does NOT consume quota even
   though it's a "fresh" assignment. Audit table tracks this so revenue
   reports stay accurate.
5. **Same category required:** replacement allocator filters by the
   same `category_id`, then by `network_type`, then anything.
6. **Health re-check before approval:** admin sees a "Re-check now"
   button so they don't grant warranty for a proxy that just had a
   blip.
7. **Banned cascade:** approved warranty → original proxy gets
   `status='banned'` (not just `expired`) so it can't be re-distributed.

### UI sketch

`/warranty` new page:
- Sub-tabs: **Chờ duyệt** / **Đã duyệt (7 ngày)** / **Đã từ chối (7 ngày)**
- Each card shows the claim with a Re-check + Approve/Reject row
- Sidebar badge: count of `pending` claims (red dot when > 0)

### Estimate

- Migration: 1h
- Bot side (callback parser + reason buttons + notifications): 4h
- Admin web (/warranty page + claim card + actions + cron): 1 day
- Replacement allocator (reuse `pickProxyFor` from custom-order): 2h
- Tests: half-day
**Total: ~3 days.** Big enough to deserve its own wave (Wave 26-D).

---

## 5. Tab "Yêu cầu proxy" — sub-tabs expansion

### Current
- "Chờ xử lý" (`status=pending`)
- "Gần đây (7 ngày)" — auto-approved + rejected in last 7 days

### Suggested additional sub-tabs

| Sub-tab | Filter | Why |
|---------|--------|-----|
| **Sắp hết hạn (gần)** | `status='approved' AND assigned_proxy.expires_at within 24h` | Pre-empt churn — admin can DM user before expiry |
| **Đã hết hạn nhưng chưa thu hồi** | `status='approved' AND assigned_proxy.expires_at < now()` | Cleanup queue (currently invisible) |
| **Bảo hành** (after Section 4) | `warranty_claims.status='pending'` | Replaces the "Chờ xử lý" overload — different ops queue |
| **Bị từ chối + lý do** | `status='rejected'` ALL TIME with reason filter | Audit/dispute resolution |
| **Theo nguồn (vendor)** | group by assigned_proxy.vendor_label | Vendor performance view |

**Recommendation:** ship "Sắp hết hạn" + "Đã hết hạn chưa thu hồi"
together as a small commit (1 endpoint extension, 2 sub-tabs). They
solve real ops pain. Defer the rest until warranty lands.

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
4. **Wave 26-E** — Yêu cầu sub-tabs (Section 5) + warranty surfacing
   in sidebar.
5. **Wave 26-F** — Categories detail page + bulk actions (Section 3.3-3.4).

Total ~7-8 days of work end-to-end.

---

## Open questions for the user

1. **Warranty replacement quota policy:** does the user want
   "replacement does NOT consume quota" (recommended, fairness) OR
   "replacement consumes a fresh quota slot" (simpler bookkeeping)?
2. **Warranty eligibility window:** 50% lifetime is a guess. Should it
   be 24h regardless of lifetime? 7 days? Lifetime − 24h?
3. **Health-check history:** user wants every probe stored, or just the
   last 5/20? (Storage cost: 1000 proxies × 1 probe/day = 30k rows/month
   if we keep all.)
4. **`proxy_assignments` table vs `activity_logs` derivation:** does the
   user prefer a dedicated assignments table (cleaner, more storage) or
   reuse activity_logs with an index on `(resource_id, action)` (cheaper,
   query gymnastics)? Recommend dedicated table — query simplicity wins.
5. **Sub-tab "Lô import":** does it deserve a top-level sub-tab under
   Quản lý proxy, or just a panel inside `/proxies` filter?
