# BOT RESPONSE GAP — VIA vs PROXY (2026-05-02)

Audit từng response path của VIA bot và so với proxy bot. Mục tiêu: mỗi tin user gửi vào → có reply (kể cả khi bot không hiểu) + audit log + i18n.

Path gốc:
- VIA: `C:\Users\Admin\Documents\quản lý via, giao via và gửi via qua bot tele\src\lib\bot\`
- Proxy: `C:\Users\Admin\Documents\quản lý proxy trên web và giao proxy qua bot tele cho user tele\proxy-manager-telebot\src\lib\telegram\`

---

## Section 1 — VIA bot flow (state diagram)

```
Telegram update
   │
   ▼
[webhook/route.ts]──IP whitelist──Secret token──update_id dedup (markUpdateProcessed)
   │                                              │
   │                              duplicate ─────►return 200 ngay
   │
   ▼ fresh
grammy bot (setup.ts)
   ├── api.config.use(...)  ◄── intercept MỌI sendMessage/sendDocument/edit
   │                          → fireLogBotMessage (audit-trail outgoing)
   │
   ├── bot.command('start')  ──► commands/start.ts        (welcome + count + main menu)
   ├── bot.command('help')   ──► commands/utility.ts      (clear state nếu non-idle, show help)
   ├── bot.command('cancel') ──► commands/utility.ts      (whitelist-gate + clear)
   ├── bot.command('lang')   ──► commands/utility.ts      (whitelist-gate + toggle)
   ├── bot.command('warranty')──► commands/utility.ts     (cooldown 30s + showWarrantyClaims)
   ├── /getvia /myvia /status /report /checkuid /history → mỗi handler riêng
   │
   ├── bot.on('callback_query:data')
   │   └── findRoute(data) qua Map exact + Array prefix
   │       ├── exact + prefix routes (12 domains)
   │       ├── whitelist-gate trước khi gọi handler
   │       ├── blacklist-gate
   │       ├── try { handler } catch → safeAnswerCb(error)
   │       └── unknown callback → logger.warn + safeAnswerCb (silent ack)
   │
   ├── bot.on('message:text')
   │   ├── chat.type ∈ {private,group,supergroup} ──► subscriberId thay đổi
   │   ├── if text starts with '/' → return (slash leak handled ở bot.command)
   │   ├── logMessage incoming
   │   ├── resolveUserOrgId
   │   ├── checkWhitelist (group → leaveChat / pending / rejected)
   │   ├── isBlacklisted → silent ignore
   │   ├── getState() → stateHandlers[step]
   │   │   ├── awaiting_quantity → handleAwaitingQuantity (validate, auto-route to custom flow nếu vượt)
   │   │   ├── awaiting_report_uid / reason / multi_reason → report-handlers.ts
   │   │   ├── awaiting_custom_qty / reason → handleAwaitingCustomQty/Reason
   │   │   ├── awaiting_warranty_uids → warranty-handler.ts
   │   │   └── default (idle) → handleDefault: clearState + 'unknown_command' + mainMenu
   │   └── try/catch → bt('error') + mainMenu
   │
   ├── bot.on('my_chat_member') → group-membership.ts  (Phase A: leave nếu flag off, register pending)
   │
   ├── bot.on('message:photo|document|sticker|voice|video|video_note|animation|location|contact')
   │   └── unsupported.ts → log + bt('unsupported.media')   (whitelist-gated)
   │
   └── bot.catch() → logger.error + nuốt (không ném 500 ra Telegram)

Webhook fail-safe:
   - try → return 200 (deduplicated path)
   - catch (telegram-stale errors như "query is too old", "message is not modified", QUERY_ID_INVALID)
        → return 200 không DLQ
   - catch unknown → writeBotWebhookDeadLetter + return 200 (KHÔNG bao giờ trả 500 cho TG)
```

States: `idle | awaiting_quantity | awaiting_confirm | awaiting_report_uid | awaiting_report_reason | awaiting_report_multi_reason | awaiting_custom_qty | awaiting_custom_reason | awaiting_custom_confirm | awaiting_warranty_uids` (state.ts:6, TTL 30 phút, validate VALID_STEPS, auto-recover nếu corrupted).

---

## Section 2 — Proxy bot flow hiện tại

```
Telegram update
   │
   ▼
[webhook/route.ts]──Secret──IP whitelist──in-memory dedup (Set<number>)──DB dedup (webhook_dedup)
   │                                                      │
   │                                            duplicate ►return 200
   │
   ▼ fresh
   per-user rate limit (30 req/min/chat) — silently 200 nếu vượt
   acquireSlot() (max 50 concurrent) — timeout → 200
   │
