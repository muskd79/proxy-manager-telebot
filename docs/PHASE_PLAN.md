# PHASE PLAN — Roadmap nâng cấp dự án proxy-manager-telebot

> Build cho team multi-admin (50 admin) vận hành 5k user Telegram + 50k proxy.
> Tổng effort: **~10 tuần** chia 5 phase + 2 song song.
> Tự critical mỗi phase: trade-off + rủi ro + acceptance criteria rõ ràng.

> Reference 4 reviews:
> - [SCORECARD_2026-05-02.md](SCORECARD_2026-05-02.md)
> - [REVIEW_2026-05-02_SENIOR_DEV.md](REVIEW_2026-05-02_SENIOR_DEV.md)
> - [REVIEW_2026-05-02_SWE_SCALING.md](REVIEW_2026-05-02_SWE_SCALING.md)
> - [REVIEW_2026-05-02_PM_UX.md](REVIEW_2026-05-02_PM_UX.md)
> - [REVIEW_2026-05-02_UI_CONSISTENCY.md](REVIEW_2026-05-02_UI_CONSISTENCY.md)

---

## Tổng quan timeline

```
Week    1   2   3   4   5   6   7   8   9   10
Phase   ▓P1▓ ▓▓P2▓▓ ▓▓P3▓▓ ▓▓▓▓P4▓▓▓▓ ▓▓P5▓▓
        Sec  Scale  UX     Refactor    Polish
```

**Phase song song** (không block timeline chính): observability + i18n sweep.

**Trigger để bắt đầu mỗi phase:** mày nhắn `bắt đầu PX` (X = 1..5).

---

## PHASE 1 — Security Hardening (Tuần 1, ~5 ngày)

### Mục tiêu
Đóng 14 P0 bug Senior Dev tìm ra. Project an toàn cho multi-admin.

### Nội dung

| # | Task | File | Effort |
|---|---|---|---|
| 1.1 | Sweep CSRF: thêm `assertSameOrigin` vào 13 route admin/profile | `api/admins/[id]/*` (4 file), `api/profile/*` (7 file), `api/requests/route.ts` POST | 4h |
| 1.2 | Migrate `admin-approve.ts` callback sang `safe_assign_proxy` RPC (B-007) | `lib/telegram/commands/admin-approve.ts` | 3h |
| 1.3 | Fix `cancel.ts` race: thêm `.eq("status", "pending")` vào UPDATE (B-008) | `lib/telegram/commands/cancel.ts:105` | 30m |
| 1.4 | Fix `cron/expire-requests` race + sequential telegram (B-013, B-020) | `api/cron/expire-requests/route.ts` | 1h |
| 1.5 | Atomic guard cho PUT proxy state (B-009) — RPC `safe_update_proxy_status` | mig 051 + `api/proxies/[id]/route.ts` | 2h |
| 1.6 | Fix `safe_bulk_edit_proxies` thêm `FOR UPDATE` (B-010) | mig 052 | 1h |
| 1.7 | Fix admin-approve user transition (B-022, B-023) — userStatusMachine | `lib/state-machine/user.ts` mới | 2h |
| 1.8 | Sweep search injection: tách `escapePostgrestPattern` helper, dùng ở `proxies/route.ts` (B-012) | `lib/search-helpers.ts` mới | 1h |
| 1.9 | Fix bulk-proxy.ts admin race (B-014) — `.eq("status", "pending")` + `data?.length > 0` check | `lib/telegram/commands/bulk-proxy.ts` | 30m |
| 1.10 | Sweep error.message leak: 6 file (B-016, B-017) | `users/route.ts`, `requests/route.ts`, etc. | 1h |
| 1.11 | Add logActivity vào POST users + POST requests (B-018, B-019) | 2 file | 30m |
| 1.12 | Add rate-limit cho /api/profile/password change (B-026) | `lib/rate-limiter.ts` + route | 1h |
| 1.13 | Tests regression cho 14 P0 — mỗi bug 1 test case | 14 test case mới | 6h |
| 1.14 | Verify build + push + CI green | — | 30m |

### Migrations
- `051_phase1_safe_update_proxy_status.sql` — atomic RPC
- `052_phase1_bulk_edit_for_update.sql` — fix TOCTOU

