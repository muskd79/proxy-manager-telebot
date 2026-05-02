# REVIEW 2026-05-02 — SWE / Infrastructure Architect

Reviewer: SWE/Infra 8y, anti-vendor-fanboy mode
Scope: kiến trúc + scale path
Stack: Next.js 16 / React 19 / TS strict / Supabase Postgres / grammy / Vercel
Mục tiêu scale: 5k user TG đồng thời, 50k proxy, 50 admin web concurrent, 100+ msg/s peak, dashboard <2s, p95 API <300ms

> TL;DR cho lười đọc: **MVP hiện tại không lên thẳng 5k user được**. Webhook in-memory dedup + rate-limit, notifyAllAdmins burst, Supabase free tier connection cap, count(\*) trên 50k proxy, RLS overhead ở 50 admin concurrent — top-5 nóng nhất. Cần ship Wave 24 (Redis/Upstash + Edge config) trước khi tăng tải. Chi phí thực tế chạy 5k MAU trên Pro/Team là $90–250/tháng, không phải free.

---

## 1. Scaling plan từ MVP → 5k/50k/50 (3 phase)

| Phase | Tải mục tiêu | Kéo dài | Hạ tầng | Ngân sách |
|-------|--------------|---------|---------|-----------|
| **P1 — Stabilize** | 500 user, 5k proxy, 10 admin | tháng 1 | Vercel Pro + Supabase Pro (8GB), Upstash free | ~$45 |
| **P2 — Scale** | 2k user, 20k proxy, 25 admin | tháng 2-3 | + Upstash Redis paid + Sentry team + edge KV | ~$110 |
| **P3 — Target** | 5k user, 50k proxy, 50 admin | tháng 4+ | + read replica Supabase + Vercel Pro 4cpu + observability | ~$250 |

### P1 nhiệm vụ (tuần 1-4)
1. Move webhook dedup + rate-limit từ in-memory Map sang Upstash Redis (KV REST). Vercel multi-region không share memory — đang vô dụng.
2. Sentry on (file `error-tracking.ts` đã wire sẵn, chỉ cần `npm i @sentry/nextjs` + DSN).
3. Tách project public health endpoint hiện rò rỉ trạng thái DB (đã fix ở mig 23A nhưng vẫn report `degraded` ra ngoài — có thể abuse để brute probing).
4. Audit `count: "exact"` — file `proxies/route.ts:54` vẫn dùng exact khi không có filter. Trên 50k row đã bắt đầu chậm.
5. State TTL cron (mig 047 có comment "future cron can sweep" — chưa có). Add vào `vercel.json`.

### P2 nhiệm vụ (tuần 5-12)
6. Materialized view cho `get_dashboard_stats()` — refresh mỗi 1 phút bằng cron, không count(\*) realtime.
7. Partition `activity_logs` theo tháng (RANGE on `created_at`). Cleanup cron hiện DELETE 90d-old từng row → vacuum stress.
8. Move `webhook_dedup` sang Redis SETEX 24h, drop bảng PG (mỗi update = 1 INSERT đang tốn write).
9. Fanout admin notify → queue (Redis stream hoặc Supabase queue table) + worker drain với rate ≤1 msg/s/admin để tránh 429 của Telegram.
10. Telegram bot — dùng `secret_token` HEAD nối với Vercel "secret edge route" để giảm cold start ~200ms.
11. Realtime channel: hiện chưa rõ có dùng Supabase Realtime không. Nếu có cho 50 admin → đẩy qua một WS gateway riêng (Pusher / Ably) hoặc tự host. Supabase Pro Realtime cap 500 concurrent connections.

### P3 nhiệm vụ (tuần 13+)
12. Read replica Supabase (Pro Team plan có hỗ trợ). Dashboard reads từ replica, writes/RLS từ primary.
13. Vendor adapter (mig 19-22) khi mở rộng — đẩy purchase saga ra background worker (Inngest/Trigger.dev), không block webhook.
14. Edge runtime cho `webhook` route — hiện đang Node default, cold start 600-1200ms. Edge ≤100ms nhưng grammy 1.41 cần check compat.
15. CDN cho assets + ISR cho dashboard shell.

---

## 2. Migration cần ship để scale (mig 051+)

