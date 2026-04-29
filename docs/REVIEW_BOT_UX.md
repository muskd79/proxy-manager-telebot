# REVIEW_BOT_UX — Telegram bot UX redesign (Wave 23B-bot)

> Reviewer: UX + Telegram bot expert
> Scope: `src/lib/telegram/**` (16 file)
> Trigger: User báo "2 keyboard chồng nhau, chật màn hình" — đang dùng cả `Keyboard()` (reply) trong `start.ts` lẫn `InlineKeyboard()` ở mọi flow.
> Mục tiêu: tắt reply keyboard, restore inline 8-button menu (label tiếng Việt), thống nhất copy + callback prefix.

---

## 0. TL;DR — vấn đề lớn nhất

| # | Vấn đề | Tác động | Fix |
|---|---|---|---|
| 1 | `start.ts` ép **persistent reply keyboard** (`new Keyboard().persistent()`) — sẽ cộng dồn với inline keyboard từng command | Mất 30–40% màn hình điện thoại | Bỏ `Keyboard()`; dùng inline persistent menu reply 1 lần khi `/start` |
| 2 | Welcome text dán 11 dòng `/getproxy - …` ngay BÊN CẠNH menu keyboard — text dư thừa | Người dùng phải đọc 2 lần | Welcome chỉ greeting + status; mọi điều hướng qua inline buttons |
| 3 | Label menu hardcode `/getproxy` thay vì label thân thiện ("Yêu cầu proxy") | Khó hiểu cho user mới, không i18n được | Dùng `text` button + `callback_data` riêng |
| 4 | `messages.ts` mix Unicode escape `à` lẫn UTF-8 thẳng — không đồng nhất encode | Khó maintain, lúc hiện tiếng Việt lúc không dấu | Convert all to UTF-8, bỏ `\u…` |
| 5 | 3 thư đổi cách `lang` được lookup — `getUserLanguage()` ở 4 nơi, parse string trực tiếp ở 5 nơi | Bug-prone, một số case fallback `en` ngầm | Bắt buộc dùng `getUserLanguage()` mọi nơi |
| 6 | Callback prefix lộn xộn: `proxy_type:`, `lang:`, `cancel_confirm:`, `revoke:`, `revoke_confirm:all:`, `qty:`, `admin_approve:`, `admin_bulk_approve:`, `aup_accept` (no colon!) | Khó parse, lỗi typo (đã thấy `aup_accept` xài `===`, không phải `startsWith`) | Chuẩn hoá `<domain>:<verb>:<arg…>` |
| 7 | `/status` trả 4 nhóm dữ liệu — user chỉ muốn rate-limit | Information overload | Tách: `/status` = rate-limit; bổ sung `/account` nếu cần show approval_mode + max_proxies |
| 8 | `/getproxy` flow: chọn type → chọn quantity → cấp. Không có nút **back/huỷ** | User stuck, phải gõ `/cancel` | Mọi inline screen có nút "Huỷ" về menu chính |
| 9 | `/myproxies` không có nút **copy** từng proxy, không pagination | Khi user có 20 proxy → 1 message dài, khó copy | Mỗi proxy 1 mini-card với nút "Copy" + "Báo lỗi" |
| 10 | Message text trộn unicode `[X]`, `[OK]`, `[!]`, `[i]` — user yêu cầu **không emoji** nhưng hiện tại dùng tag ASCII không chuẩn | Khó scan, không đồng nhất | Quyết định 1 lần: cấm emoji + dùng prefix text (đã đúng) hoặc cho phép emoji giới hạn |

---

## 1. Sơ đồ luồng end-to-end (8 button của menu mới)

### Menu chính (sau `/start` cho active user)

```
┌─────────────────────────────────┐
│ Yêu cầu proxy   │ Proxy của tôi │
├─────────────────┼───────────────┤
│ Kiểm tra proxy  │ Limit yêu cầu │
├─────────────────┼───────────────┤
│ Bảo hành proxy  │ Lịch sử       │
├─────────────────┼───────────────┤
│ Hướng dẫn       │ English       │
└─────────────────────────────────┘
```

Layout: 4 hàng × 2 cột inline `text + callback_data`. Pin vào tin nhắn welcome (không persistent reply keyboard).

### Flow 1 — "Yêu cầu proxy" (`menu:get_proxy`)

```
User click [Yêu cầu proxy]
    │
    ├─→ check user.status (blocked/banned → reject)
    ├─→ check rate-limit (denied → "Đã vượt giới hạn …")
    │
    └─→ editMessage("Chọn loại proxy:")
        ┌─────────────────────────┐
        │ HTTP │ HTTPS │ SOCKS5   │
        │      Huỷ                │
        └─────────────────────────┘
              │
              click HTTP
              ↓
        editMessage("Số lượng?  Lưu ý: > 5 cần admin duyệt")
        ┌─────────────────────────┐
        │  1  │  2  │  5  │  10   │
        │      Quay lại │ Huỷ     │
        └─────────────────────────┘
              │
              click 5
              ↓
        ├─→ qty=1 + auto:  autoAssignProxy() → editMessage(proxy)
        ├─→ qty=1 + manual: createManualRequest() → "Đã tạo yêu cầu, ID: …"
        ├─→ qty>1 + auto + ≤5: bulk_assign_proxies → editMessage(list)
        └─→ qty>5 OR manual: createManualRequest(quantity) → notify admins
```

**File path**: `src/lib/telegram/commands/get-proxy.ts` + `bulk-proxy.ts`.

### Flow 2 — "Proxy của tôi" (`menu:my_proxies`)

