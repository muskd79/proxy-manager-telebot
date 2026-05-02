# Bot Commands Deep Review — 2026-05-02

QA + Security audit của 12 lệnh + state/callback handlers tại `src/lib/telegram/commands/` + `handlers.ts`.

Auditor mode: brutal, file:line cụ thể, không generic.
Severity: P0 = corrupts data / leaks secret / DoS / security breach. P1 = wrong UX / data drift / silent fail. P2 = polish gap / inconsistent. P3 = nit.

---

## Section 1 — Per-command audit

### 1) `/start` — `commands/start.ts`

| # | Issue | Sev | File:line | Repro | Fix |
|---|---|---|---|---|---|
| 1.1 | `firstName` của user inject Markdown char `*_[` không escape → vỡ render. Nếu user đặt first_name = `*bold*_italic_` thì line 152 `Xin chào *${firstName}*!` produce `Xin chào **bold*_italic_*!` → Telegram trả 400 Bad Request: can't parse entities | P0 | start.ts:148,152,161 | Đổi tên Telegram thành `_*[` rồi /start | Escape Markdown qua hàm `escapeMd()` (chưa có) hoặc dùng `parse_mode: "MarkdownV2"` + escape tất cả char đặc biệt theo bảng |
| 1.2 | `isNew` heuristic broken — line 16 `!user.updated_at \|\| user.created_at === user.updated_at`. Supabase set `updated_at = created_at` ở insert → đúng. NHƯNG nếu DB trigger update bất kỳ field (vd: tăng `proxies_used_*` dưới 1ms sau insert) → `isNew=false`, admin notify miss | P1 | start.ts:16 | Race với cron reset hourly counter chạy đúng thời điểm /start | Thêm cờ explicit `is_new` từ getOrCreateUser hoặc check `created_at > now - 5s` |
| 1.3 | Admin notify trên `isNew && pending` chỉ fire 1 lần. Nếu Telegram API 429 ở line 41 và 3 retry đều fail → admin không bao giờ biết user đã đăng ký, user kẹt vĩnh viễn ở pending | P1 | start.ts:41-43 | Mock fetch fail liên tục | Persist `admin_notified_at` ở tele_users, cron sweep re-notify pending users mà chưa được notify |
| 1.4 | `notifyAllAdmins(...).catch(...)` fire-and-forget. User trả lời reply ngay khi await ctx.reply, nhưng nếu function chạy trong serverless và respond return trước khi notify done → Vercel kill function → notify lost | P1 | start.ts:41 | Vercel cold start, notify chậm > 200ms | `await notifyAllAdmins(...)` hoặc dùng `event.waitUntil()` (Vercel pattern) |
| 1.5 | `availableProxies` query không filter `expires_at > now` — proxy đã expired vẫn count là "sẵn sàng" → user thấy số sai | P2 | start.ts:142-146 | Insert proxy with status='available' but expires_at < now (test data) | Add `.or("expires_at.is.null,expires_at.gt." + now)` |
| 1.6 | `firstName` trim chỉ apply cho `ctx.from?.first_name`, không apply cho fallback `user.first_name`. Nếu DB có whitespace → vỡ format | P3 | start.ts:148 | Tạo user qua admin form với name = `"  John  "` | Trim cả 2 nhánh |
| 1.7 | Pending welcome dùng `[i]` ASCII trong khi welcome active không có icon nào — UX inconsistency | P3 | start.ts:54 vs 152 | — | Statyle |
| 1.8 | Blocked user vẫn được tạo audit log incoming `/start` qua `logChatMessage` nhưng outgoing log fire trước `getOrCreateUser` cuối cùng — nếu user.status update giữa logChatMessage(line 19) và check(line 100), state drift không nhận diện | P2 | start.ts:11-19 | Admin block user sau khi user gõ `/start` 50ms | Refetch status sau khi log incoming, hoặc 1 transaction |
| 1.9 | Không có rate-limit cho /start. User spam /start 100 lần → 100 lượt notify admin (vì `isNew && pending`). Wait, line 16 chỉ true 1 lần — but nếu lần đầu DB insert lỗi nhưng select xong, `existing` không có → next /start tạo lại — log cứ tăng | P1 | start.ts:11-44 | Spam `/start` từ 1 user khi DB chậm | Per-tele_user rate limit cho /start (vd: 1 lần / 60s) |
| 1.10 | `availableProxies` query thiếu `.or("expires_at.is.null,expires_at.gt.now")` lookup — `start.ts:142-146` show số "sẵn sàng" nhưng nó tính cả proxy còn `expires_at` < now (legacy chưa cron sweep) | P2 | start.ts:142 | Cron expiry sweep không chạy 1h | Filter expires_at trong query |

---

### 2) `/getproxy` — `commands/get-proxy.ts`

