# SCORECARD 2026-05-02 — Đánh giá thực tế dự án proxy-manager-telebot

> Tổng hợp từ 4 review song song: Senior Dev / SWE Scaling / PM UX / UI Consistency.
> Brutally honest. Không khen tool. Tự critical mỗi section.

---

## Baseline metrics

| Metric | Số |
|---|---|
| Tổng dòng code (TS/TSX/SQL) | **45,355** |
| File TS/TSX | **292** |
| Tab admin web | **16** |
| API routes | **49** |
| Migrations | **52** (latest: 050) |
| Test files | **62** (~21% file count) |
| Tests pass | **680/680** (loại 6 skip) |
| Wave shipped | **17 → 23C** (~7 tháng phát triển) |
| Last commit hash | `d53eeba` |

---

## Master scorecard — góc nhìn

| Góc nhìn | Score | Lý do gạt đầu | Top issue |
|---|--:|---|---|
| **Bảo mật web** | **5.0/10** | 13 route admin/profile thiếu CSRF (B-001..B-006). 6 race condition P0. Search ilike injection (B-012). | CSRF gap toàn bộ admin path |
| **UI/UX** | **5.5/10** | 4/16 tab dead/stub. 33 bug UI. 32 inconsistency. 3 confirm dialog patterns khác nhau. Drag-drop categories không hoạt động. | Bulk action không nhất quán + tab placeholder |
| **Hạ tầng / Scaling** | **5.0/10** | In-memory dedup + rate-limit không scale multi-instance Vercel. Fanout admins burst → Telegram 429 cascade. count(*) full-scan trên 50k row. | Move state ra Redis là blocker |
| **Cấu trúc file** | **6.5/10** | 292 file, không có service layer. 5 file >800 LOC (profile 838, proxy-import 832). 27 floating .catch console.error. | Refactor service layer (kế hoạch ARCHITECTURE_SERVICE_LAYER.md vẫn còn đúng, chưa thực thi) |
| **Schema DB** | **7.0/10** | 52 migration tương đối ổn. Mig 042 fix RLS InitPlan. Mig 048 audit immutability. **NHƯNG** chưa partition activity_logs (11M rows/year). Search no trigram index trên `host`. | Partition + materialized view |
| **Code quality** | **6.5/10** | TS strict ON. 17 `any` còn. 163 console.* trong production (78 file). Naming inconsistent (CategoryFormDialog vs kebab-case). | Centralized logger + lint enforce |
| **Test coverage** | **5.0/10** | 21% file ratio. 0% cho `/api/admins/*` + `/api/profile/*`. Component tests không có (cần jest-dom). E2E Playwright không có. | Add component test + E2E |
| **Bot UX** | **6.5/10** | Wave 23B-bot redesign tốt. State machine DB-persisted. NHƯNG admin-approve.ts chưa migrate safe RPC (B-007). 45 i18n string thiếu. Mix Unicode escape. | Migrate admin-approve.ts + i18n sweep |
| **Feature completeness** | **7.0/10** | CRUD đủ, import wizard mạnh, state machine có. NHƯNG admin tab 5.0 (CSRF), bot flow 6.0 (race), check-proxy 6.0 (trùng feature). | Theo Senior Dev scorecard |
| **Observability** | **3.0/10** | `error-tracking.ts` stub Sentry chưa cài. console.error 163 chỗ. Không APM, không log aggregation. /api/health public leak DB info. | Sentry + Axiom log drain |

### **Tổng điểm thực tế: ~60/100**

> Project chạy được nhưng **chưa production-grade cho team multi-admin + scale 5k user**. Bốn vấn đề lớn đang block: CSRF admin path (security), in-memory state (scaling), tab dead/stub (UX), thiếu observability (operations).

---

## So với target 5,000 user / 50,000 proxy / 50 admin

| Tiêu chí | Hiện tại | Target | Gap |
|---|---|---|---|
| Webhook dedup | In-memory Map | Redis SETEX cross-region | **BLOCKER** |
| Rate limit | In-memory Map | Redis token bucket | **BLOCKER** |
| Fanout 50 admin | Promise.allSettled burst | Queue + token bucket 25 msg/s | **BLOCKER** |
| Dashboard count | `count: "exact"` toàn bảng | Materialized view 60s refresh | HIGH |
| activity_logs | Single table | Partition by month | HIGH |
| 50k proxies search | ilike no index | Trigram GIN index | HIGH |
| Concurrent realtime | Supabase free 200 | Pro 500 (vẫn cap khi 50 admin × N tab) | MEDIUM |
| Vercel function cap | Hobby 100k inv/m | Pro 1M inv/m ($20) | MEDIUM (vượt ở 700 user/ngày) |
| Supabase storage | Free 500MB | Pro 8GB ($25) | MEDIUM |
| Read replica | KHÔNG | Pro Team supports | LOW (chỉ cần khi P3) |

**Cost projection thực tế:**
- P1 Stabilize (500 user): ~$45/tháng (Vercel Pro $20 + Supabase Pro $25)
- P2 Scale (2k user): ~$91/tháng (+Sentry $26, +Upstash $10, +Compute $10)
- P3 Target (5k user): ~$240–280/tháng