```
User click [Proxy của tôi]
    │
    └─→ fetch proxies WHERE assigned_to=user_id AND status=assigned
        │
        ├─→ rỗng → "Bạn chưa có proxy"
        │         + button [Yêu cầu proxy ngay]
        │
        └─→ có N proxy:
              editMessage("*Proxy của bạn (N/max):*")
              + foreach proxy: 1 inline row
                ┌──────────────────────────────────┐
                │ host:port:user:pass   (HTTP)     │
                │  [Copy] [Bảo hành] [Trả lại]    │
                └──────────────────────────────────┘
              + nút [Quay lại menu]
```

**Đề xuất**: nếu `proxies.length > 5`, gửi file `.txt` với link bấm để xem từng cái (như bulk hiện tại). File path: `format-proxies.ts`.

### Flow 3 — "Kiểm tra proxy" (`menu:check_proxy`)

```
User click [Kiểm tra proxy]
    │
    ├─→ proxies rỗng → "Bạn không có proxy nào để kiểm tra"
    │
    └─→ chọn proxy nào:
        editMessage("Kiểm tra proxy nào?")
        ┌──────────────────────────────────┐
        │ host1:port1 (HTTP)               │
        │ host2:port2 (SOCKS5)             │
        │ ─────────────────                │
        │ Kiểm tra TẤT CẢ                  │
        │      Huỷ                         │
        └──────────────────────────────────┘
              │
              click 1 proxy hoặc "tất cả"
              ↓
        editMessage("Đang kiểm tra…")
        await checkProxy(...) (timeout 10s)
              │
              ↓
        editMessage("Kết quả:\n
                    host:port → [OK] 234ms")
        + button [Kiểm tra lại] [Trả lại proxy] [Quay lại]
```

**Hiện tại** (`check-proxy.ts:38-56`): kiểm tra hết tất cả proxy bằng for-loop tuần tự — chậm O(N×timeout). Cần Promise.all + timeout per proxy.

### Flow 4 — "Limit yêu cầu" (`menu:rate_limit`) — đổi từ /status

User chỉ muốn xem rate-limit (per yêu cầu của user trong prompt). Hiện tại `/status` trả 4 nhóm — quá tải.

```
User click [Limit yêu cầu]
    │
    └─→ load user (rate_limit_*, proxies_used_*, *_reset_at)
        editMessage:
          *Giới hạn yêu cầu*

          Theo giờ: [###-------] 3/10  (reset sau 27 phút)
          Theo ngày:  [#####-----] 5/30  (reset sau 8 giờ)
          Tổng cộng: [##--------] 23/100

          Nút: [Yêu cầu proxy] [Tài khoản chi tiết] [Quay lại]
```

**Đề xuất**: 
- Rename copy "Trạng thái tài khoản" → "Giới hạn yêu cầu" 
- Tách phần `status`/`approval_mode`/`max_proxies` thành 1 button thứ cấp `[Tài khoản chi tiết]` → callback `account:detail`
- Hoặc: gộp vào msg ngắn 5 dòng:
  ```
  Trạng thái: active
  Proxy hiện tại: 3/5
  Theo giờ: 1/10 | Theo ngày: 4/30 | Tổng: 23/100
  Reset giờ: 12 phút
  ```

### Flow 5 — "Bảo hành proxy" (`menu:warranty`) — đổi từ /revoke?

**KHÁC `revoke` về business logic** — đây là nguồn confusion lớn:

| Khái niệm | User intent | Action | Side-effect |
|---|---|---|---|
| `revoke` (hiện tại) | "Tao không dùng nữa, trả lại pool" | `proxy.status = available`, decrement `proxies_used_*` | Proxy về pool ngay, người khác xài tiếp |
| `warranty` (đề xuất mới) | "Proxy này LỖI, đổi cho tao cái khác" | Tạo `warranty_ticket`, freeze proxy → `status=quarantine`, gửi admin → admin xác nhận → cấp proxy mới + không tăng `proxies_used` | Cần state machine + notify admin + có thể tự động (nếu proxy fail health check liên tiếp 3 lần) |

**Recommended UX**:
- "Bảo hành proxy" KHÁC `/revoke`. Cần wireframe riêng:

```
User click [Bảo hành proxy]
    │
    └─→ Chọn proxy lỗi:
        ┌──────────────────────────────────┐
        │ host1:port1 (HTTP)               │
        │ host2:port2 (SOCKS5)             │
        │      Huỷ                         │
        └──────────────────────────────────┘
              │
              click proxy
              ↓
        editMessage("Lý do?")
        ┌──────────────────────────────────┐
        │ Connection timeout               │
        │ Bị block (Cloudflare/site target)│
        │ Tốc độ chậm                      │
        │ Khác (gõ tin nhắn)               │
        └──────────────────────────────────┘
              │
              chọn lý do
              ↓
        ├─→ Auto-check 3 lần (proxy-checker)
        │   ├─→ alive → "Proxy vẫn hoạt động bình thường, vui lòng thử lại"
        │   └─→ dead/slow → tạo warranty_ticket, freeze proxy,
        │                   notify admin, đổi proxy mới (nếu setting auto_warranty=true)
        │
        └─→ Manual flow: tạo ticket pending → admin duyệt
```

**File path**: cần TẠO MỚI `src/lib/telegram/commands/warranty.ts` + table `warranty_tickets` (cột: `id, proxy_id, tele_user_id, reason, status [pending/approved/rejected/auto_replaced], replacement_proxy_id, admin_notes, created_at, processed_at`).

**Effort**: ~6h (handler + table + migration + admin callback + tests).

**Tạm thời (Wave 23B-bot)**: chỉ rename label "Bảo hành proxy" → trỏ vào `/revoke` flow; thêm note "Tính năng bảo hành đầy đủ sẽ có ở Wave 24." Đỡ scope creep.