grammy bot (handlers.ts)
   ├── KHÔNG có api.config.use(...) → outgoing messages KHÔNG auto-log; chỉ log nếu handler tự gọi logChatMessage
   │
   ├── bot.command('start' | 'help' | 'getproxy' | 'myproxies' | 'status' | 'language' | 'cancel'
   │              | 'revoke' | 'checkproxy' | 'history' | 'support' | 'requests')
   │
   ├── bot.on('callback_query:data')
   │   ├── if/else chain (KHÔNG dùng Map/route table)
   │   ├── menu:* | proxy_type:* | order_quick:* | order_custom:* | order_type:cancel
   │   ├── lang:* | cancel_confirm:* | revoke_confirm:* | revoke:* | qty:*
   │   ├── admin_approve:* | admin_reject:* | admin_approve_user:* | admin_block_user:*
   │   ├── admin_bulk_approve:* | admin_bulk_reject:*
   │   └── unknown → ctx.answerCallbackQuery("Unknown action")  (chỉ alert, KHÔNG reply)
   │
   ├── bot.on('message:text')
   │   ├── if text starts with '/' → handleUnknownCommand (có reply)
   │   ├── lookup user qua telegram_id; if !user → return (SILENT, không reply)
   │   ├── if state ∈ awaiting_quick_qty/awaiting_custom_qty → handleQtyTextInput
   │   ├── log incoming
   │   ├── kiểm tra last /support cmd trong 30 phút → reply 'support mode' OR 'use /help'
   │   └── log outgoing
   │
   ├── KHÔNG handler cho 'my_chat_member' → bot vào group sẽ KHÔNG ai biết
   │
   ├── KHÔNG handler cho photo/video/voice/sticker/file/animation/location/contact/edit/forward
   │   → user gửi sticker/file/voice → SILENT, không reply, không log
   │
   └── bot.catch() → captureError, không nuốt được lỗi async ngoài handler

Webhook fail-safe:
   - catch toàn bộ → return 200 + captureError (KHÔNG có DLQ table)
   - không tách ra "stale callback" vs "bug" — gộp tất cả vào 1 catch
