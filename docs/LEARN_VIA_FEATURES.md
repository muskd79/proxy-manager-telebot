# LEARN_VIA_FEATURES — Inventory features VIA có mà Proxy chưa có

**Audit ngày:** 2026-04-29
**VIA:** 187 migrations (15.9k LOC SQL) · `quản lý via, giao via và gửi via qua bot tele`
**Proxy:** 47 migrations (5.6k LOC SQL) · `proxy-manager-telebot`
**Mục tiêu:** identify features port-able từ VIA → Proxy, ROI ranking, plan 3 wave (24/25/26).

---

## 1. Feature Inventory (compare 1:1)

| # | Feature | VIA path / migration | Proxy có? | Port priority | Effort |
|---|---|---|---|---|---|
| 1 | **Bot webhook DLQ** (dead-letter queue, partial unique dedup) | mig 154 + 176, `bot_webhook_dead_letter` | ❌ thiếu | **P0 critical** | S |
| 2 | **Distributed rate-limiting RPC** (atomic sliding-window bằng `bigint[]`) + login lockout | mig 023, `check_rate_limit`/`check_login_lockout`/`record_login_failure` | ⚠️ in-mem only (`rate-limiter.ts`) + `api_rate_limits` table mig 008 nhưng RPC chưa atomic | **P0** | S |
| 3 | **AES-256-GCM application encryption** cho via data | `src/lib/crypto.ts` + `VIA_ENCRYPTION_KEY` env, module-level Buffer cache | ⚠️ pgsodium mig 020 nhưng vendor stack rolled back, no app-layer crypto | **P1** | M |
| 4 | **Settings changelog** (audit trail per setting key) | mig 070 `settings_changelog` table | ❌ | **P1** | S |
| 5 | **2FA backup codes** (hashed + salted, 8 codes, 60-bit entropy) | mig 055/085, `src/lib/backup-codes.ts` | ✅ có (mig 035, `admin_backup_codes`, `src/lib/backup-codes.ts`) | n/a | n/a |
| 6 | **Login logs** (login/logout/failed/2fa events) | mig 015, `login_logs` | ✅ có (mig 035, `admin_login_logs`) | n/a | n/a |
| 7 | **User whitelist + chat-member gate** (pending/approved/rejected) | mig 014/164, `bot_whitelist` | ❌ | **P1** | M |
| 8 | **Per-user limits** (max_requests_per_hour, daily/total caps, auto_approve) | mig 019/099/108, `user_limits` | ⚠️ partial (proxy_hourly_limit chưa có table) | **P1** | M |
| 9 | **Auto-approve precedence engine** (forceLevel hard/soft, perUser, global) | `src/lib/bot/auto-approve.ts` | ❌ | **P2** | S |
| 10 | **Trust score** (0-100, 6 components: age + vias + live rate + reports + warranty + activity) | mig 167, `src/lib/bot/trust-score.ts` | ❌ | **P2** | M |
| 11 | **Blacklist table** (replaces JSON in settings) | mig 052, `blacklist` | ❌ | **P2** | S |
| 12 | **Materialized view dashboard stats** + auto-refresh trigger throttle | mig 033/035, `dashboard_stats_mv`, `dashboard_refresh_state` | ❌ live count vẫn dùng | **P2** | M |
| 13 | **Full-text search** (tsvector + GIN, weighted A/B/C) trên vias + message_logs | mig 033/071, `search_vector` columns | ❌ | **P2** | M |
| 14 | **File delivery** (.txt fallback khi quantity > threshold) | mig 024, `src/lib/bot/file-delivery.ts` | ❌ chỉ text | **P2** | S |
| 15 | **Bot-files** storage system (admin uploads → fanout cho user) | mig 040/156 `bot_files` | ❌ | P3 | M |
| 16 | **Notify-admins fanout** với concurrency cap + per-message timeout + per-admin notification_types filter | `src/lib/bot/notify-admins.ts`, mig 036 | ⚠️ proxy có `notifyAllAdmins` nhưng không có concurrency cap, timeout, per-admin type filter | **P1** | S |
| 17 | **Audit logs immutability** (BEFORE DELETE trigger + safe purge RPC) | mig 175, `audit_logs_block_delete` + `purge_old_audit_logs` | ❌ activity_logs có thể bị xoá thẳng | **P1** | S |
| 18 | **Audit logs v2 schema** (target_type, actor_id/kind, before/after JSONB, redaction trigger) | mig 182/183 | ❌ | P3 | L |
| 19 | **Internal notes thread** cho requests/orders/warranty | mig 079/081 `internal_notes` | ❌ | P3 | S |
| 20 | **Warranty system** (state machine, claim → admin → refund/replace) | mig 020-022, `src/lib/state-machine/warranty.ts` | ❌ proxy gọi là "report" nhưng không có warranty state | P3 | L |
| 21 | **UID watchlist + dedicated bot** (subscribe to uid changes, fanout DM/group) | mig 142/152, `uid_watchlist`, `@uid_check_bot` | ❌ | DEFER | XL |
| 22 | **Multi-tenant orgs** (organizations + org_id everywhere + RLS isolation) | mig 056-068, `organizations` + 12+ migs | ❌ proxy single-tenant | DEFER | XL |
| 23 | **Custom orders** (admin tạo order trực tiếp, by-pass user request) | mig 037/094 `custom_orders` | ❌ | P3 | M |
| 24 | **Status history** retention + audit | mig 010/152 `*_status_history` tables | ⚠️ proxy có `proxy_status_changes` partial | P3 | S |
| 25 | **Settings changelog UI** + diff viewer | inferred từ mig 070 + UI | ❌ | P2 | M |
| 26 | **Cron via pg_cron** (DB-side schedule) thay vì Vercel cron | mig 072 `cleanup-old-logs` | ❌ Vercel cron + advisory-lock | DEFER | S |
| 27 | **Proxy distribution history** (denormalized) | mig 137 (VIA built proxy bên trong VIA project!) | ✅ proxy có activity_logs | n/a | n/a |
| 28 | **Ever-reported flag + history** (sticky reported state) | mig 128/131-138 | ⚠️ proxy có ever_reported chưa? — check | P3 | S |
| 29 | **Bot groups** (whitelist + watchlist hỗ trợ group chat, generated column `chat_kind_effective`) | mig 164 | ❌ | DEFER | M |
| 30 | **Composite-key org settings** + auto-seed per-org | mig 098/164 `(key, org_id)` unique | ❌ proxy single-key | n/a (không cần khi single-tenant) | n/a |
| 31 | **Cooldown động** (per-category, per-status) | mig 011, `dynamic_cooldown` | ❌ proxy chưa có cooldown logic | P3 | S |
| 32 | **API request logs** (every API hit logged) | mig 069 `api_request_logs` | ❌ | P3 | S |
| 33 | **Approve_request RPC atomic** (lock via row + insert request + update status trong 1 transaction) | mig 042/083/116 | ⚠️ proxy có `approve_proxy_request` mig 083 — verify atomicity | P2 | M |
| 34 | **Telegram notification preferences per admin** (notification_types JSONB) | mig 037, `user_roles.notification_types` | ❌ | P2 | S |
| 35 | **Top-users leaderboard RPC** (rank by via count, period) | mig 049, `get_top_users_by_via_count` | ❌ proxy không có leaderboard | P3 | S |
| 36 | **Heatmap RPC** (24h × 7d activity grid) | mig 185 `dashboard_heatmap_rpc` | ❌ | DEFER | S |
| 37 | **Active days RPC** (count distinct dates server-side, TZ-aware) | mig 167 | ❌ | P2 (đi kèm trust score) | S |
| 38 | **CSRF cookie protection** | inferred (`src/lib/csrf.ts` exists trong proxy) | ✅ proxy đã có | n/a | n/a |
| 39 | **State-machine via/request/warranty/custom_order** | `src/lib/state-machine/*.ts` (4 machines) | ⚠️ proxy có 2 (request + proxy) | P3 (mở rộng) | M |
| 40 | **Sentry error reporting** | `src/lib/sentry.ts` + `error-reporting.ts` | ⚠️ proxy có `error-tracking.ts` — check parity | P3 | S |