| # | Tên | Mục đích | Tải gây áp lực |
|---|-----|----------|----------------|
| 051 | `bot_state_ttl_cleanup_cron` | TTL sweep `bot_conversation_state`, lock-free | giảm tail-row hot path |
| 052 | `activity_logs_partition_by_month` | RANGE partition + drop-partition cron | 11M rows/year |
| 053 | `webhook_dedup_drop` (post Redis migration) | xoá bảng + RLS | giảm write contention |
| 054 | `materialized_view_dashboard_stats` | refresh mỗi 60s, INDEX trên view | dashboard <2s |
| 055 | `materialized_view_proxy_inventory` | type/status/country breakdown thay cho `proxies/stats` (đang select toàn bộ 50k row) | stats endpoint |
| 056 | `expand_idx_tele_users_status_active` | partial idx `WHERE status='active' AND is_deleted=false` | quick lookup hot |
| 057 | `idx_chat_messages_user_created_brin` | BRIN trên `created_at` cho retention sweep | giảm vacuum |
| 058 | `proxy_requests_partition_by_quarter` | tránh bloat khi 750k req/tháng | rate limit table cũng nên |
| 059 | `bulk_assign_proxies_v2_with_partial_fail_returning` | hiện return `assigned < requested` không kèm reason → bot không nói được tại sao thiếu | UX |
| 060 | `audit_log_immutability_strict` (kế thừa 048) — thêm `tg_audit_block_truncate` | compliance | low priority |
| 061 | `proxies_archive_table` cho status=expired >90d | inventory query nhanh hơn | 50k+ growing |
| 062 | `idx_activity_logs_actor_created_brin` | BRIN trên (actor_id, created_at) | log query speed |

---

## 3. Infra change cần (in-memory → Redis/PG, CDN, Edge)

| Hiện tại | Vấn đề scale | Đề xuất |
|----------|--------------|---------|
| `processedUpdates: Set<number>` (webhook/route.ts:22) | Per-instance memory; Vercel deploys 4-N replicas → dedup miss khi update_id rơi vào instance khác | Upstash Redis `SET update:<id> EX 86400 NX`, atomic |
| `webhookRateLimits: Map<chatId,…>` (webhook/route.ts:26) | Per-instance, không enforce thật sự | Upstash Redis sliding-window via Lua |
| `acquireSlot/releaseSlot` semaphore (webhook-queue.ts) | Per-instance, MAX_CONCURRENT=50 nhân với N instance → 200+ thực | Move sang Postgres `pg_try_advisory_lock` HOẶC chấp nhận: tính lại MAX dựa trên Vercel concurrency=N |
| `notifyAllAdmins` Promise.allSettled fanout 50 admin | Telegram 30 msg/s global; 50 admin × 100 msg/s peak = 5k msg/s → 429 cascade | Queue table `outbox_telegram` + cron worker pop với token bucket 25 msg/s |
| `webhook_dedup` Postgres bảng | Mỗi update = 1 INSERT + GC cron DELETE → vacuum churn | Redis SETEX, drop bảng |
| `api_rate_limits` Postgres bảng + RPC `check_api_rate_limit` (mig 008) | Mọi request = 1 SELECT FOR UPDATE → contention 100 req/s | Upstash Redis token bucket |
| In-memory `webhookRateLimits` đếm theo chatId | Không công bằng cross-region | Redis key `rl:tg:<chatId>` INCR + TTL |
| Health endpoint public (route.ts:24) | DB probing leak | Token-only hoặc IP-allowlist |
| Cold start webhook ~600ms Node | Telegram retry sau 60s, OK nhưng UX trễ | Edge Runtime sau khi check grammy 1.41 + supabase-js compat |
| Cron lock qua bảng `settings` + JSON `acquired_at` | Dùng `OR (.lt timestamp)` filter — race nếu 2 instance đều thấy null | Chuyển sang `pg_try_advisory_xact_lock(hashtext($key))` |
| Realtime channel (nếu có dùng) | Supabase Pro cap 500 concurrent | Tách dashboard → poll mỗi 5s khi tab active, channel chỉ cho `new request` event |
| Logs/chat retention 90d xoá bằng DELETE | Lock + bloat | Partition + DROP PARTITION |

---

## 4. Cost projection (Free vs Pro vs Team)

Giả định P3: 5k user × 5 lệnh/ngày × 30 = **750k function invocation/tháng**, ~5GB egress, 50k proxy × 800 byte avg = ~40MB hot + activity_logs 11M rows ~3GB/year, Telegram bot ~9k msg outgoing/tháng/admin × 50 = **450k msg/tháng**.

