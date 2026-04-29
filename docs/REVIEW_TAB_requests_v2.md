# REVIEW Tab "Yeu cau proxy" — V2 Deep Audit (2026-04-29)

> Bo sung sau review V1 (`docs/REVIEW_TAB_requests.md`). KHONG lap finding cu.
> Tap trung: business logic chi tiet, race/idempotency, outbox, file structure, test cases.

Phap vi doc them: `assign-proxy.ts`, `bulk-proxy.ts`, `admin-approve.ts`, `revoke.ts`, `safe_revoke_proxy` mig 029, `cron/expire-requests`, state-machine `request.ts`.

---

## A. Business logic — race/idempotency/atomicity

### A1. State machine bypass — chi enforce o web PUT, KHONG enforce trong RPC + bot

| ID | Muc | Path | Mota |
|----|-----|------|-------|
| BL1 | CRITICAL | `bulk-proxy.ts:206-214`, `admin-approve.ts:140-147` | Bot callback `handleAdminBulkApproveCallback` va `handleAdminApproveCallback` UPDATE `status='approved'` thang ma KHONG goi `requestMachine.canTransition`. Bot va web di 2 path khac nhau, state machine la guard tren giay. RPC `safe_assign_proxy` chi check `status='pending'` (text-level), khong biet enum `expired/cancelled/auto_approved` bao gio. |
| BL2 | HIGH | `[id]/route.ts:178-187` | Web bulk path UPDATE proxy_requests bypass `requestMachine` y het bot. Lan 1 da flag (B9) nhung chua list ro la **da co 3 entry point** (web single, web bulk, bot callback) deu skip; can dong nhat. |
| BL3 | HIGH | `bulk-proxy.ts:266-269`, `admin-approve.ts:196-204` | Bot reject UPDATE `status='rejected'` khong loc `WHERE status='pending'` o version `bulk-reject` (mig 196 co; admin-reject bot dong 196 co `.eq("status","pending")` nhung **khong return** count → bot edit message "Rejected" du request da approved. Race-friendly nhung silent corruption). |

**Effort:** M (1.5d). **Fix:** Tao mig `047_request_state_machine_db.sql` thanh CHECK constraint enum + trigger AFTER UPDATE ngan transition khong hop le. Khi do RPC + bot + web KHONG can goi state-machine TS — DB la single source of truth.

**Test:** unit `bot-state-bypass.test.ts` — gia lap admin bot approve request da bi user cancel; expect: UPDATE noop, bot tra "already processed".

---

### A2. Idempotency — saga lai non-idempotent o nhieu cho moi

| ID | Mota | Path |
|----|-------|------|
| BL4 | **Bot bulk approve** ko idempotent giong web bulk (B1). RPC `bulk_assign_proxies` luon assign N proxies moi lan goi → 2 admin click "Approve" inline button trong 100ms cuoi → 2 lan goi RPC → 2N proxies. UPDATE status='approved' dau tien la guard duy nhat. **KHONG co `WHERE status='pending'` o RPC body** — moi assign NEW row (mig 013:52-61), con orig request UPDATE sau. | `bulk-proxy.ts:189-214` + `mig 013:14-92` |
| BL5 | `admin-approve.ts:130-147` (single bot) — UPDATE proxy + UPDATE request **2 statement separate**, KHONG dung `safe_assign_proxy` RPC. Khac han web path. Race-prone: 2 admin click, ca 2 UPDATE proxy thanh "assigned" (last-write-wins; assigned_to dau bi mat); ca 2 UPDATE proxy_requests (cuoi cung lay processed_at ms cuoi). | `admin-approve.ts:130-147` |
| BL6 | **Idempotency key thieu** — moi web POST + bot callback nen co `Idempotency-Key` header / payload field. Hien tai click double-fire bi limited boi `isSubmitting` state client-side (`request-actions.tsx:77`); ko phai server-side enforcement. F5 → resubmit OK. | toan bo route + bot |