```

States: `idle | awaiting_quick_qty | awaiting_custom_qty` (state.ts:17, TTL 30 phút). Không có report/warranty/category states. proxyType thì lưu trong `context` JSON.

**Side-by-side compare:**

| Hạng mục | VIA | Proxy |
|---|---|---|
| Webhook secret + IP whitelist | yes | yes |
| Update_id dedup | DB (markUpdateProcessed) | in-memory + DB (`webhook_dedup`) |
| DLQ trên unknown error | `writeBotWebhookDeadLetter` + return 200 | KHÔNG có DLQ — captureError + return 200 |
| Tách stale Telegram error vs bug | yes ("query is too old"/"message is not modified" → 200, không DLQ) | KHÔNG tách |
| Bot output auto-logged | yes (api.config.use intercept tất cả send*) | KHÔNG — chỉ log nếu handler nhớ gọi logChatMessage |
| State machine | 10 steps | 3 steps |
| Group/supergroup support | yes (Phase A) | KHÔNG — bot vào group là silent |
| my_chat_member handler | yes | KHÔNG |
| Whitelist | DB-driven, multi-tenant, auto-approve "existing user", LRU cache | tele_users.status (pending/active/blocked/banned) |
| Blacklist | yes (silent ignore) | gộp vào status=blocked |
| Photo/video/voice/sticker/file/loc/contact handler | unsupported.ts catch tất cả → 'unsupported.media' | KHÔNG — silent |
| edit_message / forwarded_message | KHÔNG (cả 2 đều thiếu) | KHÔNG |
| Markdown escape helper | escapeMarkdown (helpers.ts:81) | KHÔNG có; user.first_name/username chèn raw vào Markdown |
| Cooldown helper | checkBotCooldown + formatDuration | KHÔNG ở client side; có rate-limit ở webhook layer |
| Long-message chunking | safeSendMessage tự chunk theo TELEGRAM_MAX_LENGTH | KHÔNG; long status crash |
| Error reply trong handler | bt('error') + mainMenu | KHÔNG có wrapper try; nhiều chỗ reply lỗi raw |
| Group-aware reply threading | replyTargetFor (helpers.ts:103) | KHÔNG |
| Welcome message | settings.bot_welcome_message override + fallback i18n | hardcoded VI/EN trong start.ts |
| Welcome khi blocked | blocked + mainMenu | dedicated "blocked" message (proxy làm OK) |
| Help command i18n | bt('help.title') | hardcoded array trong messages.ts |
| /cancel khi không có flow | "confirm.cancelled" + mainMenu | "[i] Khong co yeu cau nao dang cho de huy" — chỉ check pending requests, KHÔNG clear state |
| Lang switch | save + reload + send menu mới | save + editMessageText (KHÔNG kèm menu) |
| Pending request gate ở /getvia/getproxy | yes ("pending.exists" với "View status" button) | yes (denyIfNotApproved gộp pending+blocked) |
| Out-of-state callback expired | "confirm.expired" → mainMenu | KHÔNG có check |
| Inventory re-check tại confirm time | yes (handleConfirmYes) | KHÔNG (qty selection chạy luôn) |
| Idempotent admin action | "admin.order_already_processed at {time}" | "Request already processed" — không kèm thời gian |

---

## Section 3 — 20 case × 2 bot

| # | Case | VIA response | File:line | Proxy response | File:line | Gap |
|---|---|---|---|---|---|---|
| 1 | Slash `/start` (user mới chưa có row) | Whitelist→pending (admin notify) → reply `whitelist.pending`. Nếu enabled=false → welcome + count + mainMenu | `commands/start.ts:14-50` | getOrCreateUser INSERT row pending, pendingText hardcoded VI/EN, notify admin (`admin_approve_user/admin_block_user`), reply remove_keyboard. Nếu active → welcome + count + mainMenuKeyboard | `commands/start.ts:11-184` | OK roughly. Proxy thiếu i18n cho welcome, hardcoded text. |
| 2 | `/help` | whitelist→pending/rejected → cố reply tương ứng. Nếu non-idle state, clearState+`confirm.cancelled` rồi `showHelp` | `commands/utility.ts:17-32` | Reply `t('help')`. KHÔNG check whitelist, KHÔNG clear state | `commands/help.ts:7-30` | **GAP P2**: proxy /help không clear-state nếu user đang giữa flow → state cũ bám lại. |
| 3 | `/cancel` | whitelist-gate (Wave 53 fix), clearState, reply `confirm.cancelled` + mainMenu | `commands/utility.ts:35-57` | Lookup pending requests; nếu rỗng → "Khong co yeu cau nao dang cho". Inline keyboard cancel_confirm yes/no. KHÔNG clearBotState | `commands/cancel.ts:8-72` | **GAP P1**: proxy `/cancel` chỉ huỷ pending requests trong DB, KHÔNG clear conversation state. User đang awaiting_quick_qty + gõ `/cancel` → bot trả "không có yêu cầu chờ" và state vẫn còn. |
| 4 | `/lang` | whitelist-gate, clearState nếu non-idle, save + send menu mới | `commands/utility.ts:60-87` | `handleLanguage` mở keyboard chọn. `handleLanguageSelection` UPDATE language, editMessageText (không kèm menu). KHÔNG check pending, KHÔNG check status | `commands/language.ts:10-72` | **GAP P2**: proxy /language khả dụng cho cả pending/blocked user; KHÔNG clear state đang chạy. |
| 5 | `/banana` (slash không tồn tại) | grammY router không match → KHÔNG fire `bot.command()` nào → fallthrough vào `bot.on('message:text')` → text bắt đầu `/` → return (KHÔNG reply). | `handlers/messages/index.ts:241` | `handleUnknownCommand` reply `t('unknownCommand')` | `commands/help.ts:32-55` | **Proxy LÀM TỐT HƠN**. VIA silent với slash fake. |
| 6 | `/getvia` user pending | whitelist returns 'pending' → reply `whitelist.pending` | `commands/getvia.ts` (not shown nhưng cùng pattern utility.ts:24) | `denyIfNotApproved` → reply `accountPendingApproval` + log. Có i18n. | `commands/get-proxy.ts:36-38`, `guards.ts:42-53` | OK — proxy có guard tốt. |
| 7 | Click inline button `proxy_type:http` | findRoute(data) qua Map exact+prefix → handler dispatched. Whitelist+blacklist gate. answerCb tự động. Try/catch global. | `handlers/callbacks/index.ts:65-122` | if/else chain trong handlers.ts. answerCallbackQuery() inline. Không có whitelist gate ở callback path (chỉ ở /command path). Không có error wrapper | `handlers.ts:82-264` | **GAP P1**: proxy callback path KHÔNG check whitelist/blacklist/state-corrupted. Pending user click inline vẫn route tới handler (ở handler mới gate). Chuỗi if/else dài 180 dòng — khó audit. |
| 8 | Click button cũ `confirm_yes` sau khi state expired | `handleConfirmYes` check state.step !== 'awaiting_confirm' → clearState + `confirm.expired` + mainMenu | `handlers/callbacks/getvia.ts:205-211` | Không có expired check; qty:* → `handleQuantitySelection` chạy luôn với qty từ callback data (không validate state). State stale có thể gây race | `handlers.ts:230-248` | **GAP P1**: proxy không phòng vệ stale callback. |
| 9 | User text "5" khi đang `awaiting_quick_qty` (proxy) / `awaiting_quantity` (VIA) | parseInt, validate >0, validate ≤max, kiểm tra inventory, route to confirm hoặc auto-elevate to custom flow nếu vượt max | `handlers/messages/index.ts:50-130` | parseInt, validate >0 (regex `^\d+$`), max QUICK=10/CUSTOM=100, KHÔNG check inventory tại text-input time | `commands/custom-order.ts:22-88` | **GAP P1**: proxy không check inventory tại bước text qty → user nhập 50, sau đó auto-assign fail vì hết kho → bot reply `noProxyAvailable`, UX kém. VIA fail fast tại text input. |
| 10 | User text "abc" (mid-state awaiting_qty) | `validate.number` + cancelKeyboard | `handlers/messages/index.ts:54` | "Số không hợp lệ. Nhập một số nguyên dương" + KHÔNG kèm cancelKeyboard | `commands/custom-order.ts:60-66` | OK. Proxy thiếu nút Cancel để thoát loop. |
| 11 | User text "hello" idle state (KHÔNG state) | `handleDefault`: clearState + `unknown_command` + mainMenu | `handlers/messages/index.ts:197-200` | Check last /support cmd; nếu < 30min → "Tin nhan da nhan" / nếu không → "Su dung /help" | `handlers.ts:309-333` | **Proxy có pattern hay** (support mode 30min). Nhưng cảnh báo: 1 query DB mỗi tin nhắn — N+1 trong support burst. Nên cache. |
| 12 | User chưa từng /start, gõ thẳng "hello" | logMessage incoming. checkWhitelist tạo row pending + notify admin. Reply `whitelist.pending` | `handlers/messages/index.ts:243,260-280` | `if (!user) return;` — SILENT, KHÔNG reply, KHÔNG log, KHÔNG tạo row | `handlers.ts:281-287` | **GAP P0**: proxy silent với user chưa /start → contradicts user's "every message must reply" requirement. Admin không biết có user mới nói chuyện. |
| 13 | User blocked gửi /start | whitelist 'rejected' → `bt('whitelist.rejected')` reply. Nếu blacklisted: blocked + mainMenu | `commands/start.ts:28-34` | start.ts handle `status === 'blocked'/'banned'` → blocked text dedicated + remove_keyboard. Không log incoming /start nếu user.status check trước getOrCreateUser? Có log. | `commands/start.ts:100-132` | OK — proxy làm tốt phần này. |
| 14 | User blocked gửi text "hello" | whitelist + blacklist check ngay đầu message handler → silent ignore (cần thiết cho "blocked" silent UX) | `handlers/messages/index.ts:283-286` | Lookup user.status không có ở message handler — chỉ kiểm tra `if (!user) return;`. Blocked user vẫn nhận reply `t('unknownCommand')`/`support` | `handlers.ts:281-333` | **GAP P1**: blocked user vẫn được reply ở proxy bot → leak thông tin "bot alive". |
| 15 | Photo / video / voice / sticker / file / animation / location / contact | unsupported.ts handler riêng cho từng loại → log mô tả (`[Photo]`, `[File] name (sizeKB)`, etc.) → reply `unsupported.media`. Có whitelist gate. | `handlers/unsupported.ts:13-56` | KHÔNG có handler. grammY router không match → SILENT. Không log, không reply. | (none) | **GAP P0**: phá yêu cầu "mỗi tin user gửi đều cần response". |
| 16 | Empty message / poll / dice / contact | Nhiều type → unsupported.ts cover photo/document/sticker/voice/video/video_note/animation/location/contact | `handlers/unsupported.ts:35-55` | Cũng silent | (none) | **GAP P0**: phải port unsupported handler. |
| 17 | Edited message | Không bắt `edited_message` event → silent | (none in VIA) | Cũng silent | (none) | Cả 2 đều thiếu — P3, edge case ít user dùng. |
| 18 | Forward message | grammY rơi vào `message:text` nếu forward có text → đi qua state machine bình thường | `handlers/messages/index.ts:222` | Cũng vậy | `handlers.ts:270` | OK — không phải gap. |
| 19 | Bot bị add vào group/supergroup | `my_chat_member` handler: nếu flag off → leaveChat. Nếu on → checkWhitelist tạo pending row. | `handlers/group-membership.ts:53-114` | KHÔNG handler → bot ngồi yên trong group, mỗi tin user trong group gửi → grammY route theo `chat.type`; message handler xử như user. KHÔNG có gate group/supergroup. | (none) | **GAP P1**: proxy không quản lý group membership. |
| 20 | Bot bị user block (Telegram trả 403) | Khi gửi message thấy 403 → grammY ném; bot.catch() log. Không retry. | `setup.ts:150-152` | bot.catch() → captureError. Không có retry / không cleanup user.status | `handlers.ts:349-354` | OK level. Cả 2 bot đều không tự động đánh dấu user.status='blocked' khi nhận 403. |
| 21 | Telegram 429 rate limit | grammY tự retry-after (vì FloodWaitError) | grammY tự xử | (grammy lib) | grammy lib | OK — cả 2 đều dựa vào grammY default. VIA notifyAdmins dùng `Promise.allSettled` cho fan-out, log per-id failure. Proxy cũng `Promise.allSettled` (notify-admins.ts:117). OK. |
| 22 | Database error mid-flow | Try/catch trong message handler bắt → reply `bt('error')` + mainMenu. Webhook outer cũng có DLQ fallback | `handlers/messages/index.ts:300-306` | KHÔNG có outer try/catch trong handler. Lỗi async sẽ bubble lên webhook fail safe → captureError + 200. KHÔNG có user-facing message. | `handlers.ts:270-343` | **GAP P1**: proxy crash giữa flow → user thấy bot "treo" (Vercel timeout 60s). Cần wrap try/catch ở mọi command. |
| 23 | State expired (TTL 30min) | getState() tự auto-expire + clearState + return idle. Lần gọi tiếp sẽ rơi vào handleDefault → reply `unknown_command` + mainMenu | `state.ts:23-43`, `handlers/messages/index.ts:197` | getBotState cũng auto-expire (state.ts:42-48). Nhưng dispatcher chỉ gọi state-handler nếu step đúng; nếu expired → fall through tới support-mode/use-help reply | `state.ts:36-54`, `handlers.ts:292-296` | OK. |
| 24 | Concurrent admin approve giữa lúc user request | VIA atomic: `processGetVia` re-check inventory tại confirm time, dùng RPC khoá row | `handlers/callbacks/getvia.ts:215-233` | Bulk path dùng RPC `bulk_assign_proxies` — atomic | `commands/bulk-proxy.ts:67-74` | OK. |
| 25 | Idempotent retry (Telegram resend update_id) | markUpdateProcessed ở webhook → return 'duplicate' → 200 không invoke handler | `webhook-dedup.ts:69-119`, `webhook/route.ts:49-65` | 2-layer: in-memory Set + DB webhook_dedup → return 200 | `webhook/route.ts:135-145` | Cả 2 OK. Proxy dedup chạy TRƯỚC handler, mark sau khi handler thành công (route.ts:165-173) — đúng pattern hơn (VIA mark trước handler, nếu handler crash thì retry sẽ skip → mất tin). VIA cố ý làm vậy vì có DLQ. |
| 26 | Long-running operation (e.g. checkUid 50 vias) | replyWithChatAction('typing') trước khi chạy. safeSendMessage chunked nếu vượt 4096 chars | `commands/utility.ts:102` | `handleCheckProxy` reply "Dang kiem tra..." trước khi loop, sau đó reply kết quả. KHÔNG dùng chat action. KHÔNG chunk → kết quả 50 proxy có thể vượt 4096 → grammY ném | `commands/check-proxy.ts:37,57-58` | **GAP P2**: proxy thiếu chunking; checkProxy với 30+ proxy có thể vượt limit. |
| 27 | i18n vi/en | Mọi text qua `bt(key, lang, vars)`. 8 file domain i18n. Missing key warning trong dev | `i18n/index.ts:150-162` | Hỗn hợp: `t(key, lang)` cho text trong messages.ts (~30 keys). Phần lớn handler hardcode array `lang === 'vi' ? [...] : [...]` | xuyên suốt | **GAP P2**: proxy i18n fragmented. Khó thêm ngôn ngữ thứ 3, dễ miss khi đổi text. |
| 28 | Unknown callback data (legacy/older client) | `findRoute(data)` không match → logger.warn + safeAnswerCb (silent ack, không reply) | `handlers/callbacks/index.ts:98-101` | switch fall-through → answerCallbackQuery("Unknown action") (alert toast) — KHÔNG reply tin mới | `handlers.ts:262-264` | OK level. Proxy popup "Unknown action" lộ stack technical. |
| 29 | Outgoing bot message audit | api.config.use intercept TẤT CẢ sendMessage/sendDocument/sendPhoto/etc → fireLogBotMessage tự động | `setup.ts:77-137` | Mỗi handler tự nhớ gọi `logChatMessage(..., Outgoing, ...)`. ~20% miss (e.g. `handleHelp` log Incoming nhưng quên Outgoing trong vài branch) | toàn bộ commands/ | **GAP P0 architectural**: proxy bot KHÔNG có audit-trail-by-default. Admin user-detail view miss tin nhắn nếu handler quên log. |
| 30 | Mass admin notification | Promise.allSettled, per-id failure log, rate-limit/cooldown 5min cho whitelist retry notifications, separate by `notificationType` | `check-whitelist.ts:165-197`, `notify-admins.ts` | Promise.allSettled, per-id log. KHÔNG có per-type cooldown — pending user spam /start sẽ spam admin từng lần | `notify-admins.ts:103-138` | **GAP P2**: proxy không cooldown notification. |

---

## Section 4 — TOP CRITICAL GAPS (proxy bot thiếu)

### P0 (BLOCK — vi phạm requirement "mỗi tin có response")

1. **User chưa /start gửi text → silent** (case #12)
   `handlers.ts:281-287` — `if (!user) return;` cắt mọi response. Phải tạo user (như getOrCreateUser) hoặc reply "Hãy dùng /start trước" + log.

2. **Photo/video/voice/sticker/file/location/contact → silent** (case #15, #16)
   Không có handler tương đương `unsupported.ts`. Port file `bot.on('message:photo'|...)` từ VIA.

3. **Outgoing bot messages không auto-log** (case #29)
   `bot.ts:13` không có `_bot.api.config.use(...)`. Phải port pattern từ VIA `setup.ts:77-137`.

### P1 (HIGH — bug rõ ràng)

4. **`/cancel` không clear conversation state** (case #3) — `commands/cancel.ts:8-72` xoá DB pending request nhưng không gọi `clearBotState(user.id)`.

5. **Callback path không gate whitelist/blacklist/error** (case #7) — `handlers.ts:82-264` if/else chain dài, không có wrapper try/catch + whitelist gate. Pending user click button vẫn đi qua.

6. **State stale khi click button cũ** (case #8) — qty:* callback chạy luôn không validate state. Dễ race.

7. **Inventory không re-check tại text qty input** (case #9) — user nhập 50, cuối flow mới fail. VIA fail-fast.

8. **Blocked user vẫn nhận reply text** (case #14) — `handlers.ts:281-333` chỉ check `!user`. Không check `user.status`.

9. **Crash giữa flow → bot treo, user không biết** (case #22) — không có try/catch wrapper trong commands → user thấy 60s timeout, không reply.

10. **Group/supergroup membership không quản lý** (case #19) — không có `bot.on('my_chat_member')` handler. Bot vào group sẽ ngồi yên/leak.

### P2 (MEDIUM — UX kém nhưng không sai)

11. **`/help` không clear non-idle state** (case #2) — user gõ /help giữa flow → state cũ bám.
12. **`/language` không gate pending/blocked, không clear state** (case #4).
13. **Long message không chunk** (case #26) — `/checkproxy` với nhiều proxy vượt 4096.
14. **i18n hardcoded fragmented** — khó maintain.
15. **No notification cooldown** — pending user spam admin.

### P3 (LOW)

16. Edited messages không bắt (cả 2 bot đều thiếu).
17. Markdown user-input không escape — first_name có `*_[]` sẽ vỡ render.

---

## Section 5 — Patterns đáng port (cụ thể)

### Pattern 1: Auto-logging outgoing messages (S effort)

```ts
// proxy-manager-telebot/src/lib/telegram/bot.ts
import { Bot } from "grammy";
import { logChatMessage } from "./logging";
import { ChatDirection, MessageType } from "@/types/database";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const bot = new Bot(token);