| # | Issue | Sev | File:line | Repro | Fix |
|---|---|---|---|---|---|
| 2.1 | `proxyType.toUpperCase()` dùng trong line 216 + 298 — nhưng `proxyType` đến từ callback data string không validate. Nếu attacker craft callback data `proxy_type:<script>` → text Markdown `*<script>*` không exec nhưng polluted log + admin message | P1 | get-proxy.ts:216,298 | Web user replay callback với data = `proxy_type:HTTP*\`xxx\`` | Whitelist `["http","https","socks5"]` strictly trong handleProxyTypeSelection trước khi dùng |
| 2.2 | Race: 2 callback `proxy_type:http` cùng lúc từ 2 device → 2 lượt setBotState (upsert) → cuối cùng OK. NHƯNG nếu user mid-flow `awaiting_confirm` rồi gõ /getproxy → state bị overwrite về `awaiting_quick_qty` mất lock confirm. Nếu confirm callback đến sau khi state đã reset → state.step !== 'awaiting_confirm' → reply "Phiên đã hết hạn" — bug nhẹ nhưng UX lừa dối | P1 | get-proxy.ts:38 (no clearBotState before setting new flow), state.ts:setBotState | User gọi /getproxy ngay sau khi vừa nhập số → confirm dialog vẫn còn ở chat cũ | clearBotState(user.id) ở đầu handleGetProxy |
| 2.3 | pending.exists guard line 44-49 chỉ count proxy_requests pending. Nếu user có `awaiting_confirm` state nhưng chưa insert request, vẫn cho /getproxy. UX: user thấy 2 chat dialog cùng lúc | P2 | get-proxy.ts:44-64 | /getproxy → chọn loại → nhập qty → bị Yes → /getproxy lại trước khi click Yes | Check getBotState() && step === 'awaiting_confirm' → từ chối |
| 2.4 | `effectiveMaxProxies = Math.min(user.max_proxies, globalCaps.global_max_proxies)` line 170-173. Nếu admin set global_max_proxies = 0 (mistakes) thì check `globalCaps.global_max_proxies > 0` skip; OK. Nhưng nếu set = 1, user.max_proxies = 5, `assignedCount = 0` → effective = 1 → user chỉ được 1. Đúng. Nhưng UX không nói lý do | P3 | get-proxy.ts:170-198 | — | Khi maxProxiesReached, kèm "(global cap)" nếu globalCaps win |
| 2.5 | `assignedCount` line 175-180 không filter `expires_at > now` — nếu cron expiry chưa chạy, expired proxy vẫn count → user bị từ chối nhầm | P1 | get-proxy.ts:175-180 | Insert assigned proxy expires_at < now | Add `.or("expires_at.is.null,expires_at.gt." + new Date().toISOString())` |
| 2.6 | `handleProxyTypeSelection` không có `denyIfNotApproved` — nếu admin block user GIỮA handleGetProxy (line 38) và handleProxyTypeSelection click → user vẫn flow tiếp được | P0 | get-proxy.ts:125-235 | Admin block user trong khi user đang xem keyboard chọn HTTP/HTTPS | Re-check `denyIfNotApproved` ở proxyTypeSelection và orderModeSelection |
| 2.7 | `handleOrderModeSelection` (line 246) cũng không có `denyIfNotApproved` — same issue | P0 | get-proxy.ts:246-317 | — | Same |
| 2.8 | Không clear bot state khi proxy_type:cancel line 152-158. Nếu user vừa nhập qty → confirm xuất hiện → user click Cancel HTTP/HTTPS chooser cũ vì 2 message cùng tồn tại → state vẫn `awaiting_confirm` → user gửi text bị eaten by qty handler | P1 | get-proxy.ts:152-158 | Sequential /getproxy nhanh | clearBotState ở proxy_type:cancel |
| 2.9 | `availableProxies` count query trong handleProxyTypeSelection line 207-212 hiện total, không trừ phần admin đã reserve qua bulk request pending → user thấy "21 sẵn sàng" rồi xin 20 thì RPC trả 5 vì 16 cái đang lock cho admin queue | P2 | get-proxy.ts:207-212 | Concurrent admin approve | Query trừ proxy_requests.status='pending' với quantity reserve. Hoặc note "có thể giảm khi đặt" |
| 2.10 | Nếu `proxyType` đến từ callback là string không phải 1 trong 3 (vd attacker gửi `proxy_type:ftp`), check `availableProxies` ở line 209 trả 0, fallback ở `effectiveMaxProxies` vẫn cho qua orderTypeKeyboard → user kẹt ở keyboard không bao giờ assign được. Bug edge case but exploitable for admin queue spam | P1 | get-proxy.ts:131,handlers.ts:132 | `cb_data=proxy_type:ftp` | Whitelist sớm `if (!["http","https","socks5"].includes(proxyType)) return` |

---

### 3) `/myproxies` — `commands/my-proxies.ts`

| # | Issue | Sev | File:line | Repro | Fix |
|---|---|---|---|---|---|
| 3.1 | Username/password chứa Markdown char `*_\`` → line 58 backtick-quoted format vỡ. Vd password = `pass\`123` → `\`host:port:user:pass\`123\`` → 400 từ Telegram | P0 | my-proxies.ts:58 | Tạo proxy có password = `a\`b` qua admin form | Sanitize password (`replaceAll('\`',' ')`) hoặc switch sang plain text without backtick block |
| 3.2 | Output > 4096 chars Telegram limit. Nếu user có max_proxies = 100 và mỗi line ~80 chars → 8000 chars → Telegram reject | P1 | my-proxies.ts:49-77 | User có 100 proxy assigned | Pagination hoặc gửi file `.txt` khi > 30 dòng |
| 3.3 | Date format `toISOString().split("T")[0]` luôn UTC → user VN nhìn lệch 1 ngày | P2 | my-proxies.ts:51 | Proxy expires 2026-05-02 03:00 ICT (=2026-05-01 20:00 UTC) → display "2026-05-01" | Use Asia/Ho_Chi_Minh timezone |
| 3.4 | Filter `is_deleted=false` đúng nhưng không check `expires_at` — proxy đã expired (status=assigned do cron chưa chạy) hiện trong list, user copy ra dùng → bị từ chối từ proxy server, support ticket bùng nổ | P1 | my-proxies.ts:26-31 | Cron chậm | Filter expires_at hoặc add `[X] EXPIRED` label |
| 3.5 | Không có denyIfNotApproved check sau lần re-fetch — nếu getOrCreateUser trả user.status = 'active', đến giữa hàm admin block → user vẫn xem được proxy. Edge case nhưng bot quản lý sai | P2 | my-proxies.ts:24 | Race | Re-fetch status trước khi reply |
| 3.6 | Nếu `p.host` chứa whitespace (admin import bậy) → backtick block hiển thị OK nhưng user copy ra vẫn space → SSH fail. Không validate host khi import | P2 | my-proxies.ts:58 | Import proxy host = ` 1.2.3.4` | Sanitize host khi import (Wave khác) |
| 3.7 | `expiryWarning` text inject trong backtick block? Không — kết quả là `\`host:port:user:pass\` (HTTP) - Hết hạn: ... [!] Sắp hết hạn!` — OK. Nhưng if `expires_at` = invalid string (DB corruption) → `new Date()` ra `Invalid Date` → toISOString throw → 500 → user thấy gì? Bot crash trên Vercel → catch eat ở bot.catch | P2 | my-proxies.ts:50-51 | DB corruption | try/catch quanh `new Date(p.expires_at)` |
| 3.8 | `header` line 75 dùng `proxies.length` nhưng count đã bị filter `is_deleted=false`, user.max_proxies là setting raw → có thể hiển thị `5/3` nếu admin chỉnh max_proxies xuống dưới count hiện tại | P3 | my-proxies.ts:75 | Admin giảm max_proxies | Acceptable; có thể clamp display |
| 3.9 | Không log incoming /myproxies có truyền message_id ở line 17 — đúng. Nhưng outgoing line 79 message_text chứa toàn bộ password → DB chat_messages lưu credentials plaintext → leak nếu DB compromised | P1 | my-proxies.ts:79-85 | DB dump | Mask password trong outgoing log (replace với `****`) |
| 3.10 | Nếu user có 0 proxy nhưng `noProxies` text từ messages.ts trả vi/en đúng — OK. Nhưng nếu lang = `'fr'` (DB corrupted) → `getUserLanguage` fallback en — đúng | P3 | my-proxies.ts:34 | — | Fine |