**Fix BL4+BL5:** Bot phai dung CUNG RPC voi web. De xuat tao RPC moi `approve_request_v2(p_request_id, p_admin_id, p_proxy_id?, p_auto_assign)` — internal:
```sql
-- 1. SELECT FOR UPDATE proxy_requests WHERE id=$1 AND status='pending'
--    → return {error:'already_processed'} neu ko match
-- 2. quantity=1 + p_proxy_id provided: call safe_assign_proxy logic
-- 3. quantity=1 + auto_assign: smart_pick_proxy logic + country filter (B14)
-- 4. quantity>1: bulk loop, atomic update orig request o cuoi
-- 5. INSERT notification_outbox (xem A3)
```
Web va bot deu goi RPC nay. Code TS giam con orchestration thuan.

**Effort:** L (3-4d, kem migration RPC + refactor 4 path).

**Test:**
- `idempotent-double-fire.test.ts` — 2 promise chay song song goi RPC voi cung request_id; expect: 1 success, 1 fail "already_processed"; assigned == quantity
- `bot-vs-web-consistency.test.ts` — bot bulk + web bulk dung chung RPC → ket qua giong nhau

---

### A3. Atomicity boundary — saga step nao ACID, step nao khong

Liet ke tung step trong "happy path approve":

| Step | Storage | Atomicity |
|------|---------|-----------|
| 1. Rate-limit check | DB SELECT | Read-only, no race |
| 2. RPC `safe_assign_proxy` | DB | ACID **trong RPC** (UPDATE proxy + UPDATE request 1 transaction) |
| 3. logActivity | DB INSERT | Khong cung TX voi 2 |
| 4. SELECT teleUser language | DB | Khong cung TX |
| 5. sendTelegramMessage | HTTP | Khong cung TX, idempotent ko |
| 6. INSERT chat_messages (log outgoing) | DB | Khong cung TX |
| 7. notifyOtherAdmins (HTTP fanout) | HTTP × N | Khong cung TX, fire-forget |

**Failure modes:**

| Truong hop | Hau qua | Severity |
|------------|---------|----------|
| 2 thanh cong, 3 fail | Proxy assigned, audit log mat. Admin "ai approve?" trong activity_log thieu | HIGH |
| 2 thanh cong, 5 fail (Telegram 429) | Proxy assigned o DB, user khong nhan tin nhan. Re-fire (retry) khong the vi 2 da commit | CRITICAL (B4 V1) |
| 2 thanh cong, 6 fail | Telegram da gui xong, chat_messages thieu → user thay tin nhan trong bot nhung DB ko log; admin dashboard dem missing message | MEDIUM |
| 2 thanh cong, 7 fail | Other admins khong duoc bao | LOW |

**Fix Outbox pattern:**

Tao mig `048_notification_outbox.sql`:

```sql
CREATE TYPE outbox_kind AS ENUM (
  'request_approved_user',     -- gui proxy creds cho user
  'request_rejected_user',     -- gui ly do reject cho user
  'request_approved_admins',   -- fanout cho admin khac
  'request_rejected_admins',
  'request_expired_user',      -- cron expire-requests
  'chat_message_log'           -- INSERT chat_messages async
);

CREATE TABLE notification_outbox (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            outbox_kind NOT NULL,
  request_id      UUID REFERENCES proxy_requests(id) ON DELETE SET NULL,
  payload         JSONB NOT NULL,           -- {to_telegram_id, text, parse_mode, ...}
  attempts        INT  NOT NULL DEFAULT 0,
  next_retry_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at         TIMESTAMPTZ,
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_outbox_pending
  ON notification_outbox(next_retry_at)
  WHERE sent_at IS NULL;
```

RPC `approve_request_v2` INSERT tat ca outbox row trong CUNG transaction voi update request. → step 2-7 collapse thanh 1 atomic operation: "request approved + outbox enqueued".

Cron `/api/cron/dispatch-outbox` (60s) pick batch unsent (`SELECT ... FOR UPDATE SKIP LOCKED`), gui Telegram, mark sent. 429 → exponential backoff (next_retry_at = now() + 2^attempts seconds, cap 10min). Fail >5 lan → mark `dead_letter=true` + alert admin.

**Effort:** L (4-5d; mig + RPC + cron + monitoring + remove inline notify trong [id]/route.ts + bulk-proxy.ts + admin-approve.ts + cron/expire-requests).

