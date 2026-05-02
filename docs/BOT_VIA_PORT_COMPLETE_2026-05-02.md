# BOT VIA-PORT COMPLETION REPORT — 2026-05-02

> Tổng kết 6 wave port pattern VIA bot vào proxy bot trong 1 session.
> User feedback ban đầu: "tao thấy bot giao via đã khá hoàn thiện trong mọi
> trường hợp và mọi workflow" → port chính xác từng response path + vietnamese
> accent + format.

---

## 6 wave shipped trong session 2026-05-02

| Wave | Commit | Nội dung | Tests |
|---|---|---|---|
| 23C-fix | `d53eeba` | Drop AUP gate, every new user → pending direct, mig 050 explicit `default_approval_mode='manual'` | 680 |
| 23C-quickwins | `be2ca82` | Mig 048 audit immutability + mig 049 bot_files audit | 680 |
| 23D-bot | `214015b` | Every-message-must-reply guarantee: pre-/start text, photo/video/voice/sticker, /cancel clear state, blocked text gate | 683 |
| 23E-bot | `46e5c62` | Order qty format port chính xác VIA + sweep ~30 chỗ Vietnamese không dấu trong 11 file | 699 |
| 24-bot | `40aaa53` | Confirm step "Xác nhận yêu cầu" + pending.exists guard | 702 |

---

## Coverage VIA → Proxy bot (post Wave 24)

### ✅ Đã port hoàn chỉnh

| VIA pattern | Proxy bot status | File:line |
|---|---|---|
| Welcome + count + main menu | ✓ | `commands/start.ts` |
| Pending welcome (not-yet-approved) | ✓ | `commands/start.ts:48-68` |
| Blocked welcome dedicated | ✓ | `commands/start.ts:100-132` |
| Admin approval gate (`tele_users.status='pending'` default) | ✓ | `lib/telegram/user.ts` |
| Admin notify on first /start (Approve/Block buttons) | ✓ | `commands/start.ts:34-48` |
| Order type chooser (Order nhanh / Order riêng) | ✓ | `commands/get-proxy.ts` + `keyboard.ts:orderTypeKeyboard` |
| Free-form text qty input | ✓ | `commands/custom-order.ts:handleQtyTextInput` |
| Confirm step "Xác nhận yêu cầu" | ✓ | `commands/custom-order.ts:handleConfirmCallback` |
| Pending.exists guard | ✓ | `commands/get-proxy.ts:39-58` |
| Order qty format ("Yêu cầu Proxy — TYPE / Có N sẵn sàng / Nhập số lượng") | ✓ | `commands/get-proxy.ts:246-278` |
| `/cancel` clears bot state | ✓ | `commands/cancel.ts:25-30` |
| `/getproxy /myproxies /checkproxy /revoke` blocked-pending guard | ✓ | `lib/telegram/guards.ts` |
| Pre-/start text reply (no silent) | ✓ | `handlers.ts message:text` |
| Photo/video/voice/sticker/file/animation/audio/location/contact reply | ✓ | `handlers.ts UNSUPPORTED list` |
| Vietnamese có dấu chuẩn | ✓ | 11 file qua Wave 23E |
| Message log incoming/outgoing | ✓ | `chat_messages` table + `logChatMessage` |
| AUP gỡ (user spec) | ✓ | Wave 23C-fix |
| State machine DB-persisted (TTL 30 min) | ✓ | `state.ts` + mig 047 |
| Audit log immutability | ✓ | mig 048 |
| File delivery audit (`bot_files` table) | ✓ | mig 049 |

### 🟡 Có nhưng yếu hơn VIA

| Gap | Trạng thái | Plan |
|---|---|---|
| i18n architecture flat vs split | proxy `messages.ts` 217 LOC flat; VIA 8 domain file | Wave 25 (1-1.5 ngày refactor) |
| Outgoing message audit interceptor (`api.config.use`) | proxy mỗi handler tự log; ~20% miss | Wave 26 (architectural) |
| Long message chunking cho /checkproxy 30+ proxy | proxy không chunk → grammy throw nếu >4096 chars | Wave 25 (M effort) |
| Cooldown 30s sau /getproxy | proxy không có (defense-in-depth) | Defer — `pending.exists` + webhook rate-limit đã đủ |
| Markdown escape user-input | proxy KHÔNG escape `*_[]` trong first_name/username | Wave 25 (S, nhanh) |
| my_chat_member handler (group/supergroup) | proxy KHÔNG có | Wave 26 (group support) |
| Callback router map + try/catch wrapper | proxy if/else 200 dòng | Wave 26 (refactor) |
| Inventory re-check tại text qty input | proxy fail-late, VIA fail-fast | Wave 25 (M) |

### ❌ Không port (cố ý)

| Pattern VIA | Lý do KHÔNG port |
|---|---|
| Categories đa cấp | Proxy không chia category sâu như via |
| Warranty schema (16 cột) | User chưa request |
| UID check command | Khái niệm via specific |
| Multi-org (org_id) | User single tenant |
| Whitelist Phase A multi-tenant | Single project |
| Slash không tồn tại silent | Proxy LÀM TỐT HƠN — có handleUnknownCommand reply |

---

## Tests