### Flow 6 — "Lịch sử" (`menu:history`)

```
User click [Lịch sử]
    │
    └─→ fetch 10 yêu cầu gần nhất, ORDER BY created_at DESC
        editMessage:
          *Lịch sử yêu cầu*

          1. HTTP   - Đã duyệt    - 2026-04-28 (ID: ab12cd34)
          2. SOCKS5 - Tự động     - 2026-04-27 (ID: ef56gh78)
          3. HTTP   - Đã huỷ      - 2026-04-26 (ID: ij90kl12)

          [Trang sau] [Quay lại]
```

**Hiện tại** (`history.ts`): không có pagination. Khi user có > 10 request, không thấy được. Cần thêm `offset` callback `history:page:N`.

### Flow 7 — "Hướng dẫn" (`menu:help`)

```
User click [Hướng dẫn]
    │
    └─→ editMessage(t("help", lang))  
        + button [Liên hệ hỗ trợ] [Quay lại]
```

**Hiện tại** (`messages.ts:50-89`): dùng dấu Việt không dấu ("Huong dan", "su dung") — inconsistent với welcome dùng dấu Việt đầy đủ. **Sửa**: dùng UTF-8 đầy đủ dấu.

### Flow 8 — "English / Tiếng Việt" (`menu:lang_toggle`)

```
User click [English]  (hoặc [Tiếng Việt] nếu đang ở en)
    │
    └─→ supabase update language='en'
        editMessage("Language changed to English. ✓")
        gửi lại MENU mới với label English:
          [Request proxy] [My proxies]
          [Check proxy]   [Rate limit]
          [Warranty]      [History]
          [Help]          [Tiếng Việt]
```

**Sự khác biệt với `/language` hiện tại**: hiện tại show 2 button "Tiếng Việt" + "English" để chọn — UX kém vì phải xem 2 button rồi mới chọn. Đề xuất: 1 click toggle (giống Telegram chính thức).

---

## 2. Inconsistency hiện tại — bảng đối chiếu

### 2.1 i18n thiếu chỗ nào

| File:line | Vấn đề | Ví dụ string |
|---|---|---|
| `start.ts:36-57` | Welcome text **inline VN/EN** (không qua `t()`) | `lang === "vi" ? "Xin chao..." : "Hello..."` |
| `start.ts:91-109` | "Cac lenh co san" hardcode trong file | Phải maintain 2 nơi |
| `get-proxy.ts:66-80` | Description HTTP/HTTPS/SOCKS5 inline | Không có key `proxyTypeDescription` trong `messages.ts` |
| `get-proxy.ts:155-156` | "Luu y: Yeu cau > 5 can admin duyet" hardcode | Cần `t("approvalNote")` |
| `cancel.ts:34-45` | "Khong co yeu cau nao dang cho de huy" hardcode | Thiếu key `noPendingRequests` |
| `cancel.ts:50-89` | "Yeu cau dang cho", "Da huy", "Cancelled" inline | 4-5 strings |
| `revoke.ts:34-89` | "Chon proxy muon tra", "Tra tat ca", "Tra proxy thanh cong" inline | 6+ strings không có key |
| `revoke.ts:104-109` | confirmText inline | Có key `revokeConfirmAll` nhưng không dùng! |
| `check-proxy.ts:21-58` | TẤT CẢ message inline ("Dang kiem tra", "Tai khoan bi chan", "Ket qua kiem tra") | 7+ strings |
| `history.ts:29-46` | "Chua co yeu cau", "Lich su yeu cau", status map | 6+ strings |
| `support.ts:23-37` | Toàn bộ message inline | 4 strings |
| `handlers.ts:236-243` | Plain text reply hardcode | "Su dung /help…" |
| `bulk-proxy.ts:73-77` | Bulk partial text duplicated từ `messages.ts:188-190` | Dùng key `bulkPartialAssigned` thay vì copy |
| `admin-approve.ts:159-161` | Proxy assigned msg inline (admin path); duplicates `proxyAssigned` key | Phải dùng `t("proxyAssigned")` + `fillTemplate` |

**Tổng**: ~45 string i18n đang inline thay vì qua `t()`. **Effort fix**: 4-5h.

### 2.2 Copy còn English-cứng (khi user chọn `vi`)

| File:line | Bug |
|---|---|
| `admin-approve.ts:277` | `"Your account has been approved!..."` — gửi cho user VN bằng tiếng Anh |
| `admin-approve.ts:325` | `"Your account has been blocked..."` — gửi cho user VN bằng tiếng Anh |
| `admin-approve.ts:282` | `"[Approved] {username} - approved by {label}"` — message gửi cho user (chứ không phải admin), không lookup language |
| `bulk-proxy.ts:222-225` | "X/Y proxies assigned!" — không lookup user language khi notify ngược |
| `bulk-proxy.ts:277` | `"[X] Your bulk proxy request for…"` — luôn EN, không xét lang |
| `bulk-proxy.ts:118` | adminText là EN-only (đúng — admin xem EN ok) ✓ |
| `assign-proxy.ts:277` | adminText `[!] New proxy request` EN-only (admin xem ok) ✓ |
| `aup.ts:97` | adminText `[New User] {username}…` EN-only (admin ok) ✓ |
| `messages.ts:140` | `unknownCommand` chứa `[X] Lệnh không hợp lệ…` — cần kiểm tra encode |
| `messages.ts:185-187` | `errorOccurred` đã có key, nhưng nhiều nơi log lỗi trả EN cứng |

### 2.3 Button label không nhất quán