> Free tier cứu được MVP đến ~700 user/ngày. Sau đó BUỘC nâng cấp.

---

## 4 docs review chi tiết

| File | Section nổi bật |
|---|---|
| [REVIEW_2026-05-02_SENIOR_DEV.md](REVIEW_2026-05-02_SENIOR_DEV.md) | 14 P0 bug (CSRF + race + injection), 12 P1, 10 P2, 6 P3. Feature scorecard 7.15/10. |
| [REVIEW_2026-05-02_SWE_SCALING.md](REVIEW_2026-05-02_SWE_SCALING.md) | 3-phase scaling plan, 12 mig 051-062, 15 bottleneck ranked, cost projection $45→$280/m. |
| [REVIEW_2026-05-02_PM_UX.md](REVIEW_2026-05-02_PM_UX.md) | 16 tab scorecard, 15 trùng lặp/merge, IA redesign sidebar, top 30 UX issue. |
| [REVIEW_2026-05-02_UI_CONSISTENCY.md](REVIEW_2026-05-02_UI_CONSISTENCY.md) | 140+ button inventory, 28 modal, 80+ toast, 33 broken UI, 32 inconsistency. |

---

## Self-critical (mỗi review tự thừa nhận điểm yếu của review)

### Senior Dev report
- Review trước đã overrate "atomic" / "CSRF có" mà không sweep horizontal — lần này tìm thêm 14 P0
- Static analysis không catch được race condition runtime → cần load test
- CSRF gap admin path tồn tại từ Wave 23A nhưng test pass — chứng tỏ test coverage không đủ

### SWE Scaling report
- Mọi đề xuất Redis có trade-off: single point of failure ở plan rẻ
- Edge runtime cho webhook chưa verify grammy 1.41 + supabase-js compat
- Materialized view stale 60s, có thể outdated cho admin
- Read replica có race window cho bulk_assign

### PM UX report
- Over-praise IA Wave 22U/V — vẫn còn placeholder tab
- check-proxy đáng 3/10 không phải 6/10 (UX duplicate hoàn toàn với import)
- profile 838 LOC đáng 6/10 không phải 8/10 (lớn = dễ bug)
- Pain point 50 admin concurrent (presence, lock contention) chưa sờ tới

### UI Consistency report
- LLM tĩnh không kiểm được: runtime focus management, race condition UI, network resilience, modal z-index, mobile gestures, optimistic update flicker
- Toast text "trộn ngôn ngữ" không thể auto-fix mà cần native speaker review

---

## Câu hỏi tự đặt ra + phản biện

**Q1: "Project đã sẵn sàng cho 5k user chưa?"**
A: Không. 3 BLOCKER (in-memory state) + CSRF admin gap đủ để vỡ vào tuần đầu multi-admin operation.

**Q2: "Tao đang overrate gì?"**
A: Đáng overrate nhất là **bot UX state machine** (6.5/10 thực) — nhìn có vẻ ngon vì vừa redesign, nhưng admin-approve.ts callback chưa migrate safe RPC = race chưa đóng.

**Q3: "Đáng underrate gì?"**
A: **Schema DB 7.0/10** — thực ra solid hơn so với code. 52 mig được audit kỹ, RLS InitPlan đã fix. Đây là asset.

**Q4: "Nếu chỉ làm 1 thứ, làm gì?"**
A: Đóng 14 P0 bug Senior Dev list. CSRF admin + race admin-approve cùng wave. 2-3 ngày. Không có cái này thì mọi thứ khác đều có thể bị attacker khai thác.

**Q5: "Có gì tao chưa nhìn thấy?"**
A: 4 thứ static review không bắt:
1. **Telegram bot rate limit thật** — 30 msg/s global per bot. 50 admin × 5 push/s = 250 msg/s → bot bị throttle silent
2. **Vercel function cold start chain** — webhook trễ 1-2s → Telegram retry → race
3. **Supabase Realtime cap** — 200 concurrent free, 500 Pro. 50 admin × 4 tab = 200 → đụng cap ngay
4. **Postgres autovacuum lag** — activity_logs 11M rows + chat_messages tăng nhanh → bloat

**Q6: "Cải tiến UI/UX nào IMPACT nhất?"**
A: 3 thứ nhanh nhất:
1. **Drill-down dashboard** — KPI card click → filter ngay (1h)
2. **Search global** — header bar wire thật (3h)
3. **Empty state professional** — thay generic "No data" bằng action-oriented (4h)

**Q7: "Tao đang né cái gì?"**
A: 2 thứ:
1. **Service layer extraction** — kế hoạch tốt nhưng chưa ai bắt tay làm. Mỗi wave gắn thêm code → no service layer = càng khó refactor sau
2. **Playwright E2E** — không có cái này thì regression càng nhiều

---

## Kết luận thẳng

- **60/100** là điểm THẬT. Không 80, không 70.
- Project chạy production cho **single admin + <500 user** ổn.
- Multi-admin + 5k user → cần Wave 24 + 25 ship trước.
- Refactor code (service layer) phải làm song song, không thể delay.
- UX cleanup (xóa tab dead, fix bulk, IA reorg) là quick win 2-3 tuần.

**Plan triển khai:** xem [PHASE_PLAN.md](PHASE_PLAN.md).
