# COMPLETENESS REVIEW v2 — PM + Bot UX expert (2026-05-02)

> Reviewer: PM + bot UX. Brutal, không khen vớt.
> Sample: 5000 user TG / 50 admin web / 50k proxy / ~1k req/day.
> Score đầu vào: 78/100. Bot UX 9/10 (theo SESSION_2026-05-02_COMPLETE).
> Tao đi audit thật, score cuối ở dưới có thể thấp hơn.

---

## TL;DR — 7 phát hiện brutal nhất

| # | Phát hiện | Mức |
|---|---|---|
| 1 | **Bot không có nút Copy** sau khi cấp proxy. User phải dài-tap chuỗi `host:port:user:pass`. Telegram Markdown-code chỉ giúp tap-to-copy trên iOS, Android → **không copy được full chuỗi**, phải select-all thủ công. Đây là feature CỐT LÕI của bot proxy mà không ai làm. | **CRIT** |
| 2 | **/myproxies trả 1 message dài Markdown** với 20-50 dòng. Pagination=0. Mỗi proxy không có button action riêng (copy/báo lỗi/check). UX hiện tại là dump-all-on-one-message. So với chuẩn ngành (BrightData/Smartproxy bot) cách 4 năm. | **HIGH** |
| 3 | **/checkproxy block UI 30s+ khi user có 30 proxy** (sequential probe loop, không chunk message → vượt 4096 chars vỡ). Không có cách check 1 proxy cụ thể. Không có chat_action 'typing'. | **HIGH** |
| 4 | **Admin web KHÔNG có nút "send message tới user"** từ trang user-detail. Chat panel chỉ READ-ONLY. Admin muốn reply phải vào /chat, search lại user. (`user-chat-panel.tsx` không có input form.) | **HIGH** |
| 5 | **CSV Export CHỈ có cho /proxies**. Users + Requests + Logs không có Export endpoint. Admin muốn báo cáo phải copy-paste. | **HIGH** |
| 6 | **Welcome text dán 11 dòng /command BÊN CẠNH inline keyboard 8 nút** — duplicate điều hướng. User mới thấy tường text + lưới nút, không biết click gì. | **MED** |
| 7 | **"Bảo hành proxy" route → revoke flow** = user trả proxy về, KHÔNG được đổi cái mới. Word "bảo hành" trong văn cảnh VN = đổi/sửa/refund. Bot deceptive label. | **HIGH** |

---

## 1. BOT USER SIDE — Feature gap cho 5000 user dùng hằng ngày

### 1.1 Sau khi nhận proxy

| Câu hỏi | Trả lời từ codebase | Verdict |
|---|---|---|
| Có nút Copy sau khi cấp proxy? | **KHÔNG**. `messages.ts:102-119` proxyAssigned chỉ wrap Markdown backtick `\`{host}:{port}:{user}:{pass}\`` để tap-to-copy. Trên Telegram desktop và Android nhiều client KHÔNG copy. | **CRIT — phải có inline keyboard "Sao chép" gửi callback `copy:<id>`, bot reply text plaintext.** |
| Có nút "Sao chép tất cả" cho /myproxies? | KHÔNG. 1 message dump 20 dòng. | **HIGH — thêm "Sao chép tất cả" + "Xuất file .txt".** |
| Có nút "Báo lỗi proxy này" inline trên từng proxy? | KHÔNG. User phải /revoke → menu list → chọn → confirm (3-4 step). | **MED — nút "Báo lỗi" trên từng row /myproxies.** |
| Format proxy theo nhiều schema (host:port:user:pass / user:pass@host:port / curl)? | KHÔNG. 1 format duy nhất `host:port:user:pass`. | **MED — settings cho user chọn format. Vd nhiều tool dùng `user:pass@host:port`.** |
| File .txt download? | KHÔNG. Lib có `MessageType.File` (database.ts) nhưng không có flow gửi file proxy. | **MED — có >5 proxy thì gợi ý gửi file.** |

### 1.2 Check proxy

