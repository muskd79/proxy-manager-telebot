# LEARN_VIA_DEEPER — Đợt đào sâu 2026-05-02

**Phạm vi:** chỉ những thứ CHƯA review trong các doc cũ (`LEARN_VIA_BOT.md`, `LEARN_VIA_WEB.md`, `LEARN_VIA_FEATURES.md`, `PORT_VIA_TEXT_2026-05-02.md`, `BOT_VIA_PORT_COMPLETE_2026-05-02.md`).

**VIA src:** `C:\Users\Admin\Documents\quản lý via, giao via và gửi via qua bot tele\src`
**Proxy src:** `C:\Users\Admin\Documents\quản lý proxy trên web và giao proxy qua bot tele cho user tele\proxy-manager-telebot\src`

---

## Section 1 — Top 20 pattern/feature VIA có, proxy chưa

| #  | Pattern                                                               | VIA file:line                                                                | Effort | Priority | Use case proxy |
|----|-----------------------------------------------------------------------|-------------------------------------------------------------------------------|--------|----------|----------------|
| 1  | `lib/api/create-handler.ts` route factory (auth+CSRF+rate+zod+audit)  | `src/lib/api/create-handler.ts:102-385`                                       | M      | P0       | Bỏ ~70% boilerplate trong 30+ proxy API routes |
| 2  | `services/audit/*` v2 (target_type taxonomy + redactor + bot-wrapper) | `src/services/audit/audit.service.ts`, `audit-actions.ts`, `audit-redactor.ts`, `audit-bot-wrapper.ts` | L | P1       | activity_logs proxy thiếu typed target_type + secret redaction |
| 3  | `lib/bot/dead-letter.ts` DLQ + partial unique dedup                   | `src/lib/bot/dead-letter.ts:1-106`                                            | S      | P0       | Webhook 500 → Telegram retry 7d storm — proxy đang risk |
| 4  | `lib/bot/file-delivery.ts` chunked .txt + retry + bot_files audit     | `src/lib/bot/file-delivery.ts:1-164`                                          | S      | P1       | Order proxy lớn (>20) hiện gửi text dài, dễ vượt 4096 char Telegram |
| 5  | `lib/bot/auto-approve.ts` precedence chain (force tri-state)          | `src/lib/bot/auto-approve.ts:1-106`                                           | S      | P1       | Proxy có inline auto/manual nhưng chưa có force=hard/soft |
| 6  | `lib/bot/chat-member-cache.ts` LRU 60s admin role cache               | `src/lib/bot/chat-member-cache.ts:1-141`                                      | S      | P3       | Chỉ cần khi proxy hỗ trợ group admin — defer |
| 7  | `lib/lru-cache.ts` standalone LRU class (TTL+max+touch)               | `src/lib/lru-cache.ts:1-51`                                                   | XS     | P0       | Dependency cho settings cache, whitelist cache, các cache mới |
| 8  | `lib/shared/settings/cache.ts` settings LRU (100 orgs × 60s)          | `src/lib/shared/settings/cache.ts:1-72`                                       | S      | P1       | Mỗi command bot proxy đang refetch settings — N writes/min |
| 9  | `lib/bot/check-whitelist.ts` multi-tier whitelist (auto-existing-user heuristic) | `src/lib/bot/check-whitelist.ts:25-201`                              | M      | P1       | Proxy có whitelist nhưng thiếu auto-approve cho user đã chat ≥5 msg |
| 10 | `notify-admins.ts` concurrency cap + per-msg timeout + per-admin notification_types filter | `src/lib/bot/notify-admins.ts:75-161`                            | S      | P0       | Proxy `notifyAllAdmins` thiếu cap, dễ stampede 30s timeout |
| 11 | `services/warranty.service.ts` full claim lifecycle (state+RPC+notify) | `src/services/warranty.service.ts:1-440`                                     | L      | P2       | Proxy "report" hiện chỉ ghi log, chưa có pending/approved/replacement flow |
| 12 | `services/custom-orders.service.ts` admin-create order skipping queue | `src/services/custom-orders.service.ts:39-300`                                | M      | P2       | Admin proxy hiện phải đi qua flow user — cần tạo order tay |
| 13 | `services/uid-check-orchestrator.service.ts` + checker-cache + checker-process | `src/services/uid-checker-*.service.ts`                              | XL     | DEFER    | Không liên quan proxy — chỉ port nếu thêm "check IP geolocation" tương tự |
| 14 | `services/dashboard/heatmap.service.ts` + `health.service.ts`         | `src/services/dashboard/heatmap.service.ts`, `health.service.ts`              | M      | P2       | Activity heatmap (24h × 7d) cho dashboard proxy |
| 15 | `app/(admin)/dashboard/_lib/generate-insights.ts` heuristic insight cards | `src/app/(admin)/dashboard/_lib/generate-insights.ts:79-229`              | S      | P2       | Pure func — port nguyên, đổi metric (pending → low-stock proxy → revenue) |
| 16 | Materialized view dashboard (mig 033) + `dashboard_refresh_state` throttle (mig 035) | `supabase/migrations/033_scale_50k_matview_fts.sql`               | M      | P2       | Khi inventory proxy >10k, count() per request sẽ lag |
| 17 | FTS tsvector + GIN search vector (vias.search_vector)                 | `supabase/migrations/033_scale_50k_matview_fts.sql:80-160`                    | M      | P3       | Search proxy hiện ILIKE, slow khi >50k rows |
| 18 | Audit immutability strict (BEFORE DELETE block + safe purge RPC)      | `supabase/migrations/175*.sql` (audit_logs)                                   | XS     | P1       | Proxy mig 048 đã có 1 phần — verify TRUNCATE block tồn tại |
| 19 | `services/blacklist-recall.service.ts` (auto recall vias khi user vào BL) | `src/services/blacklist-recall.service.ts`                              | M      | P3       | Khi user proxy bị block, auto-recall các proxy đang assigned |
| 20 | `lib/api/dispatch-action.ts` action-name dispatcher (PATCH ?action=foo) | `src/lib/api/dispatch-action.ts`                                          | S      | P3       | Gọn các route PATCH có nhiều action (approve/reject/recall) |