bot.api.config.use(async (prev, method, payload, signal) => {
  if ('chat_id' in payload) {
    const chatId = String(payload.chat_id);
    // map chat_id (telegram_id) → tele_users.id
    const { data: u } = await supabaseAdmin
      .from('tele_users')
      .select('id')
      .eq('telegram_id', Number(chatId))
      .maybeSingle();
    if (u?.id) {
      let text = '';
      if (method === 'sendMessage' && 'text' in payload) text = String(payload.text ?? '');
      else if (method === 'sendDocument') text = `[file] ${'caption' in payload ? payload.caption : ''}`;
      else if (method === 'sendPhoto')    text = `[photo] ${'caption' in payload ? payload.caption : ''}`;
      else if (method === 'editMessageText' && 'text' in payload) text = `[edit] ${payload.text}`;
      if (text) {
        logChatMessage(u.id, null, ChatDirection.Outgoing, text, MessageType.Text)
          .catch(e => console.warn('audit-log fail', e));
      }
    }
  }
  return await prev(method, payload, signal);
});
```

Effort: **S**. 25 dòng. Xoá ~40 chỗ `await logChatMessage(... Outgoing ...)` thủ công ở các command file.

### Pattern 2: Unsupported media handler (S effort)

```ts
// src/lib/telegram/handlers.ts (mới)
const UNSUPPORTED_KIND: Array<{evt: string, fmt: (ctx: Context) => string}> = [
  { evt: 'message:photo',     fmt: () => '[Photo]' },
  { evt: 'message:document',  fmt: (c) => `[File] ${c.message?.document?.file_name ?? ''}` },
  { evt: 'message:sticker',   fmt: (c) => `[Sticker] ${c.message?.sticker?.emoji ?? ''}` },
  { evt: 'message:voice',     fmt: (c) => `[Voice] ${c.message?.voice?.duration}s` },
  { evt: 'message:video',     fmt: (c) => `[Video]` },
  { evt: 'message:animation', fmt: () => '[Animation]' },
  { evt: 'message:location',  fmt: () => '[Location]' },
  { evt: 'message:contact',   fmt: () => '[Contact]' },
];

