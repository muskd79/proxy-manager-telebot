# PERF AUDIT — proxy-manager-telebot
> Ngày: 2026-04-28 | Stack: Next.js 16.2 + React 19 + Supabase + grammy + Vercel | 283 file TS/TSX, ~43k LOC

---

## 1. DB QUERY

### 1A. Duplicate index — migrations 015 (CRITICAL)

| | |
|---|---|
| **File** | `supabase/migrations/015_connection_pool_index.sql` vs `015_cursor_pagination_index.sql` |
| **Vấn đề** | Cả 2 file số `015` tạo index trên `proxies(created_at DESC, id) WHERE is_deleted = false`. `015_connection_pool_index` tạo `idx_proxies_created_desc`; `015_cursor_pagination_index` tạo `idx_proxies_created_at_id`. Hai index về mặt B-tree **hoàn toàn giống nhau** (cùng columns, cùng predicate, cùng sort order), chỉ khác tên. PostgreSQL sẽ maintain cả hai song song, tốn gấp đôi WAL write và storage. |
| **Impact** | ~2x write amplification trên mọi INSERT/UPDATE/DELETE vào bảng proxies; ~duplex storage ~N KB/row. |
| **Patch** | `DROP INDEX IF EXISTS idx_proxies_created_desc;` — giữ lại `idx_proxies_created_at_id` (tên mô tả hơn). |

---

### 1B. N+1 — `cron/expiry-warning/route.ts` (HIGH)

| | |
|---|---|
| **File** | `src/app/api/cron/expiry-warning/route.ts:42-56` |
| **Vấn đề** | Vòng `for (const proxy of expiringProxies)` rồi `await supabaseAdmin.from("tele_users").select(...).eq("id", proxy.assigned_to).single()` bên trong — 1 query/proxy. 100 proxy sắp hết hạn = 101 round-trip DB + 100 Telegram send tuần tự. Cron timeout 10s trên Vercel là rủi ro thực. |
| **Impact** | 100 proxy expiring → ~100 × 50ms = 5s thêm chỉ cho DB; với Telegram sequential ~100 × 1s = 100s (vượt Vercel function timeout). |
| **Patch** | Tương tự pattern `expire-proxies`: một SELECT batch users `IN (assigned_to ids)`, build Map, rồi `Promise.allSettled` với concurrency cap gửi Telegram. |

```typescript
// BAD (hiện tại) — expiry-warning/route.ts:42-56
for (const proxy of expiringProxies) {
  const { data: user } = await supabaseAdmin.from("tele_users")...single(); // N query
  ...
  await sendTelegramMessage(user.telegram_id, text); // N send sequential
}

// GOOD
const userIds = [...new Set(expiringProxies.map(p => p.assigned_to).filter(Boolean))];
const { data: users } = await supabaseAdmin.from("tele_users").select("id,telegram_id,language").in("id", userIds);
const userMap = new Map(users?.map(u => [u.id, u]));
const tasks = expiringProxies.map(p => async () => {
  const u = userMap.get(p.assigned_to);
  if (u?.telegram_id) await sendTelegramMessage(u.telegram_id, buildText(p, u.language));
});
for (let i = 0; i < tasks.length; i += 10) await Promise.allSettled(tasks.slice(i, i+10).map(t=>t()));
```

---

### 1C. N+1 — `cron/expire-requests/route.ts` Telegram fan-out (MEDIUM)

| | |
|---|---|
| **File** | `src/app/api/cron/expire-requests/route.ts:40-53` |
| **Vấn đề** | `for (const req of expiredRequests) { await sendTelegramMessage(...) }` — Telegram send tuần tự. DB đã được fix (batch UPDATE + JOIN), nhưng notify vẫn sequential. |
| **Impact** | 50 requests expired → ~50s tuần tự. Ít nghiêm trọng hơn 1B vì query ít hơn, nhưng vẫn có nguy cơ timeout. |
| **Patch** | `Promise.allSettled` với concurrency 10 (giống pattern expire-proxies). |

---

### 1D. N+1 — Bot command `/checkproxy` (MEDIUM)