| Wave | Test count | Notable regression test |
|---|---|---|
| 23C | 680 | AUP gate removed (Wave 23C-fix) |
| 23C-quickwins | 680 | (mig only) |
| 23D | 683 | `regression: handleCancel triggers DELETE on bot_conversation_state` |
| 23E | 699 | `regression: messages.ts has zero unaccented Vietnamese in vi text` (banlist 24 phrase) |
| 24 | 702 | Confirm flow: Yes places + clears, No cancels, drift expires |

**Tổng tests pass:** 702/702 (loại 6 skip).

---

## Migrations

| Mig | Wave | Mục đích |
|---|---|---|
| 047 | 23B | `bot_conversation_state` table |
| 048 | 23C | `activity_logs` immutability trigger |
| 049 | 23C | `bot_files` delivery audit table |
| 050 | 23C-fix | Explicit `default_approval_mode='manual'` |

---

## Docs

| File | Mục đích |
|---|---|
| `docs/BOT_RESPONSE_GAP_2026-05-02.md` | Map 30 case VIA vs proxy 1-1, file:line, gap P0/P1/P2 |
| `docs/PORT_VIA_TEXT_2026-05-02.md` | 80+ i18n key mapping, 25 task action plan |
| `docs/SCORECARD_2026-05-02.md` | Master scorecard 60/100, 4 review tổng hợp |
| `docs/PHASE_PLAN.md` | 5-phase 10-tuần roadmap |
| `docs/BOT_VIA_PORT_COMPLETE_2026-05-02.md` | (this file) |

---

## Flow end-to-end mà user test được ngay

### 1. User mới /start lần đầu
```
User: /start
Bot:
  *Proxy Manager Bot*
  Xin chào! Bạn đã đăng ký thành công.
  [i] Tài khoản của bạn đang chờ admin duyệt.
  /support - Hỗ trợ
  /language - Đổi ngôn ngữ
Admin: nhận noti "[New User] @user (ID: 123) registered and is pending approval. Approve or block?"
```

### 2. User pending gõ /getproxy
```
Bot: [!] Tài khoản của bạn đang chờ admin duyệt. Bạn sẽ nhận thông báo khi được phê duyệt.
```

### 3. User mới gõ "hello" trước /start
```
Bot: getOrCreateUser tạo row pending → reply pending message (không silent như cũ)
```

### 4. User gửi sticker / photo / voice
```
Bot: Bot chỉ hỗ trợ tin nhắn dạng văn bản. Gửi /help để xem các lệnh có sẵn.
Log: [Photo] / [Sticker 😀] / [Voice 5s]
```

### 5. User active flow đặt proxy
```
User: /start  → menu inline 8 nút
User: bấm "Yêu cầu proxy"  → tin mới: chọn HTTP/HTTPS/SOCKS5/Hủy
User: bấm HTTP  → tin mới: order chooser
   "Yêu cầu Proxy — HTTP
    Có 21 proxy sẵn sàng (tối đa 5/lần)
    Chọn loại đặt hàng:
    • Order nhanh: Tự động, giới hạn từng user
    • Order riêng: Cần admin duyệt yêu cầu
    Dùng lệnh /status để xem giới hạn"
   [Order nhanh] [Order riêng] [Hủy]
User: bấm "Order nhanh"  → tin mới:
   "Yêu cầu Proxy — HTTP
    Có 21 proxy sẵn sàng (tối đa 5/lần)
    Nhập số lượng proxy bạn cần:"
   [Hủy]
User: gõ "3"  → tin mới (Wave 24-1 confirm):
   "Xác nhận yêu cầu
    Loại: HTTP
    Số lượng: 3 proxy
    Hình thức: Order nhanh (tự động cấp)
    Xác nhận?"
   [Xác nhận] [Hủy]
User: bấm Xác nhận  → bot thực thi assign
   "[OK] Đã cấp 3 proxy HTTP!"
   + danh sách proxy host:port:user:pass
```

### 6. Pending guard chống spam
```
User active đã có 1 request pending → bấm "Yêu cầu proxy" lần 2:
Bot: "Bạn đã có yêu cầu đang chờ xử lý. Vui lòng đợi admin duyệt."
```

---

## Đề xuất tiếp theo

### Option A — Wave 25 polish bundle (~1-1.5 ngày)
- i18n architecture split (`messages.ts` → `i18n/{common,getproxy,status,history,...}.ts`)
- Long message chunking cho `/checkproxy`
- Markdown escape user-input (first_name `*_[]`)
- Inventory re-check tại text qty input

### Option B — Phase 1 Security (~5 ngày)
14 P0 bug từ Senior Dev review:
- 13 route admin/profile thiếu CSRF
- admin-approve.ts callback chưa migrate `safe_assign_proxy` RPC
- 6 race conditions

### Option C — Phase 2 Scaling foundation (~10 ngày)
- Move webhook dedup + rate-limit từ in-memory Map → Upstash Redis
- Sentry production wire
- Materialized view dashboard
- Telegram outbox queue

---

## Khuyến nghị tao

**Phase 1 ngay** — security gap admin/profile path là blocker cho multi-admin operation. Bot UX đã ở mức rất tốt, chuyển focus sang web admin security là ưu tiên cao nhất.

Mày muốn `bắt đầu P1` hay tiếp tục Wave 25 polish? Hoặc dừng tại đây để mày test bot trước.