### Acceptance criteria
- [ ] 14 P0 đóng + tests pass
- [ ] CI green
- [ ] Penetration test giả lập: attacker không CSRF được endpoint admin/profile
- [ ] 2 admin click Approve cùng request → chỉ 1 thành công, 1 bị reject với "already processed"
- [ ] Tổng test count ≥ 700 (hiện 680 + 14)

### Trade-off + rủi ro
- **Rủi ro 1:** RPC `safe_assign_proxy` đã có. Migrate admin-approve.ts có thể break user flow Telegram nếu RPC return shape khác. Mitigation: integration test trên Supabase staging trước.
- **Rủi ro 2:** Sweep CSRF có thể break admin tools nếu env `NEXT_PUBLIC_APP_URL` chưa set đúng. Mitigation: deploy sau 22:00 + smoke test ngay.
- **Trade-off:** không refactor service layer ở phase này → code admin-approve.ts vẫn lớn. Chấp nhận để ship security trước.

### Self-critical
- Phase 1 không cover toàn bộ P1 (12 cái) — chỉ cover P0. P1 đẩy sang Phase 2-3.
- Test cho race condition khó — vitest single-thread khó simulate. Cần test thật trên staging.
- B-011 in-memory dedup KHÔNG giải quyết ở Phase 1 — cần Redis (Phase 2).

---

## PHASE 2 — Scaling Foundation (Tuần 2-3, ~10 ngày)

### Mục tiêu
Move state ra ngoài in-memory. Project chạy được multi-instance Vercel + 1k-2k user.

### Nội dung

| # | Task | Detail | Effort |
|---|---|---|---|
| 2.1 | Setup Upstash Redis (free tier) | + env config | 1h |
| 2.2 | Move webhook dedup từ in-memory Map sang Redis SETEX 24h | `webhook/route.ts:22-50` rewrite | 4h |
| 2.3 | Move webhook rate limit (per chatId) sang Redis sliding window | `webhook/route.ts:117-133` | 4h |
| 2.4 | Move api_rate_limits từ Postgres RPC sang Redis token bucket | `lib/rate-limiter.ts` rewrite | 4h |
| 2.5 | Drop bảng `webhook_dedup` (mig 053) post-cutover | mig 053 | 30m |
| 2.6 | Implement Telegram outbox pattern: bảng `outbox_telegram` + cron worker token bucket 25 msg/s | mig 054 + cron worker | 8h |
| 2.7 | Wire Sentry production (`error-tracking.ts` đã stub, chỉ cần `npm i @sentry/nextjs` + DSN) | + `withSentry` HOC cho mọi route | 3h |
| 2.8 | Materialized view dashboard stats (mig 055) — refresh mỗi 60s qua cron | mig 055 + cron | 4h |
| 2.9 | Materialized view proxy inventory (type/status/country breakdown) (mig 056) | mig 056 + thay `/api/proxies/stats` | 3h |
| 2.10 | Trigram GIN index trên `proxies.host` (mig 057) | mig 057 | 1h |
| 2.11 | TTL cron sweep `bot_conversation_state` 30 min (mig 058) | mig 058 | 1h |
| 2.12 | Health endpoint authenticated (Bearer token) | `api/health/route.ts` | 1h |
| 2.13 | Cron advisory lock đổi sang `pg_try_advisory_xact_lock` (mig 059) | mig 059 + `lib/cron/advisory-lock.ts` rewrite | 3h |
| 2.14 | Tests regression Redis layer + outbox | 15 test case | 8h |
| 2.15 | Load test giả lập 1k webhook/giây (script) | script + observe | 4h |

### Migrations
- 053-059 (7 mig)

### Acceptance criteria
- [ ] Webhook dedup correct cross-region (test bằng Vercel multi-region deploy)
- [ ] Rate limit hit ở Redis, không bị bypass khi >1 instance
- [ ] Sentry capture error real time (test ném error → check dashboard)
- [ ] Dashboard load <2s với 50k proxy seed
- [ ] Trigram search 50k proxy <100ms
- [ ] Outbox queue empty trong 60s với load 1k user concurrent
- [ ] Cost actual sau Phase 2: ~$45-91/tháng

