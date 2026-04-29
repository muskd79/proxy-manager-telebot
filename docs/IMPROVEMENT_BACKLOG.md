# IMPROVEMENT BACKLOG — proxy-manager-telebot

**Tổng hợp từ 6 audit:** REVIEW (architect) + SECURITY + PERF + CLEANUP + DB + CODE_QUALITY.

**Ranking ICE** = Impact (1-10) × Confidence (1-10) × Ease (1-10, càng dễ càng cao). Cao = ưu tiên cao.

---

## P0 — CRITICAL (làm ngay, blocker)

| ID | Issue | Impact | Conf | Ease | ICE | Source | Effort |
|----|-------|-------:|-----:|-----:|----:|--------|--------|
| P0-1 | **Open Redirect** `auth/callback?next=` chưa validate | 10 | 10 | 10 | **1000** | SEC C-1 | 15 phút |
| P0-2 | **RLS InitPlan** — `is_admin()` chạy 1 lần/row thay vì 1 lần/query → 10k proxies = 10k function call | 10 | 10 | 8 | **800** | DB R1 | 1 giờ |
| P0-3 | **anon role** chưa REVOKE schema public | 10 | 9 | 10 | **900** | DB R2 | 30 phút |
| P0-4 | **search_path** thiếu trên 8 SECURITY DEFINER functions → schema injection | 10 | 9 | 9 | **810** | DB R3 | 1 giờ |
| P0-5 | **2 index trùng** trên `proxies(created_at DESC, id)` — 2× write amplification | 8 | 10 | 9 | **720** | PERF 1A + DB | 30 phút |
| P0-6 | **withCronLock chưa wire** vào 5 cron route → overlap execution | 9 | 10 | 8 | **720** | PERF 4A | 2 giờ |

## P1 — HIGH (1-2 tuần tới)

| ID | Issue | Impact | Conf | Ease | ICE | Source | Effort |
|----|-------|-------:|-----:|-----:|----:|--------|--------|
| P1-1 | **CSRF gap** 13 mutation endpoints thiếu `assertSameOrigin` (proxies POST/PUT/DELETE, requests PUT, users, settings, chat) | 9 | 9 | 9 | **729** | SEC H-2 | 4 giờ |
| P1-2 | **CASCADE DELETE** `proxy_requests` + `chat_messages` từ `tele_users` xóa audit trail | 8 | 10 | 9 | **720** | DB R4-R5 | 1 giờ |
| P1-3 | **Supabase error.message leak** ~15 spots → expose tên bảng/constraint | 8 | 10 | 8 | **640** | SEC H-1 | 3 giờ |
| P1-4 | **Cron expiry-warning N+1** — 100 proxy = 100s sequential, vượt timeout | 9 | 9 | 7 | **567** | PERF 1B | 2 giờ |
| P1-5 | **Apply pgsodium** cho `proxies.username/password` (mig 020 đã prep) | 9 | 9 | 6 | **486** | REVIEW #5 | 1 tuần |
| P1-6 | **FK indexes** thiếu trên `proxy_requests.proxy_id`, `approved_by` | 7 | 10 | 9 | **630** | DB R6-R7 | 30 phút |
| P1-7 | **`/api/health` public** — expose DB connectivity | 7 | 9 | 9 | **567** | SEC H-4 | 30 phút |
| P1-8 | **`recover-2fa` rate limit** thiếu IP-based | 8 | 8 | 8 | **512** | SEC H-5 | 1 giờ |
| P1-9 | **Import error.message leak** trong success response | 7 | 9 | 9 | **567** | SEC H-3 | 1 giờ |
| P1-10 | **React `SortableHead` define trong render** → unmount/remount mỗi sort | 7 | 10 | 9 | **630** | PERF 2C + CODE | 30 phút |
| P1-11 | **`i18n.tsx` setState trong useEffect body** → double-render | 6 | 10 | 10 | **600** | CODE | 15 phút |
| P1-12 | **`recharts` static import** ~200KB gzip — chưa có `dynamic()` ở đâu | 7 | 9 | 8 | **504** | PERF 3A | 1 giờ |

## P2 — MEDIUM (sprint 2-4 tuần)