for (const {evt, fmt} of UNSUPPORTED_KIND) {
  bot.on(evt as any, async (ctx) => {
    const user = await getOrCreateUser(ctx); if (!user) return;
    const lang = getUserLanguage(user);
    if (await denyIfNotApproved(ctx, user, lang)) return;
    const desc = fmt(ctx);
    await logChatMessage(user.id, ctx.message?.message_id ?? null, ChatDirection.Incoming, desc, MessageType.Text);
    const text = lang === 'vi' ? 'Bot chỉ hỗ trợ tin nhắn text. Gửi /help để xem hướng dẫn.' : 'Bot only supports text messages. Send /help.';
    await ctx.reply(text);
  });
}
```

Effort: **S**. 30 dòng. Port nguyên ý tưởng từ VIA `unsupported.ts`.

### Pattern 3: Callback router với Map + try/catch (M effort)

```ts
// src/lib/telegram/callbacks/index.ts (mới)
type CallbackHandler = (ctx: Context, user: any, data: string, lang: SupportedLanguage) => Promise<void>;
type CallbackRoute = {
  pattern: string;
  type: 'exact' | 'prefix';
  handler: CallbackHandler;
  answerCb?: boolean;
};

const ROUTES: CallbackRoute[] = [
  { pattern: 'menu:request', type: 'exact', handler: (ctx) => handleGetProxy(ctx) },
  { pattern: 'proxy_type:',  type: 'prefix', handler: (ctx, _u, d) => handleProxyTypeSelection(ctx, d.replace('proxy_type:', '')) },
  // ... map ALL 14 callback prefixes hiện tại
];