**Legend:** ✅ có · ⚠️ partial · ❌ thiếu · S < 1d · M 1-3d · L 3-7d · XL > 1 wave

---

## 2. Top 5 Features Port NGAY (Wave 24-26 candidates)

### 2.1 Bot webhook DLQ — **P0, S, Wave 24**

**Mô tả:** Khi `handleUpdate` throw, route Telegram webhook hiện trả 500 → Telegram retry 7 ngày exponential backoff → log spam + duplicate processing. VIA fix: insert failed update vào `bot_webhook_dead_letter`, return 200, admin replay sau.

**Schema cần migrate:**
```sql
CREATE TABLE bot_webhook_dead_letter (
  id bigserial PRIMARY KEY,
  bot_type text NOT NULL,            -- 'proxy' | 'admin' | 'user' (chỉ 1 bot ở proxy hiện tại — vẫn cần discriminator cho future)
  update_id bigint,                  -- nullable (malformed body)
  update_payload jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
-- Partial unique on (bot_type, update_id) WHERE update_id IS NOT NULL — dedup retry
CREATE UNIQUE INDEX idx_dlq_dedup ON bot_webhook_dead_letter (bot_type, update_id) WHERE update_id IS NOT NULL;
CREATE INDEX idx_dlq_pending ON bot_webhook_dead_letter (bot_type, created_at DESC) WHERE resolved_at IS NULL;
```

