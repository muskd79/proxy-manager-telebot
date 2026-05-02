# REVIEW 2026-05-02 — PM senior, UX + product polish

> Reviewer: PM senior, brutal honest, không nương tay.
> Scope: 16 tab admin (`src/app/(dashboard)`), sidebar IA, bot Telegram UX,
> pain point của 50 admin + 5000 user.
> Ngữ cảnh: 50k proxy, mỗi ngày ~1k yêu cầu. Đã qua 22 wave hardening.
> File path: tất cả tuyệt đối, dùng `\` Windows.

---

## TL;DR — Top 5 vấn đề

| # | Vấn đề | Mức độ |
|---|---|---|
| 1 | Sidebar đã được Wave 22U/V cải thiện, nhưng vẫn bịa thêm tab `check-proxy` ngang hàng `/proxies` (đáng lý là sub-tab hoặc nút trong table). | HIGH |
| 2 | Tab `bot/config` chỉ là stub "coming soon" — đã được lên sidebar Wave 22U mà nội dung vẫn chuyển hướng `/settings`. Bait-and-switch. | HIGH |
| 3 | Logs vs History — đã được merge 1 phần (sub-tabs), nhưng History còn có `page.tsx` riêng + sidebar không trỏ tới. Code dead. | MEDIUM |
| 4 | Bulk action UX không thống nhất: Users dùng for-loop tuần tự (slow + report sai), Proxies dùng allSettled (đúng). | HIGH |
| 5 | Bot welcome text vẫn dán 11 dòng `/cmd - desc` BÊN CẠNH inline keyboard 8 nút — duplicate điều hướng, người dùng phải đọc 2 lần. | MEDIUM |

---

## SECTION 1 — 16 tab scorecard (0-10)

| Tab | Score | Cần riêng? | Comment brutal |
|---|---|---|---|
| `dashboard` | 7/10 | YES | OK. StatsCards + ProxyChart + ActiveUsers + RecentRequests. Thiếu **quick actions** (1-click "Phê duyệt tất cả pending", "Cấp 10 proxy"). KPI hiển thị ổn nhưng KHÔNG drill-down — click "Pending: 23" KHÔNG nhảy sang `/requests?status=pending`. |
| `proxies` | 7.5/10 | YES | Tốt nhất. Sub-tabs (`Proxy / Danh mục / Thùng rác`) đúng IA. Nhưng `Check All Proxies` button (line 425-442) là feature đáng đặt trong bulk action menu, KHÔNG nên là toolbar always-visible. 567 LOC quá nặng — split. |
| `proxies/import` | 8/10 | sub-route OK | Wizard 3-mode (paste/txt/csv) tốt. |
| `requests` | 7/10 | YES | 4 tab nội bộ (pending/approved/rejected/recent) đúng. `Recent` tab logic ngầm 7 ngày → KHÔNG có tooltip giải thích. Realtime update OK. |
| `users` | 6/10 | YES (sub-tab Người dùng) | Bulk action **DÙNG FOR-LOOP TUẦN TỰ** (`for (const id of selectedIds) await blockUser(id)`) — block 100 user mất 100s. Toast `block completed for 87/100 users` không nói **lỗi gì**. So với `/proxies` đã sửa Wave 22X. |
| `chat` | 6.5/10 | sub-tab OK | Tên đã đổi "Hộp thoại bot" — OK. Nhưng KHÔNG có badge "tin chưa đọc" trên sidebar Người dùng Bot → admin không biết ai đang chờ trả lời. Chat list không có search/filter. |
| `categories` | 6/10 | sub-tab OK | Up/down arrow reorder OK nhưng **không drag-drop**. 5000 user × 3-5 category — vẫn dùng được. Thiếu count proxy per category trên row chính. |
| `trash` | 6.5/10 | sub-tab OK | 3 tab Proxy/User/Yêu cầu đã đúng. Empty state thì có icon AlertTriangle generic — chưa hấp dẫn. KHÔNG có "Empty trash" bulk action. |
| `bot` | 4/10 | NO — bịa | Landing page 4 card, 2 card "coming soon" Wave 22V. Cảm giác **placeholder UI**. Page này tồn tại CHỈ vì user feedback "sidebar Bot không nên teleport" — giải pháp hợp lý hơn là gắn `/bot` redirect → `/bot/simulator` rồi sub-tab. |
| `bot/simulator` | 7/10 | sub-route OK | Simulator hữu ích, nhưng UI **quá nặng** (12 commands × button + custom input + chat panel realtime). Không có cách "save scenario" → tester phải gõ lại. |
| `bot/config` | 2/10 | NO — stub | Trang stub linkout sang `/settings`. **Xoá tab này** khỏi sidebar/sub-tab cho đến khi Wave 22V build xong. Bait-and-switch UX là tệ nhất trong 16 tab. |
| `bot-simulator` | n/a | redirect-only | Wave 22U đã chuyển sang `/bot/simulator`. File còn lại chỉ redirect. OK. |
| `check-proxy` | 6/10 | KHÔNG — merge | Tool ad-hoc paste-and-test. **Lý do tồn tại = "vetting trước import"** nhưng `/proxies/import` đã có check-then-import. → Merge thành sub-mode trong import wizard hoặc thành **action trong proxies table** ("Tái kiểm tra dòng đã chọn"). |
| `history` | 3/10 | NO — đã merge | Wave 22P "/history merged into /logs" theo comment sidebar — NHƯNG `page.tsx` vẫn còn (368 LOC). **Code dead chưa xoá**. Sidebar không trỏ tới nhưng URL `/history` trả page riêng → SEO/bookmark vẫn vào được. |
| `logs` | 7/10 | YES | Filter + export CSV (đã sanitise). Sub-tabs đã ăn `history`. Tốt nhưng **KHÔNG có log retention slider** — admin không biết log lưu bao lâu. |
| `admins` | 7.5/10 | YES — super_admin only | Wave 22X đã thêm confirm cho role-change + deactivate. Tốt. Thiếu: bulk invite, last-activity column, audit "ai sửa role ai". |
| `profile` | 8/10 | YES | Wave 22F-D rebuild với 4 sub-tab (Profile/Security/2FA/Sessions). Hoàn thiện nhất. 838 LOC quá to nhưng functional. |
| `settings` | 6/10 | YES — super_admin | Mix bot config (token, webhook, secret) + global limit + admin telegram IDs + auto-clean trash days. **Loose grouping**: 3 mục lớn không có header, scroll dài. |
| `api-docs` | 4/10 | NO | Tự build OpenAPI viewer 431 LOC chỉ để admin xem schema. Admin **không cần API docs trong sidebar admin** — đây là dev tool. → Move sang `/dev/api-docs` hoặc xoá hẳn (link tới Swagger UI public). |

**Tổng**: 6/16 tab đáng tồn tại original. 4 tab bịa/dead/stub. 6 tab đúng nhưng cần polish.

---

## SECTION 2 — Trùng lặp + đề xuất MERGE/SPLIT

| # | Tab A | Tab B (overlap) | Đề xuất | Lý do brutal |
|---|---|---|---|---|
| 1 | `bot` (landing) | `bot/simulator` | **MERGE** — `/bot` redirect tới `/bot/simulator`. Bỏ landing card 4-tile. | Landing 2/4 card "coming soon" = placeholder. Sidebar trỏ đâu thì đến đấy là chuẩn UX. |
| 2 | `bot/config` | `settings` (telegram_bot_token, webhook_secret, admin_telegram_ids) | **DELETE** `/bot/config` đến Wave 22V. Hoặc **MOVE** 3 setting bot từ `/settings` qua `/bot/config` rồi link 2 chiều. | Đang stub. User click vào kỳ vọng config được — gặp link "Xem cài đặt". |
| 3 | `check-proxy` | `proxies/import` (preview-then-import) | **MERGE** — thêm tab "Chỉ kiểm tra (no save)" trong import wizard. | Cùng input (paste/txt), cùng backend `/api/proxies/probe-batch`. Chỉ khác output có save hay không. |
| 4 | `check-proxy` | `proxies` table (per-row + bulk Health Check) | **MERGE thứ 2** — `/check-proxy` cũng dùng được cho proxy đã có trong inventory; trùng với bulk Health Check. | Admin sẽ confused: "kiểm tra proxy của tôi đã có thì vào đâu?". |
| 5 | `history` | `logs` (sub-tab History) | **DELETE `/history` page.tsx** — đã merge nhưng còn file dead. | Wave 22P comment đã nói rõ. Còn 368 LOC dead. |
| 6 | `categories` | `settings` (default values, rate-limits) | **GIỮ NGUYÊN** — categories là entity riêng, không trùng. Chỉ kiểm tra: `default_approval_mode` cho category có cần override `default_approval_mode` toàn cục? | Không trùng nhưng có thể bổ sung relation. |
| 7 | `chat` | `users` (xem hội thoại của 1 user) | **GIỮ sub-tab nhưng** thêm action "Xem hội thoại" trên row của `/users` → mở `/chat?user=ID`. | Đường tắt admin cần. Hiện tại admin phải vào `/chat` rồi search user. |
| 8 | `users` | `trash` (deleted users) | **GIỮ NGUYÊN** trash. Nhưng thêm filter `?status=deleted` trên `/users` cho phép xem mà không cần qua trash. | Soft-delete hiện ẩn trong trash. Edge case admin cần unfilter để audit. |
| 9 | `proxies` | `trash` (deleted proxies) | **GIỮ trash sub-tab Proxy**. Nhưng đảm bảo ấn restore từ trash → push notify table chính. | UX hiện tại OK, cần verify realtime sync. |
| 10 | `requests` (recent tab 7 days) | `logs` (resource_type=request) | **OVERLAP yếu** — recent tab show metadata, logs show audit. Giữ. Nhưng tooltip "Recent = 7 ngày gần nhất" cần thêm. | Mỗi nơi 1 góc nhìn, không trùng hẳn. |
| 11 | `bot/simulator` | `chat` | **GIỮ** nhưng thêm nút "Mở simulator với user này" trên `/chat` — admin đang debug user, mở simulator giả lập là quy trình thường xuyên. | Tăng efficient cho admin debug. |
| 12 | `admins` (super_admin) | `users` (tele user role) | KHÔNG trùng | Telegram user ≠ admin. |
| 13 | `api-docs` | (any) | **DELETE khỏi sidebar admin**. Move route public hoặc dev-only. | Admin tool ≠ dev tool. |
| 14 | `dashboard` | `requests` + `proxies` (KPIs) | **THÊM drill-down** — KPI card click → filter tương ứng. | Hiện tại số chỉ display, không actionable. |
| 15 | `settings` | `admins` | KHÔNG trùng — admins quản lý team, settings là global. | OK. |

**Tổng đề xuất**: 4 DELETE/MERGE (api-docs, history, bot/config, check-proxy), 3 MOVE link, 5 GIỮ + improve.

---

## SECTION 3 — IA redesign sidebar + grouping mới

### Sidebar hiện tại (Wave 22U/V — đã reorg)

```
QUẢN LÝ
  Dashboard
  Người dùng (Telegram users + Tin nhắn sub-tab)
  Quản lý Bot (Simulator + Config)