**Legend effort:** XS <2h · S <1d · M 1-3d · L 3-7d · XL >1 wave

---

## Section 2 — Per-domain deep dive

### 2.1 Warranty system

**VIA files:**
- `src/services/warranty.service.ts` — listing + getById + processClaim
- `src/lib/bot/commands/report.ts` — bot-side claim creation
- `src/lib/state-machine/warranty.ts` — pending → approved/rejected/auto_replaced
- `supabase/migrations/020_warranty.sql` (table) + `021_warranty_atomic_rpc.sql` (approve_warranty_claim RPC) + `022_create_warranty_claim_rpc.sql` (insert RPC)
- `app/(admin)/requests/warranty/[id]` UI + `app/api/warranty/[id]/route.ts`

**Schema cần (port sang proxy):**
```
warranty_claims (
  id uuid PK, claimed_by text (telegram_user_id), claimed_username text,
  via_id uuid FK→vias [proxy: → proxies.id],
  reason text, note text, status enum('pending','approved','rejected','auto_replaced'),
  replacement_via_id uuid nullable,
  is_free bool, price numeric,
  processed_by text, processed_at timestamptz,
  created_at timestamptz
)
-- Unique partial index ngăn duplicate claim cùng lúc
CREATE UNIQUE INDEX uniq_pending_claim_per_via ON warranty_claims (via_id) WHERE status = 'pending';
```

**State machine:**
- `pending` → `approved` (admin chọn replacement manually)
- `pending` → `rejected` (admin từ chối, via gốc về `distributed`)
- `pending` → `auto_replaced` (bot tự tìm replacement cùng category)
- `approved`/`rejected`/`auto_replaced` → terminal

**Flow auto-warranty:**
1. User `/report <uid> <reason>` → `processReport(report.ts:17)`
2. Cooldown 5 phút/user (`checkBotCooldown`)
3. Check `warranty_days` (mặc định 7) + `warranty_max_per_day` (mặc định 3)
4. Decide auto/manual via `decideAutoApprove({ force, forceLevel, perUser, globalDefault })`
5. Auto: tìm replacement `available + same category + live_only filter` → atomic UPDATE replacement→`distributed` (CAS `WHERE status='available'`) → UPDATE original → INSERT distribution_history + warranty_claims (status `auto_replaced`)
6. Manual: insert pending claim qua RPC `create_warranty_claim` (transaction)
7. Notify admins với inline approve/reject buttons (không nói nếu đã auto)