**Service shape:**
```ts
// src/lib/telegram/dlq.ts
export async function recordDLQ(supabase, botType: 'proxy', update: Update, error: Error) {
  await supabase.from('bot_webhook_dead_letter').upsert({
    bot_type: botType, update_id: update.update_id ?? null,
    update_payload: update, error_message: error.message,
  }, { onConflict: 'bot_type,update_id', ignoreDuplicates: true });
}
```
Wrap toàn bộ `handleUpdate` trong try/catch tại `src/app/api/telegram/webhook/route.ts`, catch → `recordDLQ`, return 200.

**UI:** `/admin/dlq` page (table: pending only, replay button, resolve button). Effort UI ~ 4h.

**Effort estimate:** Schema 30 phút · DLQ helper 1h · webhook integration 1h · UI 4h · tests 2h = **~1 ngày**.

**ROI/risk:** Cao. Một bug transient = log spam 7 ngày + duplicate proxy distribution. Proxy hiện tại có rủi ro bigger vì revoke logic mutation-heavy.

**Suggested wave:** **Wave 24a** (security hardening tiếp Wave 17/18b).

---

### 2.2 Distributed rate-limit + login-lockout RPC — **P0, S, Wave 24**

**Mô tả:** Proxy hiện dùng in-memory rate-limiter (`src/lib/rate-limiter.ts`) → mỗi serverless instance có counter riêng → Vercel scale ra nhiều region thì attacker có thể gửi N×limit request. VIA dùng atomic Postgres RPC với sliding window bigint[].

**Schema:**
```sql
CREATE TABLE rate_limits (
  key text PRIMARY KEY,
  timestamps bigint[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE login_lockouts (
  key text PRIMARY KEY,
  failed_count int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_attempt timestamptz NOT NULL DEFAULT now()
);
```
Plus 4 RPC: `check_rate_limit(key, max, window_ms)`, `check_login_lockout(key)`, `record_login_failure(key, max, lockout_ms)`, `clear_login_lockout(key)`.

**Service shape:** `src/lib/rate-limiter.ts` rewrite → call RPC qua `createAdminClient()`. Backward-compat keep same signature `await rateLimit(key, max, windowMs): { allowed: bool, remaining: int, reset_at: number }`.

**UI:** none (transparent).

**Effort:** Mig + RPC port 30 phút · rate-limiter rewrite 2h · tests update 2h = **~0.5 ngày**.

**ROI/risk:** Critical — login brute-force protection hiện single-instance, login-lockout fan-out không hoạt động khi Vercel scale.

**Wave:** **Wave 24a**.

---

### 2.3 Audit-logs immutability + safe-purge RPC — **P1, S, Wave 24**

**Mô tả:** Proxy có `activity_logs` (mig 001/032). Cleanup cron (`api/cron/cleanup`) DELETE thẳng → admin compromise có thể xoá audit evidence. VIA fix bằng BEFORE DELETE trigger + `purge_old_audit_logs(org_id, older_than_days)` SECURITY DEFINER với GUC `SET LOCAL`.

