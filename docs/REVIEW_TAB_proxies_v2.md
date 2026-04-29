# Review tab "Quản lý proxy" — v2 deep review

Phạm vi: business logic + UI/UX + cấu trúc multi-dev. Ngày 2026-04-29.
Reviewer: Opus 4.7 (1M). Tiếp nối `REVIEW_TAB_proxies.md` (v1, 2026-04-28).

---

## 0. Đã sửa từ v1 (verify)

| v1 ID | Trạng thái | Nguồn xác minh |
|---|---|---|
| C1 — bulk-edit RPC ghi `tags` đã drop | **FIXED** | mig 041 redefine RPC bỏ `tags_add/remove`, schema route `bulk-edit/route.ts:33-53` strict bỏ |
| C2 — POST proxy parse `tags` | **FIXED** | `validations.ts:13-41` không còn field `tags` |
| H1/S1 — CSRF inconsistent | **FIXED** | `proxies/route.ts:235`, `[id]/route.ts:53,177`, `import/route.ts:24`, `check/route.ts:11`, `probe/route.ts:36`, `probe-batch/route.ts:72`, `bulk-edit/route.ts:64` đều có `assertSameOrigin` |
| M10 — index 015 trùng | **PARTIAL** | mig 041 chỉ drop `idx_proxies_purchase_lot` + `idx_proxies_isp_trgm`, **2 index `015_*` vẫn còn trùng** |
| Tests có thêm | **PARTIAL** | `bulk-edit.test.ts` + `probe-batch.test.ts` + `categories.test.ts` thêm; **vẫn thiếu** test cho `[id]` PUT/DELETE, `import`, `check`, `export`, `stats` |

**Còn open từ v1**: C3 (ilike wildcard), C4+S2 (rate-limit probe), H2 (DELETE chưa revoke assigned), H3 (search ko hit GIN), H5 (bulk-edit empty notes wipe), H6 (dedupe (host,port,vendor)), H7 (export OOM), H8 (PUT race), S3 (plaintext password), M1-M11, L1-L10, UX1-UX10. Phần lớn vẫn nguyên.

---

## 1. Business-logic gap (mới phát hiện)