| Item | Free | Pro / Team | Khi nào BUỘC nâng |
|------|------|------------|------------------|
| Vercel Hobby | 100k inv/tháng, 100GB BW, 10s timeout | Pro $20/m: 1M inv, 1TB BW, 60s timeout | Vượt 100k inv → ngay P1 |
| Supabase Free | 500MB DB, 5GB egress, 2GB file, 7d log retention, 50k MAU | Pro $25/m: 8GB DB, 250GB egress, 30d log, 100k MAU. Compute small thêm $10 | DB >500MB (~3 tháng tải ổn) |
| Supabase Realtime | 200 concurrent | Pro: 500. Team Add-on: 10k | >50 admin tab cùng lúc |
| Upstash Redis | 10k cmd/ngày | $0.20/100k cmd hoặc fixed $10/m | Bật Redis (P1) |
| Sentry | 5k err/tháng | Team $26/m: 50k err | Sau go-live |
| Telegram Bot API | free | free | n/a |
| Vercel KV / Edge Config | free 100MB | Pro $0.30/100k | Tuỳ |

**Tổng tháng:**
- MVP P1: Vercel Pro $20 + Supabase Pro $25 + Upstash $0 = **~$45**
- P2: + Sentry Team $26 + Upstash $10 + Compute add-on $10 = **~$91**
- P3 5k user: + Compute medium $50 + read replica $25 + Edge Config $5 + buffer $40 = **~$240–280/tháng**

> Số "Free đủ chạy 5k user" mà bot vendor hay quote là láo. Free Vercel = 100k inv/tháng — chết ngay sau 700 user active hằng ngày.

---

## 5. Observability stack đề xuất

| Layer | Tool | Lý do | Cost |
|-------|------|-------|------|
| Errors | Sentry (đã wire trong `error-tracking.ts`) | Stack trace + release tag | $26/m |
| APM / traces | Sentry Performance hoặc Axiom | Nhúng trace id vào log để corr với webhook | bundled / free |
| Logs aggregation | Vercel Log Drains → Axiom | Vercel chỉ giữ 1h log free, 1d Pro. Axiom free 500GB/m | free → $25 |
| DB metrics | Supabase Studio + pg_stat_statements (CHƯA bật trong project — verify) | Index hit ratio, slow query | bundled |
| Uptime | Better Stack hoặc UptimeRobot | Ping `/api/health` (token) mỗi 1m | free |
| Queue depth | Custom metric `webhook_queue_depth` → Sentry transaction | Surfacing throttling | bundled |
| Telegram delivery | log table `tg_delivery_log` partition month | Track 429 rate | DB cost |
| Cron success | Sentry Cron Monitoring | Miss alert | bundled |

**Cần triển khai ngay (P1):**
- Sentry init + `withSentry` HOC cho mọi route (10 phút)
- `pg_stat_statements`: `CREATE EXTENSION` (Supabase support nhưng phải bật)
- Vercel Log Drain → Axiom (free)
- Cron monitor cho 5 cron + advisory lock acquire/skip ratio

---

## 6. Self-critical — trade-off đang khuyên có gì tệ?

| Khuyên | Mặt tệ |
|--------|--------|
| Move dedup → Upstash Redis | +1 dependency, single-region (cheapest plan), 1 outage = full webhook reject. Mitigation: fallback in-memory + 200ms timeout |
| Materialized view dashboard | Stale tới 60s. CEO/admin nhìn số "đã approved" có thể lệch. Tradeoff vs <2s load |
| Partition `activity_logs` by month | Migration phức tạp, đụng FK nếu có (luckily không). Cũng làm query cross-month chậm hơn |
| Edge runtime webhook | grammy 1.41 chưa fully verified Edge. Có thể buộc fork hoặc giữ Node + tăng warm pool ($) |
| Telegram outbox queue | Latency notify admin tăng 0.5-2s. UX kém hơn nhưng không 429 rớt 30% notify |
| Read replica | Stale 50ms-2s. Race khi admin assign proxy ngay sau khi tạo. Phải route writes về primary |
| Drop in-memory rate-limit | +1 RTT Redis (~3-15ms). Mitigation: dùng Edge Config near-cache 30s |
| Move webhook concurrency limit ra DB | `pg_advisory_lock` chiếm 1 connection trong slot — đếm vào 60-cap pool. Có thể tệ hơn |
| Supabase Pro vs self-host PG | Pro thì lock vendor nặng. Self-host RDS/Neon thì dev velocity tệ hơn |
| Khuyên Sentry trước Datadog | Sentry kém ở infra metric (CPU, mem). Cần thêm Vercel Analytics |
| RLS performance | Mig 042 wrap `(SELECT is_admin())` đã giảm cost 1000x. Nhưng 50 admin × full table scan vẫn nhảy lên >500ms — cần materialize hoặc bypass RLS via service-role read endpoint cho dashboard list view (đánh đổi an toàn) |
| Tải 100 msg/s peak | Tao đang giả định burst đều. Thực tế Telegram batch group_chat reply có thể spike 500/s trong 5s. Webhook queue 50 không đủ — phải scale tới 200 hoặc reject sớm |