| Nơi | Label hiện tại | Đề xuất chuẩn |
|---|---|---|
| `keyboard.ts:6-9` | "HTTP", "HTTPS", "SOCKS5" — giống nhau cả VN/EN ✓ | ok |
| `keyboard.ts:20-21` | "Tiếng Việt", "English" | ok |
| `keyboard.ts:26-31` | "1", "2", "5", "10" — không có "Quay lại"/"Huỷ" | Thêm row 2: `[Quay lại] [Huỷ]` |
| `keyboard.ts:36-37` | "Có"/"Không" vs "Yes"/"No" ✓ | ok |
| `cancel.ts:61-62` | "Co"/"Khong" (no dấu!) — duplicate logic của `confirmKeyboard()` | Dùng `confirmKeyboard(lang)` |
| `revoke.ts:108-109` | "Co"/"Khong" — lại duplicate, không gọi `confirmKeyboard()` | Dùng `confirmKeyboard(lang)` |
| `revoke.ts:76` | "Trả tất cả" / "Return all" | ok |
| `aup.ts:55-56` | "Chấp nhận"/"Từ chối" vs "Accept"/"Decline" ✓ | ok |
| `admin-approve.ts:67-68` | `Approve {name}` / `Reject` — admin EN-only ✓ | ok |
| `start.ts:111-115` | persistent **reply** keyboard với label `/getproxy`, `/myproxies`, … | Bỏ — dùng inline keyboard với label thân thiện |

### 2.4 Callback prefix lộn xộn

| Prefix hiện tại | File handler | Vấn đề |
|---|---|---|
| `aup_accept` (no `:`) | `handlers.ts:84` | Không scalable, dùng `===` thay vì `startsWith` |
| `aup_decline` | `handlers.ts:89` | Tương tự |
| `proxy_type:http` | `handlers.ts:94` | underscore + colon mix |
| `lang:vi` | `handlers.ts:100` | ok |
| `cancel_confirm:yes` | `handlers.ts:106` | underscore (sự kiện confirm thì nên là `cancel:confirm:yes`) |
| `revoke_confirm:all:N` | `handlers.ts:112` | 3 phần — khó parse |
| `revoke:cancel` | `handlers.ts:118` | "cancel" trùng nghĩa với "huỷ revoke" và lệnh `/cancel` |
| `revoke:{proxyId}` | `handlers.ts:130` | Sau khi check `revoke:cancel` rồi mới đến đây — tù mù logic |
| `revoke:all` | trong `handleRevokeSelection` (revoke.ts:136) | Cùng prefix `revoke:` nhưng arg là literal "all" — dễ collide với UUID |
| `admin_approve:{id}` | `handlers.ts:136` | Cùng pattern (underscore) |
| `admin_reject:{id}` | `handlers.ts:142` | |
| `admin_approve_user:{id}` | `handlers.ts:148` | underscore lồng nhau |
| `admin_block_user:{id}` | `handlers.ts:154` | |
| `qty:{type}:{n}` | `handlers.ts:160` | ok |
| `admin_bulk_approve:{id}` | `handlers.ts:170` | dài + underscore |
| `admin_bulk_reject:{id}` | `handlers.ts:176` | |

**Đề xuất chuẩn hoá** (Telegram callback_data có giới hạn 64 bytes):

```
<domain>:<verb>[:<arg1>[:<arg2>]]

domain: menu | proxy | qty | revoke | cancel | warranty | admin | aup | lang | help
verb:   open | back | confirm | yes | no | select | accept | decline | approve | reject

Ví dụ:
menu:open                          → mở menu chính
menu:back                          → về menu chính từ bất cứ submenu
proxy:select:http                  → user chọn HTTP (hiện proxy_type:http)
proxy:qty:http:5                   → 5 proxy HTTP (hiện qty:http:5)
revoke:select:{uuid}               → trả 1 proxy
revoke:all                         → trả tất cả
revoke:confirm:yes                 → xác nhận trả tất cả
cancel:confirm:yes                 → xác nhận huỷ pending
warranty:select:{uuid}             → mở ticket bảo hành
warranty:reason:timeout            → chọn lý do
admin:approve:request:{uuid}
admin:reject:request:{uuid}
admin:approve:user:{uuid}
admin:block:user:{uuid}
admin:bulk:approve:{uuid}
admin:bulk:reject:{uuid}
aup:accept
aup:decline
lang:set:vi
lang:set:en
help:open
history:page:2
```

**File path**: `src/lib/telegram/handlers.ts` (rewrite callback router) + `keyboard.ts` (update tất cả button).

**Effort**: 5h (rewrite + tests).

---

## 3. Đề xuất rename + thống nhất

### 3.1 Copy / label

| Vị trí | Hiện tại | Đề xuất | Lý do |
|---|---|---|---|
| Menu button 1 | `/getproxy` (reply) | "Yêu cầu proxy" | User-friendly, đúng yêu cầu |
| Menu button 2 | `/myproxies` (reply) | "Proxy của tôi" | |
| Menu button 3 | `/checkproxy` (reply) | "Kiểm tra proxy" | |
| Menu button 4 | `/status` (reply) | "Limit yêu cầu" | User chỉ muốn xem rate-limit |
| Menu button 5 | `/revoke` (reply) | "Bảo hành proxy" | Khác business → cần state machine riêng (Wave 24) |
| Menu button 6 | `/history` (reply) | "Lịch sử" | |
| Menu button 7 | `/help` (reply) | "Hướng dẫn" | |
| Menu button 8 | `/language` (reply) | "English"/"Tiếng Việt" toggle | |
| /support → menu? | Không có button | Thêm button `[Liên hệ hỗ trợ]` ở footer welcome | User vẫn tìm cách contact admin |
| /cancel | Có | Bỏ khỏi menu (vẫn giữ slash command); tự động hiện inline khi có pending request | Ít dùng, không đáng chiếm chỗ menu |