**Bug fixes đáng học:**
- `report.ts:204-210` — atomic replacement: claim CAS trước (`eq('status','available')`), sau đó update original. Nếu replacement claim fail → không cần rollback.
- `report.ts:283-296` — rollback toàn bộ khi finalize step fail (replacement → available, original → distributed)
- `warranty.service.ts:355-403` — bug fix Wave 53 Phase 3.3el: RPC drop `replacement_data` từ return → service phải SELECT lại và decrypt phía service (layering: ciphertext không nên cross RPC boundary)
- `warranty.service.ts:397` — guard `[DECRYPTION_FAILED]` sentinel: không gửi cho user, chỉ admin biết

**Effort port:** L (3-7d) — schema + service + bot command + state machine + admin UI + i18n.

---

### 2.2 File delivery

**VIA file:** `src/lib/bot/file-delivery.ts` (164 lines)

**4 hàm chính:**
1. `hasLongViaData(vias, maxTextLength=2000)` — check nếu via.data > 2000 ký tự
2. `shouldUseFileDelivery(viaCount, orgId)` — đọc settings `file_delivery_threshold` (mặc định ?), trả `viaCount >= threshold`
3. `generateViaFileContent(vias, meta)` — sinh .txt với:
   - Top: raw data lines (copy-paste vào Sheets)
   - Separator
   - Header: order ID, ngày, user, quantity, category
   - Per-via: `--- Via N ---` + UID + Data
4. `sendViaFile(bot, chatId, fileContent, filename, caption, keyboard)` — `Buffer.from(content, 'utf-8') → InputFile → bot.api.sendDocument`. In-memory → Vercel-safe (no /tmp).

**Audit chain:**
- `logFileDelivery(userId, username, filename, content, viaCount, trigger, requestId, messageId, orgId)` insert vào `bot_files` table
- `encryptIfConfigured(content)` — nếu `VIA_ENCRYPTION_KEY` env có thì AES-256-GCM
- Retry 1 lần sau 500ms (`insertWithRetry`) — non-fatal, không throw

**Trigger taxonomy:** `'delivery' | 'myvia_export' | 'custom_order' | 'warranty'` — proxy nên đổi thành `'assign' | 'my_proxies_export' | 'custom_order'`.

**Schema port (mig mới cho proxy):**
```sql
CREATE TABLE bot_files (
  id uuid PK,
  telegram_user_id text NOT NULL,
  telegram_username text,
  filename text NOT NULL,
  file_content text NOT NULL,  -- ciphertext nếu env có PROXY_ENCRYPTION_KEY
  via_count int NOT NULL,      -- proxy: rename → proxy_count
  trigger text NOT NULL,
  request_id uuid,
  file_message_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_bot_files_user ON bot_files (telegram_user_id, created_at DESC);
```

**Effort port:** S (<1d) — code gần như port nguyên, chỉ đổi tên field.

---

### 2.3 Auto-approve precedence chain

**VIA file:** `src/lib/bot/auto-approve.ts` (106 lines, **rất gọn — port nguyên**)

**Tri-state forceLevel: `off | soft | hard`**
- Wave 18 promote từ boolean → enum để có "soft" mode (tôn trọng per-user opt-out)
- Back-compat: legacy `force === 'true'` → treated as `'hard'`

**Truth table 7 rules (priority desc):**

| # | Condition                                          | Result | Reason                |
|---|----------------------------------------------------|--------|------------------------|
| 1 | `forceLevel='hard'`                                | auto   | `force_hard`          |
| 2 | `forceLevel='soft'` AND `perUser='off'`            | manual | `user_opt_out_honored`|
| 3 | `forceLevel='soft'`                                | auto   | `force_soft`          |
| 4 | `perUser='on'`                                     | auto   | `user_opt_in`         |
| 5 | `perUser='off'`                                    | manual | `user_opt_out`        |
| 6 | `globalDefault='true'`                             | auto   | `global`              |
| 7 | else                                               | manual | `manual`              |