**Business rule:** **At-least-once delivery, idempotent text payload.** Telegram message KHONG co idempotency key ngoai trinh server, nen chap nhan duplicate text trong rare retry (user nhan 2 tin proxy → it phien).

**Test:**
- `outbox-retry-after-429.test.ts` — mock Telegram tra 429 lan 1+2, success lan 3 → assert sent_at != null, attempts == 3
- `outbox-survives-process-crash.test.ts` — INSERT request approve → kill process truoc khi cron chay → restart cron → assert da gui

---

### A4. Race condition: user revoke proxy DUNG luc admin approve

Scenario: User co 1 proxy active. User goi `/revoke` (bot) tai t=100ms. Admin approve request KHAC (cung user) tai t=110ms. Hai promise chay song song.

| Buoc | Path | Thoi gian | Anh huong |
|------|------|-----------|-----------|
| `safe_revoke_proxy` (bot, mig 029) | BEGIN TX → UPDATE proxies SET status='available' WHERE id=A AND assigned_to=user → UPDATE tele_users decrement counter → COMMIT | 100-150ms | proxy A → available, counter -1 |
| `safe_assign_proxy` (web, mig 027) | BEGIN TX → SELECT FOR UPDATE request B → UPDATE proxies SET status='assigned' WHERE id=B AND status='available' → UPDATE proxy_requests B → COMMIT | 110-160ms | proxy B → assigned, request B → approved |

**Phan tich:**

- Hai TX **khong cung row** (proxy A vs proxy B) → ko deadlock, ko block.
- Counter `proxies_used_total`: revoke `-1`, approve `+1` (qua `bulk_assign_proxies` mig 013:75-82). Net = 0. **Nhung counter o proxies_used_hourly/daily van +1** (rate limit). Admin approve **ngay sau** revoke vao gioi han hourly → user co the bi reject false-positive.
- **Hau qua:** counter consistency tot. UX consistency tot.

| ID | Mota | Severity |
|----|------|----------|
| BL7 | Race "revoke at t=100, max-proxies check at t=105" — `[id]/route.ts:131-157` doc `proxies_used_*` truoc khi RPC fire. Sau `safe_revoke_proxy` da decrement total nhung counter hourly van +1 (mig 013:78). Admin approve sau revoke se ko thay quota tra ve → false reject neu user vua dat hourly cap | HIGH |
| BL8 | `safe_revoke_proxy` (mig 029:55-58) chi decrement `proxies_used_total`, KHONG decrement hourly/daily. Y do la "counter hourly tu reset moi gio" — true, nhung **trong cua so 1h** counter inflated. User revoke 5 → request 5 lan nua trong cung gio → bi block | HIGH |

**Fix BL7+BL8:** Sua mig `safe_revoke_proxy` cong them `proxies_used_hourly = GREATEST(0, ...-1)`, `proxies_used_daily = GREATEST(0, ...-1)`. Hoac neu lo "user tu xoay vong unlimited" thi them `proxies_revoked_total` track riêng. **Business decision can:** revoke co tra quota khong?

**Effort:** S (0.5d, sua mig + test).

**Test:**
- `revoke-during-approve.test.ts` — chay song song revoke + approve → final state assigned_to + counter consistent
- `hourly-counter-after-revoke.test.ts` — user request 5/5 hourly → revoke 5 → request again → expect: cho phep neu policy "revoke restores quota"

---

### A5. Cron expire-requests — silent overlap voi admin approve

`cron/expire-requests/route.ts:42-46` UPDATE `WHERE status='pending' AND created_at<sevenDaysAgo`. Neu admin click "Approve" CHINH luc cron chay (race 1ms):

- Admin RPC SELECT `WHERE status='pending'` → match
- Cron UPDATE `WHERE status='pending'` → 1 row affected
- Admin RPC UPDATE proxy + UPDATE request — ko co WHERE status guard
- Final: request.status='approved', nhung **proxy assigned, processed_at moi tu RPC** ghi de cron's expired

Hai TX dua nhau, last commit wins. Nhung quan trong la **proxy bi assigned cho user MA request thuc te da expired** → bot ko gui notification (vi cron khong thay status='pending' nua sau RPC), user ko biet co proxy.