---

### 4) `/checkproxy` — `commands/check-proxy.ts`

| # | Issue | Sev | File:line | Repro | Fix |
|---|---|---|---|---|---|
| 4.1 | Không có rate limit cho /checkproxy. User spam paste 20 proxy mỗi 5s → 5×20 = 100 socket connections / phút × N user concurrent → Vercel quota burn + có thể DDoS target | P0 | check-proxy.ts:36-90 | Spam | Per-user rate limit (vd: 5 lần /checkproxy / giờ) |
| 4.2 | `parseProxyText` không strip BOM (`﻿`) hoặc invisible Unicode → line 1 host = `﻿host.com` → DNS fail → reported "unreachable" sai | P2 | proxy-parse.ts:29-39, check-proxy.ts:118 | User copy từ Notepad có BOM | strip BOM ở `parseProxyLine` |
| 4.3 | `valid.length > MAX_CHECK_PER_BATCH` line 132 — sau khi user paste 21 proxy, bot reject. Nhưng state đã không clear → user phải bấm Cancel hoặc paste lại | P2 | check-proxy.ts:132-140 | Paste 21 dòng | clearBotState ngay khi reject vì over-limit |
| 4.4 | `detectProxy` chạy concurrent 5 nhưng không có overall timeout cho cả batch. Nếu 5 cái đầu đều stuck 5s → tổng 4×5×5 = 100s trên Vercel hobby (10s limit). Function timeout, user thấy "đang kiểm tra..." mãi mãi | P0 | check-proxy.ts:166-183 | 20 proxy unreachable | Per-batch wall-clock timeout (vd: 25s) hoặc giảm MAX_CHECK_PER_BATCH xuống 8 |
| 4.5 | Output > 4096 chars: 20 proxy × ~50 char/dòng + header + footer ~ 1100 char — OK. Nhưng nếu host hostname dài 80 chars (có) → có thể vượt | P2 | check-proxy.ts:210 | host = 200 char string | Truncate host display |
| 4.6 | `r.host` có thể chứa Markdown char `*_[\``— line 190 `\`${r.host}:${r.port}\`` — backtick break nếu host có `\``. Same B-1 issue | P1 | check-proxy.ts:190 | host = `a\`b` (paste lỗi) | Reject host containing `\`` ở parseProxyLine |
| 4.7 | Nếu user nhập 20 dòng có 18 invalid + 2 valid → message gửi "Đang kiểm tra 2 proxy (bỏ 18 dòng lỗi)" — KHÔNG cho user biết LÝ DO 18 dòng lỗi. UX gap | P2 | check-proxy.ts:147-152 | 18 dòng invalid | List 3 first error reasons |
| 4.8 | Không re-check denyIfNotApproved sau khi state set. Admin block user giữa /checkproxy và paste → bot xử lý paste của blocked user, log full proxy list → leak | P1 | check-proxy.ts:96-211 | Race admin block | Re-check status ở handleCheckListInput |
| 4.9 | `setBotState` line 54 không clear state cũ nếu user đang ở `awaiting_confirm`. User vừa /getproxy rồi /checkproxy → state đã đổi từ confirm → check_list, mất confirm pending. UX confusing | P1 | check-proxy.ts:54 | /getproxy → /checkproxy | Warn user nếu state hiện tại != idle: "Bạn đang đặt proxy. Hủy hay tiếp tục check?" |
| 4.10 | `detectProxy` async — nếu user gọi `check:cancel` callback giữa lúc Promise.all chạy → cancel callback clear state nhưng probe vẫn chạy đến hết, results post sau cancel — gửi message dù user đã hủy | P1 | check-proxy.ts:166-210 | Cancel mid-probe | Pass AbortController qua detectProxy, hoặc check getBotState lại trước khi reply |

---

### 5) `/status` — `commands/status.ts`

| # | Issue | Sev | File:line | Repro | Fix |
|---|---|---|---|---|---|
| 5.1 | `progressBar` chia 0 → NaN khi `limit=0`. Nếu admin set rate_limit_hourly=0 → `Math.round(0/0*10)=NaN` → repeat(NaN) throw RangeError | P0 | status.ts:27-30 | rate_limit_hourly=0 | Guard `if (limit <= 0) return "[----------]"` |
| 5.2 | Không có denyIfNotApproved — pending user có thể xem status (rate-limit counters cứng = 0). UX không phải bug bảo mật to nhưng inconsistent với các lệnh khác | P2 | status.ts:7-19 | pending user gọi /status | denyIfNotApproved (hoặc cố ý cho pending xem - cần quyết định) |
| 5.3 | `proxyCount` line 21-25 không filter `is_deleted=false` → đếm proxy đã soft-delete nhưng status=assigned | P1 | status.ts:21-25 | Soft-deleted proxy | Filter is_deleted |
| 5.4 | `user.proxies_used_hourly` etc. có thể `null` nếu schema cho phép (mặc định 0 nhưng legacy row) → hBar = NaN | P1 | status.ts:32-34 | Legacy row null counters | Fallback `?? 0` |
| 5.5 | `hourly_reset_at`/`daily_reset_at` luôn so với `Date.now()`, Vercel chạy UTC, nhưng nếu DB lưu timestamp without tz → off | P1 | status.ts:64-75 | DB col `timestamptz` thiếu | Verify col is timestamptz |
| 5.6 | `Math.ceil((reset - now) / 60000)` line 70 → nếu reset = now + 30s → mins = 1, OK. Nếu reset = now + 119s → mins = 2 (đúng). Edge case nếu reset trong quá khứ và check `> now` đã filter — OK | P3 | status.ts:68-74 | — | Fine |
| 5.7 | Markdown render `*${user.status}*` line 41 — nếu status đã bị admin set (string không trong enum) như `"weird*status"` → vỡ. DB schema enum nên unlikely | P2 | status.ts:41 | DB drift | Enum cast trong DB |
| 5.8 | Nếu user status=banned, /status vẫn hiển thị toàn bộ — OK theo spec hiện tại nhưng inconsistent với /myproxies (denied) | P3 | status.ts:7-19 | banned user gọi | Tùy spec |
| 5.9 | Không log outgoing nếu reply throw — message text đã gửi đi trên client nhưng activity log thiếu | P2 | status.ts:78-85 | Telegram 429 ở line 78 | Wrap try/catch quanh ctx.reply, log status |
| 5.10 | `approval_mode` enum hiển thị raw `manual` thay vì localize → tiếng Việt vẫn thấy "manual" | P3 | status.ts:42 | — | Localize qua `t('approvalModeManual', lang)` |