**Nguồn dữ liệu:**
- `force` ← `settings.auto_mode_force` (legacy boolean) — proxy: `proxy_auto_mode_force`
- `forceLevel` ← `settings.auto_mode_force_level` ('off'|'soft'|'hard')
- `perUser` ← `user_limits.auto_approve` ('on'|'off'|null) — proxy chưa có user_limits table
- `globalDefault` ← `settings.auto_mode`

**Lý do tách:** Agent Z1 finding H2 — chain từng inline trong 4 file (`getvia.ts`, `report.ts`, `custom-order.ts` callback, warranty handler) với implementation hơi khác nhau. Tách 1 chỗ + truth-table test (`auto-approve-precedence.test.ts`) — refactor preserve matrix.

**Audit hook:** mỗi call site log `[reason=${decision.reason}]` vào audit details — admin grep "tại sao request X auto-approve?" trả lời ngay.

**Effort port:** S — code 106 dòng pure, port y nguyên + đổi key settings. Cần thêm bảng `user_limits` cho proxy nếu muốn per-user override.

---

### 2.4 Insights / analytics dashboard logic

**VIA file:** `src/app/(admin)/dashboard/_lib/generate-insights.ts` (229 lines)

**Pattern:** pure function `generateInsights({ stats, period, t, lowStockCategories, botSilenceMinutes })` → trả `ReadonlyArray<Insight>` (max 3, frozen).

**Insight type:**
```typescript
{ priority: number, tone: 'info'|'success'|'warning'|'danger',
  icon: 'trending-up'|'trending-down'|'alert'|'check'|'info',
  message: string, href?: string }
```

**8 insight rules + priority:**

| Priority | Rule                              | Threshold                                  | Tone       |
|----------|-----------------------------------|--------------------------------------------|------------|
| 10       | pendingRequests                   | total > 0                                  | warning    |
| 20       | lowInventory                      | first cat below min                        | warning    |
| 30       | reportedSpike                     | reported pct ≥ +50%                        | danger     |
| 40       | uidLiveDrop                       | live rate drop ≥ 5pp                       | danger     |
| 50       | revenueChange                     | abs pct ≥ 10%                              | success/warning |
| 60       | highDistribution                  | today ≥ 1.5× weekly avg AND ≥ 5            | success    |
| 70       | profitMargin                      | margin shift ≥ 5pp                         | success/warning |
| 90       | botSilent                         | silence ≥ 10min                            | danger     |

**Rules port-able sang proxy:**
- pendingRequests → pending proxy requests
- lowInventory → categories below stock threshold (proxy đã có mig 023)
- reportedSpike → revoke spike (>50% vs prev period)
- uidLiveDrop → "alive" probe drop (proxy_checker live rate)
- revenueChange + profitMargin → giữ nguyên
- highDistribution → high assignment count today
- botSilent → giữ nguyên (cần `last_bot_message_at` setting)

**Lý do hay:** pure func, deterministic, dễ test. UI component chỉ render — logic không lẫn JSX.

**Effort port:** S — copy file, đổi metric names + i18n keys. Cần stats RPC trả `pending_*`, `prev_*`, `live_uids/die_uids` tương ứng.

---

### 2.5 Service layer + create-handler factory

**VIA file:** `src/lib/api/create-handler.ts` (385 lines)

**Pipeline 8 steps mỗi request:**
1. `requireAdmin(role)` — auth + resolve orgId từ user_roles (KHÔNG từ request body)
2. `checkCSRF(req)` — nếu config.csrf
3. `checkRate(req, rateLimit, user.email)` — atomic sliding window
4. Parse + zod validate body (POST/PUT/PATCH/DELETE)
5. Resolve route params (`await routeCtx.params`)
6. `auditCfg.beforeFn?(ctx)` — capture before snapshot (Wave 54)
7. `config.handler(ctx)` — business logic (service call)
8. Audit log (legacy string OR v2 structured) + response wrap

**Audit override mechanism:**
- Service trả `{ ...data, auditAction: 'force_auto_enabled', audit: 'detail string', auditEntityId: 'xxx', _audit: { after: {...} } }`
- create-handler strip 4 internal fields trước khi return JSON