### 3.2 Callback data prefix — bảng migration

| Hiện tại (handlers.ts) | Mới (proposed) |
|---|---|
| `proxy_type:http` | `proxy:select:http` |
| `lang:vi` | `lang:set:vi` |
| `cancel_confirm:yes` | `cancel:confirm:yes` |
| `revoke_confirm:all:N` | `revoke:confirm:all:N` |
| `revoke:cancel` | `revoke:back` |
| `revoke:{uuid}` | `revoke:select:{uuid}` |
| `revoke:all` | `revoke:all:execute` |
| `admin_approve:{id}` | `admin:approve:request:{id}` |
| `admin_reject:{id}` | `admin:reject:request:{id}` |
| `admin_approve_user:{id}` | `admin:approve:user:{id}` |
| `admin_block_user:{id}` | `admin:block:user:{id}` |
| `admin_bulk_approve:{id}` | `admin:bulk:approve:{id}` |
| `admin_bulk_reject:{id}` | `admin:bulk:reject:{id}` |
| `qty:{type}:{n}` | `proxy:qty:{type}:{n}` |
| `aup_accept` | `aup:accept` |
| `aup_decline` | `aup:decline` |
| (mới) | `menu:open` |
| (mới) | `menu:back` |
| (mới) | `myproxies:copy:{uuid}` |
| (mới) | `myproxies:warranty:{uuid}` |
| (mới) | `checkproxy:run:{uuid}` |
| (mới) | `checkproxy:run:all` |
| (mới) | `history:page:{n}` |
| (mới) | `account:detail` |

### 3.3 "Limit yêu cầu" — nội dung trả

User nói: "User chỉ muốn xem rate-limit". Đề xuất output:

```
*Giới hạn yêu cầu*

Theo giờ: [###-------] 3/10  (reset: 27 phút)
Theo ngày: [#####-----] 5/30  (reset: 8 giờ)
Tổng cộng: [##--------] 23/100  (giới hạn trọn đời)

Proxy hiện tại: 3/5

[Yêu cầu proxy] [Quay lại]
```

Nếu user cần thêm thông tin: thêm button `[Tài khoản chi tiết]` → callback `account:detail` → show `status`, `approval_mode`, `created_at`, `aup_version`.

### 3.4 "Bảo hành proxy" — quyết định

**Wave 23B-bot (ngắn hạn — 1 ngày)**: 
- Label "Bảo hành proxy" → tạm trỏ vào `/revoke` flow (cùng UI)
- Thêm copy: "Bạn có thể trả proxy lỗi để tự động được cấp proxy mới (rate-limit không tăng)" — cần check global cap chưa max
- Handler: trong `handleRevokeSelection`, nếu user đến từ button warranty thì sau khi `revokeProxy(p.id)` tự động gọi `autoAssignProxy(user, p.type, lang)` → cấp proxy thay thế cùng type. Counter `proxies_used_*` không tăng (logic mới trong RPC).

**Wave 24 (đầy đủ — 1 tuần)**:
- Table `warranty_tickets`
- State machine: `pending → investigating → approved → replaced` hoặc `pending → rejected`
- Auto-warranty: cron + health-check kết hợp; nếu proxy fail 3 lần trong 1h → tự mở ticket
- Refund logic: nếu approved, decrement `proxies_used_total`

---

## 4. Friction points cụ thể trong flow hiện tại

| # | Mô tả | File path | Hậu quả | Effort fix |
|---|---|---|---|---|
| 1 | `/getproxy` không hỏi quantity inline; user phải click qua 2 màn (chọn type → chọn qty) | `get-proxy.ts:81-90`, `bulk-proxy.ts:15` | Mỗi 1 yêu cầu = 3 lượt click + 2 round-trip API | LOW (UX OK, có thể giữ) |
| 2 | `/checkproxy` không option chọn proxy nào để check, kiểm tra TẤT CẢ tuần tự | `check-proxy.ts:38-56` | 5 proxy × 10s timeout = chờ 50s, có thể bị Telegram rate-limit message | MED — `Promise.allSettled` + 1 message edit; thêm option chọn 1 proxy |
| 3 | `/myproxies` chỉ show `host:port:user:pass` không có nút copy | `my-proxies.ts:45-67` | Mobile user phải tap-and-hold để copy text; dài → khó | MED — mỗi proxy 1 inline button copy via `switch_inline_query` |
| 4 | `/myproxies` không pagination | `my-proxies.ts:22` | User có 30 proxy → 1 message dài, vượt 4096 char | MED — pagination hoặc auto-export `.txt` khi > 5 |
| 5 | `/cancel` confirmation chỉ "Có/Không" không cho phép select 1 request cụ thể | `cancel.ts:50-72` | User có 3 yêu cầu pending, lỡ click "Có" → huỷ tất cả | MED — render từng request là 1 button `cancel:select:{id}` |
| 6 | `/revoke` 1 proxy auto-revoke ngay không confirm | `revoke.ts:49-63` | User lỡ tay click → mất proxy luôn, không undo | LOW — thêm 1 step confirm cho safety |
| 7 | `/history` không pagination, hardcode 10 items, không filter theo status | `history.ts:20-26` | User active lâu → không xem được lịch sử cũ | MED — pagination + filter buttons |
| 8 | `/start` cho pending user dán 11 lệnh không dùng được (chỉ /support, /language khả dụng) | `start.ts:38-57` | Confuse — user click /getproxy → bị reject | LOW — đã có `pendingKeyboard` chỉ /support, /language; chỉ cần đồng bộ welcome text |
| 9 | `/support` không có nút "Đính kèm screenshot/log"; user gõ tin nhắn rồi chờ | `support.ts:23-39` | Admin nhận text plain không context | LOW — thêm hint "Bạn có thể gửi ảnh/file kèm" |
| 10 | Welcome text đã chứa "/getproxy - …" và menu keyboard ở dưới có button "/getproxy" — duplicate info | `start.ts:95-116` | Chật + dài | HIGH priority fix |
| 11 | `/start` lưu language EN cho user mới (`user.ts:89: language: "en"`) — kể cả user Telegram VN | `user.ts:89` | User VN thấy welcome English đầu tiên | LOW — detect `from.language_code === "vi"` để init lang đúng |
| 12 | Callback `revoke:cancel` literal "cancel" — collision risk với UUID nếu UUID format chứa từ "cancel" | `handlers.ts:118` | Edge case, low risk nhưng dirty | LOW — đổi sang `revoke:back` |
| 13 | Mọi callback handler tự `select * from tele_users` — N lần roundtrip thay vì middleware load 1 lần | `language.ts:43`, `cancel.ts:78`, `revoke.ts:97`, `bulk-proxy.ts:18`, etc. | Latency, DB load | MED — middleware `attachUser(ctx)` |
| 14 | `proxyAssigned` template không bao gồm credentials nếu null | `messages.ts:102-118` + `assign-proxy.ts:151-159` | Proxy no-auth render `host:port::` (2 dấu `:` thừa) | LOW — template branching trong fillTemplate hoặc dùng `format-proxies.ts` |
| 15 | Không có nút `[Quay lại menu]` ở mọi screen — user phải gõ lại slash command | All command files | UX kém trên mobile | HIGH priority fix |