| ID | Severity | Path |
|----|----------|------|
| BL9 | HIGH | `cron/expire-requests/route.ts:42-46` UPDATE thieu guard `WHERE created_at<X AND status='pending'` (cron co WHERE created_at <, nhung KHONG `WHERE status='pending'` trong UPDATE — chi co o SELECT). Sua: them `.eq("status","pending")` o UPDATE call. |
| BL10 | MEDIUM | `safe_assign_proxy` mig 027:48 chi guard "status='pending'" nhung khong dung `FOR UPDATE`. Concurrent cron expire UPDATE va RPC UPDATE — postgres serializable isolation se reject 1 trong 2; default READ COMMITTED chap nhan ca 2 lien tiep, last-write-wins. Cong `FOR UPDATE` o SELECT line 47. |

**Effort:** S (0.5d).

**Test:** `cron-vs-approve-race.test.ts` — chay BEGIN cron TX, BEGIN approve TX, COMMIT cron, COMMIT approve → expect 1 fail/abort.

---

### A6. Approval mode disconnect

`bulk-proxy.ts:30-41` quantity=1 path goi `autoAssignProxy` hoac `createManualRequest` dua tren `user.approval_mode`. Nhung quantity>1 path (line 44) dung threshold `quantity > 5` thay vi check `user.approval_mode`. **Y nghia:** mot user `auto`-mode request 5 proxy → auto-assign; request 6 → buoc manual. **Inconsistent**: neu admin set user `manual` mode, request 3 va`auto_approve` cung KHONG goi (line 44 condition `quantity > 5 || manual`).

| ID | Mota | Path |
|----|-------|------|
| BL11 | quantity 2-5 + auto-mode = direct assign khong qua approval. Doc co cho biet "Yeu cau > 5 can admin duyet" (line 156-157) nhung **KHONG noi 2-5 cung auto neu user is auto mode**. Users tuong: any quantity > 1 = manual. UX confusion. | `bulk-proxy.ts:13, 44` |

**Fix:** lam ro **threshold theo policy hay theo user mode**. Co the them config `BULK_AUTO_THRESHOLD` vao `system_settings` table.

**Effort:** S (0.5d UX + doc).

---

## B. UI/UX scenarios cu the

### B1. Approve dialog — proxy picker khong filter theo request criteria

`request-actions.tsx:50` fetch `?status=available&pageSize=100` **KHONG truyen `type` hay `country` cua request**. Admin approve request HTTP/VN se thay 100 proxy bat ki (HTTPS/SOCKS5/US...). Phai self-filter trong dropdown.

| ID | Severity | Effort |
|----|----------|--------|
| UX1 | HIGH | S | Truyen `?status=available&type=${request.proxy_type}&country=${request.country}` vao fetch. Dialog can fetch request detail truoc, hoac component cha truyen request object xuong dialog. |

### B2. Approve dialog quen request_id cu khi mo lai

`page.tsx:155-167`: handleApprove/handleReject/handleView ca 3 deu set `activeRequestId`. handleView ko mo dialog nao (B17 V1) ma chi reset → click "View Details" sau "Approve" se reset id roi nhung Dialog Approve dang van mo, submit voi id moi == cung id (luck-dependent). Race subtle.

| UX2 | MEDIUM | XS | Tach 3 state id rieng cho 3 dialog. |

### B3. Bulk approve dialog ko hien preview

`request-actions.tsx:316-319` chi noi "Auto-assign available proxies to N selected request(s)". Khong hien:
- Group theo proxy_type (5 HTTP, 3 SOCKS5)
- Total proxy can = sum(quantity) — admin co 100 proxy free thi 100 ok, neu chi 80 free thi 20 fail silent
- Inventory check truoc khi confirm

| UX3 | HIGH | M | Them GET `/api/requests/bulk-preview?ids=...` tra ve `{by_type: {http: 5, socks5: 3}, available_inventory: {http: 12, socks5: 1}, will_succeed: 4, will_partial_fail: 4}` |

### B4. Pagination cursor vs offset