| # | File / dòng | Mô tả | Severity |
|---|---|---|---:|
| **B1** | `proxies/route.ts:202-206` viewer strip GET list + `[id]/route.ts:34-37` viewer strip detail | `password` strip nhưng **`username` vẫn lộ**. User VN dùng email làm username → leak PII với role viewer. **Cùng pattern lặp 3 chỗ** (list / detail / export) — extract helper `stripSensitiveProxyFields(p, role)`. | HIGH |
| **B2** | `import/route.ts:127` `onConflict: "host,port"` | Wave 22Y trở đi proxy có `vendor_label`. Cùng `host:port` mua từ 2 nhà cung cấp — nhập lô 2 sẽ skipped do trùng lô 1, dù 1 đã banned. Cần ON CONFLICT (host, port, vendor_label) hoặc **per-row reason "duplicate of <id>"** trả về client. | HIGH |
| **B3** | `import/route.ts:120-144` upsert ignoreDuplicates + count | `count: "exact"` mỗi batch 500 = COUNT extra. Khi N=10000 → 20 COUNT calls. Quan trọng hơn: `count` từ Supabase upsert với `ignoreDuplicates` **không nhất quán giữa version** (đôi khi trả `null` khi 0 row inserted). `result.skipped = batch.length - inserted` có thể âm/sai. Verify bằng test snapshot. | MED |
| **B4** | `[id]/route.ts:172-251` DELETE | Soft delete chỉ set `is_deleted=true` — **không kiểm `proxy.assigned_to`**. Bot Telegram của user tele đang dùng proxy này → bot lookup thấy `is_deleted=true` (không filter trong query bot?) hoặc nếu filter thì user đột ngột mất proxy giữa session. State machine require `revoke` (assigned→available) trước `delete`. **Bot side effect chưa được handle** — cần soft-delete + nullify assigned_to + log "auto-revoked" hoặc 409 nếu `assigned_to IS NOT NULL` bắt admin xác nhận. | HIGH |
| **B5** | `[id]/route.ts:99-119` PUT status guard | Vẫn 2 round-trip (SELECT current + UPDATE). Bulk-edit đã có `safe_bulk_edit_proxies` RPC atomic; **PUT [id] chưa có equivalent**. Race: 2 admin chuyển banned→maintenance + maintenance→available đồng thời, cả 2 pass guard, UPDATE thắng cuối. Tạo `safe_update_proxy(id, fields)` SECURITY DEFINER với `SELECT FOR UPDATE`. | HIGH |
| **B6** | `bulk-edit/route.ts:33-53` BulkEditSchema | **Không cho update `network_type` / `category_id` / `country` / `vendor_label` / `expires_at` (only `extend_expiry_days`)**. UI bulk-edit đang hiển thị input "Country" disabled với placeholder mỉa mai (`proxy-bulk-edit.tsx:118`). Nhưng nghiệp vụ thực sự cần: gán 500 proxy vừa nhập về 1 category, đổi vendor_label, set expires_at tuyệt đối. Mở rộng RPC + schema. | HIGH (UX impact) |
| **B7** | `import/route.ts:104-117` | `purchase_date: purchase_date \|\| new Date().toISOString().slice(0, 10)` — fallback hôm nay. Nhưng nếu admin cố ý gửi `purchase_date: null` thì vẫn bị ghi đè. Phân biệt `undefined` (chưa set) vs `null` (cố tình null) bằng `Object.hasOwn`. | LOW |
| **B8** | `check/route.ts:73-86` update | Pre-fix tốt: dead = batch update. Alive = N concurrent UPDATE. **N=500 → 500 RPC**. Có thể: `UPDATE proxies SET speed_ms = m.speed_ms FROM (VALUES ...) m(id, speed_ms) WHERE proxies.id = m.id::uuid` — 1 round-trip. Hoặc RPC `bulk_update_health(jsonb[])`. | MED (perf) |
| **B9** | `check/route.ts:75` "auto-banish" semantics | Dead → status="maintenance". Nhưng proxy đang ở `assigned` → flip về `maintenance` **không qua state-machine check** (route gọi update raw, bypass `proxyMachine`). User Telegram đang dùng proxy → nay nó ở "maintenance" mà `assigned_to` còn nguyên → orphan state. Cần: nếu `assigned`, không auto-flip; chỉ log warning + cron `notify-stale-assignment`. | HIGH |
| **B10** | `proxies/route.ts:62` `ilike host '%text%'` | v1 đã ghi (C3). Bổ sung v2: index `idx_proxies_host_trgm` (mig 011) **đã tồn tại** GIN trgm — nhưng `.ilike()` Supabase **không sử dụng GIN trgm operator** trừ khi dùng raw `host % 'text'` qua RPC hoặc `.textSearch()`. Search 100k proxy ≈ 1-2s. | HIGH (perf) |
| **B11** | `probe/route.ts` + `probe-batch/route.ts` | **Vẫn không rate-limit** sau v1 C4. `rate-limiter.ts` có `checkApiRateLimit(ip)` sẵn — wrap đơn giản. Probe-batch 1000×3 socket = vector portscan/amplification. | CRIT |
| **B12** | `proxies/route.ts:201-207` viewer strip — chỉ list | Viewer GET list bị strip password; nhưng viewer **GET `/api/proxies/[id]` cũng strip** (route.ts:34-37) — OK. Tuy nhiên `/api/proxies/export` (export/route.ts:30) **chỉ strip password, không strip username**. Cùng B1 root cause; cần helper. | HIGH |
| **B13** | `stats/route.ts:12-15` | `select("type, status, country").eq("is_deleted", false)` — full table scan. 100k proxy ≈ 1-2s mỗi GET. Page `proxies/page.tsx:117` fetchCountries gọi `/stats` mỗi mount; `proxy-form.tsx:88` gọi 1 lần; `proxy-import.tsx:165` gọi 1 lần. Nên cache 60s qua `unstable_cache` hoặc materialised view + refresh trigger. | MED |
| **B14** | `proxies/route.ts:50-58` countMode logic | `cursorDate ? undefined : hasFilter ? "estimated" : "exact"`. Nhưng admin filter "Đã ẩn" hoặc "Sắp hết hạn" → estimated → admin thấy badge "(~1234 total)" gần đúng → click trang 50 page-size 20 = 1000 → vượt total ước tính → page rỗng. Cần fallback: lần đầu estimated, sau đó count thực khi page > N. | MED |
| **B15** | `proxy-import.tsx:329-389` handleImport | Sau import, không refetch list ở /proxies. Admin import 500 proxy ở `/proxies/import` rồi back navigate → list cũ. Có thể workaround bằng router.refresh() hoặc invalidate. | LOW |
| **B16** | `proxies/page.tsx:300-339` handleCheckAll cap 500 | Hard cap 500 không có cảnh báo UI. Fleet 2000 proxy → admin click "Kiểm tra tất cả" → silent skip 1500. Hiện badge "Sẽ kiểm 500 mới nhất, đặt cron để full". | MED |