### Trade-off + rủi ro
- **Trade-off 1:** Redis = single point of failure plan rẻ. Mitigation: Upstash multi-region replication (paid). Hoặc fall-back DB nếu Redis down (deg mode).
- **Trade-off 2:** Outbox tăng latency 0.5-2s cho admin notify. Acceptable cho admin (không phải user-facing).
- **Trade-off 3:** Materialized view stale 60s. Admin dashboard có thể outdated 1 phút. Acceptable.
- **Rủi ro:** Migration drop webhook_dedup nếu Redis fail = 24h dedup miss → process trùng. Mitigation: keep table 7 ngày sau cutover, drop ở mig riêng.

### Self-critical
- Phase 2 chưa giải quyết Vercel cold start (200-1200ms). Nếu dùng Edge runtime, grammy 1.41 chưa verify compat. Defer Phase 5.
- Realtime channel cap (Supabase 500 concurrent Pro) chưa giải quyết. Defer Phase 4.
- 50 admin × 4 tab = 200 connection — sát cap. Cần monitoring + alert.

---

## PHASE 3 — UX Cleanup (Tuần 4-5, ~7 ngày)

### Mục tiêu
Xoá dead code, sửa bulk action, IA reorg sidebar. UX professional grade.

### Nội dung

| # | Task | Detail | Effort |
|---|---|---|---|
| 3.1 | DELETE tab `api-docs` khỏi sidebar admin (move sang dev-only route) | sidebar.tsx + page.tsx | 1h |
| 3.2 | DELETE tab `history` page.tsx (đã merge logs, code dead 368 LOC) | gỡ + redirect /history → /logs | 30m |
| 3.3 | DELETE tab `bot/config` stub (cho đến khi build thật) | gỡ + redirect | 30m |
| 3.4 | MERGE `check-proxy` thành sub-tab trong proxies (action "Tái kiểm tra" trên row) | UI restructure | 4h |
| 3.5 | Fix bulk action `/users` — port pattern allSettled từ /proxies | `users/page.tsx` | 3h |
| 3.6 | Sweep confirm dialog: dùng shared `<ConfirmDialog>` thay vì AlertDialog raw + `<DangerousConfirmDialog>` | 8 file | 4h |
| 3.7 | Fix single proxy delete: thêm confirm (B3 UI report) | proxy-table.tsx + proxy-detail.tsx | 1h |
| 3.8 | Fix block/unblock user: thêm confirm | user-table.tsx + users/[id]/page.tsx | 1h |
| 3.9 | Fix dashboard recent-requests Approve/Reject: thêm confirm | recent-requests.tsx | 30m |
| 3.10 | Drill-down dashboard KPI: click "Pending: 23" → /requests?status=pending | dashboard cards | 2h |
| 3.11 | Wire global search header thật (replace UI giả) | header.tsx + new search-results page | 4h |
| 3.12 | IA reorg sidebar theo PM UX recommendation (BOT group riêng, KIỂM TRA xuống sub-tab) | sidebar.tsx | 2h |
| 3.13 | Drag-drop categories thật (replace up/down arrow) | categories/page.tsx + dnd-kit | 4h |
| 3.14 | ProxyBulkEdit thêm field network_type / category / vendor (đang disabled "deferred") | proxy-bulk-edit.tsx + API | 4h |
| 3.15 | Empty state professional cho 8 tab | shared component + per-tab | 3h |
| 3.16 | Toast prefix nhất quán (✓ vs ✅ vs [OK]) — chuẩn hóa toàn bộ | sweep | 2h |
| 3.17 | Skeleton loading nhất quán cho 8 tab thiếu | shared component | 3h |
| 3.18 | Refresh button đầy đủ ở Proxies/Users/Requests/Trash/Bot/Profile | per-tab | 2h |
| 3.19 | Bot welcome text rút gọn — bỏ 11 dòng /cmd duplicate | start.ts | 30m |
| 3.20 | Tests regression UX changes | 20 test case | 6h |

### Acceptance criteria
- [ ] 4 tab dead xoá hết
- [ ] 0 button không có handler
- [ ] Bulk action /users tốc độ tương đương /proxies (Promise.allSettled)
- [ ] 100% destructive action có confirm dialog
- [ ] 100% confirm dialog dùng shared `<ConfirmDialog>` component
- [ ] Dashboard KPI click drill-down hoạt động
- [ ] Search global functional
- [ ] Drag-drop category demo hoạt động