---

### 6) `/history` — `commands/history.ts`

| # | Issue | Sev | File:line | Repro | Fix |
|---|---|---|---|---|---|
| 6.1 | Không có `denyIfNotApproved` — pending user xem được history (sẽ rỗng nhưng vẫn lộ feature) | P3 | history.ts:7-26 | — | Tùy |
| 6.2 | Limit hardcode 10. Nếu user có 1000 request, không có pagination — UX dead-end | P2 | history.ts:26 | Power user | Add pagination với inline keyboard "older" |
| 6.3 | `r.id.substring(0,8)` line 44 — nếu id null (không nên) → fallback `--------`. Đúng. Nhưng nếu attacker tạo request với specific UUID prefix collision → user nhầm | P3 | history.ts:43 | — | Fine |
| 6.4 | Status string đến từ DB, nếu DB có giá trị mới (vd `expired`) chưa map → fallback `r.status` raw → user thấy English giữa Vietnamese | P2 | history.ts:38-44 | DB enum thay đổi | Fallback localize qua `t()` |
| 6.5 | `proxy_type?.toUpperCase()` line 36 — nếu null → fallback `ANY` → đúng | P3 | history.ts:36 | — | Fine |
| 6.6 | `created_at` luôn UTC date — same TZ issue như /myproxies | P2 | history.ts:35 | — | TZ fix |
| 6.7 | Log incoming `/history` ĐẶT SAU reply (line 49) thay vì TRƯỚC như mọi command khác → nếu reply throw, không có log incoming — anomaly trong audit trail | P1 | history.ts:48-49 | reply fail | Move logChatMessage incoming lên đầu hàm |
| 6.8 | Output 10 lines × ~60 chars = 600 chars OK. Nhưng nếu admin add custom status string → có thể vượt; không cap | P3 | history.ts:34-46 | — | Fine |
| 6.9 | `[i]` no-history line 29 không có Markdown nhưng caller dùng default parseMode? `ctx.reply` không pass parse_mode → grammy default plain → OK | P3 | history.ts:29 | — | Fine |
| 6.10 | Nếu DB query throw (Supabase outage) → `requests` undefined → `!requests \|\| length===0` → reply "no history" — gây hiểu nhầm "user chưa từng request" trong khi thật ra DB chết | P1 | history.ts:20-31 | Supabase outage | Distinguish error vs empty: check `error` từ Supabase |

---

### 7) `/revoke` — `commands/revoke.ts`

| # | Issue | Sev | File:line | Repro | Fix |
|---|---|---|---|---|---|
| 7.1 | Race: 2 device user click revoke same proxy cùng lúc → cả 2 gọi `revokeProxy(p.id, user.id)` → RPC `safe_revoke_proxy` idempotent (giả định) → OK. Nhưng UI 1 device thấy "đã trả" device 2 thấy gì? Không edit message rõ | P2 | revoke.ts:120-208 | Multi-device | RPC trả `already_revoked` flag → message "Proxy đã được trả trước đó" |
| 7.2 | Single-proxy auto-revoke line 53-67 KHÔNG check return value của `revokeProxy` — RPC fail thì user vẫn thấy "[OK] Đã trả" | P0 | revoke.ts:55 | RPC error | `if (!await revokeProxy(...)) reply error` |
| 7.3 | Revoke all loop line 158-160 chạy sequential — N+1, 50 proxy = 50 round trip ~ 5s → Vercel timeout near miss | P1 | revoke.ts:158-160 | 50+ proxy revoke all | RPC `safe_revoke_proxies_bulk` accept array |
| 7.4 | Loop line 158-160 không check return — proxy fail revoke vẫn tiếp tục, cuối cùng reply "đã trả tất cả" sai | P0 | revoke.ts:158-160 | RPC partial fail | Track failures, reply "đã trả X/N" |
| 7.5 | `proxies.length === 1` auto-revoke không có confirm dialog — destructive action cần confirm trước (Wave 17 ConfirmDialog upgrade scope) | P1 | revoke.ts:53 | User accidentally /revoke | Always show confirm Yes/No |
| 7.6 | `keyboard.text(\`...\${p.host}:\${p.port}\`)` line 73-77 — nếu host chứa `:` (rare nhưng possible cho IPv6) → callback data parse vỡ ở handlers.ts:212 | P1 | revoke.ts:74 | IPv6 host | Encode/escape callback data |
| 7.7 | Callback data `revoke:${p.id}` — id UUID OK. Nhưng `revoke_confirm:all:${proxies.length}` line 80 — count chỉ display, không validate ở handleRevokeConfirm. Attacker craft `revoke_confirm:all:99999` → confirm dialog hiển thị "trả 99999 proxy" → user click Yes → thực tế revoke đúng số. UX phishing nhẹ | P2 | revoke.ts:80, handlers.ts:193-197 | Craft callback | Re-fetch count, không trust callback |
| 7.8 | `denyIfNotApproved` chỉ ở `handleRevoke` line 27, KHÔNG ở `handleRevokeConfirm`/`handleRevokeSelection`. Admin block user giữa /revoke và click → user vẫn revoke được (mất quyền). Đây OK theo logic (cho user trả về dù bị block) nhưng inconsistent | P3 | revoke.ts:96,120 | — | Document quyết định |
| 7.9 | `editMessageText` line 117/167/199 — nếu Telegram 400 (message too old, > 48h hoặc đã chỉnh sửa quá nhiều) → callback ack đã gọi nhưng message không edit được → user không thấy phản hồi. Không có fallback `ctx.reply` | P1 | revoke.ts:117,167,199 | Old message | try/catch editMessageText, fallback ctx.reply |
| 7.10 | Inline keyboard list proxy chứa host:port — privacy: nếu user share screen có proxy của họ exposed | P2 | revoke.ts:73-77 | — | Mask host (vd: `1.2.x.x:8080`) hoặc dùng index `Proxy #1` |

