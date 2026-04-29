# Security Audit — OWASP Top 10

**Scope:** `src/app/api/` — tất cả route handlers  
**Date:** 2026-04-28  
**Auditor:** security-reviewer agent  
**Stack:** Next.js 16 App Router · Supabase Auth + RLS · grammy webhook

---

## Tổng quan

| Severity | Count |
|----------|-------|
| CRITICAL | 1 |
| HIGH     | 5 |
| MEDIUM   | 5 |
| LOW      | 3 |

---

## CRITICAL

### C-1 — Open Redirect trong `auth/callback` (Broken Auth / A07)

**File:** `src/app/api/auth/callback/route.ts:7`

**Vấn đề:** Tham số `next` lấy thẳng từ query string và được dùng để redirect mà không validate. Attacker craft link `?next=https://evil.com` → sau khi user authn thành công, họ bị redirect ra ngoài domain.

```
GET /api/auth/callback?code=...&next=https://evil.com/phish
→ NextResponse.redirect(`${origin}https://evil.com/phish`)
```

`origin` + `next` concatenate không tạo ra absolute URL an toàn vì `next` hoàn toàn có thể là absolute URL.

**Repro:**
1. Gửi email invite chứa callback URL bị tamper.
2. Hoặc craft link: `https://app.example.com/api/auth/callback?code=VALID_CODE&next=https://attacker.com`.

**Patch:**

```typescript
// Chỉ cho phép path nội bộ (bắt đầu bằng /)
const rawNext = searchParams.get("next") ?? "/dashboard";
const next = rawNext.startsWith("/") && !rawNext.startsWith("//")
  ? rawNext
  : "/dashboard";
// Bỏ toàn bộ logic forwardedHost — redirect về origin + path là đủ
return NextResponse.redirect(`${origin}${next}`);
```

---

## HIGH

### H-1 — Supabase `error.message` leak ra HTTP response (Sensitive Data Exposure / A03)

**Files:**
| File | Lines |
|------|-------|
| `src/app/api/requests/route.ts` | 94, 159 |
| `src/app/api/requests/[id]/route.ts` | 448, 563, 586 |
| `src/app/api/users/route.ts` | 59, 132 |
| `src/app/api/users/[id]/route.ts` | 149, 227, 262 |
| `src/app/api/users/[id]/proxies/route.ts` | 36 |
| `src/app/api/chat/route.ts` | 45 |
| `src/app/api/admins/[id]/route.ts` | 58, 125 |
| `src/app/api/categories/[id]/defaults/route.ts` | 46 |

**Vấn đề:** Khi Supabase trả về lỗi DB, nhiều endpoint trả thẳng `error.message` về HTTP response. Message này chứa thông tin schema (tên bảng, tên cột, constraint name, pg error code) — rất hữu ích cho attacker để fingerprint DB và chuẩn bị injection.

Ví dụ tại `requests/route.ts:94`:
```typescript
return NextResponse.json(
  { success: false, error: error.message },  // leak: "duplicate key value violates unique constraint \"proxy_requests_pkey\""
  { status: 500 }
);
```

**Patch:** Thay toàn bộ các điểm này bằng message generic:
```typescript
// Thay
{ success: false, error: error.message }
// Bằng
{ success: false, error: "Internal server error" }
// Log error.message server-side qua captureError()
```

---

### H-2 — CSRF bảo vệ không đồng nhất (CSRF / A01)

**Vấn đề:** `assertSameOrigin` chỉ được gọi trên 5 endpoint:
- `POST /api/categories`
- `PATCH/DELETE /api/categories/[id]`
- `POST /api/categories/reorder`
- `POST /api/categories/bulk-assign`
- `POST /api/proxies/bulk-edit`

Các state-changing endpoint sau **không có** CSRF check:

| Endpoint | Method | Tác động |
|----------|--------|----------|
| `POST /api/proxies` | POST | Tạo proxy mới |
| `PUT /api/proxies/[id]` | PUT | Sửa proxy |
| `DELETE /api/proxies/[id]` | DELETE | Xóa proxy |
| `POST /api/proxies/import` | POST | Import hàng loạt |
| `POST /api/proxies/check` | POST | Trigger health check |
| `PUT /api/requests/[id]` | PUT | Approve/reject request — **phân phối proxy** |
| `DELETE /api/requests/[id]` | DELETE | Hủy request |
| `PUT /api/users/[id]` | PUT | Sửa rate limit user |
| `DELETE /api/users/[id]` | DELETE | Xóa user |
| `PUT /api/settings` | PUT | Đổi settings hệ thống |
| `POST /api/settings` | POST | Invite admin |
| `POST /api/chat` | POST | Gửi tin nhắn Telegram |
| `POST /api/bot-simulator/command` | POST | Trigger bot command |