const exact = new Map<string, CallbackRoute>();
const prefix: CallbackRoute[] = [];
for (const r of ROUTES) (r.type === 'exact' ? exact.set(r.pattern, r) : prefix.push(r));

bot.on('callback_query:data', async (ctx) => {
  const data = ctx.callbackQuery.data;
  const user = await getOrCreateUser(ctx); if (!user) return;
  const lang = getUserLanguage(user);
  // gate
  if (await denyIfNotApproved(ctx, user, lang)) { await ctx.answerCallbackQuery(); return; }
  const route = exact.get(data) ?? prefix.find(r => data.startsWith(r.pattern));
  if (!route) { console.warn('Unknown callback', { data }); await ctx.answerCallbackQuery(); return; }
  try {
    await route.handler(ctx, user, data, lang);
    if (route.answerCb !== false) await ctx.answerCallbackQuery();
  } catch (err) {
    captureError(err, { source: 'callback', extra: { data } });
    await ctx.answerCallbackQuery('Error').catch(() => {});
    await ctx.reply(lang === 'vi' ? '[X] Đã có lỗi xảy ra.' : '[X] An error occurred.').catch(() => {});
  }
});
```

Effort: **M**. ~80 dòng + xoá 180 dòng if/else hiện tại. Đáng vì readable + add gate cho TẤT CẢ callbacks 1 lần.

### Pattern 4: First-contact user UX (S effort)

```ts
// handlers.ts message:text
const { data: user } = await supabaseAdmin
  .from('tele_users').select('*').eq('telegram_id', from.id).single();