| ID | Issue | Impact | Conf | Ease | ICE | Source | Effort |
|----|-------|-------:|-----:|-----:|----:|--------|--------|
| P2-1 | **Trích service layer** (port từ VIA) — `requests`, `proxies`, `users`, `admins`, `categories` | 10 | 9 | 3 | **270** | REVIEW #1 | 3-4 tuần |
| P2-2 | **OpenAPI auto-gen** từ Zod, CI gate | 7 | 9 | 7 | **441** | REVIEW #4 | 3-5 ngày |
| P2-3 | **Audit module** port từ VIA + retention cron | 8 | 9 | 5 | **360** | REVIEW #7 | 1-2 tuần |
| P2-4 | **Domain i18n split** | 6 | 8 | 6 | **288** | REVIEW #6 | 1 tuần |
| P2-5 | **27 chỗ `.catch(console.error)`** mất context khi fail | 6 | 10 | 8 | **480** | CODE | 4 giờ |
| P2-6 | **163 `console.*`** trong production → `logger.ts` | 6 | 10 | 7 | **420** | REVIEW + CODE | 1 ngày |
| P2-7 | **Drop 17 `any` types** | 5 | 10 | 8 | **400** | REVIEW + CODE | 4 giờ |
| P2-8 | **`useRealtimeChannel` hook** extract từ 8 component | 6 | 9 | 7 | **378** | CODE | 3 giờ |
| P2-9 | **`stats/analytics` Cache-Control: public** → cross-user cache leak | 8 | 8 | 9 | **576** | SEC M-2 | 30 phút |
| P2-10 | **Vendor schema rollback or finish** Wave 19/20 | 7 | 8 | 4 | **224** | REVIEW #2 | 2-4 tuần |
| P2-11 | **Webhook rate limit** chuyển từ in-memory → Redis/DB | 7 | 9 | 6 | **378** | SEC M-4 | 4 giờ |
| P2-12 | **Tách 5 god-pages** (profile 838, proxies 567, settings 603, admins 523, requests UI) | 7 | 9 | 4 | **252** | REVIEW + CODE | 2-3 tuần |
| P2-13 | **chat_messages trigram index** cho search | 5 | 8 | 8 | **320** | DB R8 | 30 phút |
| P2-14 | **`users/route.ts:39` filter SQL injection** risk qua `or()` string interpolation | 8 | 7 | 8 | **448** | SEC M-1 | 1 giờ |
| P2-15 | **`/api/docs` public** expose schema | 5 | 8 | 9 | **360** | SEC M-5 | 30 phút |

## P3 — LOW (cleanup, nice-to-have)

| ID | Issue | Impact | Conf | Ease | ICE | Source | Effort |
|----|-------|-------:|-----:|-----:|----:|--------|--------|
| P3-1 | Delete `src/proxy.ts` (dead, ~70 LOC) | 3 | 10 | 10 | **300** | CLEANUP | 5 phút |
| P3-2 | Delete `src/lib/geoip/` (~120 LOC, không có caller) | 3 | 9 | 10 | **270** | CLEANUP | 10 phút |
| P3-3 | Delete `src/lib/glossary.ts` (200 LOC, không import) | 3 | 8 | 10 | **240** | CLEANUP | 5 phút |
| P3-4 | Drop unused exports (confirmKeyboard, AUP_VERSION re-export, telegram types) | 3 | 9 | 9 | **243** | CLEANUP | 30 phút |
| P3-5 | `activity_logs` retention cron policy | 6 | 8 | 7 | **336** | DB R9 | 4 giờ |
| P3-6 | Env var validation tập trung (loại 12 `!` non-null) | 4 | 9 | 8 | **288** | CODE QW-4 | 1 giờ |
| P3-7 | `vitest --coverage` script + Codecov | 4 | 10 | 9 | **360** | REVIEW + CODE | 30 phút |
| P3-8 | Đổi `CategoryFormDialog.tsx` về kebab-case | 2 | 10 | 10 | **200** | REVIEW QW | 5 phút |
| P3-9 | Rename `010_*.sql` duplicates (chỉ tài liệu) | 2 | 10 | 5 | **100** | CLEANUP | 30 phút |
| P3-10 | Playwright E2E setup + 3 critical flow | 8 | 9 | 4 | **288** | REVIEW + CODE | 1 tuần |

---

## Tổng kết

- **6 P0** (blocker) — fix trong 1 ngày: tổng ~5 giờ effort
- **12 P1** — fix trong 1 tuần: tổng ~3 ngày effort
- **15 P2** — sprint 2-4 tuần
- **10 P3** — cleanup tích lũy

**Đề xuất Wave 23 sequence:**
- **Wave 23A** = tất cả P0 + P1-1, P1-2, P1-6, P1-7, P1-9, P1-10, P1-11 (security + DB hardening, 2-3 ngày)
- **Wave 23B** = P1-3, P1-4, P1-5, P1-8, P1-12 + một số P2 nhanh (1 tuần)
- **Wave 23C** = P2-1 (service layer) + P2-3 (audit) — refactor lớn (3-4 tuần)
- **Wave 24** = P2-10 (vendor decision) + P2-12 (god-pages split) + P3-10 (E2E)