**Ảnh hưởng:** Admin authn → bị dụ vào trang độc → cross-site form silently approve/reject proxy request, xóa user.

**Lưu ý:** SameSite=Lax cookie (Supabase mặc định) giảm nhẹ attack, nhưng không đủ cho top-level navigation POST từ form HTML. Defense-in-depth yêu cầu origin check trên tất cả mutation.

**Patch:** Thêm vào đầu mọi mutation handler:
```typescript
const csrfErr = assertSameOrigin(request);
if (csrfErr) return csrfErr;
```

Hoặc tốt hơn, apply ở middleware `src/proxy.ts` cho toàn bộ `/api/` (trừ webhook/cron).

---

### H-3 — `POST /api/proxies/import` — DB error message trả về trong response body (Data Leak + Info Disclosure)

**File:** `src/app/api/proxies/import/route.ts:132`

```typescript
result.errors.push({
  line: i + 1,
  raw: `batch ${Math.floor(i / IMPORT_BATCH_SIZE) + 1}`,
  reason: error.message,  // leak Postgres error message
});
```

Khác với H-1, điểm này trả error message **trong success response** (`status: 200`) như một phần của `data.errors[]`. Import endpoint trả về array lỗi cho UI hiển thị, nhưng Postgres error messages có thể leak column name, constraint name, pg error code.

**Patch:**
```typescript
reason: "Database error on batch insert", // hoặc map pg error codes → user message
```

---

### H-4 — `GET /api/health` không cần auth, leak DB connectivity status (Misconfiguration / A05)

**File:** `src/app/api/health/route.ts`

**Vấn đề:** Endpoint công khai (no auth, explicitly excluded from middleware matcher). Không có vấn đề gì với việc trả `{ status: "healthy" }` — nhưng khi DB lỗi, response chứa:
```json
{ "status": "degraded", "services": { "database": "error" } }
```

Middleware matcher (line 74 `proxy.ts`) có `api/health` excluded, tức **hoàn toàn public**. Điều này cho attacker biết trạng thái DB, timing của deploys, v.v.

**Patch đề xuất:**
```typescript
// Option 1: Thêm secret header check (cho uptime monitor)
const monitorKey = request.headers.get("x-monitor-key");
if (monitorKey !== process.env.HEALTH_MONITOR_KEY) {
  return NextResponse.json({ status: "ok" }); // minimal response nếu unauthenticated
}
// Full response chỉ với key hợp lệ

// Option 2: Trả response tối giản bất kể auth
return NextResponse.json({ status: error ? "degraded" : "healthy" });
// Bỏ services breakdown
```

---

### H-5 — `POST /api/auth/recover-2fa` — Không có rate limiting riêng (Broken Auth / A07)

**File:** `src/app/api/auth/recover-2fa/route.ts`

**Vấn đề:** Endpoint **unauthenticated** (by design — admin bị lockout). Comment trong code nói "relies on Supabase Auth's own throttle on signInWithPassword (~5 attempts/minute)".

Vấn đề: Supabase rate limit áp dụng trên `signInWithPassword` — nhưng code Step 1 (lookup admin row) và Step 3 (validate backup code) chạy **trước** khi gọi `signInWithPassword`. Attacker có thể:
1. Gửi email giả → Step 1 fail → không touch Supabase auth throttle.
2. Gửi email đúng + password đúng → enumerate backup codes (mỗi attempt tốn 1 Supabase auth call, nhưng backup codes là 8 codes × bcrypt = chậm, nên đây là LOW risk riêng).

Nguy hiểm hơn: Supabase Auth throttle là per-email, nhưng Step 1 check `is_active = true` — attacker có thể brute-force email list của admins mà không bị throttle.

**Patch:**
```typescript
// Thêm application-level rate limit trước mọi logic
const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
const rl = await checkApiRateLimit(ip); // hoặc custom stricter limit
if (!rl.allowed) {
  return NextResponse.json({ success: false, error: "Too many attempts" }, { status: 429 });
}
```

---

## MEDIUM

### M-1 — `OR` filter trong `/api/users` có thể bị PostgREST injection (A03 Injection)

**File:** `src/app/api/users/route.ts:38-40`

