# WAVE 23 PLAN — proxy-manager-telebot

**Bối cảnh:** Sau review 2026-04-28, đã có 6 audit + 4 tab review. Tổng cộng phát hiện ~80 issue (P0-P3). Wave 23 chia 3 đợt nhỏ A/B/C để ship được an toàn, mỗi đợt tự pass CI.

**Lưu ý quan trọng:** Wave 19/20 vendor stack đã ROLLED BACK ở Wave 21A.5. Wave 23 tập trung **harden manual-only model**, không phải vendor automation.

---

## Wave 23A — Security + DB hardening (3-4 ngày, độ ưu tiên cao nhất)

### Migrations
- `041_drop_duplicate_index.sql` — drop 1 trong 2 index trùng `proxies(created_at DESC, id)` (đọc `015_*` để chọn cái nào giữ)
- `042_rls_initplan_fix.sql` — wrap `is_admin()` thành `(SELECT is_admin())` cho tất cả RLS policies dùng nó (mig 003)
- `043_search_path_hardening.sql` — `ALTER FUNCTION ... SET search_path = public` cho 8 SECURITY DEFINER (`is_admin`, `is_admin_or_viewer`, `get_admin_role`, `decrement_usage`, `increment_login_count`, `get_dashboard_stats`, `safe_assign_proxy`, `bulk_assign_proxies`)
- `044_anon_revoke.sql` — `REVOKE USAGE ON SCHEMA public FROM anon` + explicit deny webhook_dedup, api_rate_limits
- `045_fk_indexes.sql` — index `proxy_requests.proxy_id`, `proxy_requests.approved_by`
- `046_cascade_to_restrict.sql` — `proxy_requests` + `chat_messages` FK đổi CASCADE → RESTRICT (giữ audit trail)
- `047_drop_orphan_indexes.sql` — drop `idx_proxies_purchase_lot` (purchase_lots dropped mig 040), `idx_proxies_isp_trgm` (isp ẩn UI)

### Code fixes
- **Open Redirect** `auth/callback?next=` → validate path bắt đầu `/`, không có `//` — `src/app/api/auth/callback/route.ts:7`
- **Bulk-edit RPC `safe_bulk_edit_proxies`** vẫn UPDATE cột `tags` (đã DROP mig 037) → fix RPC + xóa `tags_add`/`tags_remove` trong Zod schema
- **`/api/health`** trả minimal khi unauthenticated, full khi auth
- **`/api/docs`** thêm auth check (admin only)
- **CSRF `assertSameOrigin`** thêm vào 13 mutation endpoint:
  - proxies: POST, PUT [id], DELETE [id], import, check, probe, probe-batch
  - requests: PUT [id]
  - users: PUT [id], DELETE [id]
  - settings: POST, PUT
  - chat: POST
  - bot-simulator: POST
- **Wire `withCronLock`** vào 5 cron route (cleanup, expire-proxies, expire-requests, health-check, expiry-warning)
- **Supabase error.message redaction** ~15 spot — wrap qua `toClientError()` helper, log full server-side
- **Import error.message leak** trong success response → message generic
- **`recover-2fa` IP rate limit** — thêm vào `auth/recover-2fa/route.ts`
- **`users/route.ts:39`** escape `or()` filter param

### Acceptance
- `npx tsc --noEmit` pass
- `npm test --run` pass (>= 632 tests)
- `npm run build` pass
- Migrations apply sạch trên Supabase staging
- Manual smoke: login → approve request → revoke proxy → logout

---

## Wave 23B — Performance + UX critical (1 tuần)

### Performance
- **Cron expiry-warning N+1** → batch fetch users + Promise.all sendTelegram (cap concurrency 5) — `src/app/api/cron/expiry-warning/route.ts:42`
- **`/checkproxy` bot command** sequential await → Promise.all với concurrency limit — `src/lib/telegram/commands/check-proxy.ts:41`
- **`recharts` dynamic import** — `proxy-chart.tsx` chuyển sang `next/dynamic` (giảm ~200KB initial bundle)
- **React `SortableHead`** trong `proxy-table.tsx:104` move ra ngoài render
- **`i18n.tsx:74`** lazy `useState` initializer thay setState trong useEffect
- **`011_optimize_analytics.sql:23`** — fix `cm.created_at::date = d::date` → `cm.created_at >= d AND cm.created_at < d + interval '1 day'`
- **`useRealtimeChannel` hook** extract từ 8 component → `src/hooks/use-realtime-channel.ts`