**Schema:**
```sql
CREATE OR REPLACE FUNCTION audit_logs_block_delete() RETURNS trigger ... -- raise unless GUC set
CREATE TRIGGER audit_logs_block_delete_trg BEFORE DELETE ON activity_logs ...
CREATE OR REPLACE FUNCTION purge_old_activity_logs(p_older_than_days int DEFAULT 180) ...
  -- check >= 30 days, SET LOCAL ..., DELETE, INSERT tombstone
```

**Service:** `src/app/api/cron/cleanup/route.ts` đổi `.delete().lt(...)` → `.rpc('purge_old_activity_logs', { p_older_than_days: 180 })`.

**UI:** none.

**Effort:** Mig 30 phút · cron rewrite 30 phút · tests 1h = **~0.25 ngày**.

**ROI/risk:** Cao — security defence-in-depth. Tấn công khi admin compromised → không xoá được trace.

**Wave:** **Wave 24a** (đi kèm với DLQ + rate-limit).

---

### 2.4 Settings changelog table + diff viewer — **P1, S→M, Wave 24-25**

**Mô tả:** Proxy `settings` table không track lịch sử thay đổi. Admin sửa giá → không biết ai sửa lúc nào. VIA `settings_changelog` lưu old_value/new_value/changed_by/created_at.

**Schema:**
```sql
CREATE TABLE settings_changelog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL,
  old_value text,
  new_value text NOT NULL,
  changed_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_changelog_key ON settings_changelog(key, created_at DESC);
```

**Service:** Trigger BEFORE UPDATE on `settings` → INSERT vào changelog, OR explicit insert tại `/api/settings` route. Trigger sạch hơn vì cover 100% paths.

**UI:** `/settings` page thêm tab "Lịch sử thay đổi" — table với key filter, diff colored (red/green).

**Effort:** Schema + trigger 1h · API endpoint 1h · UI tab + diff component 4h · tests 2h = **~1 ngày**.

**ROI/risk:** Trung bình. Compliance & accountability — biết ai chỉnh `proxy_price`, `auto_approve`, etc. Risk thấp (additive).

**Wave:** **Wave 25**.

---

### 2.5 User-limits + auto-approve precedence engine — **P1, M, Wave 25**

**Mô tả:** Proxy hiện có `proxy_hourly_limit` (mig 099) nhưng chưa có per-user limits table và chưa có auto-approve precedence chain. VIA cho phép admin set per-user override (`user_limits.auto_approve = 'on'/'off'/null`) chồng lên global setting.

**Schema:**
```sql
CREATE TABLE user_limits (
  telegram_user_id text PRIMARY KEY,
  max_proxy_per_request int,
  max_requests_per_hour int,
  max_proxies_per_day int,
  max_proxies_total int,
  auto_approve text CHECK (auto_approve IN ('on','off')),
  note text,
  updated_at timestamptz DEFAULT now(),
  updated_by text
);
```

**Service shape:** Port `src/lib/bot/auto-approve.ts` (107 LOC, tested truth table) → `src/lib/telegram/auto-approve.ts`. Precedence:
1. forceLevel='hard' → auto
2. forceLevel='soft' + perUser='off' → manual (carve-out)
3. forceLevel='soft' → auto
4. perUser='on' → auto · 'off' → manual
5. global default

**UI:** Trong `/users/[id]` page thêm card "Giới hạn riêng" với 5 input + auto_approve select 3-state.

**Effort:** Schema 30m · auto-approve.ts port 1h · tests 2h · UI 4h · integration approve route 2h = **~1.5 ngày**.

**ROI/risk:** Cao. Cho phép admin grant trust cho power user (auto-approve) hoặc khoá user lạm dụng (per-hour cap). Risk thấp — additive.

**Wave:** **Wave 25**.

---

## 3. Top 5 Features DEFER (chưa cần)