---

## 2. UI/UX flaw cụ thể (scenario-based)

| # | Scenario | Hành vi hiện tại | Vấn đề | Đề xuất |
|---|---|---|---|---|
| **U1** | Admin paste 1000 proxy vào textarea import | Auto-parse 250ms debounce → preview table 200 row đầu, cột "#, Host, Port, User, Loại detect, Tốc độ, Status" | **Thiếu cột nhìn nhanh "Pass"** (có pass hay không), **không chỉ rõ row thiếu user/pass** | Thêm cột "Pass" hiển thị `••` nếu có / `—` muted nếu trống. Highlight row thiếu user+pass với `bg-yellow-50` + tooltip "Auth bỏ trống — sẽ import là proxy không xác thực" |
| **U2** | Admin paste IPv6 host `[::1]:8080:user:pass` | `parseProxyLine` split `:` → host=`[`, port=NaN, **invalid** | IPv6 silent fail, không có fix | Phát hiện `[` ở đầu → split khác. Hoặc chấp nhận format `[host]:port:user:pass` |
| **U3** | Admin import 1000 proxy nhưng 500 trùng | Banner show "500 imported, 500 skipped (trùng)" — **không có danh sách proxy nào trùng với cái cũ** | User không biết là proxy nào | Thêm link "Xem 500 proxy bị bỏ qua" → modal table host:port + ngày tạo của bản gốc. Giúp admin quyết định có cần xoá lô cũ không |
| **U4** | Admin click "Tạo danh mục mới" trong CategoryPicker | Dialog nhỏ chỉ field "name" | Default fields (`default_country`, `default_proxy_type`, `default_isp`, `default_purchase_price_usd`...) phải vào tab `/categories` riêng rồi quay lại sửa — **flow gãy** khi admin đang ở giữa import 1000 proxy | Mở rộng dialog: collapsible "Cấu hình nâng cao" với 4-5 default fields. Hoặc giữ minimal nhưng auto-redirect tới `/categories/{id}/edit?return=back` |
| **U5** | Admin click "Bulk Edit 50 proxy" | Dialog mở: Status / Country (disabled) / Notes — **EN labels** | v1 đã ghi M3. Bổ sung: thiếu **Network type, Category, Vendor source, Expires at** — **các field admin thực sự cần bulk edit** | Dịch sang VN + thêm 4 field còn lại (cần mở rộng RPC `safe_bulk_edit_proxies`) |
| **U6** | Admin xem `/proxies/[id]` chi tiết | UI 100% English | v1 đã ghi M2. Tab Quản lý proxy tiếng Việt → click row → English đứt gãy | Dịch sang VN, tái dùng `useI18n()` từ page list |
| **U7** | Admin chọn 50 proxy → bấm Delete | Dialog "Xoá 50 proxy?" — **không list** | Admin không biết là proxy nào, sai 1 cái không undo được (Trash khôi phục được nhưng vẫn cần biết) | Hiện 5 proxy đầu (host:port) + "...và N proxy khác" + link "Xem tất cả" |
| **U8** | Admin click "Kiểm tra tất cả" với 2000 proxy | Toast "Đã kiểm 500 proxy" sau ~30s | **Cap 500 ngầm** — admin không biết 1500 chưa kiểm | Trước khi gọi, hiện confirm "Sẽ kiểm 500 proxy mới nhất (giới hạn). Có 2000 proxy — cần đặt cron job để kiểm tự động". Link tới `/settings/cron` |
| **U9** | Admin filter "Đã ẩn" → click row → vào detail → click "Sửa" → đổi status thành "available" → save | Status update nhưng `hidden=true` không đổi → vẫn ẩn khỏi list mặc định | Confusing — user không hiểu vì sao proxy "available" mà không thấy trong list | Trong form sửa, hiện toggle "Hiện trên list (`hidden`)" hoặc auto-unhide khi đổi sang available |
| **U10** | Admin xem table desktop | 14 cột — host, user, pass, type, network, status (multi-badge), country, user_telegram, assigned_at, speed, expires, created_by, actions | Quá nhiều cột; mobile có card view nhưng tablet width vẫn cuộn ngang | Column visibility toggle (lưu localStorage). Default ẩn: created_by, assigned_at |
| **U11** | Admin filter "Sắp hết hạn" trong dropdown Trạng thái | Filter trộn lifecycle (available/assigned/banned) với expiry derived | Confusing — đây là 2 dimension khác nhau | Thêm divider/sub-label trong dropdown: "Trạng thái — Vòng đời" / "Trạng thái — Hết hạn" |
| **U12** | Admin click "+ Thêm proxy" → Thêm đơn → form mở | Form có 13 field (host, port, type, network_type, user, pass, country, city, category, expires, notes…) | Form dài, scroll. Field cần thiết tối thiểu: host, port, type | Tách 2 section: "Bắt buộc" (host, port, type) + collapsible "Chi tiết" (rest). Field `network_type` + `category` đặt cùng |
| **U13** | Admin sau khi import thành công | Banner "Đã import 500 proxy" — **không có CTA "Xem danh sách"** | Phải tự navigate `/proxies` | Thêm button "Xem 500 proxy vừa import" → `/proxies?import_id=<importId>` (cần thêm filter param) |
| **U14** | Admin đã ẩn 1 category — proxy thuộc category đó | Cascade trigger set `proxies.hidden=true`. Filter mặc định `hidden=false` → biến mất | Không có hint "Tại sao 50 proxy biến mất" | Toast khi cascade chạy: "50 proxy ẩn theo category". Hoặc indicator nhỏ "(50 ẩn)" trên Quản lý proxy header |
| **U15** | Admin cuộn xuống cuối table 100 row | Pagination ở đáy — phải scroll xa | Mobile/tablet đặc biệt | Sticky pagination bar, hoặc pagination ở cả top và bottom |