| | |
|---|---|
| **File** | `src/lib/telegram/commands/check-proxy.ts:41-56` |
| **Vấn đề** | `for (const proxy of proxies) { const result = await checkProxy(...) }` — mỗi proxy check network tuần tự, ~1-10s/proxy. User có 5 proxy → có thể mất 50s, bot timeout. |
| **Impact** | 5 proxy × 5s timeout = 25s → Telegram bot timeout 30s gần chạm ngưỡng. |
| **Patch** | `Promise.allSettled` parallel (không cần batching vì số proxy/user thường < 10). |

```typescript
// GOOD
const results = await Promise.allSettled(proxies.map(p => checkProxy(p.host, p.port, p.type)));
```

---

### 1E. Alive proxy updates trong health-check cron — N UPDATE queries (MEDIUM)

| | |
|---|---|
| **File** | `src/app/api/cron/health-check/route.ts:56-64` |
| **Vấn đề** | Alive proxies mỗi proxy cần `speed_ms` riêng nên không batch được, nhưng đang dùng `Promise.all(aliveSpeedUpdates)` — tốt về concurrency. Tuy nhiên batch size = `HEALTH_CHECK_CONCURRENCY` (presumably ~10-20), với 500 proxies × 20/batch = 25 wave × N concurrent UPDATE. Không phải bug nhưng có thể dùng upsert JSON approach. |
| **Impact** | Low — đã parallel, chỉ ghi nhận. |
| **Patch** | Xem xét PostgreSQL `UPDATE ... FROM (VALUES ...)` via RPC để giảm round-trip. |

---

### 1F. SELECT * trong list routes (MEDIUM)

| File | Line | Bảng | Vấn đề |
|------|------|------|--------|
| `api/logs/route.ts` | 31 | `activity_logs` | Fetch toàn bộ columns kể cả `details JSONB` (có thể lớn) |
| `api/users/route.ts` | 34 | `tele_users` | Fetch `notes`, `rate_limit_*`, `proxies_used_*` — không dùng hết ở table view |
| `api/proxies/route.ts` | 57 | `proxies` | Fetch `password` rồi strip ở app level cho viewer role |

| Impact | ~10-30% extra network/deserialization per request |
| **Patch** | Explicit select columns. Với proxies: strip `password` ở DB query level cho viewer; với logs: exclude `details` trừ khi `expandDetails=true`. |

---

### 1G. `get_analytics` — correlated subquery N lần/ngày (MEDIUM)

| | |
|---|---|
| **File** | `supabase/migrations/011_optimize_analytics.sql:21-23` |
| **Vấn đề** | `WHERE cm.created_at::date = d::date` — cast `created_at::date` trên column `TIMESTAMPTZ` phá index `idx_chat_messages_created_at ON chat_messages(created_at)` vì PostgreSQL không dùng non-functional index cho expression. 14 ngày = 14 lần full scan `chat_messages`. |
| **Impact** | ~14 × seq scan chat_messages ở 90-day window có thể là 100k+ rows = ~50-200ms thêm. |
| **Patch** | Thêm functional index `CREATE INDEX idx_chat_date ON chat_messages((created_at::date));` hoặc rewrite range: `cm.created_at >= d AND cm.created_at < d + interval '1 day'` (dùng được index btree trực tiếp). |

---

### 1H. `get_dashboard_stats` — 3 full table scans mỗi 30s (LOW)

| | |
|---|---|
| **File** | `supabase/migrations/011_optimize_analytics.sql:38-75` |
| **Vấn đề** | 3 sequential `SELECT COUNT(*) FILTER(...)` trên `proxies`, `tele_users`, `proxy_requests` — mỗi call = 3 seq scan. Đã cache `s-maxage=30` ở Vercel edge nên tần suất thực tế thấp. Tuy nhiên không có index trên `(is_deleted)` standalone cho từng bảng. |
| **Impact** | Low — 30s edge cache che phần lớn. Ghi nhận để Wave 24+. |
| **Patch** | Partial index `WHERE is_deleted = false` đã có cho proxies (mig 002). Hiện tại OK. |

---

## 2. REACT RENDER

### 2A. Zero `React.memo` / `useCallback` / `useMemo` thực sự (HIGH)

