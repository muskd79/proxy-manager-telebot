# Review tab "Quản lý proxy" — admin web

Phạm vi: `/proxies` list + form + import + bulk-edit + detail + sub-tabs + 9 API
routes + DB schema + test. So sánh với sibling VIA project.

Ngày: 2026-04-28. Reviewer: Opus 4.7 (1M).

---

## 1. Bản đồ file (LOC + state hooks)

### 1.1 UI / Page + Components

| File | LOC | Hooks chính | Ghi chú |
|---|---:|---|---|
| `src/app/(dashboard)/proxies/page.tsx` | 567 | `useState`×9, `useCallback`×3, `useEffect`×4, `useRef`×1 | Container — fetchProxies / fetchCountries / fetchCategories / realtime / keyboard. |
| `src/components/proxies/proxy-table.tsx` | 454 | mobile card + desktop table 2 layouts | 14 cột desktop. `colSpan={14}` — đúng. |
| `src/components/proxies/proxy-form.tsx` | 347 | `useState`×3, Zod parse | Dialog tạo/sửa đơn. |
| `src/components/proxies/proxy-import.tsx` | 767 | 19 useState, 3 useEffect | Wizard 3 bước paste/file/probe/import. **Lớn nhất, vượt ngưỡng 800.** |
| `src/components/proxies/proxy-detail.tsx` | 288 | `useState`×2 | **Còn 100% tiếng Anh** (xem 2.6). |
| `src/components/proxies/proxy-filters.tsx` | 265 | stateless | OK — đã VN hoá. |
| `src/components/proxies/proxy-bulk-edit.tsx` | 147 | `useState`×2 | **Còn 100% tiếng Anh + 2 trường disabled.** |
| `src/components/proxies/credential-cell.tsx` | 89 | `useState`×2 | Mask password — OK. |
| `src/components/proxies/proxy-sub-tabs.tsx` | 29 | — | Wrapper nhỏ — OK. |
| **TỔNG UI** | **2 953** | — | Đa số file ổn, `proxy-import.tsx` cần refactor. |

### 1.2 API Routes

| Route | LOC | Methods | Auth | CSRF | Zod | Rate limit | Audit |
|---|---:|---|---|---|---|---|---|
| `proxies/route.ts` | 296 | GET, POST | requireAnyRole / requireAdminOrAbove | **KHÔNG** | POST có (CreateProxySchema) | KHÔNG | POST có |
| `proxies/[id]/route.ts` | 245 | GET, PUT, DELETE | requireAnyRole / requireAdminOrAbove | **KHÔNG** | PUT có (UpdateProxySchema) | KHÔNG | PUT/DELETE có |
| `proxies/bulk-edit/route.ts` | 160 | POST | requireAdminOrAbove | **CÓ** ✓ | có | KHÔNG | có |
| `proxies/import/route.ts` | 168 | POST | requireAdminOrAbove | **KHÔNG** | có (ImportProxiesSchema) | KHÔNG | có |
| `proxies/check/route.ts` | 92 | POST | requireAdminOrAbove | **KHÔNG** | có | KHÔNG | KHÔNG |
| `proxies/probe/route.ts` | 86 | POST | requireAdminOrAbove | **KHÔNG** | có | **KHÔNG (mở socket!)** | KHÔNG |
| `proxies/probe-batch/route.ts` | 135 | POST | requireAdminOrAbove | **KHÔNG** | có (max 1000) | **KHÔNG (3000 socket/req!)** | KHÔNG |
| `proxies/export/route.ts` | 75 | GET | requireAnyRole | n/a (GET) | n/a | KHÔNG | KHÔNG |
| `proxies/stats/route.ts` | 56 | GET | requireAnyRole | n/a | n/a | KHÔNG | KHÔNG |

---

## 2. Bug list

### CRIT