---

## 5. Wave 23B-bot UX changes — bảng đề xuất

| # | Change | File path | Effort | Business rule | Regression test cần có |
|---|---|---|---|---|---|
| 1 | **Bỏ persistent reply keyboard**, dùng inline 8-button menu | `start.ts:110-121` | 30m | Welcome chỉ có 1 keyboard duy nhất | `commands.test.ts`: assert `reply_markup` là `InlineKeyboard`, không phải `Keyboard` |
| 2 | **Tạo `keyboards/main.ts`** export `mainMenuKeyboard(lang)` 4×2 grid | `src/lib/telegram/keyboards/main.ts` (mới) | 1h | Label "Yêu cầu proxy"/"Proxy của tôi"/… exact theo spec | Snapshot test JSON markup |
| 3 | **Callback router rewrite** — đổi mọi callback sang `<domain>:<verb>[:<args>]` | `handlers.ts:81-184` | 2h | Backward compat: vẫn match prefix cũ trong 2 wave (deprecated path) | Test mọi callback path mới + cũ |
| 4 | **`menu:open`/`menu:back` callbacks** — submenu nào cũng có nút "Quay lại menu" | `handlers.ts` + tất cả command files | 2h | `editMessageText` thay vì `reply` để giữ nguyên 1 message | Test edit không tạo message mới |
| 5 | **Welcome text rút gọn** — bỏ list 11 lệnh, chỉ greeting + status + menu | `start.ts:95-109` | 30m | "Chào @username, tài khoản: active, proxy: 3/5" | Snapshot test text |
| 6 | **i18n consolidation** — extract 45 inline string vào `messages.ts` | `messages.ts` + 14 command files | 4h | Mọi outgoing text đi qua `t(key, lang)` | Test grep `lang === "vi" \?` không còn ngoài `keyboards/` và `messages.ts` |
| 7 | **`/myproxies` mỗi proxy 1 inline row** với nút Copy + Báo lỗi + Trả lại | `my-proxies.ts` (rewrite) + `keyboards/proxy-row.ts` | 3h | `switch_inline_query_current_chat` cho copy; route warranty đến revoke flow | Test với 1, 5, 30 proxy |
| 8 | **`/checkproxy` chọn proxy nào** — list inline + "Tất cả" | `check-proxy.ts` (rewrite) + `keyboards/proxy-select.ts` | 2h | Health-check parallel với `Promise.allSettled` + per-proxy timeout | Test 1 proxy, multi proxy, timeout |
| 9 | **`/status` đổi tên display "Limit yêu cầu"** — chỉ rate-limit, thêm button "Tài khoản chi tiết" | `status.ts:36-77` | 1h | Nội dung gọn 5 dòng | Snapshot text |
| 10 | **"Bảo hành proxy" tạm trỏ /revoke + auto-replace** | `revoke.ts` + RPC mới `revoke_with_replace` | 4h | Khi user dùng warranty entry: revoke + ngay lập tức auto-assign cùng type, không tăng counter | Test counter không tăng, test fail-soft khi pool rỗng |
| 11 | **Callback `lang:set` toggle** — 1 click swap | `language.ts:35-72` + menu | 1h | Update DB, edit menu với label mới | Test toggle vi↔en |
| 12 | **History pagination** với `history:page:N` | `history.ts:20-49` | 1h | LIMIT 10 OFFSET (page-1)*10 | Test page=1, 2, edge cases |
| 13 | **Init lang detect from Telegram** | `user.ts:89` | 15m | `language: from.language_code?.startsWith("vi") ? "vi" : "en"` | Test init với language_code |
| 14 | **`getOrCreateUser` cache trong context** — middleware `attachUser` | `handlers.ts` thêm `bot.use(attachUser)` | 1h | `ctx.user` available cho mọi handler | Test ctx.user populated |
| 15 | **Bỏ welcome list /getproxy, /myproxies trong text** | `start.ts:95-109`, `messages.ts:welcome.vi/en` | 15m | Inline buttons thay text list | Snapshot test |
| 16 | **Encoding cleanup** — convert `à` → UTF-8 thẳng | `messages.ts` (bulk replace) | 30m | File save UTF-8 BOM-less | grep -P `\\u[0-9a-f]{4}` không match |
| 17 | **Standardise prefix `[OK]` `[X]` `[!]` `[i]`** thành 4 tokens duy nhất | `messages.ts` + 14 command files | 1h | Document trong CLAUDE.md (project) | grep tokens chỉ có 4 forms |
| 18 | **Test coverage** — `commands.test.ts` mở rộng cho menu callbacks | `__tests__/commands.test.ts` | 2h | 80% coverage cho tất cả menu callbacks | Coverage report |