---

### 8) `/cancel` — `commands/cancel.ts`

| # | Issue | Sev | File:line | Repro | Fix |
|---|---|---|---|---|---|
| 8.1 | `clearBotState` line 30 chạy luôn — đúng theo Wave 23D. Nhưng user có thể đang giữa flow `awaiting_confirm`, /cancel chỉ clear bot state + cancel pending request, KHÔNG cancel transaction trên admin queue (bulk request đã insert nhưng chưa approved) — wait, `cancel` xử lý đúng pending request rồi. OK | P3 | cancel.ts:30 | — | Fine |
| 8.2 | Race: user /cancel ngay khi admin click Approve. SELECT line 32-38 thấy pending → UPDATE line 118-123 với filter `status=pending` → admin's UPDATE đã chạy trước → cancelled.length = 0 → user thấy "Đã hủy 0 yêu cầu" — OK theo race fix B-008 ở comment, nhưng UX confusing user "hỏi gì hủy 0?" | P2 | cancel.ts:118-124 | Race admin approve vs user cancel | Distinguish: nếu cancelled=0 và pending count was >0 → reply "yêu cầu vừa được duyệt" |
| 8.3 | Confirmation step echo `${pendingRequests.length}` ở line 65, nhưng UPDATE ở line 118-123 lọc lại pending → có thể user đồng ý hủy 5 nhưng chỉ hủy 3 (2 cái đã được duyệt giữa) — không feedback đúng | P1 | cancel.ts:118-124 | — | Reply "Đã hủy 3/5 (2 vừa được duyệt)" |
| 8.4 | `RequestStatus.Pending` enum dùng đúng. Nhưng `"cancelled"` string literal line 120 không qua enum → typo risk | P3 | cancel.ts:120 | — | RequestStatus.Cancelled |
| 8.5 | `pendingRequests.map(r=>r.id)` line 121 không cap — nếu user có 1000 pending (admin queue spam Wave 24-2 đã fix) → IN clause Postgres hard limit ~32k. OK | P3 | cancel.ts:121 | — | Fine |
| 8.6 | Không log outgoing nếu confirmed=false line 96-97 → audit thiếu | P2 | cancel.ts:96-98 | User click Không | logChatMessage outgoing |
| 8.7 | `editMessageText` line 96/108/130 không try/catch — nếu old message → throw → error eaten ở bot.catch → user không thấy gì | P1 | cancel.ts:96,108,130 | Old confirm dialog | try/catch fallback reply |
| 8.8 | denyIfNotApproved không có ở /cancel — user banned vẫn cancel được pending. Nhưng nếu pending của họ đã insert TRƯỚC khi bị banned, có thể OK cho phép hủy | P3 | cancel.ts:9-23 | — | Document |
| 8.9 | Không clear bot state ở handleCancelConfirm sau khi confirmed — đã clear ở handleCancel rồi nhưng nếu user gọi /cancel rồi gọi /getproxy giữa, state set lại → confirm Yes vẫn UPDATE pending nhưng state vẫn ở getproxy flow → confusing | P2 | cancel.ts:81-138 | Concurrent | clearBotState ở confirm Yes |
| 8.10 | Format date line 60 lại UTC TZ — same as elsewhere | P2 | cancel.ts:60 | — | TZ fix |

---

### 9) `/support` — `commands/support.ts`

| # | Issue | Sev | File:line | Repro | Fix |
|---|---|---|---|---|---|
| 9.1 | Không tạo user trước (chỉ select) line 11-15 — nếu user gõ /support TRƯỚC /start → reply "Please use /start first" English (không lang) → confusing | P2 | support.ts:11-19 | New user gõ /support đầu tiên | Use `getOrCreateUser` |
| 9.2 | "Please use /start first" line 18 hardcode English — không lang aware (vì chưa có user record) — chấp nhận được | P3 | support.ts:18 | — | Fine |
| 9.3 | /support set "support mode" 30 phút (handlers.ts:362) — nhưng không có chỉ báo cho user khi nào hết mode. Sau 30 phút user gõ tin → bot reply "Use /help" → user "ơ tôi đang gửi support mà?" | P1 | support.ts (logic ở handlers.ts:349-371) | Wait 31 min after /support | Track support mode explicit ở user state, hoặc nhắc thời gian |
| 9.4 | Không có rate limit /support — user spam admin queue qua chat | P2 | support.ts | Spam | Per-user cooldown |
| 9.5 | Tin nhắn "Admin sẽ phản hồi sớm" line 29-30 — không gửi NOTIFY admin về tin nhắn cụ thể. Admin phải vào dashboard tự đọc — admin có thể không thấy nếu offline. UX gap | P1 | support.ts | User send support message | notifyAdmins("New support msg from user X: ...") |
| 9.6 | denyIfNotApproved KHÔNG ở /support — đúng theo spec (blocked user vẫn support được). Nhưng pending welcome ở /start có nói "/support - Hỗ trợ" — pending có thể support OK | P3 | support.ts | — | Fine |
| 9.7 | Markdown trong text body — nếu admin reply lại, không có flow ngược về user | P1 | support.ts | Admin chat back | Two-way support module (Wave 25?) |
| 9.8 | Log incoming /support line 40 chạy SAU reply — nếu reply fail, log thiếu | P2 | support.ts:39-40 | reply fail | Move log lên đầu |
| 9.9 | Không truncate text dài — nếu user paste tiểu thuyết 5000 chars, lưu vào chat_messages. DB OK nhưng admin scroll mệt | P3 | support.ts | — | Truncate at 2k chars in display |
| 9.10 | Helper `lang === "vi"` ternary lặp 2 lần — refactor cosmetic | P3 | support.ts:23-37 | — | Use t() |

---

### 10) `/language` — `commands/language.ts`

