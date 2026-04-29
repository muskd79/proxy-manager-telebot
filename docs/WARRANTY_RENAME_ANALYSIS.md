# Phân tích: đổi nhãn "Báo lỗi" → "Bảo hành"

**Ngày**: 2026-04-29
**Scope**: project proxy-manager-telebot
**TL;DR**: hiện KHÔNG có hệ thống warranty thật. "Báo lỗi" chỉ là **label hiển thị** của enum `proxy.status = 'banned'`, do **admin set thủ công**. User trên bot KHÔNG có nút báo lỗi — `/revoke` chỉ trả proxy về pool. Đổi tên thuần là cosmetic; muốn đúng nghĩa "bảo hành" phải build module mới (xem Option B). **Đề xuất: Option C** (label "Bảo hành" + giữ admin-set workflow + thêm trường `vendor_fault_reason` + nút "Hoàn quota" cho user).

---

## 1. Hiện trạng — KHÔNG có warranty system

### 1.1. Enum & state machine
- `ProxyStatus.Banned` (`src/types/database.ts:27`) tồn tại trong DB enum.
- State machine `src/lib/state-machine/proxy.ts` chỉ cho phép:
  - `assigned → banned` (admin/bot mark dead sau ban report)
  - `banned → maintenance` (re-check trước khi revive)
- KHÔNG có state nào tên `pending_warranty`, `warranty_claimed`, `replaced`, etc.

### 1.2. Label nguồn
- `src/lib/proxy-labels.ts:72` → `STATUS_LABEL.banned = "Báo lỗi"`
- `src/lib/glossary.ts:92` → cùng label, đã chốt qua glossary 5-agent review
- `src/components/proxies/proxy-filters.tsx:55` → filter dropdown
- `src/lib/__tests__/proxy-labels.test.ts:52,103` → test pinning string

### 1.3. /revoke business logic (KHÔNG phải warranty)
File: `src/lib/telegram/commands/revoke.ts`, RPC: `safe_revoke_proxy` (mig 029).

Flow user trên bot:
1. User gõ `/revoke` → bot show keyboard chọn proxy nào trả.
2. User chọn → RPC `safe_revoke_proxy(p_proxy_id, p_user_id)` chạy atomic trong 1 transaction:
   - `UPDATE proxies SET status='available', assigned_to=NULL, assigned_at=NULL` (đk: assigned_to=user, status=assigned)
   - `UPDATE tele_users SET proxies_used_total = GREATEST(0, ... - 1)` (giảm rate-limit counter)
3. Trả về thành công → log activity `proxy_revoked`.

**Kết quả**: proxy về pool ngay, status `available`, KHÔNG có ticket nào tạo cho admin review. KHÔNG mark `banned`. KHÔNG có lý do/note. Đây là "trả proxy", không phải "báo lỗi".

### 1.4. Status `banned` được set ở đâu?
- `src/app/api/proxies/[id]/route.ts` (admin PATCH)
- `src/app/api/proxies/bulk-edit/route.ts` (admin bulk edit)
- KHÔNG có code path nào từ bot user gây ra `status=banned`.

→ **"Báo lỗi" hiện chỉ là admin housekeeping label**, không phải user-facing action.

---

## 2. Sibling VIA — có warranty system thật