| # | Feature | Lý do defer |
|---|---|---|
| 1 | **Multi-tenant organizations** (mig 056-068) | Proxy single-tenant; thêm `org_id` cascade qua 25 mig là 2 wave riêng. Chỉ port khi business cần ≥ 2 org. |
| 2 | **UID watchlist + dedicated bot** (mig 142, `@uid_check_bot`) | Domain-specific cho VIA (Facebook UID die/live). Proxy không có analog meaningful — proxy expiry đã có notification cron. |
| 3 | **Audit-logs v2 (target_type, before/after JSONB, redaction trigger)** (mig 182/183) | Stage 1 schema xong (mig 175 immutability) là đủ defence. v2 schema là nice-to-have analytics; backfill cost L. |
| 4 | **pg_cron DB-side schedule** (mig 072) | Vercel cron + advisory-lock của proxy đã đủ. pg_cron đòi Supabase Pro+ extension config; không trade-off đáng. |
| 5 | **Bot groups support** (mig 164, `chat_kind` discriminator) | Wave 46 của VIA mới làm. Proxy bot hiện 1:1 user; group chat use case chưa có. Thêm sau khi DLQ + rate-limit ổn. |

---

## 4. Migration Plan — 3 Waves

### Wave 24 — Security Hardening II (8-10 ngày)

Mục tiêu: Lấp 3 lỗ security còn hở sau Wave 18b.

| Task | Effort | Files |
|---|---|---|
| Bot webhook DLQ (mig 048) | 1d | `src/lib/telegram/dlq.ts`, `src/app/api/telegram/webhook/route.ts`, `src/app/(dashboard)/admin/dlq/page.tsx` |
| Distributed rate-limit RPC (mig 049) | 0.5d | rewrite `src/lib/rate-limiter.ts`, drop in-mem Map |
| Login lockout RPC (mig 050) | 0.5d | `src/app/api/auth/login/route.ts` integrate `record_login_failure`/`check_login_lockout` |
| Audit-logs immutability trigger + purge RPC (mig 051) | 0.25d | `src/app/api/cron/cleanup/route.ts` |
| Notify-admins fanout: concurrency cap + timeout + notification_types filter (port `src/lib/bot/notify-admins.ts`) | 1d | `src/lib/telegram/notify-admins.ts` rewrite |
| Tests + e2e | 2d | new spec files |
| Code review + ship | 1d | |

### Wave 25 — User-Trust Layer (10-12 ngày)

Mục tiêu: Cho admin tool quản lý user lifecycle (limits, blacklist, trust score).

| Task | Effort | Files |
|---|---|---|
| `user_limits` table + auto-approve engine port (mig 052) | 1.5d | `src/lib/telegram/auto-approve.ts`, `/users/[id]/page.tsx` |
| `blacklist` table standalone (mig 053) | 0.5d | `src/app/api/admin/blacklist/route.ts`, dedicated page |
| Trust score (port `src/lib/bot/trust-score.ts` + RPC `count_distinct_active_days`) (mig 054) | 1.5d | `src/lib/telegram/trust-score.ts` + admin user detail card |
| `settings_changelog` table + UPDATE trigger + diff viewer (mig 055) | 1d | `/settings` page tab |
| `notification_types` JSONB column trên admins table + UI checkbox (mig 056) | 0.5d | `/profile` page + `notify-admins` filter |
| Per-admin notification preferences integration | 0.5d | |
| Tests + ship | 3d | |

### Wave 26 — Throughput & Search (10-14 ngày)

Mục tiêu: Scale dashboard + search khi proxy count > 5K.

| Task | Effort | Files |
|---|---|---|
| Materialized view dashboard stats (mig 057) | 1.5d | `dashboard_stats_mv` + REFRESH CONCURRENTLY trigger throttle |
| Full-text search (FTS) trên proxies (mig 058) | 1.5d | `search_vector` + GIN index, `search_proxies` RPC, `/proxies` search box rewrite |
| File delivery (.txt khi quantity > threshold) (mig 059) | 1d | `src/lib/telegram/file-delivery.ts` + `requests.delivery_method` column |
| `api_request_logs` (mig 060) | 0.5d | middleware log every /api hit |
| Internal-notes thread cho requests (mig 061) | 1d | `internal_notes` + UI tab tại `/requests/[id]` |
| AES-256-GCM encryption cho sensitive proxy data (host:port:user:pass) (mig 062, **conditional** — chỉ làm nếu vendor ToS yêu cầu) | 2d | `src/lib/crypto.ts` port từ VIA |
| Tests + ship | 3d | |

---

## 5. Risk / Anti-Pattern — Cái VIA làm phức tạp, Proxy nên simplify