| # | Issue | Sev | File:line | Repro | Fix |
|---|---|---|---|---|---|
| 10.1 | `handleLanguageSelection` không check user.is_deleted hay status=banned. Banned user vẫn đổi ngôn ngữ — minor | P3 | language.ts:35-71 | — | Fine |
| 10.2 | `newLang` cast `as SupportedLanguage` line 37 — không validate. Nếu callback craft `lang:fr` → DB lưu `language='fr'` → next /start `getUserLanguage` fallback en (đúng) nhưng DB vẫn dirty | P1 | handlers.ts:181-183, language.ts:37 | Craft callback `lang:fr` | Whitelist `["vi","en"]` ở handlers.ts trước khi call |
| 10.3 | UPDATE line 57-60 không check error — nếu DB fail, vẫn answerCallback "đã đổi" | P1 | language.ts:57-60 | DB outage | Check error, fallback message |
| 10.4 | `editMessageText` line 64 — nếu old message (>48h) throw — same as revoke | P1 | language.ts:64 | Old menu | try/catch |
| 10.5 | Không log activity (chỉ logChatMessage). Admin muốn audit "ai đổi lang khi nào" → không có | P3 | language.ts | — | logActivity |
| 10.6 | Nếu user đang ở `awaiting_confirm` rồi đổi ngôn ngữ — confirm dialog cũ không re-render lang mới (Telegram message immutable) — UX mismatch | P3 | language.ts | — | Acceptable |
| 10.7 | Race: 2 device đổi lang khác nhau cùng lúc → cuối cùng 1 thắng — OK theo last-write-wins | P3 | — | — | Fine |
| 10.8 | `t("languageChanged", newLang)` line 62 đúng dùng newLang để confirm message bằng ngôn ngữ mới — OK | P3 | — | — | Fine |
| 10.9 | Không có fallback nếu user không tồn tại line 47 — silent return — không reply, user thấy spinner mãi | P2 | language.ts:47 | DB drift | answerCallbackQuery với error |
| 10.10 | Inline keyboard chỉ có 2 lựa chọn (vi/en) — nếu thêm 3rd lang → keyboard layout vỡ | P3 | language.ts | — | Fine |

---

### 11) `/help` — `commands/help.ts`

| # | Issue | Sev | File:line | Repro | Fix |
|---|---|---|---|---|---|
| 11.1 | Không denyIfNotApproved — pending user xem help OK (đúng spec) | P3 | help.ts | — | Fine |
| 11.2 | `t("help", lang)` text gồm /requests dòng — admin command. User không phải admin thấy nó cũng OK (chỉ là từ chối khi gọi) | P3 | messages.ts:64 | — | Tùy |
| 11.3 | `handleUnknownCommand` ở line 32 cũng xử lý prefix `/` — nhưng grammy đã fire `bot.command(...)` cho registered commands rồi mới đến `bot.on("message:text")`. Nếu user gõ `/foobar arg1`, grammy sẽ fire message:text vì không match command. handlers.ts line 303 check startsWith("/") đúng → handleUnknownCommand. OK | P3 | help.ts:32 | — | Fine |
| 11.4 | `ctx.message?.text ?? null` line 43 — log full unknown command including possible PII (user gõ `/email me@x.com`) | P2 | help.ts:43 | — | Fine theo audit semantics |
| 11.5 | Không có rate limit cho /help — spam OK nhưng cheap | P3 | help.ts | — | Fine |
| 11.6 | Help text fixed list — nếu thêm command mới quên update messages.ts → drift với /start menu list | P2 | messages.ts:50-89 | Add /vendor command | Generate from BOT_COMMANDS constant |
| 11.7 | `logChatMessage` outgoing line 23-29 chạy sau reply — same pattern issue | P3 | help.ts | — | Fine |
| 11.8 | Markdown `*Hướng dẫn sử dụng*` line 52 — nếu Telegram parse fail (rare cho static text) → no fallback | P3 | messages.ts:52 | — | Fine |
| 11.9 | Tooltip giải thích "Order nhanh" vs "Order riêng" KHÔNG có trong /help — user mới không hiểu khác biệt | P2 | messages.ts:50-69 | New user | Add explanation |
| 11.10 | Không có version / build info trong /help — debug khó | P3 | — | — | Add `Version: x.y.z` cuối |

---

### 12) `/requests` — `commands/admin-approve.ts`

| # | Issue | Sev | File:line | Repro | Fix |
|---|---|---|---|---|---|
| 12.1 | `isAdmin` check line 34-37 — nếu admins table không có row + settings không có `admin_telegram_ids` → KHÔNG có admin nào → bot không thể quản trị. Bootstrap problem | P1 | admin-approve.ts:21-24, notify-admins.ts:56-87 | Fresh deploy | Document bootstrap procedure |
| 12.2 | Approve callback `safe_assign_proxy` đã fix race B-007 — nhưng SELECT proxy line 115-124 KHÔNG dùng `FOR UPDATE SKIP LOCKED` ở client side. 2 admin click cùng lúc → cả 2 SELECT same proxy.id → RPC bên trong handle race (OK). Nhưng client-side double-trip wasted | P3 | admin-approve.ts:115-124 | — | RPC nội bộ OK |
| 12.3 | Reject callback line 199-218 KHÔNG có RETURNING + filter race fix như B-014 (chỉ 1 UPDATE simple). 2 admin reject cùng lúc → cả 2 UPDATE pass `eq("status","pending")` filter, second UPDATE 0 rows nhưng vẫn answerCallback "Rejected" → user nhận 2 notification reject | P1 | admin-approve.ts:209-218 | 2 admin reject same | Add `.select("id")` and check rows |
| 12.4 | Reject callback line 219-239 fetch user AFTER update — nếu update fail nhưng select user OK → user vẫn nhận "rejected" notification dù DB không update | P1 | admin-approve.ts:209-237 | RPC error | Check update error |
| 12.5 | Notify user message line 173-174 chứa proxy credentials plaintext qua Telegram — hợp lý nhưng nếu user có Telegram session bị compromise → leak. Chấp nhận theo nature of bot | P2 | admin-approve.ts:171-176 | — | Document |
| 12.6 | `proxy.username \|\| ""` line 173 — nếu null, format `host:port::password` (double colon) → user copy ra parse vỡ | P1 | admin-approve.ts:173 | Proxy không auth | Format khác cho no-auth: `host:port` |
| 12.7 | `handleAdminApproveUser` line 274-281 không filter `status=pending`. Nếu user đã active, admin click Approve → status flip lại active (no-op) — OK. Nhưng nếu user đã banned, admin nhầm click Approve cũ → unbans! | P0 | admin-approve.ts:273-281 | Pending notification còn cũ, user đã banned, admin click | Filter `.eq("status","pending")` ở update |
| 12.8 | Block user line 322-329 cũng vậy — nếu admin nhầm, block 1 user đã active từ lâu chỉ vì notification cũ | P1 | admin-approve.ts:321-329 | — | Filter status hoặc confirm dialog |
| 12.9 | Username trong adminText line 60-66 không escape Markdown — nếu user.username = `@admin*evil*` → bị render bold ở admin chat | P2 | admin-approve.ts:60 | Username chứa Markdown | Escape |
| 12.10 | Limit 10 line 47 — admin queue >10 → 11+ ẩn không thấy. Cần pagination | P2 | admin-approve.ts:47 | 50 pending request | Pagination |