---

## 3. Preview table column legend (chi tiết cho 1000-row paste)

Thay thế header table hiện tại trong `proxy-import.tsx:687-698`:

| Col | Header | Width | Format | Empty/Invalid display | Tooltip |
|---|---|---|---|---|---|
| 1 | `#` (line) | w-12 | số | luôn có | "Số dòng trong text gốc — để debug paste" |
| 2 | `Host` | min-w-32 | mono | `—` muted nếu rỗng + bg row đỏ | "Tên máy chủ proxy hoặc IPv4/IPv6" |
| 3 | `Cổng` | w-20 | mono | `—` muted nếu invalid + bg đỏ | "1-65535" |
| 4 | `User` | min-w-24 | mono muted | `—` muted nếu rỗng (KHÔNG đỏ — không bắt buộc) | "Tên đăng nhập (tuỳ chọn)" |
| 5 | `Pass` | w-16 | `••••` mono nếu có / `—` nếu trống | nếu rỗng → bg yellow nhẹ + icon `AlertTriangle` | "Mật khẩu — sẽ ẩn trong list. Trống = proxy không xác thực" |
| 6 | `Loại detect` | w-28 | Badge HTTP/HTTPS/SOCKS5 | `—` muted nếu chưa probe (chưa Auto-detect) / "Loại mặc định" italic nếu probe failed | "Loại do auto-detect quyết định. Probe trước khi import." |
| 7 | `Tốc độ` | w-20 | `Xms` màu green<500/yellow<1000/red≥1000 | `—` muted | "Latency TCP probe đầu tiên thành công" |
| 8 | `Status` | w-32 | Badge: Hợp lệ / Alive (xanh) / Dead (đỏ) / `<lý do lỗi>` (đỏ) | nếu invalid → đỏ + lý do | "Trạng thái parse + probe" |