| | |
|---|---|
| **Tổng quan** | 92 client components. Grep tìm được 63 files "có memoization" nhưng khi kiểm tra thực tế là từ hooks `useCallback`/`useMemo` trong page-level, **không có component nào được wrap với `React.memo`**. |
| **Files nặng nhất** | `proxy-table.tsx` (455 lines), `user-table.tsx`, `request-table.tsx` |
| **Vấn đề** | `ProxyTable` nhận `onEdit`, `onDelete`, `onHealthCheck` là inline arrow function từ parent `proxies/page.tsx` — mỗi render parent tạo reference mới → `ProxyTable` re-render toàn bộ 20 rows × nhiều cells kể cả khi không có gì thay đổi. Tương tự `UserTable`, `RequestTable`. |
| **Impact** | ~20-50ms wasted render per filter/sort change trên list pages. Cumulative ở dashboard với 4 components fetch độc lập. |
| **Patch** | |

```tsx
// proxies/page.tsx — wrap callbacks
const handleEdit = useCallback((proxy: Proxy) => { setEditProxy(proxy); setFormOpen(true); }, []);
const handleDeleteCb = useCallback((id: string) => handleDelete(id), [handleDelete]);
const handleHealthCheckCb = useCallback((ids: string[]) => handleHealthCheck(ids), []);

// proxy-table.tsx
export const ProxyTable = React.memo(function ProxyTable({ ... }) { ... });
```

---

### 2B. Dashboard — 4 fetch độc lập, không parallel (HIGH)

| | |
|---|---|
| **File** | `src/app/(dashboard)/dashboard/page.tsx` + children |
| **Vấn đề** | Dashboard mount → `DashboardPage` fetch `/api/stats` → `ProxyChart` fetch `/api/stats/analytics` → `ActiveUsers` fetch `/api/users` → `RecentRequests` fetch `/api/requests`. Tất cả đều `useEffect` độc lập, fire tuần tự vì mount theo waterfall React. 4 round-trip API là 4 × RTT (mỗi ~50-150ms trên Vercel). |
| **Impact** | Dashboard load thêm ~200-600ms so với fetch song song. |
| **Patch** | Hoist fetches lên `DashboardPage`, dùng `Promise.all`, pass data xuống children qua props hoặc context. Hoặc convert sang RSC fetch parallel. |

---

### 2C. `SortableHead` component định nghĩa trong render (MEDIUM)

| | |
|---|---|
| **File** | `src/components/proxies/proxy-table.tsx:104-135` |
| **Vấn đề** | `function SortableHead(...)` được khai báo **bên trong** `ProxyTable` render function. Mỗi render `ProxyTable` tạo lại component type mới → React unmount/remount toàn bộ `<SortableHead>` DOM thay vì update. |
| **Impact** | ~5-15ms redundant DOM mutation per sort/filter. |
| **Patch** | Kéo `SortableHead` ra ngoài `ProxyTable`, pass `onSort`/`sortBy`/`sortOrder` qua props. |

---

### 2D. Realtime subscription re-create khi `fetchProxies` thay đổi (MEDIUM)

| | |
|---|---|
| **File** | `src/app/(dashboard)/proxies/page.tsx:201-224` |
| **Vấn đề** | `useEffect(..., [fetchProxies])` — `fetchProxies` là `useCallback([filters])`. Mỗi khi `filters` thay đổi (search, page, sort...) → `fetchProxies` reference mới → Supabase channel unsubscribe/re-subscribe. Mỗi lần filter = 1 WebSocket churn. Tương tự ở `users/page.tsx`. |
| **Impact** | ~100-300ms reconnect cost mỗi filter change; Supabase billing cho channel event. |
| **Patch** | Dùng `useRef` để hold stable callback cho realtime, tách biệt khỏi filter-driven fetch: |

```tsx
const fetchRef = useRef(fetchProxies);
useEffect(() => { fetchRef.current = fetchProxies; }, [fetchProxies]);

useEffect(() => {
  const channel = supabase.channel("proxies-changes")
    .on("postgres_changes" as any, ..., () => {
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => fetchRef.current(), 2000);
    }).subscribe();
  return () => { clearTimeout(debounceRef.current); channel.unsubscribe(); };
}, []); // empty deps — subscribe once, never re-create
```