**Tổng effort**: ~26h (~3-4 ngày dev fulltime).

**Roadmap chia phase**:
- **Phase 1 (1 ngày)**: #1, #2, #3, #4, #5, #11, #15, #16, #17 — UX fix nhanh, không đụng business logic
- **Phase 2 (1 ngày)**: #6 (i18n), #9, #12, #13, #14
- **Phase 3 (1.5 ngày)**: #7, #8, #10 — feature mới
- **Phase 4 (0.5 ngày)**: #18 — test

---

## 6. File structure — tách `keyboard.ts`?

### 6.1 Hiện tại

```
src/lib/telegram/
├── bot.ts                    16 lines
├── handlers.ts              268 lines  ← router lớn
├── keyboard.ts               43 lines  ← 4 export functions
├── messages.ts              208 lines  ← 27 i18n keys
├── user.ts                  116 lines
├── notify-admins.ts         152 lines
├── format-proxies.ts         20 lines
├── logging.ts                71 lines
├── send.ts                   ~80 lines
├── revoke.ts                 ~60 lines
├── rate-limit.ts            ~150 lines
├── ip-whitelist.ts          ~150 lines
├── webhook-queue.ts         ~120 lines
├── simulator.ts             ~200 lines
└── commands/                14 file (start, help, get-proxy, ...)
```

### 6.2 Đề xuất Wave 23B-bot

```
src/lib/telegram/
├── bot.ts
├── handlers.ts                    ← chỉ register commands + middleware
├── callback-router.ts            ← MỚI — tách callback dispatch
├── middleware/
│   ├── attach-user.ts            ← MỚI — load ctx.user 1 lần
│   └── log-incoming.ts           ← MỚI — log incoming command
├── keyboards/                    ← THAY thế keyboard.ts
│   ├── index.ts                  ← re-export
│   ├── main.ts                   ← mainMenuKeyboard(lang) — 4×2 grid 8 button
│   ├── proxy-type.ts             ← HTTP/HTTPS/SOCKS5 + huỷ
│   ├── quantity.ts               ← 1/2/5/10 + back/huỷ
│   ├── confirm.ts                ← Yes/No
│   ├── language.ts               ← VN/EN
│   ├── proxy-row.ts              ← Copy/Báo lỗi/Trả lại cho 1 proxy
│   ├── proxy-select.ts           ← list proxy để select (dùng cho check, revoke, warranty)
│   ├── pagination.ts             ← Trước/Sau
│   └── back.ts                   ← util `backToMenuRow()`
├── messages.ts                   ← all keys + helpers
├── i18n/                         ← OPTIONAL nếu messages.ts > 500 lines
│   ├── vi.ts
│   ├── en.ts
│   └── index.ts
├── commands/                     ← giữ structure hiện tại
│   └── ...
└── ...
```

### 6.3 Lý do tách `keyboards/`

| Pro | Con |
|---|---|
| ✓ Multi-dev: 2 người sửa 2 keyboard không đụng nhau | ✗ Thêm 9 file |
| ✓ Test isolation: snapshot test từng keyboard riêng | ✗ Import path dài hơn |
| ✓ Tránh circular dep khi keyboards cần i18n | — |
| ✓ Dễ tìm: "menu chính ở đâu?" → `keyboards/main.ts` | — |
| ✓ Mỗi file < 50 lines (theo `coding-style.md` <50 lines/function, <800/file) | — |

**Quyết định**: TÁCH. Effort thêm ~30m so với giữ 1 file. Lợi ích long-term lớn.

### 6.4 `messages.ts` tách `i18n/`?