---

## Section 2 — Cross-command issues

| # | Issue | Sev | File:line examples | Pattern |
|---|---|---|---|---|
| C.1 | **Markdown injection toàn bộ bot** — username, first_name, host, password chèn thẳng vào text Markdown không escape. Telegram trả 400 hoặc render méo. | P0 | start.ts:152, my-proxies.ts:58, admin-approve.ts:60, get-proxy.ts:216 | Cần helper `escapeMd(s)` global, hoặc switch sang MarkdownV2 + escape table |
| C.2 | **TZ UTC universal** — toISOString().split("T")[0] dùng khắp nơi, user VN nhìn lệch ngày | P1 | my-proxies.ts:51, history.ts:35, cancel.ts:60 | Helper `formatDateVN(d)` với Intl.DateTimeFormat('vi-VN', {timeZone:'Asia/Ho_Chi_Minh'}) |
| C.3 | **denyIfNotApproved chỉ ở entry handler** — callback handlers (proxyTypeSelection, orderModeSelection, revokeSelection, languageSelection, confirmCallback) KHÔNG re-check status. Admin block giữa flow → user vẫn complete flow. | P0 | get-proxy.ts:125,246; revoke.ts:120; language.ts:35; custom-order.ts:141 | Wrapper `requireApproved(handler)` áp dụng mọi callback xử lý mutations |
| C.4 | **editMessageText không try/catch** — old message (>48h) throw, eaten by bot.catch, user no feedback. | P1 | revoke.ts:117,167,199; cancel.ts:96,108,130; language.ts:64; admin-approve.ts:147,180,242,295,343 | Helper `safeEditOrReply(ctx, text, opts)` |
| C.5 | **Output > 4096 chars** — /myproxies, /history, /requests, /checkproxy đều có thể vượt. Không fragment. | P1 | my-proxies.ts:77, admin-approve.ts:73, check-proxy.ts:210 | Helper `replyChunked(ctx, text)` split mỗi 3500 chars |
| C.6 | **Sequential loops thay vì RPC bulk** — revoke all (revoke.ts:158), notify admins for-loop (assign-proxy.ts:279). N+1 latency. | P1 | revoke.ts:158-160, assign-proxy.ts:279-281 | Bulk RPC |
| C.7 | **logChatMessage outgoing chạy SAU reply** — nếu reply throw, log thiếu. | P2 | start.ts:81, history.ts:48-49, support.ts:39-40, help.ts:23-29 | Log trước reply (intent) hoặc try/finally |
| C.8 | **Callback data không validate** — proxyType, lang, count, requestId nhận string raw từ callback và dispatch. Không whitelist. | P1 | handlers.ts:132-276 | Whitelist mỗi parsed field |
| C.9 | **Race state machine** — setBotState khi state cũ chưa clear. Nhiều flow khắc nhau ghi đè nhau. | P1 | get-proxy.ts:38, check-proxy.ts:54 | clearBotState trước khi setBotState mới (hoặc warn user) |
| C.10 | **fire-and-forget Promise** — notifyAllAdmins, sendTelegramMessage trong loop dùng `.catch(console.error)` → trên Vercel serverless function return trước khi promise complete → notification mất. | P1 | start.ts:41, admin-approve.ts:191,253,302,349; bulk-proxy.ts:158 | `await` hoặc dùng `event.waitUntil()` (Vercel) |
| C.11 | **Counters expires_at filter thiếu** — proxy đã expired vẫn count vào availableProxies + assignedCount + myproxies list | P1 | start.ts:142, get-proxy.ts:91,175,207,284, my-proxies.ts:26 | Add `.or("expires_at.is.null,expires_at.gt.<now>")` everywhere |
| C.12 | **chat_messages lưu credentials plaintext** — outgoing message có proxy host:port:user:pass full | P1 | my-proxies.ts:79, admin-approve.ts:176, bulk-proxy.ts:101 | Mask password trong outgoing log row (giữ message gửi đi cho user) |
| C.13 | **No request_id correlation** — log incoming + outgoing pair không có shared request_id, hard debug user complaint "tôi không nhận message" | P2 | logging.ts toàn bộ | Add request_id qua AsyncLocalStorage hoặc context |
| C.14 | **Silent fallback when Supabase outage** — query trả `data: null, error: <set>` thì caller chỉ check `!data` → reply "no records" / "user not found" → user nhận thông tin sai. | P1 | history.ts:20-31, my-proxies.ts:26 (no error check), revoke.ts:30 (no error check) | Distinguish error vs empty mọi nơi |
| C.15 | **`?.value?.value` Settings JSONB pattern** — nếu admin save setting với schema khác (vd `{val: 5}` thay vì `{value: 5}`) → undefined fallback → silently dùng default. Khó debug | P2 | rate-limit.ts:106, user.ts:64-65 | Zod validate settings schema |

---

## Section 3 — Top 30 priority fixes ranked