**Wave 54 v2 audit:**
- `before` từ `beforeFn` (async callback, capture pre-mutation state)
- `after` từ handler return `_audit.after`
- Branch logic: nếu có before/after → `logAuditV2()` structured, else → `logAuditLegacy()` flat positional shim

**Error path:**
- `AppError` (custom subclass với statusCode + code) → JSON với `code` field, status từ `err.statusCode`
- `sanitizeErrorMessage()` strip Postgres internals (table/column/constraint/relation/violates/duplicate key/foreign key/schema/pg_/index/RLS) — gửi "A database error occurred" cho client
- Unknown error → 500 với `errorId` (8 hex chars) trong body + `X-Error-ID` header — admin grep log

**logApiRequest** trong cả success + error path → mọi API hit ghi vào `api_request_logs` (mig 069 VIA).

**Service layer pattern:**
- `services/*.service.ts` chỉ nhận `(supabase, params, orgId)` — không biết NextRequest/NextResponse
- Throw `AppError`/`ValidationError`/`NotFoundError` (subclass) — handler factory translate thành HTTP
- Có thể dùng từ bot, cron, API — share business logic

**ROI port sang proxy:**
- 30+ proxy API routes hiện boilerplate auth+csrf+rate+zod+catch ~50 dòng/route
- Sau port: ~10 dòng/route
- Bonus: audit consistency (mọi mutation log đồng nhất shape)

**Effort port:** M — phải kèm `services/audit/*` (`logAudit`/`logAuditV2`/`inferTargetType`/`redactSnapshot`) + `lib/api/errors.ts` (AppError class) + chuyển từng route dần.

---

## Section 3 — Plan port từng pattern (effort + dependency)

| Wave hint | Patterns                                              | Dependency                                       | Total effort |
|-----------|--------------------------------------------------------|--------------------------------------------------|--------------|
| **Wave 24A** (foundation) | LRU cache class + settings cache + create-handler factory + audit v1 (logAudit shim) + AppError class | none                                | 3d  |
| **Wave 24B** (bot resilience) | DLQ table + dead-letter helper + notify-admins concurrency cap + per-msg timeout | mig new + admins.notification_types JSONB | 1.5d |
| **Wave 24C** | file-delivery + bot_files table + insertWithRetry      | settings cache (24A)                             | 1d  |
| **Wave 25A** | auto-approve precedence chain + user_limits table + 4 call sites refactor | settings cache (24A)              | 2d  |
| **Wave 25B** | services/audit/v2 (target_type, actor_kind, before/after, redactor, bot-wrapper) + audit_logs schema upgrade (target_type, actor_id, etc.) | audit v1 (24A) | 4d  |
| **Wave 25C** | generate-insights port + dashboard insight strip UI    | stats RPC trả prev_* metrics                     | 1.5d |
| **Wave 26A** | warranty schema + service + state machine + bot /report flow + admin /requests/warranty UI | auto-approve (25A), file-delivery (24C) | 5d  |
| **Wave 26B** | custom_orders (admin tạo order tay) + service + bot delivery | warranty patterns shared             | 3d  |
| **Wave 26C** | matview dashboard + refresh trigger + FTS              | only when proxy >10k rows                        | 3d  |
| **DEFER**    | chat-member-cache (group bot), uid-check (irrelevant), blacklist-recall (cần khi proxy có blacklist), dispatch-action (sugar) | n/a | n/a |

**Critical path:** 24A → 24B → 24C → 25A → 26A. Ai làm parallel: 25B + 25C độc lập.

---

## Section 4 — Pattern KHÔNG nên port