Hiện tại 208 lines, 27 keys. **Khuyến nghị**: chưa cần tách `i18n/{vi,en}.ts` ở Wave 23B-bot. Khi consolidate xong (Phase 2 #6) sẽ ~80 keys + ~400 lines — vẫn dưới 800 limit. Tách khi vượt 500 lines hoặc khi thêm ngôn ngữ thứ 3.

---

## 7. Regression risk matrix

| Change | Rủi ro | Mitigation |
|---|---|---|
| Bỏ reply keyboard | User cũ quen gõ `/getproxy` bằng button reply → bị mất | Slash commands vẫn register → user vẫn gõ được. Telegram menu (3 gạch) vẫn show command list |
| Đổi callback prefix | Callback đang in-flight (pre-deploy) sẽ orphan | `handlers.ts` keep cả prefix cũ + mới trong 2 wave (deprecated branch) |
| `[Bảo hành]` trỏ /revoke + auto-replace | Pool rỗng → user mất proxy không có thay thế | Fail-soft: nếu auto-assign fail, restore proxy về assigned cho user cũ; show error |
| i18n consolidation | Dấu Việt encode sai → render lỗi | E2E snapshot test mọi reply text trên VN simulator |
| Welcome text rút gọn | User mới không biết có command gì khác | `/help` vẫn list đầy đủ; menu hiển thị 8 button chính |
| `getOrCreateUser` middleware | Concurrency: 2 message gần nhau cùng tạo user | Đã có `INSERT ... ON CONFLICT` ngầm? Kiểm tra `user.ts:68` — hiện dùng `select` rồi `insert`, có race. Mig riêng, không scope wave này |

---

## 8. Quick wins (1-2 hour, ship first)

Nếu ngắn thời gian, ưu tiên 3 thứ này:

1. **Bỏ persistent reply keyboard** trong `start.ts` — đó là root cause 2 keyboard chồng. **Effort 15m**.
2. **Thay `Keyboard()` bằng `InlineKeyboard()`** với 8 button label tiếng Việt như spec. **Effort 1h**.
3. **Welcome text rút gọn** từ 13 dòng còn 4 dòng (greeting + status + "Chọn chức năng:"). **Effort 15m**.

Sau 3 thay đổi: user thấy 1 màn hình, 1 keyboard, 8 button rõ ràng → sạch sẽ ngay.

---

## 9. Acceptance criteria — Wave 23B-bot done khi

- [ ] `/start` chỉ render 1 inline keyboard 8 button, không có reply keyboard
- [ ] 8 button label đúng theo spec (kể cả khi user ở mode `en`)
- [ ] Mọi submenu có nút "Quay lại menu"
- [ ] Mọi callback prefix tuân chuẩn `<domain>:<verb>[:<args>]`
- [ ] `messages.ts` chứa ≥ 80 keys, không còn `lang === "vi" ?` ngoài `keyboards/` và i18n file
- [ ] `/myproxies` mỗi proxy có nút Copy + Báo lỗi + Trả lại
- [ ] `/checkproxy` cho phép chọn proxy nào để check
- [ ] "Bảo hành proxy" → /revoke + auto-replace cùng type, không tăng counter
- [ ] "Limit yêu cầu" gọn 5-7 dòng, có "Tài khoản chi tiết" button
- [ ] Test coverage ≥ 80% cho mọi handler menu callback
- [ ] Encoding UTF-8 sạch (`grep -P '\\u[0-9a-f]{4}' messages.ts` empty)
- [ ] No `console.log` trong `src/lib/telegram/**` (per `coding-style.md`)

---

## 10. Open questions cần user xác nhận

1. **"Bảo hành proxy" Wave 23B-bot làm thế nào?** 
   - Option A (1 ngày): trỏ /revoke + auto-replace cùng type, đánh dấu `revoke_reason='warranty'`
   - Option B (1 tuần): table mới + state machine + admin approval flow
2. **"Limit yêu cầu" gồm những gì?**
   - Option A: chỉ 3 progress bar (theo giờ/ngày/tổng)
   - Option B: 3 bar + status + max_proxies (như hiện tại nhưng UI gọn hơn)
3. **/cancel có giữ không?**
   - Option A: bỏ khỏi menu, giữ slash command
   - Option B: thêm vào menu thành button thứ 9 → grid 3×3
4. **/support có button menu không?**
   - Option A: button thứ 9 trong menu
   - Option B: button "Liên hệ hỗ trợ" footer trong welcome
5. **Welcome trang khi user PENDING approval — menu khác?**
   - Hiện tại: chỉ /support, /language. Có cần đổi label sang "Hỗ trợ", "Đổi ngôn ngữ" không?

---

## 11. Phụ lục — file inventory đã đọc

| File | Lines | Note |
|---|---|---|
| `src/lib/telegram/bot.ts` | 16 | Token check + Bot init |
| `src/lib/telegram/handlers.ts` | 268 | Router callback + text — mục tiêu rewrite Phase 1 |
| `src/lib/telegram/keyboard.ts` | 43 | 4 functions — tách thành `keyboards/` |
| `src/lib/telegram/messages.ts` | 208 | 27 i18n keys — sẽ + 50 keys |
| `src/lib/telegram/user.ts` | 116 | getOrCreateUser + getUserLanguage |
| `src/lib/telegram/notify-admins.ts` | 152 | Promise.allSettled + admin check |
| `src/lib/telegram/format-proxies.ts` | 20 | text + buffer formatters |
| `src/lib/telegram/logging.ts` | 71 | logChatMessage + logActivity (sanitised) |
| `src/lib/telegram/commands/start.ts` | 132 | **Reply keyboard** — fix priority |
| `src/lib/telegram/commands/help.ts` | 56 | help + unknownCommand |
| `src/lib/telegram/commands/get-proxy.ts` | 161 | proxy type → quantity flow |
| `src/lib/telegram/commands/my-proxies.ts` | 82 | List proxies |
| `src/lib/telegram/commands/status.ts` | 86 | 4 nhóm dữ liệu — gọn lại |
| `src/lib/telegram/commands/language.ts` | 72 | language select + apply |
| `src/lib/telegram/commands/cancel.ts` | 122 | cancel pending requests |
| `src/lib/telegram/commands/revoke.ts` | 204 | revoke 1 / all |
| `src/lib/telegram/commands/check-proxy.ts` | 62 | health check tuần tự |
| `src/lib/telegram/commands/history.ts` | 50 | 10 gần nhất, không pagination |
| `src/lib/telegram/commands/support.ts` | 41 | text-only |
| `src/lib/telegram/commands/aup.ts` | 125 | AUP gate flow |
| `src/lib/telegram/commands/admin-approve.ts` | 339 | Admin callback |
| `src/lib/telegram/commands/bulk-proxy.ts` | 286 | Quantity → bulk assign |
| `src/lib/telegram/commands/assign-proxy.ts` | 282 | autoAssign + manualRequest |
| `src/lib/telegram/commands/index.ts` | 25 | barrel |
| `src/lib/constants.ts:21-34` | — | BOT_COMMANDS list |

---

> **Reviewer note**: Document này là input cho `WAVE23_PLAN.md` mục Bot UX. Sau khi user xác nhận open questions ở mục 10, lock plan và bắt đầu Phase 1 (3 quick wins).