```typescript
query = query.or(
  `username.ilike.%${filters.search}%,first_name.ilike.%${filters.search}%,...`
);
```

**Vấn đề:** `filters.search` được nhúng trực tiếp vào chuỗi PostgREST `or()` filter. Supabase JS client không escape chuỗi truyền vào `.or()`. Một search string như:

```
%,telegram_id.gt.0,username.ilike.%
```

có thể break logic filter. Mức độ: attacker là authenticated admin — real injection thành SQL rất khó qua Supabase's parametrized layer, nhưng filter manipulation (leak thêm rows, break pagination counts) là khả thi.

**Contrast:** `proxies/route.ts:61` dùng `.ilike("host", ...)` — safe vì Supabase JS properly parametrizes column + value khi gọi `.ilike()` trực tiếp.

**Patch:**
```typescript
// Tách thành separate ilike calls thay vì or() string concat
if (filters.search) {
  const s = `%${filters.search}%`;
  query = query.or(`username.ilike.${s},first_name.ilike.${s},last_name.ilike.${s}`);
  // Hoặc dùng Supabase textSearch nếu cần
}
// Xử lý telegram_id search riêng, safe:
if (!isNaN(Number(filters.search))) {
  query = query.or(`telegram_id.eq.${Number(filters.search)}`);
}
```

Thực tế an toàn hơn: bỏ string interpolation, tách thành nhiều `.or()` calls với giá trị escaped.

---

### M-2 — `GET /api/stats` trả về `Cache-Control: public` — cache poisoning risk (A05)

**File:** `src/app/api/stats/route.ts:46`  
**File:** `src/app/api/stats/analytics/route.ts:22`

```typescript
"Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
```

**Vấn đề:** `public` cho phép CDN cache response mà không kiểm tra xác thực. Mặc dù route có auth check, Vercel's Edge Network cache response sau authn thành công → response của admin A có thể serve cho admin B. Đây là thông tin không nhạy cảm (dashboard stats), nhưng tạo tiền lệ xấu.

**Patch:** Đổi thành `private`:
```typescript
"Cache-Control": "private, s-maxage=30, stale-while-revalidate=60",
```

Hoặc dùng `Vary: Cookie, Authorization` nếu vẫn muốn edge cache.

---

### M-3 — `bot-simulator` leak error.message từ handler (Info Disclosure)

**File:** `src/app/api/bot-simulator/command/route.ts:148`

```typescript
error: error instanceof Error ? error.message : "Handler error",
```

Bot simulator handler errors có thể chứa DB messages, stack traces từ grammy context. Trả ra HTTP response → admin thấy được, nhưng nếu có session sharing hoặc logging middleware, info có thể leak.

**Patch:**
```typescript
error: "Bot simulator handler error", // generic
// Log chi tiết: captureError(error, { source: "bot-simulator" })
```

---

### M-4 — In-memory webhook rate limit không bền (Replay / DoS / A09)

**File:** `src/app/api/telegram/webhook/route.ts:25-32`

```typescript
const webhookRateLimits = new Map<number, { count: number; resetAt: number }>();
```

**Vấn đề:** `webhookRateLimits` Map là module-scoped in-memory. Trên Vercel serverless:
- Mỗi cold start → Map rỗng → window reset.
- Nhiều instances → mỗi instance có Map riêng → user có thể gửi 30 req/min × số instances.

DB-backed dedup (`webhook_dedup`) bảo vệ replay, nhưng rate limiting không persistent → không thực sự ngăn được flood từ user có nhiều instances serving.

**Patch:** Migrate rate limit sang Supabase RPC tương tự `check_api_rate_limit`:
```typescript
const { data } = await supabaseAdmin.rpc("check_webhook_rate_limit", {
  p_chat_id: chatId,
  p_max_requests: RATE_LIMIT_MAX,
  p_window_seconds: 60,
});
```

---

### M-5 — `GET /api/docs` expose OpenAPI spec (Info Disclosure / A05)

**File:** `src/app/api/docs/route.ts`

**Vấn đề:** Route này không có auth check. OpenAPI spec expose toàn bộ API schema — endpoint paths, parameter names, response shapes. Attacker không cần đăng nhập để biết attack surface.

**Patch:**
```typescript
export async function GET(request: Request) {
  const supabase = await createClient();
  const { error: authError } = await requireAnyRole(supabase);
  if (authError) return authError;
  return NextResponse.json(openApiSpec);
}
```

---

## LOW

### L-1 — `console.error` với raw error objects (Info Disclosure qua logs)