### Trade-off + rủi ro
- **Rủi ro:** Xoá tab có thể break bookmark admin → redirect 301 cẩn thận
- **Trade-off:** ProxyBulkEdit thêm field tốn API thay đổi → cần schema validation update
- **Rủi ro:** Drag-drop dnd-kit thêm bundle size ~30KB → dynamic import

### Self-critical
- Phase 3 không touch service layer — hard-coded fix UI sẽ bị refactor lại Phase 4 → 1 phần effort phí
- Chấp nhận: ship UX trước cho user thấy, refactor sau

---

## PHASE 4 — Service Layer Refactor (Tuần 6-8, ~14 ngày)

### Mục tiêu
Tách 49 route handler nặng thành 18 service file. Code multi-dev friendly.

### Nội dung — theo `ARCHITECTURE_SERVICE_LAYER.md`

#### Sub-phase 4A — Foundation (3 ngày)
| # | Task | Effort |
|---|---|---|
| 4A.1 | `lib/api/errors.ts` — AppError family (port từ VIA) | 2h |
| 4A.2 | `lib/api/response.ts` — okResponse/errorResponse | 2h |
| 4A.3 | `lib/api/sanitize.ts` — error message redactor | 1h |
| 4A.4 | `lib/api/create-handler.ts` — route factory với role/csrf/schema/audit | 6h |
| 4A.5 | Tests cho errors + create-handler | 4h |

#### Sub-phase 4B — Domain services notifications + categories + users + profile (3 ngày)
| # | Task | Effort |
|---|---|---|
| 4B.1 | `services/notifications.service.ts` (gom telegram side-effect) | 4h |
| 4B.2 | `services/categories.service.ts` + migrate `api/categories/*` | 4h |
| 4B.3 | `services/users.service.ts` + migrate `api/users/*` | 4h |
| 4B.4 | `services/profile.service.ts` + migrate `api/profile/*` | 6h |
| 4B.5 | Tests +40 case | 8h |

#### Sub-phase 4C — Heavy lifting proxies + requests (5 ngày)
| # | Task | Effort |
|---|---|---|
| 4C.1 | `services/proxies.service.ts` + `lib/db/proxies.repo.ts` | 8h |
| 4C.2 | Migrate `api/proxies/*` (8 route) | 6h |
| 4C.3 | `services/proxy-import.service.ts` | 4h |
| 4C.4 | `services/proxy-export.service.ts` | 2h |
| 4C.5 | `services/proxy-check.service.ts` | 3h |
| 4C.6 | `services/requests.service.ts` (approveSingle, approveBulk, reject, restore — gom 612 LOC route handler) | 12h |
| 4C.7 | Migrate `api/requests/*` | 4h |
| 4C.8 | Tests +60 case | 12h |

#### Sub-phase 4D — Remaining services + bot + cron (3 ngày)
| # | Task | Effort |
|---|---|---|
| 4D.1 | `services/admins.service.ts` + migrate | 6h |
| 4D.2 | `services/two-factor.service.ts` + migrate | 4h |
| 4D.3 | `services/settings.service.ts` + migrate | 3h |
| 4D.4 | `services/cron.service.ts` + migrate 5 cron route | 4h |
| 4D.5 | `services/audit.service.ts` (port VIA pattern) | 6h |
| 4D.6 | `services/stats.service.ts` (mat-view consumer) | 3h |
| 4D.7 | Tests +40 case | 8h |

### Acceptance criteria
- [ ] 18 service file đầy đủ public function header
- [ ] `requests/[id]/route.ts` ≤ 100 LOC (hiện 612)
- [ ] 100% service throw AppError (không return null/Result mơ hồ)
- [ ] Service layer ≥ 80% test coverage
- [ ] Lint rule: service không import `next/server` / `cookies()`
- [ ] Tổng test count ≥ 850

### Trade-off + rủi ro
- **Rủi ro to nhất:** refactor 612 LOC requests/[id] = bom. Mitigation: ship từng method (approveSingle trước, bulk sau, reject sau). Mỗi method = 1 PR/commit.
- **Trade-off:** 14 ngày refactor không thêm feature mới. Chỉ technical debt payback.