### UX critical
- **Tab Proxies — i18n cleanup**:
  - `proxy-detail.tsx` (288 LOC, 100% English) → port qua i18n
  - `proxy-bulk-edit.tsx` (147 LOC) → port qua i18n + bỏ Country disabled
  - Hint "Ctrl+A: Select all..." → vi
- **Tab Users — fix enum drift CRITICAL**:
  - `CreateUserSchema`/`UpdateUserSchema` dùng đúng enum `('active','blocked','pending','banned')`, drop `limited`
  - UI Select sync 4 status
- **Tab Requests — search hoàn toàn dead** → wire `ilike()` trên `host_text` hoặc note vào DB
- **Tab Requests — "View Details" dropdown dead handler** → implement modal/drawer
- **Tab Users — URL state sync** filter/tab/search

### Acceptance
- Lighthouse score web giữ nguyên hoặc cao hơn
- Cron expiry-warning hoàn thành 1000 proxy < 5s
- Bundle size giảm ≥ 150KB

---

## Wave 23C — Service layer + audit (3-4 tuần, refactor lớn)

### Mục tiêu: port pattern từ VIA, giảm route handler từ 600+ LOC xuống <100 LOC

### Service layer
Tạo `src/services/`:
- `requests.service.ts` — `approveSingle()`, `approveBulk()`, `reject()`, `restore()` — gom logic từ `requests/[id]/route.ts:97-310`
- `proxies.service.ts` — CRUD + state transition + bulk assignment
- `users.service.ts` — tele user CRUD + AUP gate
- `admins.service.ts` — admin lifecycle
- `categories.service.ts` — categories
- `notifications.service.ts` — Telegram outbox dispatcher

### Saga refactor
- `notification_outbox` table mới — request approve fanout chuyển vào outbox
- Cron `outbox-drain` worker poll outbox + retry với exponential backoff
- Atomic RPC `approve_request_atomic` — gộp single + bulk path, FOR UPDATE pending guard

### Audit subsystem (port VIA)
- `services/audit/{actions,redactor,query}.service.ts`
- `audit_logs` table mới (hoặc rename `activity_logs` thành `audit_logs`)
- Retention cron — drop record > 90 days
- `/audit` admin UI page (search + filter)

### pgsodium encryption
- Apply migrations để encrypt `proxies.username`, `proxies.password` at rest
- Backfill script
- Service-role-only key access pattern

### Acceptance
- `requests/[id]/route.ts` giảm xuống ≤ 100 LOC
- 80%+ test coverage cho service layer mới
- Audit retention cron chạy ổn định 1 tuần
- pgsodium encryption verified — direct SELECT username trả ciphertext

---

## Sau Wave 23 — Wave 24 candidate

- **Tách 5 god-pages** (profile 838, proxies 567, settings 603, admins 523, requests UI)
- **Playwright E2E** + 5 critical flow (login → 2FA → approve → revoke → logout)
- **OpenAPI auto-gen** từ Zod
- **Domain i18n split**
- **Tab Users compliance**: AUP filter + tab Pending compliance
- **Tab Requests pagination cursor-based**

---

## Cleanup task song song (làm bất cứ khi nào, không gắn wave)

- Delete `src/proxy.ts` (dead, ~70 LOC)
- Delete `src/lib/geoip/` (~120 LOC)
- Delete `src/lib/glossary.ts` (~200 LOC)
- Drop unused exports (4 file)
- Đổi `CategoryFormDialog.tsx` → kebab-case
- Add `vitest --coverage` script
- Mig `041_drop_vendor_pgsodium_key.sql` sau 2026-05-03 (PITR window pass)

---

## Quy trình ship từng wave

Theo `user_communication.md`:
1. `npx tsc --noEmit` clean
2. `npm test --run` 100% pass
3. `npm run build` green
4. Commit theo format `Wave 23A: <summary>`
5. Push lên master
6. Watch GitHub Actions → wait green
7. Vercel auto-deploy → smoke test prod
8. Update memory nếu có decision/insight quan trọng