---

### 2E. `handleBulkAction` trong `users/page.tsx` — sequential API calls (MEDIUM)

| | |
|---|---|
| **File** | `src/app/(dashboard)/users/page.tsx:103-127` |
| **Vấn đề** | `for (const id of selectedIds) { await blockUser(id) }` — tuần tự. Chọn 20 users block = 20 × 1 API round-trip sequential. |
| **Impact** | 20 users × ~100ms = ~2s UX lag. |
| **Patch** | `Promise.allSettled(selectedIds.map(id => blockUser(id)))`. |

---

### 2F. `ActiveUsers` component — sai dữ liệu (MEDIUM)

| | |
|---|---|
| **File** | `src/components/dashboard/active-users.tsx:32-33` |
| **Vấn đề** | Title "Users active in the last 24 hours" nhưng query `?sortBy=updated_at&status=active` — không filter `updated_at >= now()-24h`. Fetch bất kỳ 10 active users mới update nhất, không phải "24h active". |
| **Impact** | Misleading data; cũng không cần `SELECT *` — chỉ cần 6 columns. |
| **Patch** | Thêm `dateFrom=now()-24h` filter hoặc dùng `/api/stats` RPC. |

---

## 3. BUNDLE

### 3A. Zero dynamic import — recharts nặng (HIGH)

| | |
|---|---|
| **File** | `src/components/dashboard/proxy-chart.tsx:5` |
| **Vấn đề** | `import { ResponsiveContainer, BarChart, ... } from "recharts"` — static import. `recharts` ~200KB gzipped. Được load kể cả khi user chưa mở dashboard/chart. Không có `dynamic()` hay `React.lazy()` nào trong toàn dự án (0 instances). |
| **Impact** | +~200KB main bundle. LCP dashboard tăng ~300-500ms trên 3G. |
| **Patch** | |

```tsx
// proxy-chart.tsx
const { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend }
  = await import("recharts"); // hoặc dùng next/dynamic

// Hoặc wrapper:
const ProxyChart = dynamic(() => import("@/components/dashboard/proxy-chart"), {
  ssr: false,
  loading: () => <div className="h-64 animate-pulse rounded bg-muted" />,
});
```

---

### 3B. `lucide-react` 1.7.0 — barrel import risk (MEDIUM)

| | |
|---|---|
| **File** | Multiple files (e.g. `proxies/page.tsx:21-28` — 9 icons, `sidebar.tsx:14-26` — 11 icons) |
| **Vấn đề** | `lucide-react` v1.7.0 có tree-shaking tốt với ESM, nhưng cần verify bundler config. Nếu Next.js không có `transpilePackages` hay `optimizePackageImports`, barrel re-export có thể pull toàn bộ icon library. |
| **Impact** | Worst case: +300KB nếu tree-shaking fail. |
| **Patch** | Thêm vào `next.config.ts`: `experimental: { optimizePackageImports: ['lucide-react', 'recharts'] }` |

---

### 3C. Không có bundle analyzer config (LOW)

| | |
|---|---|
| **Vấn đề** | `next.config.ts` không có `@next/bundle-analyzer`. Không có visibility vào chunk sizes. |
| **Patch** | `npm i -D @next/bundle-analyzer` + wrap config; thêm `"analyze": "ANALYZE=true next build"` script. |

---

## 4. API ROUTE

### 4A. Tất cả 5 cron routes KHÔNG có `withCronLock` (HIGH)

| | |
|---|---|
| **Files** | `src/app/api/cron/cleanup/route.ts`, `expire-proxies/route.ts`, `expire-requests/route.ts`, `expiry-warning/route.ts`, `health-check/route.ts` |
| **Vấn đề** | `withCronLock` đã được build đầy đủ tại `src/lib/cron/advisory-lock.ts` (Wave 17), nhưng **không route cron nào wire nó**. Vercel cron có thể fire khi invocation cũ vẫn đang chạy (nếu job > interval). Kết quả: double-expire proxies, double-notify users, double-cleanup. `expire-proxies` có RPC `safe_expire_proxies` idempotent nên data không corrupt, nhưng `cleanup` và `expiry-warning` không có guard → users nhận thông báo 2 lần. |
| **Impact** | Duplicate Telegram notifications; double DELETE (lãng phí compute). |
| **Patch** | Wrap mỗi cron handler body: |