**Legend bar trên cùng table** (mới):
```
[Hợp lệ: 950]  [Lỗi: 50]  [Alive: 800]  [Dead: 150]  [Trống user/pass: 200]   |   Click row đỏ để xem lý do
```

**Row visual rules**:
- Row invalid (parse fail): `bg-red-50 dark:bg-red-950/20`
- Row alive=false (đã probe, dead): `opacity-50`
- Row alive=true: bình thường
- Row chưa probe + valid: bình thường
- Row thiếu user+pass (cả 2): `border-l-2 border-yellow-500` (warning gentle)

**Empty value display matrix**:
- Required field rỗng (host/port) → `—` đỏ + bg row đỏ
- Optional field rỗng (user/pass) → `—` muted gray
- Probe field chưa chạy (loại detect, tốc độ) → `—` muted với tooltip "Bấm Auto-detect"
- Probe field chạy thất bại → italic muted "Probe failed" + retry icon

---

## 4. Cấu trúc file cho team multi-dev/agent

### 4.1 File >500 LOC cần tách

| File | LOC | Vấn đề | Đề xuất tách |
|---|---:|---|---|
| `proxy-import.tsx` | 786 | God component: paste UI + file UI + 4 form section + probe + preview + result. **2 dev không thể edit cùng lúc**. | Tách 5 file:<br>• `proxy-import.tsx` (orchestrator, ~150 LOC) — quản lý state & 5 sub-component<br>• `proxy-import-input.tsx` (~120 LOC) — paste textarea + file upload + drop zone<br>• `proxy-import-meta-form.tsx` (~250 LOC) — 9 field bulk metadata (category, network_type, vendor, country, dates, prices, notes)<br>• `proxy-import-preview.tsx` (~200 LOC) — table 200-row + summary + Auto-detect button<br>• `proxy-import-result.tsx` (~80 LOC) — kết quả 3 stat + error list<br>• Hook `useProxyImportState.ts` (~150 LOC) — useState chung + parse + probe + import action |
| `proxies/page.tsx` | 567 | God container: filter state, fetch list, fetch countries, fetch categories, realtime sub, keyboard shortcut, check-all, bulk delete, render. | Tách:<br>• `proxies/page.tsx` (~200 LOC) — chỉ render layout<br>• `hooks/useProxiesState.ts` (~120 LOC) — useState + useReducer cho filters/selectedIds<br>• `hooks/useProxiesActions.ts` (~120 LOC) — handleSave/Delete/BulkDelete/CheckAll/Export<br>• `hooks/useProxiesRealtime.ts` (~80 LOC) — realtime channel + debounce<br>• `hooks/useProxiesKeyboard.ts` (~50 LOC) — Ctrl+A / Esc / Del<br>• `components/proxies-toolbar.tsx` (~100 LOC) — header + dropdown thêm + export button<br>• `components/proxies-bulk-action-bar.tsx` (~80 LOC) — selectedIds banner |
| `proxy-table.tsx` | 454 | Mobile card + desktop 14-col table inline cùng 1 file | Tách:<br>• `proxy-table.tsx` (~120 LOC) — chọn layout & re-export<br>• `proxy-table-desktop.tsx` (~250 LOC) — desktop 14 col<br>• `proxy-table-mobile.tsx` (~150 LOC) — mobile card<br>• `proxy-table-row.tsx` (~80 LOC) — row dùng chung |
| `proxy-form.tsx` | 381 | OK ở 381 nhưng đang trộn schema + state + 13 field | Giữ nguyên file, **tách schema sang `lib/validations/proxy-form.ts`**. 2 dev khác có thể edit schema vs UI |

### 4.2 Tách services layer (port từ VIA)

VIA project có sẵn **`vias-list.service.ts`** + **`vias-mutations.service.ts`** + 28 services khác. Pattern:

```
src/services/
├── proxy-list.service.ts        # GET list logic — tái dùng cho /api/proxies + bot Telegram
├── proxy-mutations.service.ts   # create/update/delete/bulk — tái dùng cho cron + admin
├── proxy-import.service.ts      # parse + dedupe + upsert
├── proxy-probe.service.ts       # detect logic (đã có lib/proxy-detect.ts — wrap)
├── proxy-stats.service.ts       # stats + countries cache
└── proxy-export.service.ts      # CSV + JSON streaming
```

**Tại sao**:
- API route hiện tại fat: query + business + response trong 1 hàm. Bot Telegram (`grammy`) muốn list proxy phải gọi HTTP qua chính server → wasted hop. Service layer cho phép import trực tiếp.
- Test dễ: mock supabase 1 chỗ; route handler chỉ test auth + CSRF + serialization.
- 2 dev: dev A sửa filter logic trong service, dev B sửa response shape trong route — không xung đột.

**Effort**: M (1-2 ngày). Bắt đầu với `proxy-list.service.ts` extract từ `proxies/route.ts` GET handler — dễ nhất, ROI cao nhất.

### 4.3 Test file mapping (multi-dev convention)

```
src/app/api/__tests__/
├── proxies.test.ts              # GET list + POST create  ✅
├── proxies-id.test.ts           # GET/PUT/DELETE by id    ❌ MISSING
├── proxies-import.test.ts       # POST import + dedupe    ❌ MISSING
├── proxies-bulk-edit.test.ts    # POST bulk-edit + race    ✅ (rename from bulk-edit.test.ts)
├── proxies-check.test.ts        # POST check + concurrency ❌ MISSING
├── proxies-probe.test.ts        # POST probe + SSRF guard  ❌ MISSING
├── proxies-probe-batch.test.ts  # POST probe-batch         ✅
├── proxies-export.test.ts       # GET export CSV + JSON    ❌ MISSING
└── proxies-stats.test.ts        # GET stats                 ❌ MISSING

src/components/proxies/__tests__/
├── proxy-import.test.tsx        # parse, paste, file       ❌ MISSING
├── proxy-form.test.tsx          # validation, submit       ❌ MISSING
├── proxy-table.test.tsx         # render, sort, select     ❌ MISSING
├── proxy-bulk-edit.test.tsx     # dialog, submit           ❌ MISSING
├── proxy-filters.test.tsx       # filter state             ❌ MISSING
└── category-picker.test.tsx     # select + create new     ❌ MISSING

e2e/
├── proxies-import.spec.ts       # paste 100 proxies → see them in list  ❌ MISSING
├── proxies-bulk-edit.spec.ts    # select all → bulk edit → verify       ❌ MISSING
└── proxies-trash.spec.ts        # delete → trash → restore               ❌ MISSING
```

**Convention**: 1 file test = 1 file source. Tên test file = tên source file + `.test.tsx`. 2 dev biết rõ "tao đụng `proxy-import.tsx` → tao update `proxy-import.test.tsx`".

### 4.4 Owner mapping (CODEOWNERS gợi ý)

```
# .github/CODEOWNERS
src/app/api/proxies/route.ts                @api-owner
src/app/api/proxies/[id]/                    @api-owner
src/app/api/proxies/import/                  @import-feature-owner
src/app/api/proxies/probe*/                  @probe-feature-owner
src/app/api/proxies/bulk-edit/               @api-owner
src/app/(dashboard)/proxies/                 @ui-owner
src/components/proxies/                      @ui-owner
src/components/proxies/proxy-import.tsx      @import-feature-owner
src/services/proxy-*.service.ts              @api-owner @ui-owner   # both
supabase/migrations/                         @db-owner
src/lib/proxy-detect.ts                      @probe-feature-owner
src/lib/state-machine/proxy.ts               @api-owner @db-owner
```

---

## 5. 10 đề xuất cụ thể (ưu tiên cao)