PROXY
  Quản lý proxy (Proxy + Danh mục + Thùng rác sub-tab)
  Yêu cầu proxy
  Kiểm tra proxy (check-proxy ad-hoc)
HỆ THỐNG
  Lịch sử & Nhật ký (Logs + History merged)
  Tài khoản Admin (super_admin only)
  Hồ sơ cá nhân
  Cài đặt (super_admin only)
```

### Đề xuất sidebar mới (sau khi MERGE/DELETE)

```
QUẢN LÝ
  Dashboard
  Người dùng Bot (sub: Người dùng / Tin nhắn)
PROXY
  Quản lý proxy (sub: Proxy / Danh mục / Thùng rác / Kiểm tra)
  Yêu cầu proxy
BOT
  Bot (sub: Giả lập / Cấu hình — chỉ enable Cấu hình khi Wave 22V xong)
HỆ THỐNG
  Nhật ký (gồm History + Audit log + Activity log)
  Tài khoản Admin
  Cài đặt (link tới /api-docs nội bộ)
  Hồ sơ cá nhân
```

**Thay đổi**:
- Bỏ `Kiểm tra proxy` top-level → nhập làm sub-tab của `Quản lý proxy` (consistency với "Danh mục", "Thùng rác").
- Đổi `PROXY` → tách thêm group `BOT` riêng: hiện 22U gộp Bot vào QUẢN LÝ, nhưng Bot là **product surface khác** (telegram side, không phải admin side). Tách ra giúp scan nhanh hơn.
- `api-docs` xuống chân `Cài đặt` như expandable link.

### Search global — KHÔNG có

Header có `<SearchInput placeholder="Search..." onSearch={query => router.push('/dashboard?search=...')}>`. KHÔNG ai sẽ vào dashboard và filter — đây là **UI giả** không hoạt động. Đề xuất:

- **CTRL+K command palette** (kbar/cmdk) navigate giữa các tab + jump-to user/proxy/request bằng ID.
- Global search mở dialog với 4 nhóm: Người dùng (TG ID, username), Proxy (host:port), Yêu cầu (request ID), Admin.

### Quick actions từ dashboard — KHÔNG có

Stats card click không drill-down. Đề xuất:
- Card "Pending: N" → click jump `/requests?status=pending`
- Card "Active proxies" → `/proxies?status=active`
- Card "Tổng user TG" → `/users`
- Card "Lỗi 24h gần nhất" (mới) → `/logs?level=error&dateFrom=...`

### Breadcrumbs

`<Breadcrumb />` đã có trong Header — nhưng **KHÔNG show** sub-tab cấp 2 (vd: Quản lý proxy → Danh mục). Cần verify.

### URL state sync

Test thực tế:
- `/proxies` filter (search, type, status, country, expiryStatus, categoryId) → **KHÔNG sync URL params**. Refresh trang là mất filter. **BUG HIGH**.
- `/users` filter → cùng vấn đề.
- `/logs` filter → cùng.
- `/requests` activeTab → KHÔNG sync (`useState("pending")` thay vì `useSearchParams`). Click chia sẻ link Tab Approved cho admin khác → admin kia mở thấy Pending.

→ **Top priority improvement**: tất cả filter dùng `nuqs` hoặc `useSearchParams` để URL ↔ state đồng bộ.

---

## SECTION 4 — Top 30 UX issues (bug list)

| # | Severity | Tab | Vấn đề | Hint sửa |
|---|---|---|---|---|
| 1 | CRIT | users | Bulk action for-loop tuần tự, KHÔNG report lỗi cụ thể (`block completed for 87/100`). | Copy pattern từ `/proxies` `handleBulkDelete` Wave 22X (allSettled + tally + `toast.warning("87/100, 13 lỗi")`). |
| 2 | HIGH | proxies | filter state KHÔNG sync URL → refresh mất filter. | Dùng `nuqs` hoặc `useSearchParams`. |
| 3 | HIGH | users | filter state KHÔNG sync URL. | Như trên. |
| 4 | HIGH | logs | filter state KHÔNG sync URL. | Như trên. |
| 5 | HIGH | requests | activeTab KHÔNG sync URL. Pending/Approved tab share link bể. | Như trên. |
| 6 | HIGH | dashboard | KPI card không drill-down. Số mà không actionable. | Wrap card trong `<Link href="/requests?status=pending">`. |
| 7 | HIGH | bot/config | Stub "coming soon" không có giá trị, dẫn tới `/settings`. | Xoá khỏi sidebar đến Wave 22V. |
| 8 | HIGH | history | `page.tsx` còn dead code 368 LOC sau khi merge vào `/logs`. | Xoá file + add server redirect 301 → `/logs`. |
| 9 | HIGH | check-proxy | Trùng với `/proxies/import` mode "check-only". | Merge thành sub-mode hoặc sub-tab. |
| 10 | HIGH | proxies | "Check All Proxies" button always-visible nhưng cap 500 — admin có 50k proxy click sẽ confused. | Move vào dropdown `Bulk health check (≤500 latest)` + thêm "Schedule cron check" link. |
| 11 | HIGH | header | Global search input giả — chuyển query về `/dashboard?search=` không có handler. | Replace bằng CTRL+K command palette hoặc disable hẳn. |
| 12 | MED | dashboard | Auto-refresh 30s + realtime debounced 2s → 2 nguồn fetch cùng dữ liệu, dễ race. | Bỏ polling, chỉ giữ realtime + manual refresh. |
| 13 | MED | proxies | LOC 567 — file quá to. ProxyTable + ProxyFilters + ProxyForm + BulkEdit + AlertDialog cùng 1 page. | Extract ProxyPageHeader, ProxyBulkActions thành sub-component. |
| 14 | MED | users | Confirm dialog `bulkConfirm` template `{action}` raw value ("block"/"unblock"/"delete") → user thấy English giữa câu Việt. | Dùng switch label tiếng Việt: "chặn"/"bỏ chặn"/"xoá". |
| 15 | MED | trash | Không có "Xoá vĩnh viễn ngay" hoặc "Empty trash" bulk action. Admin phải đợi 30 ngày auto-clean. | Add "Empty all" button (super_admin) + confirm 2 lần. |
| 16 | MED | proxies | Keyboard shortcut hint "Ctrl+A: Select all" hardcode hidden trong bulk-action bar — ai biết? | Show in tooltip khi hover toolbar OR Ctrl+/ help dialog. |
| 17 | MED | logs | Không có log retention info. Admin không biết log lưu bao lâu. | Footer "Logs retained for 90 days" + link `/settings`. |
| 18 | MED | settings | 11 field không group, scroll dài. | Card-section: "Bot Telegram", "Rate limits", "Vận hành", "Auto clean". |
| 19 | MED | settings | Telegram bot token hiển thị plain text (read sau load). Có nên mask `••••` + reveal button? | Mask + Show/Hide eye icon. |
| 20 | MED | admins | Không có "audit role-change history" dù DB có activity_logs. | Thêm sub-tab "Lịch sử thao tác" trong admin detail page. |
| 21 | MED | profile | 838 LOC trong 1 page — performance, maintain. | Extract 4 sub-tab thành 4 component file. |
| 22 | MED | api-docs | Tab admin nhưng nội dung là dev resource. | Move /dev/api-docs hoặc Swagger UI external. |
| 23 | MED | chat | Không có badge "unread" trên sidebar Người dùng Bot. | Counter từ `chat_messages WHERE direction=incoming AND read_by_admin IS NULL`. |
| 24 | MED | chat | KHÔNG có search trong conversation list 5000 user. | Add filter input: tìm theo telegram_id, username, last message text. |
| 25 | MED | bot/simulator | KHÔNG save scenario / reuse test setup. | Thêm "Save as preset" button. |
| 26 | MED | requests | Không có "Approve all on this page" — admin chỉ select-then-approve. | Thêm row select-all + bulk approve + filter. |
| 27 | LOW | toast tone | Mix `toast.success` Vietnamese ("Đã chuyển 5 proxy vào Thùng rác") vs English ("Logged out successfully" trong sidebar.tsx:273, header.tsx:77). | Replace tất cả về VI hoặc i18n. |
| 28 | LOW | accessibility | `<Bell>` button trong header không có route — chỉ icon. KHÔNG dropdown danh sách thông báo. Bell ở đó để làm gì? | Hoặc remove, hoặc dropdown panel show pendingRequests + recent error. |
| 29 | LOW | mobile | Sidebar `Sheet` mobile OK nhưng tab `/proxies` table không scroll horizontal đúng — bulk action bar wrap rách. | Verify lại sm: breakpoint trên iPhone SE width 375. |
| 30 | LOW | dark mode | next-themes wired nhưng nhiều card hardcode `bg-amber-50 dark:bg-amber-950/20` — đã thử 1 vài chỗ. Audit 16 tab có chỗ nào quên không? | Visual QA dark mode 16 tab. |

---

## SECTION 5 — Bot Telegram UX issues

8 button menu: Yêu cầu proxy / Proxy của tôi / Kiểm tra proxy / Limit yêu cầu / Bảo hành proxy / Lịch sử / Hướng dẫn / English.

| # | Severity | Vấn đề | Note brutal |
|---|---|---|---|
| 1 | HIGH | Welcome text vẫn dán 11 dòng `/getproxy - Yêu cầu proxy mới ...` BÊN CẠNH inline 8 nút. | `messages.ts:9-26` — text duplicate điều hướng. Chỉ cần greeting + status + tap menu. |
| 2 | HIGH | "Bảo hành proxy" → revoke flow. **Confusing**: warranty thường = đổi/refund; revoke = trả lại. Người dùng VN nghĩ "bảo hành" = bot kiểm tra giúp, sửa giúp, đổi giúp. | Đổi label: "Đổi/trả proxy lỗi" hoặc tách 2 button "Báo lỗi" + "Trả proxy". |
| 3 | HIGH | "Limit yêu cầu" — nghĩa mơ hồ. "Quota của tôi"? "Gói của tôi"? | "Hạn mức yêu cầu" hoặc "Quota của tôi". |
| 4 | HIGH | Pending welcome ko có hint cụ thể: "Bạn đang chờ duyệt" — nhưng không nói ETA, ai duyệt, làm gì trong lúc chờ. | "Yêu cầu của bạn được gửi cho admin. Thường duyệt trong 1-4 giờ. Cần gấp? /support". |
| 5 | HIGH | Order nhanh vs Order riêng: user mới KHÔNG hiểu khác gì. Khi click vào còn không có giải thích. | Thêm subtitle: "Order nhanh = cấp ngay (≤10 cái). Order riêng = admin duyệt (>10, có yêu cầu đặc biệt)". |
| 6 | MED | Encoding mix: `messages.ts` có `à` Unicode escape lẫn UTF-8 thẳng (`Chào`). Có chỗ "Chao" không dấu (line 47-69 help). | Convert all UTF-8, bỏ ASCII không dấu. |
| 7 | MED | Callback prefix lộn xộn: `proxy_type:`, `qty:quick:`, `menu:`, `lang:`, `revoke:`, `revoke_confirm:all:`, `aup_accept` (no colon). | Chuẩn hoá `<domain>:<verb>:<arg>`. Đã ghi trong REVIEW_BOT_UX.md nhưng chưa fix triệt để. |
| 8 | MED | `/myproxies` không pagination + không nút **copy** từng proxy. 20 proxy → message dài. | Format mỗi proxy 1 mini-card với nút Copy + Báo lỗi. |
| 9 | MED | `[X]`, `[!]`, `[i]`, `[OK]` ASCII tag → user yêu cầu không emoji nhưng dùng tag ASCII xấu. | Chuyển sang prefix text: "Lỗi:", "Cảnh báo:", "Thông báo:". |
| 10 | MED | Error messages không có recovery hint. Vd `[!] Bạn đã vượt quá giới hạn yêu cầu. Vui lòng thử lại sau.` — sau bao lâu? | "Reset sau 47 phút (1h-quota). /status để xem chi tiết." |
| 11 | LOW | "Hướng dẫn" mở `/help` text dài 14 dòng — có thể dùng deep-link `t.me/...?start=help` rồi nội dung scrollable. | Long help → split 2-3 page với nút "Tiếp"/"Quay lại". |
| 12 | LOW | English label switch hiển thị "English" / "Tiếng Việt" — OK, nhưng người EN khi click thấy "Tiếng Việt" có thể nghĩ nó SẼ chuyển sang VI (chứ không phải nó đang VI). | Tweak label: hiển thị NGÔN NGỮ HIỆN TẠI badge + nút "Switch to ..." . |

---

## SECTION 6 — Self-critical (review tool dễ overrate cái gì)

| # | Bias |
|---|---|
| 1 | **PM review dễ over-praise IA**. Wave 22U redesign tốt thật, nhưng đẻ ra `/bot` landing + `/bot/config` stub là **product debt**, không phải achievement. PM thường khen "đã cấu trúc lại" mà bỏ qua việc 2/4 card "Coming Soon" là failure UX. |
| 2 | **Check-proxy đáng được brutal hơn**. Tôi đã chấm 6/10 nhưng thật sự là **redundant 100%** với `/proxies/import` check mode + bulk health check trong table. Nên là 3/10. |
| 3 | **Settings 6/10 quá hào phóng**. Trộn 5 nhóm khác bản chất (bot config, rate limit, cron, IP whitelist, telegram admin IDs) trong 1 form không header — thực tế là 4/10. PM sợ thay đổi infrastructure nên không hạ. |
| 4 | **Bot UX section bị limited bởi tài liệu cũ** (REVIEW_BOT_UX.md đã có). Nhiều issue đã ghi nhận từ Wave 23B-bot. Tôi chỉ tóm — KHÔNG thực sự test bot live → không phát hiện edge case race condition giữa `/cancel` và auto-assign. |
| 5 | **Chấm Profile 8/10 quá cao**. 838 LOC 1 page là **code smell nghiêm trọng**, dù chức năng đầy đủ. PM khen functional bỏ qua maintainability. |
| 6 | **Sidebar global search disable đề xuất quá nhanh**. Có thể global search là feature dài hạn — chỉ đang stub. Cần check roadmap Wave 23+. |
| 7 | **Pain point của 50 admin dùng cùng lúc** chưa thực sự sờ đến: lock conflict khi 2 admin approve cùng request, presence indicator (ai đang xem trang nào), real-time conflict warning. Realtime debounced 2s nhưng không có pessimistic lock. |

---

## SECTION 7 — Top 20 priority UX improvements

| Pri | # | Issue | ROI | Effort |
|---|---|---|---|---|
| P0 | 1 | URL state sync 4 tab (proxies/users/logs/requests) — refresh mất filter là **bug daily**. | Cao | 2-3 ngày |
| P0 | 2 | Users bulk action allSettled + tally giống Proxies — block 100 user 1s thay vì 100s. | Cao | 0.5 ngày |
| P0 | 3 | Xoá `/history` page.tsx dead code + 301 redirect → `/logs`. | Trung | 0.5 giờ |
| P0 | 4 | Xoá `/bot/config` khỏi sidebar đến Wave 22V (bait-and-switch). | Cao UX | 0.5 giờ |
| P0 | 5 | Dashboard KPI card → drill-down. | Cao | 1 ngày |
| P0 | 6 | Bot welcome text — bỏ 11 dòng cmd, chỉ giữ greeting + status + inline keyboard. | Cao | 1 giờ |
| P1 | 7 | Merge `/check-proxy` → sub-tab trong import wizard hoặc bulk action proxies. | Trung | 1 ngày |
| P1 | 8 | Bot label đổi "Bảo hành proxy" → "Đổi/trả proxy lỗi" + "Limit yêu cầu" → "Hạn mức". | Cao UX | 1 giờ |
| P1 | 9 | Header global search → CTRL+K command palette navigate hoặc disable. | Trung | 1-2 ngày |
| P1 | 10 | Settings group form 11 field → 4 card section. | Trung | 0.5 ngày |
| P1 | 11 | Trash "Empty all" bulk action (super_admin). | Trung | 0.5 ngày |
| P1 | 12 | Chat sidebar badge "unread" + search trong conversation list. | Cao | 1 ngày |
| P1 | 13 | Proxies "Check All" → vào dropdown bulk + thêm "Schedule cron health check" link. | Trung | 0.5 ngày |
| P1 | 14 | Bot pending welcome — thêm ETA + cách liên hệ. | Cao UX | 0.5 giờ |
| P2 | 15 | Order nhanh / Order riêng — thêm subtitle giải thích. | Trung | 1 giờ |
| P2 | 16 | Bot rate-limit error có recovery time. | Trung | 1 giờ |
| P2 | 17 | Toast tone audit (mix EN/VI) → 100% VI hoặc i18n. | Trung | 0.5 ngày |
| P2 | 18 | Profile 838 LOC → 4 sub-tab component file. | Thấp ngay, cao maintain | 0.5 ngày |
| P2 | 19 | Admins audit role-change history sub-tab. | Trung | 1 ngày |
| P3 | 20 | Move `/api-docs` → `/dev/api-docs` (hoặc xoá) ngoài sidebar admin. | Thấp | 0.5 ngày |

**Total effort estimate**: ~14 ngày-người (1 dev, 2-3 sprint).

---

## Appendix — File path đầy đủ

| Tab | Path |
|---|---|
| dashboard | `C:\Users\Admin\Documents\quản lý proxy trên web và giao proxy qua bot tele cho user tele\proxy-manager-telebot\src\app\(dashboard)\dashboard\page.tsx` |
| proxies | `...\src\app\(dashboard)\proxies\page.tsx` |
| proxies/import | `...\src\app\(dashboard)\proxies\import\page.tsx` |
| categories | `...\src\app\(dashboard)\categories\page.tsx` |
| trash | `...\src\app\(dashboard)\trash\page.tsx` |
| requests | `...\src\app\(dashboard)\requests\page.tsx` |
| users | `...\src\app\(dashboard)\users\page.tsx` |
| chat | `...\src\app\(dashboard)\chat\page.tsx` |
| bot | `...\src\app\(dashboard)\bot\page.tsx` |
| bot/simulator | `...\src\app\(dashboard)\bot\simulator\page.tsx` |
| bot/config | `...\src\app\(dashboard)\bot\config\page.tsx` |
| bot-simulator (legacy redirect) | `...\src\app\(dashboard)\bot-simulator\page.tsx` |
| check-proxy | `...\src\app\(dashboard)\check-proxy\page.tsx` |
| logs | `...\src\app\(dashboard)\logs\page.tsx` |
| history (DEAD) | `...\src\app\(dashboard)\history\page.tsx` |
| admins | `...\src\app\(dashboard)\admins\page.tsx` |
| profile | `...\src\app\(dashboard)\profile\page.tsx` |
| settings | `...\src\app\(dashboard)\settings\page.tsx` |
| api-docs | `...\src\app\(dashboard)\api-docs\page.tsx` |
| sidebar | `...\src\components\layout\sidebar.tsx` |
| header | `...\src\components\layout\header.tsx` |
| bot keyboard | `...\src\lib\telegram\keyboard.ts` |
| bot messages | `...\src\lib\telegram\messages.ts` |
| bot start cmd | `...\src\lib\telegram\commands\start.ts` |

---

End of review.