| Pattern                                | Lý do bỏ                                                                 |
|----------------------------------------|--------------------------------------------------------------------------|
| **Multi-tenant orgs (organizations + org_id)** | Proxy single-tenant. Port ~12 mig + RLS rewrite không xứng. |
| **UID watchlist + dedicated bot**      | Domain Facebook, không liên quan proxy.                                   |
| **uid-check-bot tách riêng**           | Proxy đã có 1 bot — không cần fork bot thứ 2.                              |
| **Bot groups** (chat_kind + group whitelist) | Proxy use case 100% private DM (giao proxy cá nhân). Group chỉ làm phức tạp guard logic. |
| **2FA backup codes** (mig 055/085)     | Proxy đã có (mig 035). |
| **Login logs** (mig 015)               | Proxy đã có (mig 035 admin_login_logs). |
| **Cooldown động per-category**         | Proxy bán per-IP không phải per-category, cooldown đơn giản đủ. |
| **Trust score** (mig 167)              | Cần history dài (≥30d active days) — proxy chưa đủ traffic, premature optimization. |
| **chat-member-cache**                  | Chỉ dùng khi support group bot — DEFER cùng group whitelist. |
| **Top-users leaderboard**              | Proxy không có gamification, user count thấp. |
| **`audit-bot-wrapper.botAudit(ctx, ...)`** | Sugar wrapper — proxy bot ít callsite, gọi `logAudit` trực tiếp với 5 dòng đủ rõ. |
| **Warranty `auto_replaced` status**     | Nếu chỉ port basic warranty, bỏ auto-replace, chỉ pending/approved/rejected — đơn giản hơn. |

---

## Section 5 — Self-critical: pattern VIA có vẻ ngon nhưng thực ra over-engineered?

| Pattern                                       | Vấn đề                                                                                          | Đề xuất cho proxy |
|-----------------------------------------------|-------------------------------------------------------------------------------------------------|-------------------|
| **Audit v2 target_type taxonomy 15 entries**  | 15 target_types là di sản multi-domain (via, warranty, custom_order, broadcast, 2fa, ...). Proxy chỉ có 5-6 domain → CHECK constraint dài lê thê. | Thu hẹp còn `'proxy' \| 'request' \| 'admin_user' \| 'setting' \| 'whitelist' \| 'blacklist'` — đủ. |
| **`audit-bot-wrapper.ts` botAudit() helper**  | 50 dòng wrapper chỉ để extract `actor = bot:${ctx.from.username}` — 1 dòng inline. | Bỏ. Inline `actorEmail: bot:${ctx.from?.username ?? ctx.from?.id}` tại call site. |
| **`auto-approve.ts` 7-rule precedence + 4 reason enums** | `force_hard` vs `force_soft` vs `user_opt_out_honored` vs `force` (deprecated alias) — 4 reasons cho concept "force engaged". Lý do: dashboard back-compat. | Proxy port thẳng v2 — chỉ giữ `force_hard`, `force_soft`, `user_opt_in`, `user_opt_out`, `global`, `manual`. Bỏ `force` deprecated alias. |
| **AuditConfig với beforeFn callback**         | `beforeFn` async callback chạy trước handler — capture pre-mutation state. Đẹp nhưng: thực tế 90% mutation chỉ cần `after`. `before` thường giống fetch của handler → duplicate query. | Proxy port chỉ `after` qua `_audit.after`. `before` defer cho admin actions hiếm (bulk-edit, recall) khi cần forensics. |
| **`createHandler` 385 dòng + 8 stages**       | Comprehensive nhưng: `config.cache` header, `searchParams`, `params` type juggling — nhiều branch ít dùng. Wave 54 thêm v2 audit branch nữa. | Proxy port version giảm: bỏ `cache` header (route tự set), bỏ branch v2 (chỉ giữ v1 path), gộp `params` + `searchParams` thành `ctx.url`. ~200 dòng đủ. |
| **`warranty.service.ts` 440 dòng**            | 1 file 440 dòng — vi phạm rule "<400 lines". Có 3 hàm public (list/getById/process) + scattered RPC calls + decrypt path. | Port tách 3 file: `list.service.ts`, `get.service.ts`, `process.service.ts`. |
| **File delivery threshold + `hasLongViaData(maxTextLength=2000)` 2 cờ** | 2 trigger cho file mode (count threshold OR data length) — flag override flag. Edge case khó test. | Proxy: chỉ 1 cờ `count >= threshold`. Proxy data ngắn (host:port:user:pass), không cần length check. |
| **`generate-insights.ts` 8 rules cố định + i18n key string concat** | `t('dashboard.insight.pendingRequests').replace('{count}', ...)` — không type-safe placeholder. Mỗi rule hard-code priority number. | Proxy: dùng `i18next` interpolation `t(key, { count })`. Bảng config-driven thay vì 8 if. |
| **Settings cache 100 orgs × 60s TTL**         | Proxy single-tenant → `100 orgs` overkill. 60s TTL nghĩa admin đổi setting xong, bot mất tới 60s mới apply — confusing. | Proxy: `LRUCache(1, 30_000)` đủ. Hoặc dùng Postgres LISTEN/NOTIFY thay cache. |
| **Notify-admins per-admin notification_types JSONB filter** | `prefs[type] === false` — JSONB column trong `user_roles`, mỗi notify query select column này. Admin proxy ít (5-10 người), filter này edge case. | Defer: proxy giữ "all-or-nothing" `notifications_enabled` boolean. Thêm filter khi >20 admin. |