| # | Đề xuất | Effort | File đụng | Business rule |
|---|---|---|---|---|
| **R1** | **Wrap `assertSameOrigin` + `requireAdminOrAbove` thành `requireAdminWrite(request)`** helper. Giảm 7 dòng boilerplate × 9 route = 63 dòng. | S (1h) | New `src/lib/auth-helpers.ts` (đã tồn tại?), refactor 9 route | Mọi POST/PUT/DELETE proxy phải pass CSRF + admin role. |
| **R2** | **Helper `stripSensitiveProxyFields(p, role)`** strip cả `username` + `password` cho viewer (B1, B12). | S (1h) | `proxies/route.ts:202-206`, `[id]/route.ts:34-37`, `export/route.ts:30` | Viewer role không thấy credential bao gồm cả username (= email PII của khách). |
| **R3** | **Rate-limit probe + probe-batch + check** qua `checkApiRateLimit` (đã có sẵn). 10 batch/giờ/admin cho probe-batch, 100 single/giờ cho probe, 5 batch check/phút. | S (2h) | `probe/route.ts`, `probe-batch/route.ts`, `check/route.ts`. Cần admin-id key thay IP. | Admin compromised không thể dùng làm portscan/amplification. |
| **R4** | **`safe_update_proxy` RPC atomic** cho PUT [id] (B5). SECURITY DEFINER + `SELECT FOR UPDATE` + check transition. | M (4h) | New mig `047_safe_update_proxy.sql`, refactor `[id]/route.ts:99-119` | 2 admin update status đồng thời không bypass state-machine. |
| **R5** | **DELETE soft + auto-revoke assigned** (B4). Nếu `assigned_to IS NOT NULL` → 409 trừ khi `?force=true`; force → revoke + log + soft-delete. | M (4h) | `[id]/route.ts:172-251`, new RPC `safe_delete_proxy(id, force)` | Không xoá proxy khi user đang dùng — bảo vệ trải nghiệm Telegram. |
| **R6** | **Mở rộng `safe_bulk_edit_proxies`** thêm `network_type`, `category_id`, `vendor_label`, `country`, `expires_at_absolute` (B6). Mở 5 field disabled trong `proxy-bulk-edit.tsx`. | M (6h) | New mig `048_bulk_edit_extend.sql`, `bulk-edit/route.ts` schema, `proxy-bulk-edit.tsx` enable + dịch VN | Admin bulk-rename 500 proxy về 1 category trong 1 click. |
| **R7** | **Search via trgm GIN** — wrap thành RPC `search_proxies_trgm(text, limit, offset)` dùng `host % p_search` operator. Hoặc dùng `.textSearch()` Supabase với `tsvector` (cần generated col). | M (4-6h) | New mig `049_proxy_search_rpc.sql`, `proxies/route.ts:62` | Search 100k proxy <100ms thay vì 1-2s. |
| **R8** | **Tách services layer** — bắt đầu với `src/services/proxy-list.service.ts` extract từ `proxies/route.ts` GET. | M (1 ngày) | New `src/services/proxy-list.service.ts`, refactor `proxies/route.ts` GET | Bot Telegram tái dùng list logic không qua HTTP hop. |
| **R9** | **Tách `proxy-import.tsx` 786 LOC** thành 5 file + 1 hook (xem 4.1). Cho phép 2 dev edit song song. | M (6h) | 5 file mới trong `src/components/proxies/import/` + hook | Multi-dev dev. Test riêng từng phần. |
| **R10** | **Preview table column legend** (xem section 3) + Pass column + warning row khi user/pass rỗng. | S (3h) | `proxy-import.tsx:687-744` | User feedback: "1000 proxy nhìn không biết cột nào trống". |

**Bonus (nếu còn thời gian)**:
- R11: VN hoá `proxy-detail.tsx` + `proxy-bulk-edit.tsx` (S, 2h)
- R12: Encrypt `proxies.password` qua pgsodium (L, 1-2 ngày) — high security ROI
- R13: `import_id` filter param + "Xem proxy vừa import" link (S, 1h) — UX win lớn
- R14: Drop 1 trong 2 index `015_*` trùng (S, 30 phút)
- R15: Bulk delete confirm hiện 5 host + "...và N khác" (S, 30 phút)

---

## 6. Test mới cần thêm (regression mapping)