V1 da neu (B5). De xuat **cursor**:
- Server: `?cursor=<base64(requested_at,id)>&limit=20` → SELECT `WHERE (requested_at, id) < (cursor.requested_at, cursor.id) ORDER BY requested_at DESC, id DESC LIMIT 20+1`
- Index can: `idx_requests_pending_queue` (mig 017) `(status, created_at DESC)` da co; them index moi `(requested_at DESC, id DESC) WHERE is_deleted=false` cho cursor seek
- Client: keep `cursors[]` stack de "Next/Prev" — Prev pop stack
- **Tradeoff**: mat "jump to page 50". Filter dashboard usually scroll, ko jump → OK
- **Khong xoa offset path** — keep them dual mode: small page (≤page 5) dung offset, lon hon dung cursor (auto-detect ?page param)

| UX4 | HIGH | M | Mig + API + UI Pagination component sua. |

### B5. Search dead (B3 V1) — fix

PostgreSQL full-text search hay nested filter Supabase **ko ho tro JOIN ilike directly** trong PostgREST. Co 2 path:

1. **Dual query**: parse `search`, query `tele_users WHERE username ilike OR first_name ilike` → lay user_ids → query `proxy_requests WHERE tele_user_id IN (...)`. 2 round-trip.
2. **DB view + tsvector**: tao MATERIALIZED VIEW `proxy_requests_searchable` join sometimes_user_text + tsvector index. Refresh trigger on UPDATE tele_users / proxy_requests. Heavy nhung scale tot.

De xuat **option 1 truoc** (S effort), option 2 khi >100k requests.

| UX5 | HIGH | S | Implement option 1 trong service layer (xem section C). |

### B6. Realtime cuc bo

`page.tsx:107-125`: subscribe cap table khong filter. **Postgres Logical Replication co the dung filter**:
```ts
.on("postgres_changes", {
  event: "*", schema: "public", table: "proxy_requests",
  filter: `status=eq.pending`  // chi pending
}, ...)
```
Tab "recent" dung filter rieng `status=in.(approved,auto_approved,rejected)`. 2 channel, narrow.

| UX6 | MEDIUM | XS | Sua filter param. Bonus: type-safe, bo `as any`. |

### B7. Bulk-approve dialog — partial-failure UX

Hien tai `for (id of requestIds) await fetch` (line 285-294). Neu request 3/10 fail (no inventory), client van toast "10 approved" sai. Va N+1 latency.

| UX7 | HIGH | M | Them endpoint POST `/api/requests/bulk` body `{ids:[], action:'approve', auto_assign:true}` → server transaction → tra ve `{succeeded: [...], failed: [{id, reason}]}`. Dialog hien table ket qua. |

### B8. Quantity column hidden

Schema co `quantity` (mig 013) nhung table render khong show. Bulk request 50 proxy hien same row size voi single request. Admin ko biet click vao se assign nhieu.

| UX8 | MEDIUM | XS | Them column "Qty" (display "1" hoac "50" with badge red >5). |

### B9. Detail panel that su

`onView(id)` la dead handler (page.tsx:163-167). User mong: drawer/dialog hien full detail (request meta, related proxy, user info, activity timeline).

| UX9 | HIGH | M | Tao `<RequestDetailDrawer/>` — fetch `/api/requests/[id]` + `/api/activity-logs?resourceType=request&resourceId=...`. |

### B10. Tab counter

| UX10 | LOW | XS | TabsTrigger badge `Pending (12)`, fetch `/api/requests/counts` → `{pending: 12, recent_7d: 145}`. Cache 30s. |

---

## C. Cau truc file — service layer cho multi-dev/agent

### C1. Tinh trang hien tai

- `src/app/api/requests/route.ts` — 179 LOC, OK
- `src/app/api/requests/[id]/route.ts` — **604 LOC monolithic** — chua approve, reject, cancel, restore, hard-delete, fanout, log
- KHONG co `src/services/`. Mappings logic linh tinh trong route handlers.

### C2. De xuat shape