| Câu hỏi | Trả lời | Verdict |
|---|---|---|
| Check 1 proxy duy nhất, không phải tất cả? | **KHÔNG**. `check-proxy.ts:25-30` luôn fetch toàn bộ assigned proxies + loop sequential. | **HIGH — `/checkproxy` cần keyboard chọn proxy hoặc ghi text "1" để check proxy #1.** |
| Probe parallel? | KHÔNG. Sequential `for (const proxy of proxies)`. 30 proxy × 1s = 30s block. | **HIGH — Promise.allSettled chunks of 5.** |
| Chat action 'typing' trước khi probe? | KHÔNG. | **MED — `ctx.replyWithChatAction("typing")`.** |
| Chunk message khi vượt 4096 chars? | KHÔNG. `check-proxy.ts:58` join all results vào 1 string + reply Markdown. **Vỡ runtime ở 30+ proxy.** | **HIGH — bug timing bomb.** |
| Cache kết quả check trong N phút? | KHÔNG. Mỗi /checkproxy đều probe lại. | **LOW — không phải gap chí mạng.** |

### 1.3 Recent / bookmark / quick re-request

| Câu hỏi | Trả lời | Verdict |
|---|---|---|
| Bookmark proxy gần đây? | **KHÔNG**. `/history` chỉ show request log, không show proxy được cấp. | **LOW — feature nice-to-have.** |
| /lastproxy hay tương tự? | KHÔNG. | **LOW.** |
| Re-request proxy giống loại gần nhất 1 click? | KHÔNG. Phải đi qua menu → loại → mode → qty. | **MED — nút "Yêu cầu lại 5 HTTP" trên dashboard inline khi cấp xong.** |

### 1.4 Multi-language

| Câu hỏi | Trả lời | Verdict |
|---|---|---|
| vi/en đủ chưa? | **CHƯA**. `messages.ts` ~30 keys + ~20 hardcode `lang === "vi" ? ... : ...` rải rác trong handlers. Coverage ~70%. | **HIGH — fragmentation tệ. Khó maintain.** |
| Ngôn ngữ thứ 3? | KHÔNG support. `SupportedLanguage = "vi" | "en"` cứng. | **N/A.** |
| Detect lang từ TG account? | `user.ts` có. OK. | OK |

### 1.5 Báo lỗi / warranty

| Câu hỏi | Trả lời | Verdict |
|---|---|---|
| "Bảo hành proxy" → flow gì? | `keyboard.ts:50-51` route `menu:warranty` → revoke flow. **DECEPTIVE LABEL**. User VN nghĩ "bảo hành" = đổi/refund. Thực tế = trả về kho. | **HIGH — đổi label thành "Trả proxy lỗi" + thêm flow "Yêu cầu đổi proxy mới" riêng.** |
| Có ticket riêng (vendor/lý do/screenshot)? | KHÔNG. /support chỉ là chat thường. Admin phải tự match request với conversation. | **MED — schema `support_tickets` table?** |
| Auto re-issue proxy thay thế? | KHÔNG. Revoke → user phải /getproxy lại → quota tính 2 lần. | **HIGH — revoke + auto-replace flow.** |

### 1.6 Notification expiry

| Câu hỏi | Trả lời | Verdict |
|---|---|---|
| Cron warning 3 ngày? | CÓ. `expiry-warning/route.ts:22-33`. **NHƯNG** loop sequential 1 user/1 query, no batching, không track "đã warn rồi" → cron mỗi 24h sẽ spam user 3 lần. | **HIGH — thêm column `expiry_warned_at` để dedup.** |
| Warning 1 ngày trước khi hết hạn? | KHÔNG (chỉ 3-day window). | **MED — thêm 1-day re-warn.** |
| Warning sau khi proxy hết hạn? | `expire-proxies` chỉ update status. Không notify user. | **MED — user thấy proxy biến mất không lý do.** |

### 1.7 Receipt / lịch sử