| Issue | Test path | Test case |
|---|---|---|
| B1/B12 viewer strip username | `proxies-id.test.ts` | GET as viewer — expect `data.username === undefined` |
| B2 dedupe per vendor | `proxies-import.test.ts` | Import 2 row cùng host:port khác vendor_label → expect 2 inserted |
| B3 upsert count nhất quán | `proxies-import.test.ts` | Mock supabase `count: null` → expect skipped không âm |
| B4 DELETE assigned guard | `proxies-id.test.ts` | DELETE proxy có `assigned_to=uuid` → expect 409 unless `?force=true` |
| B5 PUT race | `proxies-id.test.ts` | 2 PUT đồng thời banned→maintenance + maintenance→available → expect 1 succeed + 1 fail 409 |
| B6 bulk-edit extended | `proxies-bulk-edit.test.ts` | POST update `category_id` cho 100 proxy → expect 100 updated |
| B9 dead status không flip assigned | `proxies-check.test.ts` | proxy `assigned`, alive=false → expect status unchanged + warning logged |
| B11 rate-limit probe | `proxies-probe-batch.test.ts` | 11 lần liên tiếp same admin → expect lần 11 = 429 |
| B14 estimated count overflow | `proxies.test.ts` | Mock count=1000 estimated, request page=51 pageSize=20 → expect graceful empty page |
| C3 ilike wildcard escape | `proxies.test.ts` | search="%" → expect 0 hoặc parameter-escaped |
| U1 preview missing pass column | `proxy-import.test.tsx` (component) | Render với 1 row thiếu pass → expect cell `—` muted + bg yellow |
| U2 IPv6 parsing | `proxy-import.test.tsx` | Parse `[::1]:8080:user:pass` → expect host=`::1` valid |
| U7 bulk delete preview | E2E `proxies-bulk-edit.spec.ts` | Select 50 → confirm dialog hiện 5 host + "...và 45 khác" |
| Component: CategoryPicker create flow | `category-picker.test.tsx` | Click "+ Tạo danh mục mới" → fill name → submit → expect category in list + selected |
| H8 PUT race (cũ v1) | `proxies-id.test.ts` | xem B5 |

---

## 7. Tóm tắt

- **Đã sửa từ v1**: C1, C2 (tags drop), CSRF gap (toàn bộ POST/PUT/DELETE giờ có `assertSameOrigin`), 1 phần index orphan (mig 041), 3 test file mới.
- **Còn open**: 11 issue v1 (C3, C4, H2-H8, S2-S11, M1-M11, L1-L10, UX1-UX10).
- **Mới phát hiện v2**: 16 business-logic gap (B1-B16), 15 UI/UX scenario flaw (U1-U15).
- **Cấu trúc**: cần tách `proxy-import.tsx` 786 LOC + `proxies/page.tsx` 567 LOC + `proxy-table.tsx` 454 LOC. Port services layer từ VIA. CODEOWNERS để 2-3 dev/agent không đụng.
- **10 đề xuất cụ thể** (R1-R10): R1-R3 effort S 4h tổng, đáng làm trước; R4-R7 effort M 1-2 ngày mỗi cái; R8-R10 cấu trúc.
- **Preview table** (section 3): 8 cột rõ ràng + legend + visual rules cho row + empty value matrix.
- **Test mapping** (section 6): 15 test case mới cho B1-B14 + U1, U2, U7 + 1 component test cho CategoryPicker.

**Top 3 ưu tiên user-facing**:
1. **R10** preview table legend (S, 3h) — fix issue user vừa báo
2. **R6** bulk-edit mở rộng (M, 6h) — fix UX nhức nhối "Country disabled, không edit được"
3. **R3** rate-limit probe (S, 2h) — đóng vector portscan

**Top 3 ưu tiên code-quality**:
1. **R8** services layer (M, 1 ngày) — unlock multi-dev + bot reuse
2. **R9** tách proxy-import.tsx (M, 6h) — unlock 2 dev edit cùng feature
3. **R1+R2** auth helper + strip helper (S, 2h) — giảm boilerplate, fix B1/B12 cùng 1 lần

File path: `C:\Users\Admin\Documents\quản lý proxy trên web và giao proxy qua bot tele cho user tele\proxy-manager-telebot\docs\REVIEW_TAB_proxies_v2.md`