Path: `C:\Users\Admin\Documents\quản lý via, giao via và gửi via qua bot tele\`

### 2.1. Migrations (11 files có "warranty" trong tên)
- `020_warranty.sql` — bảng `warranty_claims`, `vias.warranty_status`
- `021_warranty_atomic_rpc.sql` — `approve_warranty_claim()`
- `022_create_warranty_claim_rpc.sql` — `create_warranty_claim()`
- `041_fix_warranty_approve_via_status.sql`
- `075_warranty_fk_cascade.sql`
- `078_warranty_claims_unique_pending.sql`
- `095_warranty_distribution_source.sql`
- `115_user_limits_warranty_auto.sql`
- `129_warranty_order_codes.sql`
- `156_bot_files_warranty_trigger.sql`
- `173_warranty_filters_and_cron_index.sql`

### 2.2. Schema VIA (mẫu để port nếu chọn Option B)
```sql
CREATE TABLE warranty_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  via_id UUID REFERENCES vias(id),
  claimed_by TEXT NOT NULL,                  -- telegram_id
  claimed_username TEXT,
  reason TEXT NOT NULL,
  status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','auto_replaced')),
  admin_note TEXT,
  replacement_via_id UUID REFERENCES vias(id),
  is_free BOOLEAN DEFAULT true,
  price NUMERIC DEFAULT 0,
  processed_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  processed_at TIMESTAMPTZ
);
ALTER TABLE vias ADD COLUMN warranty_status TEXT DEFAULT 'none';
```

### 2.3. Flow VIA (admin review queue)
- User gửi `/baohanh <uid> <lý do>` → RPC `create_warranty_claim()` set `vias.status='reported'`, `warranty_status='claimed'`, INSERT 1 row pending.
- Admin xem tab `requests/warranty` (`src/app/(admin)/requests/warranty/page.tsx`).
- Approve → RPC `approve_warranty_claim()` lock pending claim, claim 1 via available làm thay thế, mark via gốc `warranty_status='replaced'`, push distribution_history. Reject → set status='rejected' + admin_note.
- UI: `WarrantyTabContent.tsx`, `useWarrantyData.ts`, `useWarrantyActions.ts`, `/api/warranty`, `/api/warranty/bulk`.

→ VIA có flow đầy đủ: **claim ticket → admin review → approve/reject → atomic replacement**.

---

## 3. Khác biệt nghĩa "Báo lỗi" vs "Bảo hành"

| Khía cạnh | "Báo lỗi" (báo bug) | "Bảo hành" (warranty claim) |
|-----------|---------------------|------------------------------|
| Trigger | User/admin nhận ra lỗi | User claim đòi quyền |
| Hành động | Log + remove | Claim ticket, admin xét |
| Latency | Instant | Async (chờ admin) |
| Outcome | Đánh dấu dead, archive | Replace / refund / reject |
| Cần lý do? | Optional | **Bắt buộc** |
| Cần admin? | Không (auto) | **Bắt buộc** |
| Tài chính | Không | Có thể có (free/paid replacement) |

→ Đây là **khác biệt business**, không chỉ UX. "Bảo hành" implies **quyền lợi**, "báo lỗi" chỉ là **report**.

---

## 4. Ba phương án

### Option A — chỉ đổi label (cosmetic only)
Sửa string ở 5 chỗ:
- `src/lib/proxy-labels.ts:72` `banned: "Báo lỗi"` → `"Bảo hành"`
- `src/lib/glossary.ts:21,92`
- `src/components/proxies/proxy-filters.tsx:55,172`
- `src/lib/proxy-labels.ts:160,167,187`
- `src/lib/__tests__/proxy-labels.test.ts:52,103` (sửa expected string)

**Effort**: 30 phút.
**Pro**: trivial, low risk.
**Con**: **sai về nghĩa**. User thấy "Bảo hành" sẽ kỳ vọng được replace/refund, nhưng admin chỉ archive. Reputation risk + customer complaint. Không có form claim, không có queue. Tệ hơn cả giữ nguyên.

### Option B — full warranty system (port từ VIA)
Port toàn bộ module VIA warranty.

**Schema mới**:
```sql
-- migrations/047_wave23b_warranty_claims.sql
CREATE TABLE proxy_warranty_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proxy_id UUID NOT NULL REFERENCES proxies(id) ON DELETE RESTRICT,
  tele_user_id UUID NOT NULL REFERENCES tele_users(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 5 AND 500),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','auto_replaced','expired')),
  admin_note TEXT,
  replacement_proxy_id UUID REFERENCES proxies(id),
  refund_quota INTEGER DEFAULT 0,           -- nếu refund quota thay vì replace
  is_free BOOLEAN DEFAULT true,
  processed_by UUID REFERENCES admins(id),
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_warranty_claims_status ON proxy_warranty_claims(status)
  WHERE status = 'pending';
CREATE INDEX idx_warranty_claims_user ON proxy_warranty_claims(tele_user_id);
CREATE INDEX idx_warranty_claims_proxy ON proxy_warranty_claims(proxy_id);
CREATE UNIQUE INDEX uniq_pending_claim_per_proxy
  ON proxy_warranty_claims(proxy_id) WHERE status = 'pending';

-- proxies thêm warranty_status để badge UI
ALTER TABLE proxies ADD COLUMN warranty_status TEXT DEFAULT 'none'
  CHECK (warranty_status IN ('none','claimed','replaced','rejected'));