| # | Anti-pattern VIA | Vì sao tránh | Proxy nên làm |
|---|---|---|---|
| 1 | **187 migrations chỉ cho 1 schema** — 30+ mig là fix-of-fix (`fix_*`, `drop_stale_*`, `hotfix_*`) | Schema drift, mỗi rebase prod đều tốn deploy time, một số mig conflict (mig 010 trùng số) | Proxy đã giữ kỷ luật wave-numbered; tiếp tục SQUASH các fix vào 1 migration trước ship |
| 2 | **Auto-refresh materialized view trigger** statement-level — refresh sau MỖI INSERT/UPDATE/DELETE | Mig 035 đã thêm throttle qua `dashboard_refresh_state` table — chứng tỏ pattern ban đầu sai. Bulk import 10K vias = 10K refresh | Proxy nên dùng cron job 1-5 phút refresh thay vì trigger |
| 3 | **`vias.search_vector` UPDATE trigger trên 3 cột** | Bulk import phải UPDATE từng row → trigger fires N lần. Tốt hơn dùng GENERATED column | Proxy dùng `GENERATED ALWAYS AS ... STORED` cho `search_vector` |
| 4 | **`bot_webhook_dead_letter.update_payload jsonb` không có size cap** | TOAST out-of-line storage, một file gửi 50MB sẽ swell DLQ table | Proxy thêm `CHECK (octet_length(update_payload::text) < 1048576)` (1MB) |
| 5 | **Mig 037 thêm 4 cột riêng cho notification preferences** thay vì 1 JSONB column → mig 037 lại fix thành JSONB | Proxy đi thẳng tới JSONB column từ đầu |
| 6 | **`auto-approve.ts` 7-rule precedence chain inline 4 chỗ** trước Wave 18 mới refactor | Proxy port helper từ ngày đầu (Wave 25), không inline |
| 7 | **`user_limits` không có `org_id` ban đầu** → Wave 56 phải backfill org_id qua 7 mig | Proxy single-tenant, không có vấn đề này — nhưng nếu sau này multi-tenant thì add org_id từ schema gốc |
| 8 | **Trigger `set_default_org_id` BEFORE INSERT trên 15 bảng** | Implicit logic, hidden từ ORM, debug khó. Code-side default rõ hơn | Proxy nếu multi-tenant nên truyền `org_id` explicit |
| 9 | **`audit_logs` không append-only ban đầu** → mig 175 mới patch sau khi compromised admin có thể xoá | Proxy port immutability từ Wave 24 ngay |
| 10 | **`settings` key+org_id composite unique** (mig 098) sau khi đã ship single-key | Proxy single-tenant không cần; nếu multi-tenant sau, schema từ đầu là `(key, org_id)` |
| 11 | **`uid_check_cache.previous_status`** column để detect transition stateless | OK pattern nhưng phải UPDATE 2 lần per check | Proxy dùng `LAG()` window function trong RPC nếu cần |

---

## 6. Tham khảo

- VIA migrations folder: `C:\Users\Admin\Documents\quản lý via, giao via và gửi via qua bot tele\supabase\migrations\`
- Proxy migrations folder: `C:\Users\Admin\Documents\quản lý proxy trên web và giao proxy qua bot tele cho user tele\proxy-manager-telebot\supabase\migrations\`
- VIA crypto module: `src\lib\crypto.ts` (AES-256-GCM với module-level Buffer cache)
- VIA notify-admins fanout: `src\lib\bot\notify-admins.ts` (concurrency 5, timeout 5s, per-admin filter)
- VIA auto-approve engine: `src\lib\bot\auto-approve.ts` (107 LOC, truth-table tested)
- VIA trust-score: `src\lib\bot\trust-score.ts` (6-component, 0-100)
- VIA backup-codes: `src\lib\backup-codes.ts` (proxy đã có equivalent tại `src\lib\backup-codes.ts`)

**Quyết định ưu tiên cuối:** Wave 24 ưu tiên 3 features security (DLQ + rate-limit + audit immutability) vì rủi ro production hiện hữu. Wave 25 mở rộng admin tooling (user_limits + trust score + settings changelog). Wave 26 throughput (matview + FTS) chỉ cần khi proxy count > 5K.