---

## File paths trích yếu

**VIA pattern source:**
- `C:\Users\Admin\Documents\quản lý via, giao via và gửi via qua bot tele\src\lib\api\create-handler.ts`
- `C:\Users\Admin\Documents\quản lý via, giao via và gửi via qua bot tele\src\lib\bot\auto-approve.ts`
- `C:\Users\Admin\Documents\quản lý via, giao via và gửi via qua bot tele\src\lib\bot\dead-letter.ts`
- `C:\Users\Admin\Documents\quản lý via, giao via và gửi via qua bot tele\src\lib\bot\file-delivery.ts`
- `C:\Users\Admin\Documents\quản lý via, giao via và gửi via qua bot tele\src\lib\bot\notify-admins.ts`
- `C:\Users\Admin\Documents\quản lý via, giao via và gửi via qua bot tele\src\lib\bot\check-whitelist.ts`
- `C:\Users\Admin\Documents\quản lý via, giao via và gửi via qua bot tele\src\lib\bot\chat-member-cache.ts`
- `C:\Users\Admin\Documents\quản lý via, giao via và gửi via qua bot tele\src\lib\lru-cache.ts`
- `C:\Users\Admin\Documents\quản lý via, giao via và gửi via qua bot tele\src\lib\shared\settings\cache.ts`
- `C:\Users\Admin\Documents\quản lý via, giao via và gửi via qua bot tele\src\services\audit\audit.service.ts`
- `C:\Users\Admin\Documents\quản lý via, giao via và gửi via qua bot tele\src\services\audit\audit-actions.ts`
- `C:\Users\Admin\Documents\quản lý via, giao via và gửi via qua bot tele\src\services\audit\audit-redactor.ts`
- `C:\Users\Admin\Documents\quản lý via, giao via và gửi via qua bot tele\src\services\audit\audit-bot-wrapper.ts`
- `C:\Users\Admin\Documents\quản lý via, giao via và gửi via qua bot tele\src\services\audit\audit-query.service.ts`
- `C:\Users\Admin\Documents\quản lý via, giao via và gửi via qua bot tele\src\services\warranty.service.ts`
- `C:\Users\Admin\Documents\quản lý via, giao via và gửi via qua bot tele\src\services\custom-orders.service.ts`
- `C:\Users\Admin\Documents\quản lý via, giao via và gửi via qua bot tele\src\app\(admin)\dashboard\_lib\generate-insights.ts`
- `C:\Users\Admin\Documents\quản lý via, giao via và gửi via qua bot tele\src\lib\bot\commands\report.ts`
- `C:\Users\Admin\Documents\quản lý via, giao via và gửi via qua bot tele\src\lib\bot\commands\getvia.ts`
- `C:\Users\Admin\Documents\quản lý via, giao via và gửi via qua bot tele\supabase\migrations\033_scale_50k_matview_fts.sql`

**Proxy current state (cho compare):**
- `C:\Users\Admin\Documents\quản lý proxy trên web và giao proxy qua bot tele cho user tele\proxy-manager-telebot\src\lib\telegram\notify-admins.ts` — thiếu cap + timeout + per-admin filter
- `C:\Users\Admin\Documents\quản lý proxy trên web và giao proxy qua bot tele cho user tele\proxy-manager-telebot\src\lib\telegram\commands\` — chưa có /report (warranty), check-proxy có sẵn nhưng đơn giản
- `C:\Users\Admin\Documents\quản lý proxy trên web và giao proxy qua bot tele cho user tele\proxy-manager-telebot\src\app\api\` — 30+ routes boilerplate, candidate cho create-handler refactor