```
src/services/
  requests/
    index.ts                  — re-export
    requests.types.ts         — domain types: ApproveResult, RejectInput, BulkApproveInput
    requests.repository.ts    — Supabase CRUD: findById, listByFilters, updateStatus, softDelete
    requests.service.ts       — orchestration cao cap (xem signature ben duoi)
    approve.service.ts        — single + bulk approve (call RPC + outbox enqueue)
    reject.service.ts         — reject + cancel + delete
    notify.service.ts         — outbox INSERT helper
    rate-limit.service.ts     — pre-check rate limit (shared web + bot)
    state-machine.guard.ts    — wrap requestMachine voi error xchange
  outbox/
    outbox.repository.ts
    outbox.dispatcher.ts      — cron tick logic
```

### C3. Service signature

```typescript
// approve.service.ts
export interface ApproveSingleInput {
  requestId: string;
  adminId: string;
  proxyId?: string;          // pinned by admin
  autoAssign?: boolean;
  actorIp?: string;
  actorUa?: string;
  idempotencyKey?: string;   // future
}

export interface ApproveResult {
  request: ProxyRequest;
  proxy: { host: string; port: number; type: string; username: string|null; password: string|null };
  outboxIds: string[];       // for tracing
}

export class ApproveError extends Error {
  constructor(public code: 'ALREADY_PROCESSED'|'NO_INVENTORY'|'RATE_LIMIT'|'STATE_INVALID', msg: string) { super(msg); }
}

export async function approveSingle(
  supabase: SupabaseClient,
  input: ApproveSingleInput
): Promise<ApproveResult>

export async function approveBulk(
  supabase: SupabaseClient,
  input: { requestIds: string[]; adminId: string; autoAssign: true; actorIp?: string }
): Promise<{ succeeded: ApproveResult[]; failed: Array<{requestId: string; code: ApproveError['code']}> }>

// reject.service.ts
export async function rejectRequest(
  supabase: SupabaseClient,
  input: { requestId: string; adminId: string; reason?: string; actorIp?: string }
): Promise<ProxyRequest>

// rate-limit.service.ts (shared bot + web)
export async function checkUserCanReceive(
  supabase: SupabaseClient,
  userId: string,
  quantity: number
): Promise<{ ok: true } | { ok: false; reason: string; remaining: number }>
```

### C4. Sau refactor `[id]/route.ts` shape (~80 LOC)

```typescript
export async function PUT(req: NextRequest, ctx: { params: Promise<{id:string}> }) {
  const csrfErr = assertSameOrigin(req); if (csrfErr) return csrfErr;
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { admin, error: authErr } = await requireAdminOrAbove(supabase);
  if (authErr) return authErr;

  const parsed = UpdateRequestSchema.safeParse(await req.json());
  if (!parsed.success) return validationError(parsed.error);

  try {
    if (parsed.data.status === 'approved') {
      const result = await requestsService.approveSingle(supabase, {
        requestId: id, adminId: admin.id,
        proxyId: parsed.data.proxy_id,
        autoAssign: parsed.data.auto_assign,
        actorIp: req.headers.get('x-forwarded-for') ?? undefined,
        actorUa: req.headers.get('user-agent') ?? undefined,
      });
      return ok(result.request, 'Request approved');
    }
    if (parsed.data.status === 'rejected') {
      const result = await requestsService.rejectRequest(supabase, {
        requestId: id, adminId: admin.id, reason: parsed.data.rejected_reason,
      });
      return ok(result, 'Request rejected');
    }
    // ... cancel, restore, etc.
  } catch (e) {
    if (e instanceof ApproveError) return errorFromCode(e);
    captureError(e, {source: 'api.requests.update'});
    return serverError(e);
  }
}
```

### C5. Multi-dev/agent loi the

| Dev/agent | File pattern | Co lap |
|-----------|--------------|---------|
| Backend infra | `requests.repository.ts` + `*.service.ts` | Pure logic, ko care UI |
| API surface | `route.ts` (~80 LOC each) | Auth + parse + delegate |
| Telegram bot | `commands/admin-approve.ts` import service | Cung service voi web → consistency |
| UI | `components/requests/*` | Khong import service truc tiep, di qua REST |
| Test | `__tests__/services/requests/*.test.ts` | Mock SupabaseClient, no HTTP |
| DBA | `migrations/*.sql` | Single-source RPC (approve_request_v2, dispatch_outbox) |

**Loi the chinh**: 1 RPC change → 1 service update → web + bot tu dong dong bo. Khong con scenario "fix web nhung quen bot" (BL5 V2).