-- proxy_status cần thêm value mới
-- Cập nhật state-machine: assigned -> pending_warranty -> banned|available
ALTER TYPE proxy_status ADD VALUE IF NOT EXISTS 'pending_warranty';
```

**State machine update** (`src/lib/state-machine/proxy.ts`):
```
assigned        -> pending_warranty (user claim)
pending_warranty -> banned          (admin approve, original dead)
pending_warranty -> available       (admin reject)
pending_warranty -> assigned        (admin auto-replace, original chuyển banned)
```

**Code surface mới**:
- `src/app/api/warranty/route.ts`, `/api/warranty/bulk`
- `src/app/(dashboard)/requests/warranty/page.tsx` (admin review queue)
- `src/lib/telegram/commands/baohanh.ts` — `/baohanh <proxy_id> <lý do>`
- `src/lib/telegram/keyboards/warranty.ts`
- 2 RPC: `create_proxy_warranty_claim()`, `approve_proxy_warranty_claim()`
- Bulk approve/reject pattern từ VIA `useWarrantyActions.ts`

**Effort**: 2-3 tuần (1 dev). **Migrations** ~5, **service layer** ~6 files mới, **UI** ~4 components, **tests** ~10 files.
**Pro**: đúng nghĩa, professional, support được vendor reseller flow (xem `vendor_reseller_status.md` trong memory — Wave 20+).
**Con**: lớn, cần planner agent + tdd-guide. Có thể block waves khác.

### Option C — hybrid (đề xuất)
Label đổi `"Bảo hành"`, giữ workflow đơn giản hiện tại nhưng thêm 2 thứ:

1. **Lý do tuỳ chọn**: bot `/revoke` nhận thêm callback chọn `Trả proxy` (giữ nguyên) hoặc `Báo proxy lỗi` → flow thứ 2 tạo light-weight ticket.
2. **Refund quota**: admin xem ticket, nếu xác nhận lỗi vendor → bấm "Hoàn quota" → tăng `tele_users.proxies_used_total - 1` (đã có pattern trong `safe_revoke_proxy`). Reject → no-op.

**Schema tối giản**:
```sql
-- migrations/047_wave23b_warranty_lite.sql
CREATE TABLE proxy_warranty_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proxy_id UUID NOT NULL REFERENCES proxies(id) ON DELETE RESTRICT,
  tele_user_id UUID NOT NULL REFERENCES tele_users(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 3 AND 300),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','refunded','rejected')),
  admin_note TEXT,
  refunded_quota BOOLEAN DEFAULT false,
  processed_by UUID REFERENCES admins(id),
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_warranty_claims_pending ON proxy_warranty_claims(status)
  WHERE status = 'pending';
CREATE UNIQUE INDEX uniq_pending_claim_per_proxy
  ON proxy_warranty_claims(proxy_id) WHERE status = 'pending';