### Self-critical
- Service layer port từ VIA + porting lai pattern Next 16 — có thể không khớp 100%
- Test coverage tăng nhưng E2E vẫn KHÔNG có → Phase 5 cần Playwright

---

## PHASE 5 — Polish + Observability (Tuần 9-10, ~7 ngày)

### Mục tiêu
Production-grade observability + advanced features.

### Nội dung

| # | Task | Effort |
|---|---|---|
| 5.1 | Setup Vercel Log Drain → Axiom (free 500GB/m) | 2h |
| 5.2 | pg_stat_statements bật + dashboard slow query | 2h |
| 5.3 | Sentry Cron Monitoring cho 5 cron route | 2h |
| 5.4 | Better Stack uptime ping `/api/health` (token) mỗi 1m | 1h |
| 5.5 | Custom metric webhook_queue_depth → Sentry transaction | 3h |
| 5.6 | Activity_logs partition by month (mig 060) + drop-partition cron | 6h |
| 5.7 | Proxy_requests partition by quarter (mig 061) | 4h |
| 5.8 | Read replica setup Supabase (Pro Team) cho dashboard reads | 8h |
| 5.9 | Edge runtime cho webhook (verify grammy compat) | 6h |
| 5.10 | Playwright E2E setup + 5 critical flow | 10h |
| 5.11 | jest-dom + 10 component test critical (CategoryPicker, ProxyForm, BulkEdit, Dashboard) | 10h |
| 5.12 | Domain i18n split (`messages/{getproxy,myproxies,auth,admin,common}.ts`) | 6h |
| 5.13 | i18n sweep — fix 45 string thiếu | 4h |
| 5.14 | OpenAPI auto-gen từ Zod (bỏ openapi.ts 1213 LOC) | 6h |
| 5.15 | Tests +50 case | 8h |

### Migrations
- 060 (activity_logs partition)
- 061 (proxy_requests partition)

### Acceptance criteria
- [ ] Sentry capture mọi unhandled error
- [ ] Axiom log retention 30d
- [ ] Slow query alert <200ms threshold
- [ ] Playwright 5 flow CI gate
- [ ] Component test ≥10 cho UI critical
- [ ] OpenAPI auto-gen sync với route
- [ ] Tổng test count ≥ 950

### Trade-off + rủi ro
- **Rủi ro:** Edge runtime grammy compat — có thể cần fork hoặc downgrade
- **Rủi ro:** Read replica race condition — bulk_assign có thể thấy stale read. Mitigation: route critical write→primary, read→replica
- **Trade-off:** Activity_logs partition cần migration plan zero-downtime

### Self-critical
- Phase 5 nhiều task technical — không có feature user-facing. Có thể xen kẽ với Wave warranty (Phase 6) nếu cần
- Playwright cần Chromium download → CI cache

---

## PHASE SONG SONG (xuyên suốt)

### A — Quick wins (làm bất cứ lúc nào, trong ngày là xong)

| # | Task | Effort |
|---|---|---|
| QW1 | Delete `src/proxy.ts` (dead, 70 LOC) | 5m |
| QW2 | Delete `src/lib/geoip/` (~120 LOC) | 10m |
| QW3 | Delete `src/lib/glossary.ts` (~200 LOC) | 5m |
| QW4 | Delete `src/lib/telegram/commands/aup.ts` (đã unwire) | 5m |
| QW5 | Đổi `CategoryFormDialog.tsx` → kebab-case `category-form-dialog.tsx` | 30m |
| QW6 | `vitest --coverage` script + Codecov badge | 30m |
| QW7 | Mig drop `vendor_credentials_key` pgsodium key (sau PITR window) | 30m |
| QW8 | env validation tập trung (loại 12 `!` non-null) | 1h |

### B — Maintenance ongoing

- Update `docs/CHANGELOG.md` mỗi wave ship
- Run `npm test --run` + `npm run build` trước mỗi commit
- Watch GitHub Actions CI sau push
- Watch Sentry dashboard sau Phase 2

---

## Tổng hợp metric mục tiêu sau Phase 5