### C6. Migration strategy

| Phase | Effort | Output |
|-------|--------|--------|
| Phase 1 | M (2d) | Tao service layer + reposit, tach 60% `[id]/route.ts` ra. Web tests pass. Bot van go straight DB (chua dong bo). |
| Phase 2 | M (2d) | RPC `approve_request_v2`, web service goi RPC. Bot van inline. Outbox table tao nhung chua wired. |
| Phase 3 | L (3d) | Bot service goi cung RPC. Outbox cron live. Inline notify trong route + bot xoa. |
| Phase 4 | S (1d) | Index hardening + cursor pagination + UI bulk endpoint. |

**Tong:** 8 ngay (1 dev), parallel 2 dev = 5-6 ngay neu split phase 1+2 vs phase 3.

---

## D. Test cases bo sung (tren V1)

| Test file | Cover |
|-----------|-------|
| `services/requests/approve.service.test.ts` | unit happy + ALREADY_PROCESSED + NO_INVENTORY + RATE_LIMIT |
| `services/requests/idempotent-double-fire.test.ts` | 2 promise concurrent goi cung approveSingle → 1 success, 1 ApproveError |
| `services/requests/race-revoke-vs-approve.test.ts` | BL7+BL8 rate-limit consistency |
| `outbox/dispatcher.test.ts` | retry, exponential backoff, dead-letter |
| `outbox/durability.test.ts` | RPC commit + crash before dispatch → recovery on next cron |
| `state-machine/db-trigger.test.ts` | DB trigger reject illegal transition (BL1) |
| `cron/expire-vs-approve-race.test.ts` | BL9+BL10 |
| `api/requests/bulk-endpoint.test.ts` | partial failure response shape |
| `e2e/approve-bot-vs-web-consistency.spec.ts` | playwright simulate 2 path → state final giong nhau |
| `repository/cursor-pagination.test.ts` | cursor parsing + tail seek |
| `service/rate-limit.test.ts` | hourly/daily/total + global cap precedence |

Tong **11 test files moi**, ~1500 LOC test code.

---

## E. Top 6 priority — V2 (tang cuong V1)

| # | Action | Wave | Effort | Severity goc |
|---|--------|------|--------|---------------|
| 1 | RPC `approve_request_v2` thong nhat web + bot. Goi tu service layer. | 23B | L (4d) | BL4, BL5, B1, B2 |
| 2 | Outbox `notification_outbox` + cron dispatch. Inline notify deprecated. | 23C | L (5d) | BL6, B4 |
| 3 | DB trigger state machine guard. | 23B | S (1d) | BL1, BL2, BL3 |
| 4 | Service layer scaffold + tach `[id]/route.ts`. | 23B | M (2d) | tech-debt #1 |
| 5 | Sua `safe_revoke_proxy` decrement hourly/daily; cron `expire-requests` UPDATE WHERE status='pending'. | 23A hotfix | S (0.5d) | BL7, BL8, BL9, BL10 |
| 6 | Approve dialog filter proxy by request type+country; bulk-preview endpoint; cursor pagination. | 23D | M (2d) | UX1, UX3, UX4 |

**Tong roadmap:** ~14.5 dev-day (1 dev). Parallel = 8-9 ngay.

---

## F. Tom tat rui ro V2 (deltas vs V1)

- **Bot va web di 2 path approve khac nhau** (BL5) — V1 chi nhin web. Sua bang chung 1 RPC. **Phai fix truoc 23B** vi se duplicate work neu sua tung path.
- **safe_revoke_proxy decrement chi total**, ko hourly/daily — race scenario thuc te (BL7+BL8) gay false rate-limit reject. Hotfix 0.5d.
- **Cron expire UPDATE thieu status guard** (BL9) — silent overwrite. Hotfix nhanh.
- **Outbox** la prerequisite cho mo rong: bot tab moi, alert rules, chat broadcast — cau truc nay tai su dung 100%.
- **Service layer co lap web/bot** — multi-agent (claude code parallel) dung agent rieng cho UI vs service vs bot ma ko conflict file.

---

Path: `docs/REVIEW_TAB_requests_v2.md`