**Files:** Nhiều file (xem grep output) — `proxies/[id]/route.ts:40`, `proxies/[id]/route.ts:160,239`, etc.

Dùng `console.error("...", error)` thay vì `captureError()`. Không trực tiếp expose ra HTTP response, nhưng:
- Vercel Function logs có thể được read bởi nhiều team members.
- Stack traces trong logs chứa file paths, line numbers.

**Patch:** Thay `console.error("X error:", error)` bằng `captureError(error, { source: "X" })` để centralize và control log output.

---

### L-2 — Thiếu security headers (A05 Misconfiguration)

**Vấn đề:** Không tìm thấy `next.config.ts/js` headers config. Không có:
- `Content-Security-Policy`
- `X-Frame-Options`
- `X-Content-Type-Options`
- `Referrer-Policy`
- `Permissions-Policy`

**Patch:** Thêm vào `next.config.ts`:
```typescript
async headers() {
  return [
    {
      source: "/(.*)",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self' 'unsafe-inline'; ..." },
      ],
    },
  ];
}
```

---

### L-3 — `x-forwarded-for` IP không verified (Broken Access Control / A01)

**Files:** Tất cả routes dùng:
```typescript
request.headers.get("x-forwarded-for") || undefined
```

**Vấn đề:** `x-forwarded-for` có thể bị forged nếu không đứng sau trusted proxy. Trên Vercel, Vercel set header này đúng, nhưng nếu app được deploy elsewhere (self-hosted, behind nginx), attacker có thể forge IP để:
1. Bypass webhook IP whitelist (nếu `isTelegramIp` dùng forged IP).
2. Spoof IP trong activity logs.

**Vị trí ảnh hưởng nhất:** `webhook/route.ts:104` — `isTelegramIp(clientIp)` defense-in-depth layer dùng `getClientIp(req)`. Nếu `getClientIp` lấy first element của X-Forwarded-For mà không kiểm tra Vercel trust, attacker có thể forge Telegram IP.

**Patch:** Verify `getClientIp` implementation chỉ lấy IP từ trusted proxy hop, không từ attacker-controlled header position.

---

## OWASP Items — Đã xử lý tốt (không có finding)

| OWASP | Area | Status |
|-------|------|--------|
| A01 | SQL Injection | Supabase JS ORM — không có raw SQL concat |
| A01 | sortBy injection | `safeSort()` allowlist trên tất cả endpoints |
| A02 | Broken Auth | `requireAuth/requireAdminOrAbove/requireSuperAdmin` pattern nhất quán |
| A02 | Timing attack | `timingSafeEqual` ở webhook + cron secret |
| A03 | Password in logs | `reset-password` không log password — confirmed |
| A03 | Proxy creds viewer | `password` field stripped cho viewer role — `proxies/[id]`, `users/[id]/proxies` |
| A04 | XXE | Không có XML parsing |
| A04 | pgsodium | `supabaseAdmin` (service role) dùng đúng context |
| A05 | Secret keys in settings | `SECRET_SETTING_KEYS` set chặn write vào DB |
| A05 | Self-demotion guard | Settings: `adminId === admin.id` guard |
| A07 | 2FA backup codes | bcrypt hash + salt, timing-safe compare |
| A08 | SSRF | `assertPublicHost` + DNS rebinding defense + CIDR blocklist |
| A08 | Webhook IP | `isTelegramIp` CIDR check |
| A09 | Webhook replay | Two-layer dedup: in-memory Set + DB `webhook_dedup` |
| A09 | Bulk op atomic | `safe_bulk_edit_proxies` RPC trong transaction |
| A10 | Audit logging | `logActivity` trên hầu hết mutations |

---

## Priority Action List

| Priority | Finding | Effort |
|----------|---------|--------|
| 1 | **C-1** Open Redirect `auth/callback` | 5 lines |
| 2 | **H-1** DB error message leak | Grep + replace ~15 spots |
| 3 | **H-2** CSRF coverage gap | Add `assertSameOrigin` to ~13 endpoints hoặc middleware |
| 4 | **H-5** `recover-2fa` rate limit | Add IP rate limit |
| 5 | **M-1** OR filter string concat | Refactor `users/route.ts` search |
| 6 | **H-4** `/health` public info | Add minimal-response for unauthenticated |
| 7 | **M-5** `/docs` no auth | Add `requireAnyRole` |
| 8 | **H-3** Import error.message | Replace with generic message |
| 9 | **M-2** Cache-Control public | Change to `private` |
| 10 | **L-2** Security headers | next.config.ts |