```typescript
// cleanup/route.ts
import { withCronLock } from "@/lib/cron/advisory-lock";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  const authError = verifyCronSecret(request);
  if (authError) return authError;

  const outcome = await withCronLock(supabaseAdmin, "cron_cleanup", async () => {
    // ... existing body
  });
  if (outcome.skipped) return NextResponse.json({ success: true, skipped: true });
  return NextResponse.json({ success: true, data: outcome.result });
}
```

---

### 4B. Webhook route — top-level import `handlers.ts` kéo toàn bộ command tree (MEDIUM)

| | |
|---|---|
| **File** | `src/app/api/telegram/webhook/route.ts:4-5` |
| **Vấn đề** | `import "@/lib/telegram/handlers"` và `import { bot } from "@/lib/telegram/handlers"` tại top-level kéo: `bot.ts` → `grammy` → toàn bộ 15 command files (admin-approve, assign-proxy, aup, bulk-proxy, cancel, check-proxy, get-proxy, help, history, language, my-proxies, revoke, start, status, support). Cold start phải parse/execute tất cả. |
| **Impact** | Cold start webhook ~200-500ms thêm. Trên Vercel Hobby tier cold start từ ~800ms lên ~1.2-1.5s. |
| **Patch** | `bot` và handlers nên init lazy (singleton pattern) thay vì module-level side-effect. Tuy nhiên grammy bot cần registered commands trước khi handle — cần đánh giá kỹ. Short-term: đảm bảo `handlers.ts` không có heavy synchronous init (DB calls, etc.). |

---

### 4C. Webhook — IP whitelist check bị bỏ qua nếu `SKIP_TELEGRAM_IP_CHECK=true` nhưng không log (LOW)

| | |
|---|---|
| **File** | `src/lib/telegram/ip-whitelist.ts` (referenced) |
| **Vấn đề** | Logic tốt, nhưng nên đảm bảo `SKIP_TELEGRAM_IP_CHECK` không mặc định true trong production env. Kiểm tra `.env.example`. |

---

### 4D. API route `api/proxies/check` — không có rate limit (MEDIUM)

| | |
|---|---|
| **File** | `src/app/api/proxies/check/route.ts` |
| **Vấn đề** | Admin có thể POST `{ ids: [500 UUIDs] }` → 500 TCP connections ra ngoài Internet mỗi request. Không có rate limit hay cap ngoài validator. `CheckProxiesSchema` có max validation không? |
| **Impact** | DDoS tiếp nhận bởi proxy targets; Vercel network egress cost. |
| **Patch** | Giới hạn `ids.length <= 100` trong Zod schema hoặc API logic; thêm rate limit. |

---

### 4E. `api/users` — `count: "exact"` mọi request (MEDIUM)

| | |
|---|---|
| **File** | `src/app/api/users/route.ts:34` |
| **Vấn đề** | `select("*", { count: "exact" })` force full `COUNT(*)` mỗi request. Với tele_users có 10k+ rows và filter `status+is_deleted` partial index, count vẫn cần scan index. Không dùng `estimated` như proxies endpoint đã tối ưu. |
| **Impact** | ~10-30ms thêm per request cho count query. |
| **Patch** | Dùng `estimated` khi có filter, `exact` chỉ khi no-filter (pattern từ `/api/proxies/route.ts`). |

---

## 5. CRON / BACKGROUND

### 5A. withCronLock đã code nhưng chưa wire — xem 4A

---

### 5B. Health-check cron — alive proxy UPDATE cá nhân thay vì batch (LOW)

| | |
|---|---|
| **File** | `src/app/api/cron/health-check/route.ts:56-64` |
| **Vấn đề** | Đã dùng `Promise.all` — tốt. Nhưng N concurrent UPDATE riêng lẻ với unique `speed_ms`. Nếu N=200 alive → 200 concurrent connections tới Supabase → connection pool pressure. |
| **Patch** | Dùng RPC nhận `JSONB[]` input và `UPDATE ... FROM (VALUES ...)` dạng single statement. |