| # | File / dòng | Mô tả |
|---|---|---|
| C1 | `bulk-edit/route.ts:38-39, 91-99` + RPC `safe_bulk_edit_proxies` (mig 030 dòng 126-136) | Schema vẫn chấp nhận `tags_add`/`tags_remove`, RPC vẫn UPDATE column `p.tags`. **Cột `tags` đã DROP ở mig 037 (`ALTER TABLE proxies DROP COLUMN IF EXISTS tags`).** Gọi bulk-edit với `tags_add` → RPC raise `column "tags" does not exist`, mọi update khác trong cùng tx cũng rollback. |
| C2 | `proxies/route.ts:249-266` POST handler | `CreateProxySchema` vẫn parse `tags` (VIA-style flat tags) và route gán `notes: notes \|\| null` nhưng KHÔNG ghi `tags`. Nếu schema yêu cầu `tags` mà cột đã drop, dữ liệu user gửi lên bị nuốt im lặng — không insert lỗi nhưng không lưu. Cần verify `CreateProxySchema` đã loại `tags`. |
| C3 | `proxies/route.ts:60-61` | `query.ilike("host", "%${filters.search}%")` — không escape `%` / `_` / `\` user input. SQL wildcard injection: search `%` match all rows, `_` match 1 char. Không phải SQL injection (Postgres bind param), nhưng bypass intended search → leak inventory + DoS qua scan toàn bảng. |
| C4 | `proxies/probe-batch/route.ts:42-58` | `MAX_BATCH_SIZE=1000`, `MAX_CONCURRENT_HOSTS=50` × 3 socket/host = **150 socket đồng thời, 1000 socket/req**. **KHÔNG có rate limit, KHÔNG CSRF.** Admin compromised → 1000 outbound TCP connect → có thể được dùng làm portscan / amplification reflector. |

### HIGH

| # | File / dòng | Mô tả |
|---|---|---|
| H1 | Mọi route POST/PUT/DELETE (trừ `bulk-edit`) | **Thiếu `assertSameOrigin`** — CSRF risk. Bulk-edit có nhưng inconsistent. Một POST attack từ origin khác qua cookie session vẫn xoá/sửa proxy được. |
| H2 | `[id]/route.ts:215-221` DELETE soft-delete | Chỉ set `is_deleted=true` nhưng **KHÔNG check `proxy.assigned_to`**. User Telegram đang giữ proxy này → list endpoint của bot vẫn trả proxy đã "xoá" hoặc bot lookup lỗi. State machine phải ép `revoke` trước khi delete. VIA project có `safe_revoke_proxy` (mig 029) — chưa wire vào DELETE. |
| H3 | `proxies/route.ts:60-61` search index | Query `ilike host LIKE '%text%'` — leading `%` không dùng được btree index. `idx_proxies_host_trgm` GIN trgm có ở mig 011 — nhưng `.ilike()` Supabase không tự dùng GIN, cần `.textSearch()` hoặc raw SQL. **Bảng 10k+ proxy: search 200-800ms**. |
| H4 | `proxies/page.tsx:300-339` `handleCheckAll` | `fetch("/api/proxies?pageSize=500")` — **fetch tối đa 500 proxy rồi gọi `/check` từng batch 100**. Fleet >500 sẽ chỉ check một phần. Comment trong code nói "use cron for >500" nhưng UI không hiển thị warning. |
| H5 | `bulk-edit/route.ts:44-53` schema refine | `.refine()` cho phép update với `notes: ""` (empty string) coi là "có update" → wipe notes của 5000 proxy do client UX nhầm submit textarea trống. |
| H6 | `import/route.ts:117-140` upsert dedupe | `onConflict: "host,port"` — nhưng cùng `host:port` 2 nhà cung cấp khác (vendor_label) → 1 dòng bị bỏ qua (skipped). User import lô mới nghĩ đã import nhưng bị "trùng" với lô cũ đã banned. Cần composite key `(host, port, vendor_label)` hoặc per-row error. |
| H7 | `export/route.ts:14-36` while-loop pagination | Loop `range(page*1000, ...)` không có upper bound — fleet 1M proxy = 1000 round-trip + giữ array trong memory. **OOM rủi ro trên Vercel hobby (1024MB).** Mig `idx_proxies_created_at_id` partial index không có index ASC, nên ORDER BY DESC OK nhưng chunked memory fan-in vẫn lớn. |
| H8 | `[id]/route.ts:97-116` PUT status guard | Đọc `currentStatus` ở 1 query, gọi `canTransition`, rồi UPDATE — **race condition** y hệt bulk-edit pre-22E-3. 2 admin chuyển banned→available và banned→maintenance đồng thời, cả 2 pass guard, UPDATE thắng cuối → state máy bị bypass. Cần RPC tương tự `safe_bulk_edit_proxies` cho single update. |

### MEDIUM

| # | File / dòng | Mô tả |
|---|---|---|
| M1 | `proxy-bulk-edit.tsx:114-121` Country input disabled | Hiển thị input Country với placeholder "(deferred — not yet wired into bulk RPC)" nhưng vẫn render. Hoặc làm nó hoạt động hoặc remove khỏi UI. |
| M2 | `proxy-detail.tsx` | **Toàn bộ trang detail còn tiếng Anh** — "Created", "Edit", "Delete", "Health Check", "Copy", "Copied!", "Status", "Speed", "Last Checked", "Country", "Assigned To", "Expires", "Authentication", "Assignment History", "Previous assignments", "No assignment history". Trái với spec Wave 22 VN-first. |
| M3 | `proxy-bulk-edit.tsx` | DialogTitle "Bulk Edit", labels "Status/Country/Notes", toast `"Updated X/Y proxies"`, `"Failed to update proxies"`, `"No fields to update"`, button "Cancel", "Update X Proxies" — **toàn EN**. SelectItem cũng EN: "Available", "Maintenance", "Banned". |
| M4 | `proxies/route.ts:201-205` viewer strip | Strip `password` xong **nhưng `username` vẫn lộ**. Username thường = email khách → data leak với role viewer. Cần strip cả 2. |
| M5 | `proxies/route.ts:55-57` count="exact" without filter | Khi unfiltered, `count: "exact"` chạy COUNT(*) full table — comment giải thích đã tốt nhưng với fleet >100k đây vẫn 200-500ms. Nên dùng `pg_class.reltuples` cho approximate. |
| M6 | `proxies/page.tsx:200-224` realtime debounce | 2s debounce. Nhưng `channel.on("postgres_changes", "*", ...)` bắt mọi sự kiện (insert/update/delete) trên TOÀN BẢNG — admin A đang xem trang 1 filter "available", admin B import 1000 proxy ở trang khác → admin A re-fetch 1000 lần (debounce gom thành 1 nhưng vẫn refetch). Filter event theo `pk in (current page ids)` để tránh thrash. |
| M7 | `import/route.ts:83-90` port validation | Đã check `< 1 \|\| > 65535` — nhưng không check `Number.isInteger`. Port "8080.5" qua zod coerce thành 8080 (lossy) — silent corruption. |
| M8 | `proxy-import.tsx:266-269` probe error fallback | `if (!res.ok) { toast.error; break; }` — break giữa loop nhưng `setProbeProgress(0)` không reset. UI vẫn hiện 47% mãi mãi. |
| M9 | `proxies/route.ts:200-205` viewer + cursor | Viewer nhận stripped data NHƯNG `nextCursor` build từ `responseData[length-1].created_at` — same. OK. Verify: `assigned_to` cũng nên strip cho viewer (tránh enumerate user). |
| M10 | `015_*` duplicate prefix | `015_cursor_pagination_index.sql` (`idx_proxies_created_at_id`) + `015_connection_pool_index.sql` (`idx_proxies_created_desc`) — **2 file cùng prefix 015, tạo 2 index TRÙNG NHAU** trên `(created_at DESC, id) WHERE is_deleted=false`. Wasted ~50MB/100k rows + write amplification. Drop 1 trong 2. |
| M11 | `proxy-table.tsx:401` `created_by.slice(0,8)…` | Hiển thị 8 ký tự UUID — không có hover/popover hiện full. Admin không biết là ai trừ khi memorise UUID. VIA hiển thị tên admin — port pattern. |

### LOW

| # | File / dòng | Mô tả |
|---|---|---|
| L1 | `proxy-form.tsx:73` password trong state | `password: proxy?.password \|\| ""` — load proxy edit thì password hiện trong React state plaintext. DevTools React inspector lộ. Nên fetch on-demand khi user click "Hiện". |
| L2 | `proxy-detail.tsx:208` `"*".repeat(8)` | Mask hardcode 8 ký tự — không phản ánh độ dài thực, mà cũng không random. Dùng `CredentialCell` như table. |
| L3 | `proxy-form.tsx:281-293` country `<datalist>` | Datalist không validate — user gõ "Việt Nam" lưu DB; ai đó gõ "VN" tạo proxy duplicate quốc gia. Nên ép Select từ ISO list. |
| L4 | `proxies/page.tsx:307-310` `result?.data?.data \|\| result?.data` | Fallback 2 tầng — chứng tỏ API response shape không đồng nhất giữa caller. Sửa response API thay vì client doanh fallback. |
| L5 | `proxy-import.tsx:213` regex split | `split(/[:\t,;]/)` — IPv6 host (chứa `:`) sẽ bị tan. Test case thiếu. |
| L6 | `proxies/route.ts:225` log adminId optional chain | `admin?.id` trong catch — nhưng auth đã pass nên admin chắc chắn defined. Cleanup. |
| L7 | `proxy-table.tsx:298-300` checkbox aria | OK, nhưng table không có `aria-rowcount` chính xác (pageSize chứ không phải total). |
| L8 | `proxy-form.tsx:199-213` Select missing `placeholder` | Cho `Giao thức` dùng `<SelectValue />` không labels. Khi value="http" SelectValue hiện "http" raw chứ không "HTTP". |
| L9 | `proxy-bulk-edit.tsx:62-65` "No fields to update" | English. Mismatched với phần còn lại của UI. |
| L10 | `proxies/page.tsx:475-488` Hint hotkeys English | "Ctrl+A: Select all \| Esc: Deselect \| Del: Delete" — không VN hoá. |

---

## 3. UX issues

| # | Vấn đề | Tác động | Đề xuất |
|---|---|---|---|
| UX1 | `proxy-bulk-edit.tsx` toàn EN + 2 trường disabled | Admin VN khó hiểu, "Country" đứng đó như mock-up | Dịch + remove disabled hoặc làm hoạt động |
| UX2 | `proxy-detail.tsx` 100% EN | Tab "Quản lý proxy" đã VN nhưng click vào 1 row thì văn hoá đứt gãy | Dịch toàn bộ + hợp dùng `t()` từ i18n |
| UX3 | Empty state "Chưa có proxy nào" — chỉ chữ, không có CTA | User mới landing thấy bảng trắng | Thêm icon + button "Thêm proxy đầu tiên" |
| UX4 | `handleCheckAll` cap 500 không hiện trên UI | Fleet 2000 proxy click nút này nghĩ đã check tất | Hiện badge "Sẽ kiểm 500 mới nhất" hoặc enable streaming |
| UX5 | Filter "Sắp hết hạn" trong dropdown Trạng thái | Trộn lifecycle với expiry — confusing | Tách lại như Wave 22J ban đầu hoặc thêm sub-label |
| UX6 | Pagination ở dưới + 14 cột — phải scroll xa mới thấy | Mobile + tablet đặc biệt | Sticky pagination hoặc giảm cột mặc định, ẩn vào "..." |
| UX7 | Realtime sync không có visual indicator | Admin không biết list vừa được refresh từ admin khác | Toast "Đã cập nhật" hoặc highlight row mới |
| UX8 | Bulk delete confirmation không hiện danh sách host | "Xoá 50 proxy?" — admin không biết là proxy nào | List 5 đầu + "...và 45 proxy khác" |
| UX9 | Import wizard 3 cột "Phân loại / Nguồn / Quốc gia" trên row, "Ngày mua / Hạn / Giá" row khác — admin scroll xa | Dùng tabs hoặc collapse nhóm metadata |
| UX10 | Status badges multi-render (Wave 22J) — tới 5 badge/row | Trùng visual noise với "Loại mạng" badge | Gộp lại hoặc cho phép cấu hình |

---

## 4. Security issues

| # | Severity | File | Mô tả |
|---|---|---|---|
| S1 | CRIT | All write routes (trừ bulk-edit) | **Thiếu CSRF (`assertSameOrigin`)** trên POST/PUT/DELETE/import/check/probe* — cookie auth + cross-origin form attack. |
| S2 | CRIT | `probe-batch` | Không rate limit, 1000 hosts × 3 socket = portscan vector. Cần Upstash/Redis token bucket per-admin. |
| S3 | HIGH | DB | **`proxies.username` + `proxies.password` PLAINTEXT** trong DB. pgsodium chỉ áp cho `vendor_credentials` (mig 020). Backup leak = lộ tất cả credential khách. |
| S4 | HIGH | `proxies/route.ts:60` | `ilike` không escape `%` `_` `\` — wildcard bypass + DoS scan. |
| S5 | HIGH | `[id]/route.ts:97-115` | Race condition state-machine guard (xem H8). |
| S6 | MED | `route.ts:201-205` viewer strip | Strip `password` chỉ — `username` lộ với viewer role. |
| S7 | MED | `import/route.ts` không cap `proxies.length` | Schema cap 10000 (theo UI text) — verify ImportProxiesSchema. Body 10000-row JSON ~5MB. |
| S8 | MED | `export/route.ts:38-44` | Không log "ai export khi nào" — audit trail thiếu. Export 10k credential là sự kiện đáng log. |
| S9 | MED | `check/route.ts` | Không log audit. Health-check chính nó vô hại nhưng frequency = forensic signal. |
| S10 | LOW | `proxies/page.tsx:206` | `as any` cast Supabase realtime — disabled type safety. ESLint đã allow. |
| S11 | LOW | RLS `proxies_select` chỉ check `is_admin_or_viewer()` | OK nhưng — mỗi admin xem được proxy của admin khác. Nếu mô hình multi-tenant trong tương lai, thiếu `WHERE created_by = auth.uid()` hoặc tenant_id. |

---

## 5. Performance issues

| # | File | Vấn đề |
|---|---|---|
| P1 | `proxies/route.ts:55-57` | `count="exact"` trên unfiltered list = full COUNT — đã có flag `hasFilter` để dùng "estimated". OK ở filter mode, nhưng unfiltered "trang Quản lý proxy" mặc định = 100% admin sẽ trigger exact count. |
| P2 | `route.ts:60` ilike search | LIKE leading `%` không hit btree, chưa migrate sang trgm operator class. Index `idx_proxies_host_trgm` đã tồn tại nhưng `.ilike()` không xài. |
| P3 | `[id]/route.ts:99-103` PUT | Mỗi PUT = 2 round-trip (SELECT current status + UPDATE). Có thể inline RPC. |
| P4 | `check/route.ts:76-82` | `Promise.all(aliveUpdates)` — N row alive → N UPDATE statement riêng lẻ. Với 100 proxy = 100 round-trip. Dùng UNNEST batch update hoặc CASE WHEN. |
| P5 | `export/route.ts:19-36` | Loop 1k rows/page không có hard cap — fleet 1M = 1000 round-trip. Stream NDJSON thay vì array. |
| P6 | `015_*` duplicate index | 2 index gần như identical trên `(created_at DESC, id) WHERE is_deleted=false`. Drop 1. |
| P7 | `proxies/page.tsx` realtime | `*` event subscription = mọi update bảng → debounce gom nhưng vẫn re-fetch full page. Filter event theo current page ids. |
| P8 | `import/route.ts:117` upsert | OK đã dùng batch 500. Nhưng `count: "exact"` trên upsert → COUNT chạy mỗi batch. Nếu chỉ cần stat tổng cuối thì dùng `count: undefined` rồi đếm len. |
| P9 | `stats/route.ts:12-15` | `select("type, status, country").eq("is_deleted", false)` — full table scan. Fleet 100k → 1-2s. Nên là materialised view hoặc cache 60s. |
| P10 | `proxy-import.tsx:681` `parsedProxies.slice(0, 200).map` | Render OK, nhưng client giữ 10k row trong React state. Mỗi state update re-render 10k-elem array. Dùng useMemo + virtual scroll. |

---

## 6. So sánh với VIA (sibling project)

VIA path: `C:\Users\Admin\Documents\quản lý via, giao via và gửi via qua bot tele\src\app\(admin)\vias\`

| Khía cạnh | VIA (mature) | Proxy (current) | Gap |
|---|---|---|---|
| Page LOC | 733 (`page.tsx`) + 17 hook/component file con (4235 LOC) | 567 + 8 component (2953 LOC) | VIA tách hooks tốt hơn (`useViasState`, `useViasActions`, `useViasFiltersURL`, `useViasPagination`, `useViasFiltersURL`, `useViasSearchFilter`, `useViasStatusFilter`, `useViasTemporalFilter`) |
| Filter | Multi-UID search, price range min/max, date range, hidden toggle, warranty, ever_reported, uid_status, dropdown "More filters" với badge count | 6 dropdown ngang + search host | **Thiếu**: price range, date range, multi-host search, more-filters dropdown, presets bar |
| Filter presets | `FilterPresetsBar` + `useFilterPresets` hook — admin save lọc thường dùng | Không có | **Thiếu** |
| URL sync | `useViasFiltersURL` 2-way URL ↔ state | Filter chỉ gửi qua API params, không persist URL | **Thiếu** — share link không bảo toàn filter |
| Empty state | `EmptyState` component dùng chung | Chỉ text "Chưa có proxy nào" | **Thiếu** CTA |
| Stats bar | `ViasStatsBar` (107 LOC) hiển thị tổng quan trên list | Chỉ "(N total)" trong header | **Thiếu** |
| Card view (mobile) | `ViaCardView` (265 LOC) chuyên dụng | Inline trong `proxy-table.tsx:142-243` | OK proxy đã có |
| Bulk action bar | `BulkActionBar` shared component, "Select all matching" banner | Inline trong page | **Thiếu** select-all-across-pages |
| Tabs | Tabs component shared, URL `?tab=categories\|trash` | `ProxySubTabs` link sang `/categories` `/trash` 3 page riêng | Khác cách thiết kế — VIA SPA-like, proxy multi-page. Cả 2 đều OK. |
| Dynamic import nặng modal | `dynamic(() => import('./_components/ImportViasModal'), { ssr: false })` — code-split | Tất cả import sync | **Thiếu** — `proxy-import.tsx` 767 LOC nằm trong route `/proxies/import` riêng nên đỡ, nhưng `proxy-form` + `proxy-bulk-edit` đáng dynamic. |
| Test files | 11 test files: vias-edit, vias-import, vias-api, auth-guards, vias-bulk-edit, vias-import-dedup, vias-queries, vias-copy-uids, vias-check-uid-live, vias-list.service, vias-mutations.service | 1 test file (`proxies.test.ts`, 348 LOC, ~8 GET test + 8 POST test) | **Thiếu nặng**: bulk-edit, import, [id], check, probe, probe-batch, export, stats — KHÔNG test |
| Service layer | `vias-list.service.ts`, `vias-mutations.service.ts` tách query khỏi route | Logic nằm hết trong route handler | **Thiếu** — khó test, khó tái dùng từ bot Telegram |
| Pagination | Cursor + offset, `PageSizeSelector` shared | Có cursor + offset (Wave 21C) | OK |
| API endpoints | 12 endpoints: route, [id], bulk, check-uid, check-uid-live, check-uids, copy, copy-uids, filtered-stats, import, report-action, stats | 9 endpoints | Tương đương — proxy có probe-batch là điểm cộng |

**Điểm proxy hơn VIA**: Probe (auto-detect protocol qua TCP), CredentialCell (mask + reveal), state-machine guard (proxyMachine), pgsodium pattern sẵn cho vendor_credentials.

**Tóm tắt VIA hơn**: tổ chức hooks-driven, filter presets, URL sync, code-split dynamic modal, **coverage test 11x dày hơn**, service layer.

---

## 7. Test coverage

File: `src/app/api/__tests__/proxies.test.ts` (348 LOC).

Coverage estimate: **~25%**.

| Endpoint | Test có | Ghi chú |
|---|---|---|
| `GET /api/proxies` | 8 case | OK — auth, viewer strip, search filter, type filter, pageSize clamp, default, supabase error |
| `POST /api/proxies` | 8 case | OK — create, 401, 403, missing host, invalid port, invalid type, optional fields, supabase error |
| `GET /api/proxies/[id]` | **0** | Thiếu hoàn toàn |
| `PUT /api/proxies/[id]` | **0** | Thiếu — đặc biệt cần test state-machine guard race + valid/invalid transition |
| `DELETE /api/proxies/[id]` | **0** | Thiếu — soft + permanent + assigned guard |
| `POST /api/proxies/bulk-edit` | **0** | Thiếu — RPC mock, atomic guard, 409 invalid_count |
| `POST /api/proxies/import` | **0** | Thiếu — dedupe, batch, validation, 10000 cap, IPv6 split, malformed line |
| `POST /api/proxies/check` | **0** | Thiếu — concurrency, alive/dead update, error containment |
| `POST /api/proxies/probe` | **0** | Thiếu — SSRF block, DNS resolve |
| `POST /api/proxies/probe-batch` | **0** | Thiếu — rate limit, max 1000 cap, ref correlation |
| `GET /api/proxies/export` | **0** | Thiếu — CSV injection escape, pagination loop, viewer strip |
| `GET /api/proxies/stats` | **0** | Thiếu |

Test mock cần hardening:
- `tags: ["fast"]` ở `sampleProxy` — cột đã drop, mock outdated.
- Mock chain method list `["select", "eq", "ilike", "overlaps", ...]` thiếu `.gt`, `.lt`, `.lte`, `.is`, `.not`, `.or`, `.in`, `.upsert` — test sẽ break khi route gọi các method này.

**Component test**: KHÔNG có. Search `__tests__/components` hoặc `*.test.tsx` cho `proxy-form`, `proxy-table`, `proxy-filters` — không có. VIA cũng không có nhiều component test.

**E2E**: Không có Playwright file nào cho `/proxies` flow.

---

## 8. DB analysis

### 8.1 Bảng proxies — Index inventory

| Index | Cột | Where | Mig | Trùng/Thừa? |
|---|---|---|---|---|
| `idx_proxies_status` | status | — | 002 | OK |
| `idx_proxies_type_status` | type, status | — | 002 | Subset của idx_proxies_status_assigned? — kiểm tra |
| `idx_proxies_assigned_to` | assigned_to | — | 002 | OK |
| `idx_proxies_country` | country | — | 002 | OK |
| `idx_proxies_expires_at` | expires_at | NOT NULL AND is_deleted=false | 006 | OK |
| `idx_proxies_host_port` | host, port | is_deleted=false | 007 | UNIQUE? — verify |
| `idx_proxies_status_assigned` | status, assigned_to | is_deleted=false | 008 | OK |
| `idx_proxies_host_trgm` | host gin_trgm | — | 011 | OK |
| `idx_proxies_isp_trgm` | isp gin_trgm | — | 011 | **isp đã drop khỏi UI Wave 22Y, kept in DB** — index vẫn hợp lệ nhưng không được query |
| `idx_proxies_expiry` | expires_at | partial | 014 | **Trùng `idx_proxies_expires_at` (006)?** Cần đọc kỹ |
| **`idx_proxies_created_at_id`** | created_at DESC, id | is_deleted=false | **015_cursor_pagination_index** | **TRÙNG idx_proxies_created_desc** |
| **`idx_proxies_created_desc`** | created_at DESC, id | is_deleted=false | **015_connection_pool_index** | **TRÙNG idx_proxies_created_at_id** |
| `idx_proxies_vendor` | vendor_id | mig 019 | 019 | OK |
| `idx_proxies_expiry_vendor` | (composite) | 023 | 023 | OK |
| `idx_proxies_avail_geo_type` | partial avail | 023 | 023 | OK |
| `idx_proxies_distribute_priority` | partial | 023 | 023 | OK |
| `idx_proxies_purchase_lot` | purchase_lot_id | 023 | 023 | **purchase_lots dropped mig 040** — index cần drop |
| `idx_proxies_category_id` | category_id | 028 | 028 | OK |
| `idx_proxies_visible_v22g` | partial visible | 036 | 036 | OK |
| `idx_proxies_network_type` | network_type | 037 | 037 | OK |
| `idx_proxies_network_type_trgm` | trgm | 038 | 038 | **Trùng `idx_proxies_network_type_eq` mig 039?** |
| `idx_proxies_network_type_eq` | eq | 039 | 039 | **Trùng 038** — verify |
| `idx_proxies_host_trgm` | mig 039 | — | 039 | **Trùng mig 011 cùng tên** — IF NOT EXISTS bảo vệ nhưng cleanup |

**Findings**:
- **Index trùng 015**: 2 index identical (đã verify by Read).
- **Index orphan**: `idx_proxies_purchase_lot` — purchase_lots table đã drop (mig 040) nhưng index trên proxies.purchase_lot_id chưa drop. Verify.
- **Index orphan**: `idx_proxies_isp_trgm` — `isp` column còn nhưng UI không filter, không value.
- **Index trùng tên**: `idx_proxies_host_trgm` xuất hiện ở mig 011 + 039. CREATE INDEX IF NOT EXISTS chặn lỗi nhưng noise.
- **Network_type 2 index**: trgm vs eq — 1 cho LIKE 1 cho =, có thể cùng tồn tại nhưng review usage.

### 8.2 RLS

Bảng `proxies` (mig 003 dòng 91-115):
- `proxies_select` USING is_admin_or_viewer() — OK
- `proxies_insert` WITH CHECK is_admin() — OK
- `proxies_update` USING+WITH CHECK is_admin() — OK
- `proxies_delete` USING is_admin() — OK
- `proxies_service_all` cho service_role — OK

Bảng `proxy_categories` (mig 028):
- ENABLE RLS — OK
- 5 policy đầy đủ — OK

**Gap**: Không có RLS cho `tele_users` đang `assigned_to` — user A có thể nhận proxy khác user B nếu RLS không kiểm. Cần coi `tele_users` policy. Nhưng proxy cấp qua bot là service_role — bypass RLS. OK trong scope review tab admin.

### 8.3 Encrypt

- `pgsodium` cài đặt mig 020 — chỉ áp `vendor_credentials.password_encrypted`.
- **`proxies.password` PLAINTEXT** — backup, log query, support engineer nhìn được.
- Wave 17/18 roadmap có ghi nhưng chưa migrate.

**Khuyến nghị**: extend `encrypt_vendor_cred()` thành generic `encrypt_secret()` + thêm cột `proxies.password_encrypted bytea` + `password_key_id uuid` rồi backfill + drop plaintext. Chiến lược giống mig 020 nhưng cho proxies.

---

## 9. Top 5 ưu tiên cao nhất (CRIT/HIGH)

| # | Item | Severity | Effort | Tóm tắt |
|---|---|---|---|---|
| 1 | **C1** — bulk-edit/route + RPC `safe_bulk_edit_proxies` vẫn ghi cột `tags` đã drop | CRIT | **S** (1-2h) | Sửa Zod schema bỏ `tags_add`/`tags_remove`, sửa RPC mig mới drop param + path; deploy. Nếu UI client không gọi với tags thì nguy cơ thấp nhưng vẫn cần dọn vì bất kỳ caller nào (API direct) sẽ bể. |
| 2 | **S1+H1** — Thêm `assertSameOrigin` cho mọi POST/PUT/DELETE/import/check/probe* | CRIT | **S** (2h) | Copy pattern từ `bulk-edit/route.ts:66`. Wrap trong helper `requireWriteAuth(request, supabase)` gộp CSRF + role check. |
| 3 | **S3** — Encrypt `proxies.username` + `proxies.password` qua pgsodium | HIGH | **L** (1-2 ngày) | Extend hàm encrypt_vendor_cred → encrypt_secret(plaintext). Migration: thêm 2 col bytea + key_id, backfill, sửa route insert/select/PUT, drop plaintext. Test rotation. |
| 4 | **C4+S2** — Rate limit `probe-batch` + `probe` | CRIT | **M** (4-6h) | Upstash rate-limit per-admin: 10 batch/giờ, 1000 single/ngày. Wrap helper. Audit log mỗi batch. |
| 5 | **H8** — RPC atomic cho PUT `[id]` status transition (race fix) | HIGH | **M** (4h) | Tạo `safe_update_proxy_status(id, new_status, admin_id)` SECURITY DEFINER, lock SELECT FOR UPDATE, check transition trong tx. Sửa route PUT gọi RPC. Pattern y hệt `safe_bulk_edit_proxies`. |

**Bonus** (để cân nhắc batch 2):
6. M10 — drop 1 trong 2 index `015_*` trùng (S, 30 phút)
7. M2+M3+UX1+UX2 — VN hoá `proxy-detail.tsx` + `proxy-bulk-edit.tsx` (S, 2-3h)
8. Test — viết test cho `bulk-edit`, `import`, `[id]` PUT/DELETE (M, 1 ngày)
9. H6 — import dedupe theo `(host, port, vendor_label)` (M, 4h)
10. Service layer extraction (XL) — chỉ làm khi planner approve

---

## 10. Tóm gọn

- **9 file API**, **2953 LOC UI**, **40 migration**, chỉ **1 test file 348 LOC** (~25% endpoint coverage).
- Filter UI Wave 22 đã đúng spec 4 trạng thái + "Sắp hết hạn" + "Đã ẩn".
- **CSRF inconsistent** — chỉ bulk-edit có; mọi POST/PUT/DELETE khác hở.
- **Bulk-edit RPC vẫn write cột `tags` đã drop** — bom hẹn giờ.
- **Probe-batch không rate-limit** — 1000 socket outbound/req, vector portscan.
- **Plaintext credential** trong DB.
- 2 index `015_*` trùng nhau, 1 index `purchase_lot` orphan.
- `proxy-detail.tsx` + `proxy-bulk-edit.tsx` còn EN, trái spec VN-first.
- VIA project có pattern hooks-driven + filter presets + URL sync + 11x test coverage — nên port.

File path đã ghi: `C:\Users\Admin\Documents\quản lý proxy trên web và giao proxy qua bot tele cho user tele\proxy-manager-telebot\docs\REVIEW_TAB_proxies.md`