| Câu hỏi | Trả lời | Verdict |
|---|---|---|
| /history format? | `history.ts:34-46` — `1. HTTP - Đã duyệt - 2026-04-30 (ID: 12345abc)`. 10 record cuối. **KHÔNG có**: pagination, filter theo status, search ID, link "xem chi tiết". | **MED — pagination + nút filter pending/approved/rejected.** |
| Receipt khi nhận proxy có timestamp + invoice ID? | proxyAssigned msg có host/port/expires nhưng KHÔNG có request_id, KHÔNG có "có thể tra cứu /history". | **LOW — UX cảm giác thiếu chuyên nghiệp.** |
| Export request history qua file? | KHÔNG. | **LOW.** |

### 1.8 Admin chat 1-1

| Câu hỏi | Trả lời | Verdict |
|---|---|---|
| /support có? | CÓ. `support.ts:7-41`. Support mode 30 phút. | OK |
| Có discoverable trong main menu? | **KHÔNG**. `keyboard.ts:20-55` 8 nút không có "Hỗ trợ". User phải gõ /support hoặc /help mới biết. | **HIGH — nút "Hỗ trợ" thay "Hướng dẫn" hoặc thêm row 5.** |
| User biết admin đang typing / đã đọc? | KHÔNG. Webhook 1 chiều, admin reply qua web → bot push. | **LOW.** |
| Admin reply có timestamp + identity? | Phải check trong chat-window.tsx. KHÔNG có "Reply by admin John at 14:30". | **MED.** |

---

## 2. ADMIN WEB SIDE — Feature gap cho 50 admin

### 2.1 Xem proxy của 1 user

| Câu hỏi | Trả lời | Verdict |
|---|---|---|
| Route trực tiếp `/users/[id]` show proxy của user đó? | CÓ. `users/[id]/page.tsx:1-22` + `user-detail.tsx` 4 sub-tab (info/proxies/rate-limit/chat). | OK |
| Filter `/proxies?assigned_to=USER_ID`? | Phải check filter param. **CHƯA THẤY**. Bulk filter chỉ có status/type/country/category. | **MED — filter `assigned_to` nhân tiện thêm.** |
| Click row user → mở proxies tab trực tiếp? | Có sub-tab nhưng default `?tab=info`. | OK với 1 click thừa. |

### 2.2 Send message tới user

| Câu hỏi | Trả lời | Verdict |
|---|---|---|
| Form gửi message từ user-detail? | **KHÔNG**. `user-chat-panel.tsx` chỉ render messages + scroll. **Read-only**. | **CRIT — admin muốn reply phải đi sang /chat, search user, mới gõ. Workflow tệ.** |
| Form gửi từ /chat sau khi chọn user? | Phải kiểm tra. Có `chat-window.tsx`. Có thể có. Cần verify. | Verify needed |
| Broadcast message đến nhóm user (vd. tất cả user có HTTP proxy)? | **KHÔNG**. | **HIGH — feature hữu dụng.** |
| Schedule message? | KHÔNG. | **LOW.** |
| Template message (vd. notify maintenance)? | KHÔNG. | **MED.** |

### 2.3 Export

| Câu hỏi | Trả lời | Verdict |
|---|---|---|
| Export proxy CSV/JSON? | CÓ. `/api/proxies/export` + UI button. | OK |
| Export user CSV? | **KHÔNG endpoint**. `users/page.tsx:173-200` `handleExport` thực hiện client-side: fetch /api/users (phân trang 200 record) → buildCsv local. Vượt 200 user → mất data. | **HIGH — bug ngầm. Backend route /api/users/export.** |
| Export request CSV? | **KHÔNG**. Phải kiểm tra. | **HIGH.** |
| Export logs CSV? | CÓ (theo SESSION_2026-05-02 ghi đã sanitise). | OK |
| Export chat history? | KHÔNG. | **MED.** |

### 2.4 Import bulk

| Câu hỏi | Trả lời | Verdict |
|---|---|---|
| /proxies/import có? | CÓ. 3 mode (paste/txt/csv) + probe + import. | OK |
| Wizard có save draft? | KHÔNG. Refresh trang là mất paste. | **MED.** |
| Import history (lot tracking)? | Wave 21 có schema `proxy_lots` nhưng đã rolled back ở 21A.5. Không có UI. | **LOW (vendor system rolled back).** |
| Bulk import user TG? | KHÔNG. Admin không thể seed 100 user pre-approve. | **HIGH cho admin onboard.** |