---

## 7. Top 15 bottleneck (ranked + fix-first order)

| # | Bottleneck | Impact | Đường ngắn nhất | Khó | Khi |
|---|-----------|--------|-----------------|-----|-----|
| 1 | Webhook in-memory dedup không cross-instance (route.ts:22) | DUP message, double-charge proxy | Upstash Redis SETEX | M | tuần 1 |
| 2 | `webhookRateLimits` Map per-instance (route.ts:26) | Bypass limit trên multi-region | Redis sliding-window | M | tuần 1 |
| 3 | Notify-fanout 50 admin → Telegram 429 (notify-admins.ts:117) | Drop notification ở admin #20+ | Outbox table + worker token-bucket | H | tuần 2 |
| 4 | `count: "exact"` trên proxies list khi không filter (route.ts:54) | List 50k = 300-800ms | Materialized count cell hoặc estimate | L | tuần 1 |
| 5 | `proxies/stats` SELECT toàn bộ rows (stats/route.ts:14) | OOM ở 50k+ | RPC group-by hoặc materialized view | L | tuần 1 |
| 6 | `bot_conversation_state` không có TTL cleanup cron | Bloat + stale state lừa user | Cron sweep + advisory lock | L | tuần 1 |
| 7 | RLS `is_admin()` pre-mig042 đã 10k call/query (đã fix mig 042 — nhưng vẫn check 50 admin × 50k row × FOR-EACH-ROW eval policy) | CPU spike Postgres | Service-role read path cho dashboard, RLS giữ cho user-tenant | H | tuần 4 |
| 8 | `activity_logs` không partition, 11M rows/year | Slow query + vacuum stress | Partition by month | M | tuần 6 |
| 9 | Health endpoint public leak DB status | Probing surface | Token gate | L | tuần 1 |
| 10 | `webhook_dedup` PG bảng → write spike + DELETE GC | Vacuum churn | Drop sau khi Redis dedup ổn | L | tuần 2 |
| 11 | Cron advisory lock dùng `settings` JSON timestamp | Race khi 2 instance cùng tick | `pg_try_advisory_xact_lock` | L | tuần 2 |
| 12 | Vercel cold start webhook 600-1200ms (Node) | Telegram retry, UX lag | Edge runtime sau verify grammy | H | tuần 8 |
| 13 | Supabase connection pool 60 (free) / 200 (Pro) vs 50 webhook + 50 admin = đủ nhưng burst dễ tràn | 500 error random | PgBouncer transaction mode + Supavisor | M | tuần 4 |
| 14 | `bulk_assign_proxies` không return reason cho thiếu (mig 013) | Bot không trả lời "hết hàng kiểu gì" | RPC v2 trả `shortage_reason` | L | tuần 6 |
| 15 | Realtime concurrent channel (nếu enabled) cap 500 (Pro) | 50 admin × 10 tab = 500 cap fragile | Polling fallback hoặc Pusher | M | tuần 10 |

---

## Phụ lục — số liệu nhanh tao đã verify trong codebase

- 50 mig hiện tại, mig 051 sẽ là chỗ ship đầu tiên
- `vercel.json` hiện 5 cron, không cron nào sweep `bot_conversation_state` → bottleneck #6 confirm
- `webhook-queue.ts` MAX_CONCURRENT=50 + QUEUE_TIMEOUT_MS=10s → phù hợp 1 instance, không phù hợp 4+ instance
- `error-tracking.ts` đã viết stub Sentry, chỉ thiếu `npm i @sentry/nextjs` + DSN env
- `notifyAllAdmins` Promise.allSettled (đã fix Wave 22D-4) — vẫn fanout sync, không token bucket
- RLS đã wrap `(SELECT is_admin())` (mig 042) — initplan caching OK, nhưng 50 concurrent vẫn cần đo
- Advisory lock cron qua `settings` table, chưa dùng `pg_try_advisory_xact_lock`
- Health endpoint `/api/health` public response `degraded` cho ngoài → nhỏ nhưng leak

---

## Action priority summary (1 dòng)

**Tuần 1-2 BLOCKER:** Upstash Redis (dedup + rate-limit) → Sentry on → bot_state TTL cron → drop count(\*) ở stats → health auth.

**Tuần 3-6 SCALE PREP:** Outbox-fanout Telegram → activity_logs partition → materialized view dashboard → advisory_xact_lock → audit Realtime usage.

**Tuần 7-12 TARGET:** Edge runtime webhook → read replica → vendor saga worker → APM full → load test 5k user.

Path: `docs/REVIEW_2026-05-02_SWE_SCALING.md`