1. **C.1 Markdown injection toàn bộ** — P0, 1.1/3.1/12.6: escape `*_[\`\\` mọi user-controlled string trước Markdown render. **Build helper `escapeMd()` + sweep all 14 command files.**
2. **2.6/2.7/4.8/C.3 denyIfNotApproved callbacks** — P0: wrapper `requireApproved` cho mọi callback mutation (proxyTypeSelection, orderModeSelection, revokeSelection, languageSelection, confirmCallback, checkproxy paste).
3. **12.7 admin_approve_user không filter status** — P0: admin nhầm click cũ unblock user banned. Filter `.eq("status","pending")`.
4. **5.1 progressBar chia 0** — P0: rate_limit_*=0 → NaN repeat throw.
5. **4.4 detectProxy batch timeout > Vercel limit** — P0: 20 unreachable proxy = 100s.
6. **4.1 /checkproxy no rate limit** — P0: DDoS surface.
7. **7.2/7.4 revokeProxy không check return** — P0: user thấy "đã trả" nhưng RPC fail.
8. **C.10 fire-and-forget notify trên Vercel** — P1: admin notify lost. Dùng `event.waitUntil()`.
9. **C.4 editMessageText không try/catch** — P1: old message throw, user no feedback. Helper `safeEditOrReply`.
10. **C.11 counters expires_at filter thiếu** — P1: expired proxy counted.
11. **C.5 output > 4096 chars** — P1: my-proxies/history/requests fail render.
12. **C.12 credentials plaintext trong chat_messages** — P1: DB leak full creds.
13. **2.6/12.3 reject race no RETURNING filter** — P1: 2 admin double-reject.
14. **8.3 cancel partial count drift** — P1: hủy 5 thực 3 → user lừa.
15. **C.8 callback data không whitelist** — P1: 10.2 lang=fr DB dirty + 2.10 proxy_type=ftp stuck.
16. **9.5 /support no admin notify** — P1: admin offline miss support msg.
17. **9.3 support mode 30min implicit timeout** — P1: user confused.
18. **C.14 silent fallback Supabase outage** — P1: history "không có" thay vì error.
19. **C.6 sequential bulk revoke loop** — P1: 50 proxy revoke = 5s.
20. **2.8 proxy_type:cancel không clear state** — P1: state drift.
21. **6.7 /history log incoming sau reply** — P1: audit anomaly.
22. **3.2 /myproxies output > 4096** — P1: 100 proxy crash.
23. **3.4 /myproxies expired vẫn show** — P1: support ticket spam.
24. **1.3 admin notify trên isNew không retry** — P1: user kẹt pending.
25. **2.5 /getproxy assignedCount expired count** — P1: từ chối nhầm.
26. **4.10 /checkproxy cancel không abort probe** — P1: probe rò.
27. **C.2 TZ UTC universal** — P1: lệch ngày VN.
28. **8.7 cancel editMessage không try/catch** — P1: same as C.4 specific.
29. **12.8 admin_block_user không filter status** — P1: same 12.7 mirror.
30. **9.1 /support không getOrCreateUser** — P2: new user gõ /support đầu tiên dead-end.

---

## Section 4 — Self-critical: bug nào tao đoán dễ miss?

Dưới đây là góc khuất tao nghi ngờ nhưng chưa đủ data để confirm — cần tao hoặc QA khác đào thêm:

1. **Webhook idempotency** — Telegram retry update khi bot 500/timeout. handlers.ts không check `update.update_id` đã xử lý chưa. Có thể double-execute /getproxy → 2 proxy cấp cho 1 lần click. **CHECK:** `webhook-queue.ts` (chưa đọc) có dedup không?
2. **bot_conversation_state cleanup cron** — state.ts:STATE_TTL_MS = 30 phút comment "Future cron can sweep stale rows". Hiện chưa có cron → table phình mãi (vì delete chỉ xảy ra khi user hoàn flow / cancel).
3. **Markdown trong `t()` translations** — `messages.ts` chứa nhiều Markdown `*bold*`. Nếu i18n string lỡ chứa unmatched `_` ở giữa Việt, render fail im lặng — không có test nào assert valid Markdown.
4. **User.id vs telegram_id mismatch** — nhiều handler dùng `user.id` (UUID), nhưng `sendTelegramMessage(teleUser.telegram_id, ...)` dùng numeric Telegram. Nếu admin form đổi tele_user.telegram_id (vd: typo fix) trong khi user gọi /getproxy → admin notify gửi đến telegram_id MỚI nhưng user đang chat ở telegram_id CŨ → 2 ngữ cảnh tách rời. Edge nhưng admin có thể trigger.
5. **grammy InlineKeyboard size limit** — Telegram giới hạn inline keyboard ~100 buttons total và button text ~64 chars. /revoke với 50 proxy line 70-78 sẽ vỡ keyboard. Không thấy cap.
6. **Settings cache** — `loadGlobalCaps()` query mỗi /getproxy. Nếu 100 user concurrent → 100 settings query. Không cache → DB load. Cũng admin sửa settings hot-reload đúng nhưng đắt.
7. **`getOrCreateUser` race** — 2 update đến cùng lúc cho new user, line 42-46 SELECT trả null cho cả 2 → cả 2 INSERT → 1 thắng (PK telegram_id unique?), 1 throw. Code không handle insert error specifically — `error` log generic, return null → user thấy nothing.
8. **proxy_requests.quantity nullable?** — `bulk-proxy.ts:195` cast `(request.quantity as number) || 1`. Nếu DB column nullable và row cũ null → fallback 1, có thể không khớp ý định ban đầu.
9. **`crypto.randomUUID()` Node version** — Vercel Node 18+ OK. Nếu deploy cũ → crash. Không feature-detect.
10. **No spam/abuse for /cancel** — user click /cancel 1000 lần = 1000 confirm dialog. Chưa rate limit.
11. **`bot.catch` swallows everything** — handlers.ts:464-469 captureError nhưng KHÔNG reply user. Nếu /myproxies throw, user nhận silence — không có "Đã có lỗi xảy ra" message.
12. **Webhook signature verification** — chưa kiểm tra. Nếu attacker biết bot URL → spoof Telegram update → trigger handler với arbitrary `from.id` → impersonate. Cần Telegram secret_token check trên route handler.
13. **`format-proxies.ts` format separator** — nếu dùng `:` nhưng password chứa `:` → user copy line không parse đúng được client-side. Chưa kiểm tra escape.
14. **Activity log row spam** — mỗi lần /status không ghi activity (đúng). Nhưng /getproxy → flow → confirm → bulk_assign_proxies fire 5 row activity. Volume cao → Activity table phình.
15. **`bot.api.setMyCommands` chạy ở module load** — handlers.ts:68-80. Nếu deploy Vercel cold start mỗi function call → setMyCommands fired liên tục → 429 từ Telegram. Cần guard 1 lần thôi.

---

**Tổng kết:** 12 lệnh × ~10 issue = ~120 row. Cross-cutting 15. Ưu tiên 30 fix top.

**Chí mạng:** P0 = Markdown injection (C.1), denyIfNotApproved gap callbacks (C.3), admin approve/block không filter status (12.7/12.8), progressBar chia 0 (5.1), checkproxy timeout (4.4), revoke return không check (7.2/7.4), checkproxy no rate limit (4.1).

**Còn nghi:** webhook idempotency, bot_conversation_state cron, webhook signature verification, bot.catch không reply.
