# REVIEW 2026-05-02 — Senior Dev (10y) Code Health Audit

> Reviewer: Senior Dev role, brutally honest, không khen tool.
> Scope: 292 file TS/TSX, 49 route, 50 migration, ship Wave 17→23C.
> Tổng LOC: ~45.4k, test 62 file (~14% file count).
> Vibe: project chạy được, có khung tốt, NHƯNG nhiều lỗ "chỉ cần 1 lần xui là vỡ" vẫn còn — đặc biệt CSRF + race trên admin/profile path. Not production-grade until P0/P1 đóng hết.

---

## Section 1 — BUG LIST (severity P0–P3)

> **P0 = data corruption / security exploit / money loss**, **P1 = bug end-user thấy**, **P2 = inconsistent behavior**, **P3 = lint/style/dead-code**.

### P0 — CRITICAL

| ID | File:line | Bug | Repro | Fix patch |
|---|---|---|---|---|
| **B-001** | `src/app/api/admins/[id]/route.ts:86, 151` | PUT/DELETE admin **không có CSRF check** (`assertSameOrigin` thiếu). Super_admin đang có session → attacker dụ click link → DELETE admin / PUT đổi role / telegram_id của admin khác. | curl từ origin attacker với cookie super_admin → request thành công. | Thêm `const csrfErr = assertSameOrigin(request); if (csrfErr) return csrfErr;` đầu mỗi handler. |
| **B-002** | `src/app/api/admins/[id]/disable-2fa/route.ts:29` | POST disable-2fa của admin khác **không CSRF**. Attacker force super_admin disable 2FA của admin victim → revoke session globally → victim phải re-login mà không cần 2FA. | Same as above. | Thêm `assertSameOrigin`. |
| **B-003** | `src/app/api/admins/[id]/reset-password/route.ts:56` | POST reset-password **không CSRF**. Cùng kịch bản: attacker buộc super_admin reset password admin khác (mode=generate) → password rò rỉ trong response, attacker không nhận được nhưng victim mất password và session bị global signOut. | Same. | Thêm `assertSameOrigin`. |
| **B-004** | `src/app/api/admins/[id]/revoke-sessions/route.ts` (toàn file) | Không CSRF. Attacker buộc super_admin revoke session một admin khác → DOS. | Same. | Thêm `assertSameOrigin`. |
| **B-005** | `src/app/api/profile/password/route.ts:44` | POST đổi password của bản thân **không CSRF**. Attacker dụ click → đổi password user (dù phải biết current_password — nhưng tấn công chained với MITM hoặc reused password). | Same. | Thêm `assertSameOrigin`. |
| **B-006** | `src/app/api/profile/email/route.ts`, `2fa/disable/route.ts`, `2fa/enroll/route.ts`, `2fa/verify/route.ts`, `2fa/backup-codes/regenerate/route.ts`, `sessions/revoke/route.ts` | **Toàn bộ /api/profile/* không CSRF**. 7 route sensitive. | Same kịch bản. | Thêm `assertSameOrigin` mỗi handler. |
| **B-007** | `src/lib/telegram/commands/admin-approve.ts:82-180` | `handleAdminApproveCallback` **KHÔNG dùng RPC `safe_assign_proxy`**. Race: 2 admin click Approve cùng lúc → cả 2 SELECT proxy `available` (line 117) → cả 2 UPDATE proxy = `assigned` (line 130) → 2 request approved cùng 1 proxy, 1 user lấy mất proxy của user khác. | Hai admin telegram cùng click admin_approve cho 2 request gần đồng thời. | Thay đoạn 117–147 bằng `supabaseAdmin.rpc("safe_assign_proxy", { p_request_id, p_proxy_id, p_admin_id })` y như `requests/[id]/route.ts:325`. |
| **B-008** | `src/lib/telegram/commands/cancel.ts:105-108` | `handleCancelConfirm` update `.in("id", ids)` **không filter `status="pending"`**. Race: user click "Yes Cancel All" → giữa SELECT (line 93) và UPDATE (line 105) admin approve một request → request đã approved bị overwrite về `cancelled` → state machine bypass + proxy đã giao xong. | Approve concurrent với cancel-all. | Thêm `.eq("status", "pending")` vào UPDATE. |
| **B-009** | `src/app/api/proxies/[id]/route.ts:102-145` | PUT proxy: SELECT status (line 103) + state-machine guard (line 110) + UPDATE (line 141) **không atomic** — 3 statement riêng. 2 admin edit cùng proxy → cả 2 thấy state cũ, cả 2 pass canTransition → cả 2 UPDATE → final state có thể illegal (banned→available bypass maintenance). | Hai admin web đồng thời chỉnh status proxy. | Đẩy guard + update vào RPC `safe_update_proxy_status` (như `safe_bulk_edit_proxies` ở mig 041 đã làm cho bulk). |
| **B-010** | `supabase/migrations/041_wave23a_orphan_idx_and_bulk_edit.sql:56-92` | `safe_bulk_edit_proxies` RPC: `SELECT count(*)` (line 57) + `UPDATE` (line 74) trong cùng tx nhưng **không `FOR UPDATE`** trên các id trước count. READ COMMITTED → 2 tx concurrent đều thấy snapshot cũ pass guard → cùng UPDATE. Comment trong route bảo "atomic" nhưng thực ra TOCTOU vẫn còn. | 2 admin bulk-edit cùng tập id với target status khác nhau. | `SELECT id FROM proxies WHERE id = ANY(p_ids) FOR UPDATE` trước khi count + update. |
| **B-011** | `src/app/api/telegram/webhook/route.ts:22-23, 167-170` | `processedUpdates: Set<number>` in-memory dedup. Multi-instance Vercel → mỗi instance Set riêng → race. FIFO eviction (line 168) dùng `Set.values().next()` — Set giữ insertion order OK trong V8 nhưng không guaranteed bởi spec. Layer-2 DB dedup cứu được, nhưng nếu DB outage → fallback open (line 50 `return false`). | Telegram retry burst với DB latency cao. | DB-only dedup hoặc dùng Redis. Bỏ in-memory Set. |
| **B-012** | `src/app/api/proxies/route.ts:62, 90` | `query.ilike("host", '%${filters.search}%')` — không escape `%` `_` `\` từ user input. Pattern injection: user nhập `%` → match all (information disclosure: viewer role thấy host pattern họ không nên thấy). Đã có `sanitizeSearchTerm` ở `users/route.ts:20` nhưng KHÔNG dùng ở `proxies/route.ts`. | search=`%`. | Tách hàm chung `escapePostgrestPattern` rồi gọi ở mọi route dùng `ilike/or`. |
| **B-013** | `src/app/api/cron/expire-requests/route.ts:43-46` | UPDATE `.in("id", ids)` không filter `status="pending"`. Cron chạy concurrent với admin approve cùng request → request approved bị flip về expired → state machine bypass + proxy đã giao trở thành mồ côi. | Cron tick + admin approve cùng lúc. | Thêm `.eq("status", "pending")` vào UPDATE; hoặc tạo RPC `safe_expire_requests` giống `safe_expire_proxies` (mig 031). |
| **B-014** | `src/lib/telegram/commands/bulk-proxy.ts:175-185, 226` | `handleAdminBulkApproveCallback`: SELECT request status (line 175) + RPC bulk_assign + UPDATE request status (line 240). Pre-check `status !== "pending"` không atomic → 2 admin click bulk_approve cùng request → cả 2 RPC chạy → đôi khi `bulk_assign_proxies` chạy 2 lần với cùng request_id → giao gấp đôi. | 2 admin click admin_bulk_approve same request. | Đặt `.eq("status", "pending")` trong UPDATE và check `data?.length > 0` để biết mình mới là người approve. |

### P1 — HIGH

| ID | File:line | Bug | Fix |
|---|---|---|---|
| **B-015** | `src/app/api/proxies/import/route.ts:102` | Code đọc `proxy.isp` nhưng `ImportProxyRow` interface (line 12-21) **không khai báo `isp`**. TypeScript loose vì cast `Record<string, unknown>`. Per-row isp từ TXT bị loose, fallback về bulk. | Thêm `isp?: string` vào interface; verify schema cho phép. |
| **B-016** | `src/app/api/users/route.ts:79` | Trả raw `error.message` từ Supabase → leak schema (column name, constraint name). Wave 22D-3 đã fix ở `proxies/route.ts:228` ("Failed to fetch proxies") nhưng users/route bỏ sót. | Thay `error.message` bằng generic "Failed to fetch users" + `captureError`. |
| **B-017** | `src/app/api/users/route.ts:155, requests/route.ts:159, users/[id]/route.ts:153, requests/[id]/route.ts:452, admins/[id]/route.ts:125, settings/route.ts (PUT)` | Tương tự B-016 — nhiều nơi vẫn leak `error.message`. | Sweep + thay generic message. |
| **B-018** | `src/app/api/requests/route.ts:125` | POST `/api/requests` **không CSRF** + thiếu `logActivity`. | Thêm `assertSameOrigin` + `logActivity({ action: "request.create_admin", … })`. |
| **B-019** | `src/app/api/users/route.ts:109` | POST `/api/users` thiếu `logActivity`. (Đã có CSRF). | Thêm `logActivity({ action: "user.create", … })`. |
| **B-020** | `src/app/api/cron/expire-requests/route.ts:50-65` | Sequential `for await sendTelegramMessage` — 500 expired x 1s/req = 500s, vượt timeout Lambda. Đã fix ở `expire-proxies` (Wave 22E-2 dùng concurrency=10) nhưng `expire-requests` còn nguyên. | Áp dụng cùng pattern: `Promise.allSettled` với batch concurrency. |
| **B-021** | `src/lib/telegram/commands/revoke.ts:158` | Sequential `for await revokeProxy` cho `revoke:all`. User có 20 proxy → 20s. | Promise.allSettled với chunk size 5. |
| **B-022** | `src/lib/telegram/commands/admin-approve.ts:130` | UPDATE proxy không enforce state-machine `proxyMachine.canTransition(available, assigned)`. Nếu proxy đã ở `expired/banned` (do cron giữa lúc), vẫn được flip về `assigned`. | Dùng `safe_assign_proxy` RPC. |
| **B-023** | `src/lib/telegram/commands/admin-approve.ts:263, 311` | UPDATE tele_users.status `active`/`blocked` không kiểm soát transition (no state machine cho user status). User đang `banned` có thể bị admin "approve" về `active` qua callback notification cũ. | Tạo `userStatusMachine`. |
| **B-024** | `src/app/api/chat/route.ts:202` | `await import("@/lib/logger")` runtime — slow cold start, inconsistent. | Đẩy lên top-level import. |
| **B-025** | `src/lib/telegram/commands/cancel.ts:84` | Validate language: `(user.language === "vi" \|\| user.language === "en") ? user.language : "en"` — duplicate logic ở ~6 chỗ thay vì gọi `getUserLanguage`. | Dùng `getUserLanguage` allover. |
| **B-026** | `src/app/api/profile/password/route.ts:33` | Comment ghi "rate limit ~30 req/hr/email từ Supabase" — đúng nhưng KHÔNG có in-app rate limit, không kiểm soát brute force current_password (response 401 leak "wrong current password"). | Thêm rate limit `lib/rate-limiter.ts` với key `password_change:${admin.id}` 5 req/15 phút. |

### P2 — MEDIUM

| ID | File:line | Bug | Fix |
|---|---|---|---|
| **B-027** | `src/lib/error-tracking.ts:71` | TODO Sentry chưa cài, chỉ console.error. Stale TODO 1 năm? | Quyết: cài Sentry hoặc gỡ TODO + đổi tên file. |
| **B-028** | `src/app/api/telegram/webhook/route.ts:50` | `isDuplicateInDb` fail-open trên DB error → Telegram retry → process trùng. | Fail-closed (return true on error) hoặc inject monitor. |
| **B-029** | `src/lib/telegram/commands/revoke.ts` (toàn file) | Mix `ạn` Unicode escape lẫn UTF-8 trực tiếp — REVIEW_BOT_UX.md item #4 đã list, vẫn chưa fix. | sed/normalize toàn file về UTF-8. |
| **B-030** | `src/lib/telegram/commands/admin-approve.ts:160` | Hardcoded fallback ngôn ngữ tiếng Việt KHÔNG DẤU ("Proxy da duoc cap"). Inconsistent với i18n đã có cho user-facing message. | Dùng `t("proxyAssigned", lang)` từ messages.ts. |
| **B-031** | `src/app/api/proxies/[id]/route.ts:34-37` | DELETE viewer role check thiếu — chỉ GET có viewer-strip-password. PUT/DELETE chỉ guard `requireAdminOrAbove`. OK nhưng nhất quán nên có comment. | Comment hoặc test |
| **B-032** | `src/app/api/admins/[id]/route.ts:33-35` | UpdateAdminSchema cho phép `telegram_id` nhưng KHÔNG validate format Telegram ID (1..1e10). Có `.coerce.number().int().positive()` — quá loose, telegram_id dài hơn 1e15 vẫn pass. | Thêm `.max(9_999_999_999)`. |
| **B-033** | `supabase/migrations/048_wave23c_audit_immutability.sql` | Trigger immutability OK nhưng `current_setting('app.activity_logs_purge', true)` chỉ check session GUC. Service role có thể `SET LOCAL app.activity_logs_purge=on` từ bất kỳ RPC nào → bypass. | Hardcode chỉ cho phép trong specific function `purge_activity_logs(p_before TIMESTAMPTZ)`. |
| **B-034** | `supabase/migrations/049_wave23c_bot_files_audit.sql:24` | Cột `telegram_message_id BIGINT` nhưng code `bulk-proxy.ts:113` không insert nó. Dead column. | Hoặc populate từ `sendTelegramDocument` response, hoặc drop column. |
| **B-035** | `src/lib/telegram/commands/bulk-proxy.ts:111-122` | `bot_files` insert không await + không in-flight check error handling tốt. Comment ghi "best-effort" nhưng thiếu metric/sample log. | OK nhưng nên đếm fail rate. |
| **B-036** | `src/app/api/proxies/route.ts:62` | Search `ilike` không index. Bảng 10k+ rows → sequential scan. | Tạo trigram GIN index `host gin_trgm_ops` (đã có cho `isp` rồi drop ở mig 041, lại không có cho host?). |
| **B-037** | `src/app/api/proxies/route.ts:122` | Filter `expiry_status=valid` dùng `or(expires_at.is.null, expires_at.gt.X)` — `or` clause + `eq("is_deleted", false)` ở `eq()` chain trước → PostgREST kết hợp OK, nhưng nếu mở rộng `or` lồng, có thể parse sai. | Cover bằng integration test. |

### P3 — LOW

| ID | File:line | Issue | Note |
|---|---|---|---|
| **B-038** | `src/lib/telegram/commands/aup.ts` | Dead file (handlers gỡ). | Xóa file hoặc move `archive/`. |
| **B-039** | `src/lib/error-tracking.ts:17-23` | Comment Sentry config commented-out 30 dòng. | Move docs ra README hoặc gỡ. |
| **B-040** | 79 file × 166 console.* | Mix `console.error` raw + `captureError` + `logger`. | Hook lint: `no-console` exception list. |
| **B-041** | `src/components/proxies/proxy-import.tsx:430+` | Hardcoded VN string lẫn EN string ("Đã đọc N dòng") không qua i18n. | port lên `t("proxies.import.read_lines", { count })`. |
| **B-042** | `src/components/categories/CategoryFormDialog.tsx:160`, etc. | `toast.success("Category created")` hardcode EN. | i18n. |
| **B-043** | `src/lib/telegram/commands/start.ts:184` | Hàm `handleStart` 173 LOC > 50. | Split: `notifyAdminsForNewUser`, `replyPending`, `replyBlocked`, `replyMain`. |

---

## Section 2 — Feature completeness scorecard (0–10)

| Feature | Score | Lý do | Bug cụ thể |
|---|---|---|---|
| **Tab Quản lý proxy (CRUD + bulk + import + export + check + probe)** | **7.0** | CRUD đủ, import wizard mạnh, probe-batch tốt. NHƯNG state-machine TOCTOU (B-009, B-010), `ilike` chưa escape (B-012), search no-index (B-036), filter UI mix VN/EN. | B-009, B-010, B-012, B-015, B-036 |
| **Tab Yêu cầu proxy (single + bulk + admin queue)** | **6.5** | Single approve có safe_assign_proxy + retry race-loss tốt. Bulk approve OK qua RPC. **NHƯNG admin-approve.ts callback vẫn dùng pattern cũ** (B-007), cancel race (B-008), expire cron race (B-013). | B-007, B-008, B-013, B-014 |
| **Tab User (CRUD + AUP gỡ)** | **7.5** | AUP đã gỡ sạch theo user spec. CRUD + rate-limit + global cap enforcement OK. Trash + restore work. THIẾU: log error.message leak (B-016), POST không log activity (B-019). | B-016, B-019, B-023 |
| **Tab Admin (CRUD + 2FA + sessions)** | **5.0** | **Tất cả route admin/[id]/* không CSRF** — đây là gap lớn nhất review này (B-001, B-002, B-003, B-004). 2FA disable + reset-password đều exposed. Self-target guard có. | B-001, B-002, B-003, B-004, B-032 |
| **Tab Categories** | **8.5** | CRUD + bulk-assign + reorder đều có CSRF + activity log + RLS. Defaults cascade hoạt động. Nhỏ: hardcoded EN string toast. | B-042 |
| **Tab Settings** | **7.0** | Secret key isolation (telegram_bot_token excluded from DB) tốt. Self-target deactivate guard có. NHƯNG PUT vẫn `error.message` raw leak (B-017). | B-017 |
| **Tab Chat** | **7.5** | RPC dedup get_recent_conversations OK (Wave 22D-4). POST có CSRF. NHƯNG runtime `await import` (B-024), `error.message` leak. | B-017, B-024 |
| **Tab Logs** | **8.0** | Append-only trigger trên activity_logs (Wave 23C, mig 048). Sanitize input ổn. Edge: GUC bypass (B-033) cần chặt. | B-033 |
| **Tab Trash** | **8.5** | Soft delete + restore + permanent delete đủ ở proxies/users/requests. CASCADE→RESTRICT (mig 046) bảo vệ audit OK. | — |
| **Bot flow end-to-end** | **6.0** | UX redesign Wave 23B đã đỡ rất nhiều, persistent reply keyboard gỡ. NHƯNG **admin-approve.ts callback chưa migrate sang safe RPC** (B-007), cancel race (B-008), revoke sequential (B-021), Unicode escape mix (B-029), in-memory dedup (B-011), aup.ts dead code (B-038). | B-007, B-008, B-011, B-021, B-029, B-038 |

**Tổng kết:** trung bình 7.15/10. Project ship được nhưng phần admin/security path mới là điểm đau — nếu user là 1 người dùng cá nhân OK, nếu là multi-admin team thì CSRF gap đủ để trục lợi.

---

## Section 3 — Inconsistency / Đồng bộ (30+ items, file:line)

### Error handling pattern không nhất quán

| # | File:line | Inconsistency |
|---|---|---|
| 1 | `src/app/api/proxies/route.ts:228` vs `src/app/api/users/route.ts:79` | Một dùng "Failed to fetch proxies", một raw `error.message`. |
| 2 | `src/app/api/proxies/route.ts:226` vs `src/app/api/requests/route.ts:114` | Một `captureError(...)`, một dùng nhưng không đồng nhất source name. |
| 3 | `src/app/api/proxies/[id]/route.ts:41` console.error vs `requests/[id]/route.ts:50` không có. |
| 4 | `src/app/api/proxies/import/route.ts:166` `captureError` vs `proxies/bulk-edit/route.ts:98` `console.error`. |
| 5 | `src/app/api/cron/expire-proxies/route.ts:75` `captureError` vs `cron/expire-requests/route.ts:62` `captureError` nhưng không đồng `source` namespace. |

### CSRF không nhất quán

| # | File:line | Status |
|---|---|---|
| 6 | `src/app/api/proxies/*` (all routes) | **CSRF có**. |
| 7 | `src/app/api/users/[id]/route.ts:53, 199` | CSRF có. |
| 8 | `src/app/api/requests/[id]/route.ts:64, 535` | CSRF có. |
| 9 | `src/app/api/requests/route.ts (POST)` | **CSRF thiếu** (B-018). |
| 10 | `src/app/api/admins/[id]/*` | **CSRF thiếu toàn bộ** (B-001..B-004). |
| 11 | `src/app/api/profile/*` | **CSRF thiếu toàn bộ** (B-005, B-006). |
| 12 | `src/app/api/categories/*` | CSRF có. |
| 13 | `src/app/api/settings/route.ts (PUT)` | CSRF có. |

### Logging pattern không nhất quán

| # | File:line | Issue |
|---|---|---|
| 14 | `src/lib/telegram/commands/admin-approve.ts:130-147` | UPDATE proxy + UPDATE request **không có `logActivity`**. |
| 15 | `src/lib/telegram/commands/admin-approve.ts:196-204` | Reject **không có `logActivity`**. |
| 16 | `src/lib/telegram/commands/admin-approve.ts:263, 311` | Approve/Block user **không có `logActivity`**. |
| 17 | `src/lib/telegram/commands/cancel.ts:105` | UPDATE **không log**. |
| 18 | `src/app/api/proxies/route.ts:281` `logActivity` ✓ vs `requests/route.ts (POST)` ✗ vs `users/route.ts (POST)` ✗. |
| 19 | `src/lib/telegram/commands/bulk-proxy.ts:240-292` | Bulk approve không có `logActivity` nhánh telegram. |

### Response format không thống nhất

| # | File:line | Issue |
|---|---|---|
| 20 | `proxies/route.ts:222` returns `{ success, ...response }` (spread) vs `users/route.ts:85` returns `{ success, data: {...} }` nested. |
| 21 | `proxies/route.ts:293` 201 status vs `requests/route.ts:166` 201 vs `users/route.ts:162` 201 vs `categories/route.ts (varies)`. Inconsistent đôi chỗ trả `data` đôi chỗ `data.data`. |
| 22 | `requests/[id]/route.ts:46` `data` direct vs `chat/route.ts:142` `data: ConversationResponse[]`. |

### Validation pattern không nhất quán

| # | File:line | Issue |
|---|---|---|
| 23 | `users/route.ts:20` có `sanitizeSearchTerm` vs `proxies/route.ts:62` không escape ilike. |
| 24 | `requests/route.ts:46` parse status comma split inline vs các filter khác parse 1 lần. |
| 25 | `users/[id]/route.ts:67-74` lồng `flat.formErrors` vs `proxies/[id]/route.ts:67` chỉ `fieldErrors`. |

### console.* vs logger

| # | File | Count |
|---|---|---|
| 26 | `src/lib/telegram/commands/admin-approve.ts` | 6× console.error trực tiếp, không qua `captureError`. |
| 27 | `src/lib/telegram/commands/bulk-proxy.ts` | 8× console.error. |
| 28 | `src/app/api/admins/[id]/disable-2fa/route.ts:93, 110` | 2× console.error trong sensitive flow. |

### Naming convention vi phạm

| # | File:line | Issue |
|---|---|---|
| 29 | `src/lib/logger.ts:60` `logActivity(params)` camelCase vs `src/lib/telegram/logging.ts logActivity({ actor_type, ... })` snake_case wrapper. Hai shape khác nhau cùng tên hàm — dễ nhầm. |
| 30 | `src/components/categories/CategoryFormDialog.tsx` PascalCase file vs `proxies/proxy-form.tsx` kebab. |
| 31 | `src/lib/telegram/commands/check-proxy.ts` kebab vs `revoke.ts` đơn từ — OK nhưng `admin-approve.ts` action prefix khác `bulk-proxy.ts`. |

### Code duplication >85% similarity

| # | Locations | Pattern |
|---|---|---|
| 32 | `src/app/api/proxies/[id]/route.ts:172-252` vs `users/[id]/route.ts:195-298` vs `requests/[id]/route.ts:531-611` | DELETE handler: same shell `csrf → auth → check exists → permanent flag → soft/hard → log`. ~80 LOC × 3 = 240 LOC duplicated. |
| 33 | `proxies/[id]/route.ts:11-47` vs `users/[id]/route.ts:10-47` vs `requests/[id]/route.ts:17-58` | GET handler shape duplicated. |
| 34 | `bulk-proxy.ts:165-296` vs `requests/[id]/route.ts:127-265` | Bulk approve logic: rate-limit pre-check + `bulk_assign_proxies` RPC + send proxies + bot_files audit. Bot version 100 LOC vs API version 100 LOC ~85% similar. |
| 35 | Notification template strings: `requests/[id]/route.ts:494`, `admin-approve.ts:160`, `cancel.ts:111` — VI/EN ternary inline thay vì `messages.ts t()`. |

---

## Section 4 — File structure metrics + recommendations

### Top 10 file LOC (cần split)

| Rank | File | LOC | Recommendation |
|---|---|---|---|
| 1 | `src/app/api/docs/openapi.ts` | 1213 | OK — generated/declarative. Để vậy. |
| 2 | `src/app/api/__tests__/cron.test.ts` | 1084 | Test file — OK nhưng có thể split per-cron. |
| 3 | `src/app/(dashboard)/profile/page.tsx` | 838 | **VI PHẠM 800 max**. Tách thành ProfileTab/SecurityTab/TwoFactorTab/SessionsTab components. |
| 4 | `src/components/proxies/proxy-import.tsx` | 832 | **VI PHẠM**. Wizard 4 step → 4 component. |
| 5 | `src/app/(dashboard)/bot/simulator/page.tsx` | 625 | Tạm OK — admin-only tool. |
| 6 | `src/app/api/requests/[id]/route.ts` | 611 | **PRIORITY refactor**. Tách: approveSingle/approveBulk/reject/cancel service. |
| 7 | `src/app/(dashboard)/settings/page.tsx` | 603 | Split per-section tab. |
| 8 | `src/app/(dashboard)/proxies/page.tsx` | 567 | Tạm OK với filter+table. |
| 9 | `src/app/(dashboard)/admins/[id]/page.tsx` | 523 | Split. |
| 10 | `src/types/database.ts` | 518 | OK — generated types. |

### Top 10 function LOC

| Rank | Function | LOC | File |
|---|---|---|---|
| 1 | `ProxyImport` | 728 | `proxy-import.tsx:24802` |
| 2 | `PUT (requests/[id])` | 469 | `requests/[id]/route.ts:14000` — **9× quá ngưỡng 50** |
| 3 | `TwoFactorCard` | 273 | `profile/page.tsx:4993` |
| 4 | `UserRateLimit` | 237 | `user-rate-limit.tsx` |
| 5 | `UserDetail` | 237 | `user-detail.tsx` |
| 6 | `PUT (settings)` | 237 | `settings/route.ts:14611` |
| 7 | `GET (proxies)` | 220 | `proxies/route.ts:13165` |
| 8 | `POST (recover-2fa)` | 208 | `auth/recover-2fa/route.ts` |
| 9 | `UserChatPanel` | 207 | `user-chat-panel.tsx` |
| 10 | `handleStart` | 173 | `start.ts:37264` |

### Service layer status

`docs/ARCHITECTURE_SERVICE_LAYER.md` plan **vẫn còn đúng** — chưa thực thi đoạn nào. Hiện tại 0 file `src/services/`. Wave 23C đã ship hardening + audit nhưng route handlers chưa split. Recommendation: dùng `requests/[id]/route.ts` (611 LOC) làm pilot — rip ra 4 service:
- `services/request-approval.service.ts` (single + bulk)
- `services/request-reject.service.ts`
- `services/proxy-assignment.service.ts`
- `services/notification.service.ts` (Telegram + admin notify shared)

### Test coverage gap (heatmap)

| Module | Files | Tested | Gap |
|---|---|---|---|
| `src/app/api/proxies/*` | 9 routes | ✓ proxies, probe-batch, validations, bulk-edit | NO probe-single, NO check, NO export, NO bulk-edit edge cases |
| `src/app/api/requests/*` | 2 routes | ✓ request-approval | NO bulk-approve race, NO cancel-race |
| `src/app/api/admins/*` | 4 routes | ✗ NONE | **All admin routes untested** — sensitive flow! |
| `src/app/api/profile/*` | 7 routes | ✗ NONE | **All profile routes untested** — auth/2FA/password |
| `src/app/api/cron/*` | 5 routes | ✓ cron.test.ts comprehensive | OK |
| `src/lib/telegram/commands/*` | 15 file | ~5 tested (start, status, custom-order, get-proxy, assign-proxy) | NO test admin-approve, NO bulk-proxy admin handler, NO cancel race |
| `src/lib/state-machine/*` | 3 file | ✓ tested | OK |
| `src/lib/csrf.ts` | 1 file | ? | Verify |

**Concrete gap:** 16 route handler không test tại tier admin/profile (CSRF-relevant). 0% coverage cho admin lifecycle = không catch B-001..B-006 trong CI.

---

## Section 5 — Self-critical (review tool dễ overrate đoạn nào?)

1. **`safe_bulk_edit_proxies` "atomic" claim** — review trước (Wave 22E-3) khen "atomic" nhưng thực ra TOCTOU vẫn còn (B-010). Tool overrate vì comment trong code dùng từ "atomic" mà không kiểm chứng SQL semantics. **Bài học:** tin code comment là sai lầm; phải đọc SQL với mindset isolation level.
2. **CSRF "đã có"** — `assertSameOrigin` được giới thiệu Wave 22+ và áp dụng partial. Mỗi review trước thấy 1 file có là tick OK, không sweep toàn bộ. **Reality:** 13 route POST/PUT/DELETE thiếu (B-001..B-006, B-018). Review tool vào 1 file là không đủ — cần audit horizontal.
3. **State machine "enforce ở route"** — tool khen có `requestMachine.canTransition` ở 2 chỗ. Thực tế: bot 4 chỗ + cron 1 chỗ + telegram 3 chỗ ĐỀU không qua → enforce coverage <30%. **Audit horizontal pattern: grep `.update({ status:` ra hết.**
4. **Wave 23C ship "OK"** — bot_files insert (mig 049) audit table được ship + reference từ bulk-proxy.ts:111-122. NHƯNG `telegram_message_id BIGINT` cột có mà không bao giờ được populate (B-034). Half-done. **Bài học:** ship feature kèm sample data + verify column được dùng.
5. **Wave 23B-bot UX hardening** — REVIEW_BOT_UX.md liệt 10 issue, ship Wave 23B + 23B-bot-fix giải quyết 7. Còn 3: hardcoded VI no-dấu fallback (B-030), Unicode escape (B-029), `denyIfNotApproved` không guard tất cả command (verify needed). Ghi "đã fix" nhưng audit lại vẫn thấy.
6. **`safe_assign_proxy` retry-race-loss loop ở `requests/[id]/route.ts:305-341`** — looks tốt. NHƯNG: nếu admin pick `proxy_id` cụ thể và proxy đó vừa bị flip `assigned` bởi cron/bot → RPC trả "no longer available", code không retry (line 339), trả 409. UX OK nhưng error message generic; admin không biết sao proxy biến mất khỏi pool. Cần error code phân biệt "race lost" vs "permission denied" vs "not found".
7. **Migration 048 immutability** — feature tốt, NHƯNG GUC bypass (B-033) — service role có thể dùng `SET LOCAL` trong bất kỳ RPC nào. Đoạn `purge` chưa được implement (mig nói "Wave 25"). Có nguy cơ "ship trigger nhưng quên gỡ session GUC" trong tương lai.

### Tech debt INVISIBLE (chỉ đọc code không thấy)

1. **Admin role transition không log:** `admin-approve.ts:263` flip user `pending → active` không có activity_logs row. Audit trail rỗng cho hành động sensitive.
2. **Settings cache miss:** `loadGlobalCaps()` đọc DB mỗi lần `/getproxy` callback → 2× DB hit per user click. Tích lũy 1000 user/h = 2k DB query rỗng. Cần in-memory TTL 60s cache.
3. **Webhook dedup table không có pruning trigger:** `cleanupOldDedupEntries` chạy "every 100 requests" — nếu webhook im 1 ngày, không cleanup; restart không đặt counter. Cần pg_cron job.
4. **CategoryPicker tạo new categoryid trên-the-fly không qua state-machine** — categories có thể có cycle nếu admin nghịch. Không có constraint.
5. **`bot_conversation_state` (mig 047) TTL 30min đọc-time:** comment ghi "future cron sweep" — chưa có. Bảng tăng dần.

---

## Section 6 — Top 20 Priority items để fix tăng score

| Rank | Item | Severity | Effort | Score impact |
|---|---|---|---|---|
| 1 | Sweep CSRF: thêm `assertSameOrigin` cho `/api/admins/*` + `/api/profile/*` + `/api/requests` POST | P0 | S (1 buổi) | Admin 5→8 |
| 2 | Migrate `handleAdminApproveCallback` (telegram bot) sang `safe_assign_proxy` RPC | P0 | M | Bot 6→7.5 |
| 3 | Fix race trong `safe_bulk_edit_proxies` RPC: `SELECT ... FOR UPDATE` trước count | P0 | S | Proxy 7→8 |
| 4 | Fix `cancel.ts` race: thêm `.eq("status", "pending")` trong UPDATE; fix expire-requests cron tương tự | P0 | XS | Bot 6→7 |
| 5 | Tạo `safe_update_proxy_status` RPC + dùng ở `proxies/[id]/route.ts` PUT | P1 | M | Proxy 7→8 |
| 6 | Sweep `error.message` leak: thay generic + `captureError` ở 6 route | P1 | S | Đồng bộ |
| 7 | Concurrent telegram send: áp `Promise.allSettled` cho expire-requests + revoke:all | P1 | XS | Bot+cron |
| 8 | Migrate `telegram/commands/admin-approve.ts` user lifecycle (active/blocked) qua state machine | P1 | M | Bot |
| 9 | Add CSRF tests + Admin/Profile API tests (target 80% coverage 16 route mới) | P1 | L | Test gap |
| 10 | Refactor `requests/[id]/route.ts` thành service layer (pilot) | P2 | L | Maintainability |
| 11 | Settings cache TTL 60s cho `loadGlobalCaps` (giảm DB load) | P2 | S | Perf |
| 12 | i18n hóa toast strings ở `components/categories`, `proxies/proxy-bulk-edit`, `chat-window` | P2 | M | Đồng bộ |
| 13 | Fix Unicode escape mix → UTF-8 ở `revoke.ts`, `cancel.ts`, `messages.ts` (REVIEW_BOT_UX item 4) | P2 | S | Bot |
| 14 | Tách `proxy-import.tsx` (832 LOC) thành 4 sub-component | P2 | M | Code health |
| 15 | Tách `profile/page.tsx` (838 LOC) thành tab components | P2 | M | Code health |
| 16 | Add trigram GIN index cho `proxies.host` (search perf) | P2 | XS | Perf 10k+ |
| 17 | Cài Sentry hoặc gỡ TODO khỏi `error-tracking.ts` | P2 | S | Tech debt |
| 18 | Pin `safe_assign_proxy` error codes (not_found vs race_lost vs forbidden) | P2 | S | UX admin |
| 19 | Drop `bot_files.telegram_message_id` cột chết hoặc populate | P3 | XS | Đồng bộ |
| 20 | Xóa `commands/aup.ts` dead file | P3 | XS | Đồng bộ |

---

## Tổng kết Senior Dev

- **Strength:** state machine concept tốt, RPC pattern (`safe_assign_proxy`, `safe_revoke_proxy`, `safe_bulk_edit_proxies`, `safe_expire_proxies`) là backbone đúng. Activity logs immutability + audit trail chắc. Cron lock + dedup phòng thủ multi-instance khá ổn. Migration discipline tốt (idempotent, comment lý do).
- **Weakness:** **Admin/Profile path là điểm yếu nhất** — 13 route POST/PUT/DELETE thiếu CSRF, 0% test coverage. Admin telegram callback chưa migrate sang RPC pattern (race condition exposure). State machine enforce <30% coverage. Code duplication trong route handler ~30% (chưa có service layer).
- **Recommendation:** trước khi mở public beta cho team multi-admin, đóng top-4 P0 (CSRF sweep, admin-approve RPC migrate, bulk-edit RPC FOR UPDATE, cancel race). Đó là 1 wave bảo trì 2-3 ngày.

— end —