---

## TOP 10 QUICK WINS (Effort S, Impact H)

| # | Finding | File | Effort | Impact |
|---|---------|------|--------|--------|
| 1 | **Wire `withCronLock`** vào 5 cron routes | `src/app/api/cron/*/route.ts` | S (30 min) | H — ngăn duplicate notify/delete |
| 2 | **Drop duplicate index** `idx_proxies_created_desc` | Migration mới | S (5 min) | H — -50% write amplification proxies table |
| 3 | **Fix N+1 `expiry-warning`** — batch SELECT users + parallel Telegram | `src/app/api/cron/expiry-warning/route.ts` | S (1h) | H — ngăn cron timeout |
| 4 | **Fix N+1 `/checkproxy` bot** — parallel checkProxy | `src/lib/telegram/commands/check-proxy.ts:41-56` | S (15 min) | H — bot không timeout cho user |
| 5 | **Dynamic import recharts** | `src/components/dashboard/proxy-chart.tsx` | S (15 min) | H — -~200KB main bundle |
| 6 | **Realtime subscription deps fix** — `useRef` stable callback | `proxies/page.tsx:201-224`, `users/page.tsx:62-85` | S (30 min) | M — ngăn WS churn mỗi filter |
| 7 | **Parallel bulk action users** — `Promise.allSettled` | `users/page.tsx:103-127` | S (10 min) | M — 20x nhanh hơn cho bulk |
| 8 | **Fix expire-requests Telegram fan-out** — parallel gửi | `cron/expire-requests/route.ts:40-53` | S (20 min) | M — ngăn cron timeout |
| 9 | **Move `SortableHead` ra ngoài render** | `proxy-table.tsx:104-135` | S (10 min) | M — ngăn unmount/remount DOM |
| 10 | **`optimizePackageImports` cho lucide-react + recharts** trong next.config | `next.config.ts` | S (5 min) | M — đảm bảo tree-shaking |

---

## TOP 5 ĐẦU TƯ LỚN (Effort L, Impact H)

| # | Finding | File | Effort | Impact |
|---|---------|------|--------|--------|
| 1 | **Dashboard parallel fetch** — hoist 4 fetches vào RSC, pass data down | `dashboard/page.tsx` + `active-users`, `proxy-chart`, `recent-requests` | L (1 ngày) | H — -200-600ms dashboard load |
| 2 | **`React.memo` + `useCallback` cho table components** — ProxyTable, UserTable, RequestTable | 3 table files + 3 parent pages | L (2 ngày) | H — giảm render wasted ~50ms/interaction |
| 3 | **Functional index cho `get_analytics` chat subquery** — `(created_at::date)` hoặc rewrite range query | Migration mới + SQL function update | L (4h) | H — -14 seq scans/analytics call |
| 4 | **Batch UPDATE alive proxies trong health-check** — RPC `update_proxy_speeds(JSONB[])` | Migration RPC + route update | L (6h) | M — giảm connection pool pressure khi N>100 alive |
| 5 | **Explicit column select thay `SELECT *`** — logs, users, proxies (viewer strip) | `api/logs`, `api/users`, `api/proxies` | L (1 ngày — phải sync với TS types) | M — -10-30% data transfer + serialization |

---

## GHI CHÚ KỸ THUẬT

**Về index 015 duplicate:** Hai migration cùng số `015` là lỗi naming, không phải Supabase chạy theo thứ tự alphabetical. Cần verify cả hai đã được apply và drop cái thừa.

**Về `withCronLock`:** Lock TTL mặc định 600s. Nếu cron interval < 600s (e.g. health-check 5 phút) thì TTL nên = interval × 0.9. Ví dụ health-check 5min → TTL 270s.

**Về recharts dynamic import:** Cần `ssr: false` vì recharts dùng `window`. Loading skeleton đã có sẵn trong component.

**Dependencies không có vấn đề:** Không có `moment.js`, `lodash` full. `date-fns` v4 đã có tree-shaking tốt. `recharts` là dependency nặng duy nhất.