if (!user) {
  // Tạo row pending + reply welcome thay vì silent.
  const created = await getOrCreateUser(ctx);  // existing helper
  if (created) {
    const lang = getUserLanguage(created);
    await ctx.reply(lang === 'vi'
      ? 'Chào bạn! Vui lòng gõ /start để đăng ký.'
      : 'Hello! Please type /start to register.');
    await logChatMessage(created.id, ctx.message.message_id, ChatDirection.Incoming, ctx.message.text, MessageType.Text);
  }
  return;
}
```

Effort: **S**. 10 dòng. Vá P0 case #12.

### Pattern 5: cancelKeyboard (XS effort)

```ts
// keyboard.ts thêm:
export function cancelKeyboard(lang: SupportedLanguage): InlineKeyboard {
  return new InlineKeyboard().text(lang === 'vi' ? 'Hủy' : 'Cancel', 'qty:cancel');
}
```

Mỗi text-prompt reply cần kèm cancelKeyboard để user thoát loop.

### Pattern 6: safeSendMessage chunked (S effort)

Port từ VIA `helpers.ts:112-142`. Dùng cho /checkproxy, /myproxies dài.

### Pattern 7: clearBotState trong /cancel /help /language (XS effort)

Mỗi command đầu file:
```ts
const state = await getBotState(user.id);
if (state.step !== 'idle') {
  await clearBotState(user.id);
  // (optional) inform: 'Đã hủy thao tác đang chờ.'
}
```

### Pattern 8: replyTargetFor for groups (S effort)

Khi/nếu thêm group support, port `replyTargetFor` (helpers.ts:103-110).

---

## Section 6 — Action plan để proxy bot bằng VIA

| # | Task | File:line target | Acceptance | Effort | Prio |
|---|---|---|---|---|---|
| 1 | Auto-log outgoing qua `bot.api.config.use` | `src/lib/telegram/bot.ts:13` (mở rộng) | sendMessage/Document/Photo/Voice/Animation/edit auto-insert chat_messages row Outgoing | S | P0 |
| 2 | Xoá ~40 chỗ logChatMessage(... Outgoing ...) thủ công | mọi `commands/*.ts` | grep `Outgoing` chỉ còn ở chỗ thật cần (e.g. external sendTelegramMessage) | M | P0 |
| 3 | Port unsupported handler | `src/lib/telegram/handlers.ts` cuối file | Gửi sticker/photo/voice/file/loc/contact → bot reply 'unsupported.media'; có chat_messages Incoming | S | P0 |
| 4 | First-contact (user chưa /start gửi text) | `handlers.ts:281-287` | User mới gõ "hello" → bot tạo pending row, notify admin, reply "Vui lòng /start" | S | P0 |
| 5 | Block status ở message handler | `handlers.ts:281-333` thêm gate `if (user.status === 'blocked' \|\| 'banned') return;` (silent) | Blocked user gõ text → silent, KHÔNG reply | XS | P1 |
| 6 | `/cancel` clear conversation state | `commands/cancel.ts:8-72` | Gõ /cancel khi awaiting_quick_qty → state về idle, reply "đã huỷ" | XS | P1 |
| 7 | `/help` `/language` clear non-idle state | `commands/help.ts:7`, `commands/language.ts:10` | Gõ giữa flow → clear + reply | XS | P1 |
| 8 | Callback router Map + global gate + try/catch | tách ra `src/lib/telegram/callbacks/index.ts` | 14 callback prefix routed via Map; gate whitelist+blocked; lỗi → answerCb('Error') | M | P1 |
| 9 | State expired check ở handleQuantitySelection / qty:* | `commands/bulk-proxy.ts:24-30` | Click button cũ sau >30min → reply "Phiên đã hết hạn" + mainMenu | S | P1 |
| 10 | Inventory re-check tại text qty input | `commands/custom-order.ts:60-88` | User nhập 50 trong khi chỉ có 5 → fail fast trước khi lock state | S | P1 |
| 11 | my_chat_member handler (group support hoặc auto-leave) | mới `src/lib/telegram/group-membership.ts` | Bot bị add vào group → leaveChat (Phase 1) | S | P1 |
| 12 | Wrap mọi command với try/catch + reply error | mọi `commands/*.ts` | DB lỗi giữa /myproxies → user thấy "[X] Đã có lỗi xảy ra" trong <2s | M | P1 |
| 13 | safeSendMessage chunked | `src/lib/telegram/send.ts` | Reply >4096 chars tự chia 2+ message | S | P2 |
| 14 | escapeMarkdown helper + áp dụng | `src/lib/telegram/messages.ts` | first_name có `*_[]` không vỡ render | XS | P2 |
| 15 | i18n centralisation (đưa hardcoded array vào messages.ts) | mọi `commands/*.ts` welcome/blocked/lists | mỗi text qua `t()` | L | P2 |
| 16 | Notification cooldown (5min) cho pending user spam | `src/lib/telegram/notify-admins.ts` | Pending user /start nhiều lần → admin chỉ nhận 1 lần/5min | S | P2 |
| 17 | replyWithChatAction('typing') trên long ops | `commands/check-proxy.ts:37`, `commands/my-proxies.ts:9` | Trước khi loop check → typing indicator | XS | P2 |
| 18 | DLQ trên unknown webhook error | `src/app/api/telegram/webhook/route.ts:186-189`, mới table `bot_webhook_dead_letter` | Lỗi unknown → ghi DLQ + 200 thay vì chỉ captureError | M | P2 |
| 19 | Tách stale Telegram error → 200 không DLQ | `webhook/route.ts:186-189` | "query is too old"/"message is not modified" → 200 không DLQ | XS | P2 |
| 20 | cancelKeyboard kèm mọi text-prompt | `commands/get-proxy.ts:278-282`, custom-order.ts | User luôn có nút Hủy thoát loop | XS | P2 |
| 21 | Idempotent admin action thông báo "đã xử lý lúc X" | `commands/admin-approve.ts`, `bulk-proxy.ts:181-185` | Admin click duplicate approve → "Đơn đã được duyệt lúc HH:mm" | S | P3 |
| 22 | Edited message handler | `handlers.ts` thêm `bot.on('edited_message:text')` | User edit câu cũ → bot phản hồi "Đã ghi nhận chỉnh sửa" | S | P3 |
| 23 | Auto-detect & flag user.status='blocked' khi nhận TG 403 | `bot.ts` config.use error path | Bot bị user block → tele_users.status update | M | P3 |
| 24 | callback registry + stats normalize | mới `src/lib/telegram/command-registry.ts` | Stats dashboard label callbacks chuẩn | M | P3 |
| 25 | Group reply threading (replyTargetFor) | `src/lib/telegram/send.ts` | Reply trong group quote tin user (sau khi enable group) | S | P3 |

---

## Section 7 — Self-critical

### Patterns VIA cũng tệ, KHÔNG nên port

1. **markUpdateProcessed mark TRƯỚC handler chạy** (`webhook-dedup.ts:69-119` + comment ở line 60-67).
   Lý lẽ VIA: idempotent handler + DLQ. Nhưng nếu handler crash mid-flow, retry sẽ skip → mất tin (DLQ chỉ chạy nếu webhook handler ném). Proxy bot mark SAU khi handler thành công (`webhook/route.ts:165-173`) là pattern đúng hơn. **GIỮ pattern proxy.**

2. **api.config.use intercept tất cả send → fire logBotMessage trong middleware**. Mỗi outgoing message tốn 1 SUPABASE INSERT trong critical path. Với /myvia 50 vias hoặc bulk delivery có thể block 50ms × N. Có ý kiến scaling.
   → Nếu port, dùng `setImmediate`/queue để defer log out của hot path. Hoặc batch insert mỗi 1s.

3. **escapeMarkdown nhưng vẫn parse_mode: 'Markdown'**. Markdown V1 deprecated theo Telegram. Nên migrate parse_mode='HTML' + escapeHtml. VIA mix cả 2, không consistent.
   → Khi port, chuẩn HTML đầu.

4. **state.ts dùng comma-separated string `report_uid` để chứa array `reportUids`** (`state.ts:46-46`). Anti-pattern — JSONB column phù hợp hơn.
   → Proxy đã dùng `context: jsonb` (state.ts:73-77). Giữ nguyên.

5. **Nhiều file i18n nhỏ + một index lớn** — VIA có 8 file i18n cho 8 domain. Tốt cho separation nhưng overhead khi thêm key. Proxy bot scale nhỏ, 1 file `messages.ts` đủ. Đừng over-engineer.

### Pattern proxy bot LÀM TỐT HƠN VIA

1. **Slash command không tồn tại → reply unknown** (case #5). VIA silent là bug, đừng "sửa" theo.

2. **2-layer dedup (in-memory Set + DB)** (`webhook/route.ts:135-145`). VIA chỉ DB. Proxy nhanh hơn cho replay nhanh.

3. **Per-user webhook rate limit 30 req/min** (`webhook/route.ts:117-133`). VIA không có. Tốt để chống spam nhưng silent (không reply user). OK.

4. **`acquireSlot` semaphore 50 concurrent** (`webhook-queue.ts`). VIA không có. Bảo vệ Supabase connection pool. Giữ.

5. **`denyIfNotApproved` guard helper** (`guards.ts:24-55`). VIA inline check ở mỗi command — repetitive. Proxy DRY hơn (3 dòng vs 5×N dòng).

6. **AGENTS.md cảnh báo "NOT the Next.js you know"** — discipline tốt hơn VIA.

7. **`/support` mode 30 phút "tin nhắn nào cũng nhận"** (`handlers.ts:309-322`). VIA không có. UX nhân văn cho user lúc cần help.

### Khó audit chỉ qua source — cần test live

1. **Group chat actual behaviour** — VIA Phase A có gate `bot_groups_enabled`; chưa rõ flow khi user trong group click inline button (chat_id âm vs user_id) thực sự routing thế nào.

2. **Telegram retry timing** — chỉ test live mới biết Vercel cold start nào blow past 30s.

3. **i18n key miss** — `bt('error')` fallback vào key string nếu không có vi/en. Cần test live xem có ai thấy raw key.

4. **Bulk delivery file vs inline path** — quá threshold thì gửi file; trong test có thể không trigger. Cần đẩy test với 50+ proxy.

5. **DLQ replay tool có thực sự work** — VIA log DLQ row nhưng chưa rõ admin UI replay đã connect đúng chưa. Đọc code không thấy admin action button.

6. **Markdown render edge cases** — emoji + non-ASCII trong username + `__bold__` raw từ user → cần test live.

7. **Chat-member event ordering** khi bot bị remove rồi add lại trong vài giây — race giữa whitelistCache LRU và DB row update.

8. **answerCallbackQuery sau bao nhiêu giây thì stale** — Telegram doc nói 15s nhưng thực tế khác cold start.

---

**TL;DR cho user:**

- VIA bot có 30+ pattern UX/audit/error-handling mà proxy bot thiếu. Đáng port.
- 3 P0 phá yêu cầu "mọi tin user có response": user mới silent (case #12), media silent (case #15), outgoing không log (case #29).
- 7 P1 là bug rõ: /cancel không clear state, callback path không gate, blocked user vẫn được reply, crash không reply, state stale, inventory không re-check sớm, group không quản.
- Không phải mọi pattern VIA đều tốt — webhook-dedup mark-before-handler, multi-file i18n, Markdown+escapeMarkdown nửa vời. Đừng copy mù.
- 25 task action plan với effort + acceptance — gợi ý làm tuần này: P0 (1-4) + P1 (5-12) ≈ 1 wave (Wave 23D hoặc 24A).