| Metric | Trước (now) | Sau Phase 5 |
|---|---|---|
| Tổng điểm | 60/100 | **85/100** |
| LOC | 45,355 | ~55,000 (+service layer) |
| Test files | 62 | **120+** |
| Test count | 680 | **950+** |
| Bug P0 | 14 | **0** |
| Bug P1 | 12 | **0** |
| Bug P2-P3 | 30+ | **<10** |
| File >800 LOC | 5 | **0** (split) |
| Function >50 LOC | 10+ | **<3** |
| In-memory state | 5 chỗ | **0** (Redis) |
| Tab dead/stub | 4 | **0** |
| Confirm dialog patterns | 3 | **1** (shared) |
| Service layer files | 0 | **18** |
| Cost/m | $0 (Free) | $240-280 (5k user) |
| Tải max chứa | <500 user | **5,000 user** |
| Concurrent admin | <10 | **50** |

---

## Recheck — phản biện kế hoạch

> Trước khi chốt plan, tự hỏi 7 câu:

**Q1: "Phase 1 có thực sự fit 5 ngày không?"**
- 14 P0 × ~30m-3h = ~25h tổng. 5 ngày = 40h. Buffer 15h cho test + integration. **Fit.**

**Q2: "Phase 2 có blocking nhau không?"**
- Redis setup (2.1) → block 2.2-2.5. Phải làm tuần tự.
- Outbox (2.6) độc lập, có thể parallel.
- Materialized view (2.8-2.9) độc lập với Redis.
- Sentry (2.7) độc lập.
- **Có thể parallel 2.6 + 2.7 + 2.8 + 2.9 + 2.10 + 2.11.**

**Q3: "Phase 3 có thực sự cần thiết trước Phase 4 không?"**
- Có. UX cleanup làm sạch trước khi refactor — tránh refactor code bị xóa
- Trade-off: Phase 3 hard-coded fix có thể bị refactor lại trong Phase 4. Effort overlap ~10%

**Q4: "Phase 4 14 ngày có đủ không?"**
- Refactor 49 route → 18 service. Conservative est: 1 service/ngày = 18 ngày
- Nếu pair work + parallel = 14 ngày
- **Tight. Có thể slip thành 16-17 ngày.**

**Q5: "Phase 5 nên hay không?"**
- Phase 5 không user-facing → có thể defer nếu time pressure
- Nhưng observability là bảo hiểm — production error không Sentry = mù
- **Nên giữ.**

**Q6: "Có gì missing trong plan?"**
- Bot Wave 26 warranty (rename Bảo hành proxy thành flow thật) chưa có trong 5 phase
- Vendor adapter (Wave 19/20 đã rollback) — nếu user muốn bring back → wave riêng
- Multi-tenant (org_id) — chưa có trong plan vì user chưa request
- Mobile app native — không trong scope

**Q7: "Plan có tổn thất gì nếu skip phase?"**
- Skip Phase 1 → KHÔNG ĐƯỢC. Security gap chí mạng.
- Skip Phase 2 → giới hạn 500 user. OK nếu mày chỉ chạy MVP.
- Skip Phase 3 → UX rối, admin dùng khó. OK trong ngắn hạn.
- Skip Phase 4 → tech debt accumulate, mỗi feature mới càng đắt.
- Skip Phase 5 → mù trong production, debug khó.

---

## Cách bắt đầu

Mày nhắn 1 trong 5 câu sau, tao bắt đầu phase đó ngay:

1. `bắt đầu P1` → 14 P0 security fix (5 ngày)
2. `bắt đầu P2` → Scaling foundation (10 ngày)
3. `bắt đầu P3` → UX cleanup (7 ngày)
4. `bắt đầu P4` → Service layer refactor (14 ngày)
5. `bắt đầu P5` → Polish + observability (7 ngày)

Hoặc:
- `quick wins` → ship 8 quick wins parallel (1 ngày tổng)
- `bắt đầu warranty` → bot warranty module (Wave 26, ~5 ngày, separate)
- `tiếp tục như cũ` → tao tự chọn priority theo recommend

**Khuyến nghị tao:** P1 → P3 (parallel với P2) → P4 → P5. P2 chèn vào tuần 3-4 sau khi P1 + P3 đã ship.