-- KHÔNG cần thêm proxy_status enum value, KHÔNG cần state machine mới
-- KHÔNG cần warranty_status column (status badge "Bảo hành" = banned label)
```

**Flow C**:
1. User `/revoke` thấy 2 nút: `Trả proxy` (như cũ → status=available) | `Báo lỗi & yêu cầu bảo hành` (status=banned + tạo claim row pending).
2. Admin tab `Yêu cầu / Bảo hành` thấy queue → 1 nút "Hoàn quota" (`-1 proxies_used_total` + claim status=refunded), 1 nút "Từ chối" (claim status=rejected, proxy giữ banned).
3. Label `banned` trên admin proxy table = **"Bảo hành"** (badge destructive). Nếu muốn phân biệt `banned-có-claim` vs `banned-no-claim` → join `proxy_warranty_claims` LATEST.

**Effort**: 4-5 ngày.
- 1 migration
- 1 RPC `create_warranty_claim`
- 1 RPC `refund_warranty_quota`
- Bot: thêm callback handler `revoke_warranty:<proxyId>`
- Admin UI: 1 page `/requests/warranty` đơn giản (không cần bulk, không cần auto-replace)
- Tests: ~5 file

**Pro**:
- Đúng nghĩa từ "bảo hành" (có queue, có lý do, có quyết định admin).
- Không touch state machine (giữ enum 5 trạng thái) → ít regression.
- Reuse pattern `safe_revoke_proxy` đã atomic.
- Mở đường cho Option B sau (auto-replace) — chỉ cần thêm `replacement_proxy_id` + RPC.
**Con**:
- Không có auto-replace như VIA → user phải chờ admin.
- Vẫn yêu cầu sửa label test ở 5 chỗ.

---

## 5. Đề xuất: chọn Option C

**Lý do**:
1. **Option A là trap** — user kỳ vọng quyền lợi, dev không deliver, complaint sẽ tăng. Đặc biệt nguy hiểm khi memory note `vendor_reseller_status.md` cảnh báo Wave 20+ đụng vendor ToS.
2. **Option B là overkill** cho giai đoạn hiện tại (Wave 17 còn chưa xong, Wave 18A/19/20 đang queue per `wave_roadmap.md`). Spend 3 tuần vào module mới sẽ lùi roadmap.
3. **Option C là đầu tư đúng** —
   - Effort 4-5 ngày = 1 wave nhỏ (đặt tên Wave 23B-warranty-lite).
   - Đặt foundation: bảng `proxy_warranty_claims`, RPC pattern, admin tab. Sau này muốn auto-replace chỉ cần thêm column + RPC, không cần migrate data.
   - Giải quyết gap chính từ `REVIEW_2026-04-28.md` line 107 ("Warranty system: VIA có, Proxy KHÔNG, Cần nếu sell proxy") — vì project đang sell proxy thật.
   - Không phá state machine → ít risk.

**Trình tự đề xuất**:
1. Wave 23B-1: migration + RPC (1 ngày).
2. Wave 23B-2: bot `/revoke` 2-button + handler (1 ngày).
3. Wave 23B-3: admin queue UI tối giản (1.5 ngày).
4. Wave 23B-4: rename label "Báo lỗi" → "Bảo hành" + tests (0.5 ngày).
5. Wave 23B-5: smoke test Playwright + commit message `feat(wave23b): warranty-lite claim queue` (1 ngày).

Sau Wave 17 hardening xong, ưu tiên Wave 23B này TRƯỚC khi đi tiếp Wave 19/20 vendor saga — vì warranty là dependency của vendor adapter (refund flow cần ticket trail).

---

## 6. Risks chung khi rename label

- 3 file test pin string `"Báo lỗi"`. Phải update đồng thời.
- Glossary 5-agent review đã chốt → cần update comment block ở `glossary.ts:21` và `proxy-labels.ts:160,167`.
- Search/filter URL params không dùng label, dùng enum `banned` → backward compat OK.
- Activity log details có thể chứa string cũ → KHÔNG migrate (audit rows immutable).

---

## File paths quan trọng (absolute)

- `C:\Users\Admin\Documents\quản lý proxy trên web và giao proxy qua bot tele cho user tele\proxy-manager-telebot\src\lib\proxy-labels.ts`
- `C:\Users\Admin\Documents\quản lý proxy trên web và giao proxy qua bot tele cho user tele\proxy-manager-telebot\src\lib\glossary.ts`
- `C:\Users\Admin\Documents\quản lý proxy trên web và giao proxy qua bot tele cho user tele\proxy-manager-telebot\src\components\proxies\proxy-filters.tsx`
- `C:\Users\Admin\Documents\quản lý proxy trên web và giao proxy qua bot tele cho user tele\proxy-manager-telebot\src\lib\__tests__\proxy-labels.test.ts`
- `C:\Users\Admin\Documents\quản lý proxy trên web và giao proxy qua bot tele cho user tele\proxy-manager-telebot\src\lib\state-machine\proxy.ts`
- `C:\Users\Admin\Documents\quản lý proxy trên web và giao proxy qua bot tele cho user tele\proxy-manager-telebot\src\lib\telegram\commands\revoke.ts`
- `C:\Users\Admin\Documents\quản lý proxy trên web và giao proxy qua bot tele cho user tele\proxy-manager-telebot\src\lib\telegram\revoke.ts`
- `C:\Users\Admin\Documents\quản lý proxy trên web và giao proxy qua bot tele cho user tele\proxy-manager-telebot\supabase\migrations\029_wave22e1_safe_revoke_proxy.sql`
- VIA reference: `C:\Users\Admin\Documents\quản lý via, giao via và gửi via qua bot tele\supabase\migrations\020_warranty.sql` (+ 021, 022)
- VIA reference: `C:\Users\Admin\Documents\quản lý via, giao via và gửi via qua bot tele\src\app\(admin)\requests\_components\useWarrantyData.ts`