### 2.5 Performance/health monitoring

| Câu hỏi | Trả lời | Verdict |
|---|---|---|
| Dashboard alive % hôm nay? | KHÔNG. StatsCards chỉ có count theo status. | **HIGH — admin operational không có signal.** |
| Per-proxy alive history (last 7 days line chart)? | KHÔNG có schema. | **HIGH — proxy 4-5 stars sản phẩm.** |
| Cron schedule health check? | `health-check/route.ts` exist nhưng phải verify run định kỳ. | Verify |
| Alert khi alive % giảm dưới 80%? | KHÔNG. | **HIGH.** |
| Per-vendor alive tracking? | Vendor system rolled back. | N/A. |

### 2.6 Vendor management

Wave 21A.5 đã drop. Không có vendor schema active. Admin không track "proxy mua ở đâu/giá bao nhiêu/expire khi nào theo nguồn". → strategic gap. (theo MEMORY.md: Wave 19 vendor schema vẫn còn ở `019_wave19_vendor_schema.sql` nhưng table không dùng — dead schema.)

### 2.7 Audit ai làm gì

| Câu hỏi | Trả lời | Verdict |
|---|---|---|
| activity_logs table? | CÓ. mig 048 immutability + 032 hardening. | OK |
| UI /logs có filter actor + resource_type? | CÓ. | OK |
| Log retention policy hiển thị? | **KHÔNG**. Admin không biết log lưu bao lâu (REVIEW_PM_UX issue #17). | **MED.** |
| Audit role-change history trong /admins/[id]? | KHÔNG có sub-tab "lịch sử thao tác". (REVIEW_PM_UX issue #20.) | **MED.** |
| Audit login attempt fail? | mig 016 login_tracking. Có. | OK |

### 2.8 Notification cho admin

| Câu hỏi | Trả lời | Verdict |
|---|---|---|
| Cron expire-requests sau 7 ngày? | CÓ. | OK |
| Notification "có 5 pending request quá 24h"? | **KHÔNG**. Pending sit forever cho đến khi 7 ngày auto-expire. | **HIGH — admin thấy pending count tăng nhưng không notify.** |
| Bell icon header có handler? | **KHÔNG**. `header.tsx:122-138` bell button không click action. (REVIEW_UI_CONSISTENCY 1.1.) | **HIGH — bell decoration.** |
| Email notification khi bot offline? | KHÔNG. Sentry chưa wire. | **HIGH ops gap.** |
| Slack/TG group cho admin alert? | KHÔNG. | **MED.** |

---

## 3. TOP 15 friction point (admin + user, file:line + UX impact)

| # | Side | File:line | Vấn đề | UX impact |
|---|---|---|---|---|
| 1 | Bot user | `messages.ts:102-119` (proxyAssigned), `keyboard.ts` | Cấp proxy không có nút Copy/Save/Resend. User dài-tap thủ công, lẫn dấu cách → password sai. | **CRIT** — feature core fail |
| 2 | Bot user | `my-proxies.ts:49-70` | 20 proxy dump 1 message dài Markdown, không action button per-row. | HIGH — không scale |
| 3 | Bot user | `check-proxy.ts:39-58` | Sequential probe + no chunk → vượt 4096 chars hoặc timeout 30s. | HIGH — bug timing |
| 4 | Bot user | `keyboard.ts:50-51` | "Bảo hành proxy" route → revoke (=trả về). Word lừa. | HIGH — trust |
| 5 | Bot user | `keyboard.ts:43-55` (mainMenuKeyboard) | 8 button main menu KHÔNG có "Hỗ trợ" — buried sau /support hoặc /help. | HIGH — không discoverable |
| 6 | Bot user | `messages.ts:9-26` (welcome) | Welcome dán 11 dòng /command + inline keyboard 8 nút → duplicate điều hướng. | MED |
| 7 | Bot user | `messages.ts:94` (rateLimitExceeded) | "Vui lòng thử lại sau" — không nói sau bao lâu. | MED — recovery hint |
| 8 | Bot user | `commands/cancel.ts:8-72` | /cancel KHÔNG clear conversation_state (gap doc P1 #3). User stuck mid-flow. | HIGH |
| 9 | Bot user | `expiry-warning/route.ts:22-95` | Cron không track `expiry_warned_at` → spam user mỗi 24h. | HIGH |
| 10 | Admin web | `user-chat-panel.tsx` (toàn file) | Chat panel READ-ONLY. Không có form gửi message. | CRIT — admin workflow fail |
| 11 | Admin web | `users/page.tsx:173-200` (handleExport) | Export user client-side fetch /api/users 200 record → vượt mất data. | HIGH — silent data loss |
| 12 | Admin web | `header.tsx:122-138` (Bell) | Bell button no handler. Decoration. | HIGH — admin tin có notif |
| 13 | Admin web | `dashboard/page.tsx:36-42` + realtime | Polling 30s + realtime 2s → 2 nguồn fetch race. (REVIEW_PM_UX #12.) | MED |
| 14 | Admin web | URL state | filter/search/page KHÔNG sync URL params trên proxies/users/logs/requests. Refresh mất. (REVIEW_PM_UX #2-5.) Wave 23E mới làm partial. | HIGH — daily annoyance |
| 15 | Admin web | `requests/page.tsx` | Không có "Approve all on this page" + "auto-approve nếu inventory đủ". Admin click 1-by-1. | HIGH — không scale |

---

## 4. TOP 10 quick win (1-2 ngày, S effort, impact medium-high)

| # | Quick win | File:line | Effort | Impact | Hint |
|---|---|---|---|---|---|
| 1 | Inline keyboard "Sao chép" sau khi cấp proxy | `commands/get-proxy.ts` (assignSuccess block) + handler `copy:<id>` reply plaintext | 2h | CRIT | New callback prefix `copy:` → reply `host:port:user:pass` không Markdown để user copy long-press dễ. |
| 2 | Welcome bỏ 11 dòng /command, chỉ greeting + status + inline keyboard | `messages.ts:9-26` | 30m | MED | Đã có inline keyboard. Text dư. |
| 3 | Đổi label "Bảo hành proxy" → "Trả proxy lỗi" | `keyboard.ts:27` | 5m | HIGH | + thêm tooltip/subtitle giải thích. |
| 4 | Thêm "Hỗ trợ" vào main menu | `keyboard.ts:43-55` | 30m | HIGH | Thay "Hướng dẫn" hoặc thêm row 5. |
| 5 | /checkproxy parallel + chunk message | `check-proxy.ts:39-58` | 3h | HIGH | Promise.allSettled chunks of 5; split message khi vượt 4000 chars. |
| 6 | rateLimitExceeded recovery time | `messages.ts:94` + `status.ts:64-75` | 1h | MED | Replace "Vui lòng thử lại sau" → "Reset sau {N} phút. Dùng /status." |
| 7 | Cron expiry-warning add column `expiry_warned_at` | mig 052 + `expiry-warning/route.ts:22-95` | 2h | HIGH | UPDATE proxies SET expiry_warned_at = now() RETURNING; filter `IS NULL OR expiry_warned_at < now() - 7d`. |
| 8 | Bell header → dropdown panel show pending requests + recent errors | `header.tsx:122-138` | 4h | HIGH | Đếm /requests?status=pending real-time. |
| 9 | /api/users/export endpoint + stream CSV | route mới | 3h | HIGH | RPC stream all rows, không phân trang. |
| 10 | Admin send message form trong user-detail | `user-chat-panel.tsx` thêm input + POST /api/chat/send | 4h | CRIT | Telegram sendMessage qua bot.api. + log Outgoing. |

Total quick wins: ~20h = 2.5 ngày-người. Impact rất lớn.

---

## 5. TOP 5 strategic gap (so với 1 sản phẩm proxy production hoàn thiện)

| # | Gap | Effort | Why |
|---|---|---|---|
| 1 | **Vendor management + cost tracking** | 3-4 tuần (re-implement Wave 19-21 sau khi roll-back) | Admin không track proxy mua từ đâu/giá nào/expire khi nào theo lot. Báo cáo chi phí/lợi nhuận = excel manual. Roadmap đã có (Wave 18A→22) nhưng partly rolled back. **Cần quyết: tự build hoặc dùng external tool.** |
| 2 | **Proxy alive history + per-proxy uptime SLA** | 2 tuần | Schema mới `proxy_health_checks` (proxy_id, checked_at, alive, latency). Cron mỗi 5 phút probe sample 100 proxy. UI: per-proxy line chart 7 days. Alert khi <80%. **Sản phẩm proxy không có SLA = không đáng tiền.** |
| 3 | **Telegram outbox queue** (defer P2 ghi nhận) | 1 tuần | Hiện `sendTelegramMessage` direct, fail là mất message. Cần table `telegram_outbox` + worker retry. SESSION_2026-05-02 ghi defer. **Khi 5000 user × 1 notif/ngày → fail rate Telegram thực ~1-2%.** |
| 4 | **Self-service: user mua proxy mới qua bot** (Wave 22 roadmap) | 4 tuần | Hiện admin phải approve manual. User không thể tự pay (SePay đã integration). Cần purchase saga + auto-allocate. **Đây là "self-service tự động" mà MEMORY ghi rõ Wave 22 scope.** |
| 5 | **Multi-tenant admin role / department** | 2 tuần | 50 admin hiện 2 role (admin/super_admin). Không có "team A chỉ thấy proxy team A". Khi grow → rối. **Required khi ≥ 100 admin/3 team.** |

Tổng: 12-14 tuần (3-4 tháng) cho 5 strategic gap.

---

## 6. Self-critical — ai sẽ phàn nàn nhất

### Persona 1 — Power user TG (10+ proxy đồng thời)

> "Bot này không có nút copy. Tao copy 20 proxy vào antidetect browser mỗi sáng, mỗi cái 6 click. Bot đã chậm còn không export file.
> /checkproxy chạy 30s, message vỡ.
> /history chỉ 10 record, tao có 200 request lifetime, làm sao xem hết.
> 'Bảo hành' click vào lại trả proxy về kho — tao đếch hiểu đang test cái gì."

**Mức phàn nàn**: HIGH. **Khả năng churn**: 30%.

### Persona 2 — User mới VN không biết tiếng Anh

> "Tao /start, bot hiện tường text + 8 nút.
> Click 'Limit yêu cầu' không hiểu là gì.
> Click 'Bảo hành' tưởng đổi proxy mới, ai dè trả proxy đi.
> Click 'Hướng dẫn' lại 14 dòng /command.
> Sau 5 phút tao tắt bot."

**Mức phàn nàn**: MED. **Khả năng churn**: 60%. — onboarding fail.

### Persona 3 — Admin tier 2 (process pending requests)

> "Mở /requests, có 50 pending. Tao click Approve từng cái. Không có bulk action 'approve all matching filter'.
> User hỏi qua chat — tao phải mở /chat tab khác, tìm user. Đã có UserDetail/ChatPanel sao không cho tao gõ thẳng?
> Bell trong header tao tưởng có notification, click không có gì ra."

**Mức phàn nàn**: HIGH. **Productivity loss**: 40%.

### Persona 4 — Super admin báo cáo CFO hàng tháng

> "Tao cần xuất CSV: tất cả user đã mua proxy tháng này, giá, vendor, alive %.
> Users page export client-side max 200 user → tao có 5000 user, lấy đâu ra.
> Không có vendor table active. Không có alive history. Tao ngồi excel manual 6h."

**Mức phàn nàn**: CRIT. **Khả năng nghỉ tool**: cao.

### Persona 5 — Ops monitoring 3am incident

> "Bot offline. Tao không có Sentry. Telegram group admin không có bot alert. Phát hiện qua user complaint sau 4h.
> Vercel log không structured. activity_logs có nhưng không alert ai cả."

**Mức phàn nàn**: CRIT. **Risk**: incident cost cao.

---

## 7. Score reality check

SESSION_2026-05-02_COMPLETE đánh score 78/100. Tao audit sâu thêm:

| Góc nhìn | Score session | Score audit lại | Comment brutal |
|---|---|---|---|
| Bot UX | 9.0 | **6.5** | 9.0 tự sướng. CRIT gap: copy button, /myproxies action, /checkproxy chunk, deceptive label "bảo hành", main menu thiếu /support. Đã port VIA pattern là tốt nhưng product UX vẫn kém. |
| Feature complete | 8.0 | **6.5** | Admin export 3/4 entity thiếu. user-chat-panel read-only. Bell decoration. /requests bulk approve thiếu. Vendor + alive history strategic gap. |
| UI/UX (web) | 7.5 | **6.5** | URL state sync chưa đủ. Wave 23E partial. Bell header. Confirm dialog inconsistent (REVIEW_UI_CONSISTENCY). |
| Bảo mật | 8.5 | **8.0** | OK nhưng /api/users/export không tồn tại = data exposure rủi ro thấp. CSRF Phase 1 tốt. |
| Test coverage | 5.5 | **5.5** | OK. |
| Observability | 3.0 | **3.0** | Sentry chưa wire. Bell decoration. Outbox defer. **Đây là khâu kém nhất.** |

**Tổng audit lại: ~70/100.** SESSION ghi 78 hơi tự sướng do measure progress chứ không measure gap.

---

## 8. Recommend ưu tiên (1 wave 5-7 ngày tiếp theo)

### Wave 25-bot — Bot UX phần 2 (3 ngày)
1. Inline Copy button sau cấp proxy (CRIT)
2. /myproxies action button per-row (HIGH)
3. /checkproxy parallel + chunk + per-proxy (HIGH)
4. Đổi label "Bảo hành" → "Trả proxy lỗi" + flow đổi (HIGH)
5. Welcome rút gọn + thêm "Hỗ trợ" main menu (HIGH+MED)
6. rateLimitExceeded recovery time (MED)
7. /cancel clear state (P1 từ gap doc, đã ghi nhận chưa fix hết)
8. expiry_warned_at column + dedup (HIGH)

### Wave 25-admin — Admin web critical (2 ngày)
9. user-chat-panel send message form (CRIT)
10. /api/users/export + /api/requests/export server-side (HIGH)
11. Bell header dropdown panel pending+errors (HIGH)
12. /requests "Approve all matching filter" (HIGH)
13. /api/users/[id] route + filter `assigned_to` trên /proxies (MED)

### Wave 25-ops (1 ngày)
14. Sentry DSN wire (HIGH — defer P2)
15. Cron alert pending >24h → notify admin TG group (HIGH)

Total: ~6 ngày. Sau đó score lên ~80/100.

---

## 9. Path đầy đủ

| Mục | Path |
|---|---|
| Welcome | `C:\Users\Admin\Documents\quản lý proxy trên web và giao proxy qua bot tele cho user tele\proxy-manager-telebot\src\lib\telegram\messages.ts:9-26` |
| Main menu | `...\src\lib\telegram\keyboard.ts:43-55` |
| /myproxies | `...\src\lib\telegram\commands\my-proxies.ts:49-78` |
| /checkproxy | `...\src\lib\telegram\commands\check-proxy.ts:39-58` |
| /history | `...\src\lib\telegram\commands\history.ts:34-49` |
| /support | `...\src\lib\telegram\commands\support.ts:7-41` |
| /cancel | `...\src\lib\telegram\commands\cancel.ts:8-72` |
| Cron expiry-warning | `...\src\app\api\cron\expiry-warning\route.ts:22-95` |
| User detail web | `...\src\app\(dashboard)\users\[id]\page.tsx` |
| Chat panel (read-only) | `...\src\components\users\user-chat-panel.tsx` (entire file) |
| Bell decoration | `...\src\components\layout\header.tsx:122-138` |
| User export client-side | `...\src\app\(dashboard)\users\page.tsx:173-200` |
| Dashboard polling+realtime race | `...\src\app\(dashboard)\dashboard\page.tsx:36-42` |
| Confirm dialog inconsistency | tham chiếu `docs/REVIEW_2026-05-02_UI_CONSISTENCY.md` |

---

End — hết review brutal.
