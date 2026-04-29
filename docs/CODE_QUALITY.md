# CODE QUALITY AUDIT - proxy-manager-telebot

> Ngay audit: 2026-04-28 | Stack: Next.js 16 + React 19 + TypeScript + Supabase + grammy | 283 file src, 29k LOC

---

## 1. TypeScript Strictness

### tsconfig.json

| Setting | Gia tri | Nhan xet |
|---------|---------|----------|
| strict | true | Tot - full strict mode bat |
| skipLibCheck | true | OK cho Supabase types |
| noUncheckedIndexedAccess | chua bat | Nen them vao Wave tiep theo |
| exactOptionalPropertyTypes | chua bat | Nice-to-have |

### any usage (18 file, ~45 occurrences)

Justified: 13 eslint-disable inline co comment ly do ro rang - tat ca la postgres_changes as any do Supabase JS realtime chua export literal union type.

Unjustified (production code):

| File | Dong | Van de |
|------|------|--------|
| src/app/(dashboard)/proxies/page.tsx | 310 | (p: any) => p.id - response tu /api/proxies chua typed |
| src/app/api/stats/analytics/route.ts | 15 | (d: any) - RPC get_analytics chua co return type |
| src/lib/telegram/commands/assign-proxy.ts | 29,187,262 | user: Record<string,unknown> roi cast as string |
| src/lib/telegram/commands/bulk-proxy.ts | 153,271 | Double-cast de lay Supabase join field |

Test files: 30+ any trong __tests__/ va setup/mocks/supabase.ts - gay 61 ESLint errors.

### @ts-ignore / @ts-expect-error
Khong tim thay - tot.

### Non-null assertion ! tren process.env
12 cho dung process.env.NEXT_PUBLIC_SUPABASE_URL! rai rac trong src/app/api/profile/*/route.ts, src/lib/supabase/client.ts, middleware.ts. Nen validate tap trung o startup.

---

## 2. Naming + Cohesion

### File > 500 LOC - Top 10 can split

| Rank | File | LOC | Van de |
|------|------|-----|--------|
| 1 | src/app/api/docs/openapi.ts | 1213 | Toan bo OpenAPI spec trong 1 file |
| 2 | src/app/api/__tests__/cron.test.ts | 1081 | Test file qua lon |
| 3 | src/app/(dashboard)/profile/page.tsx | 838 | 4 tabs nhoi vao 1 page component |
| 4 | src/components/proxies/proxy-import.tsx | 767 | Parse + validate + preview + submit trong 1 component |
| 5 | src/app/(dashboard)/bot/simulator/page.tsx | 625 | Realtime + dispatch + UI trong 1 file |
| 6 | src/app/api/requests/[id]/route.ts | 604 | PUT handler 450+ LOC: bulk approve + single + reject + restore |
| 7 | src/app/(dashboard)/settings/page.tsx | 603 | Multiple settings sections nhoi |
| 8 | src/app/(dashboard)/proxies/page.tsx | 567 | Fetch + filter + keyboard shortcut + bulk ops + realtime |
| 9 | src/app/(dashboard)/admins/[id]/page.tsx | 523 | Detail + edit + 2FA mgmt + session mgmt |
| 10 | src/types/database.ts | 518 | OK (type declarations) |

### Function > 50 LOC - Top 10

| Rank | File | Function | LOC est. |
|------|------|----------|-----------|
| 1 | src/app/api/requests/[id]/route.ts | PUT handler | ~450 |
| 2 | src/app/(dashboard)/proxies/page.tsx | page component + handleCheckAll | ~300+ |
| 3 | src/lib/telegram/commands/admin-approve.ts | handleAdminApprove | ~150 |
| 4 | src/lib/telegram/commands/bulk-proxy.ts | approve/reject handlers | ~130 |
| 5 | src/lib/telegram/commands/assign-proxy.ts | autoAssignProxy | ~120 |
| 6 | src/app/(dashboard)/profile/page.tsx | page render | ~100+ |
| 7 | src/app/api/cron/expire-proxies/route.ts | GET handler | ~90 |
| 8 | src/lib/telegram/commands/revoke.ts | handleRevoke | ~80 |
| 9 | src/components/proxies/proxy-import.tsx | import wizard component | ~80 |
| 10 | src/app/api/settings/route.ts | PUT handler | ~70 |

### Naming conventions

| Van de | Chi tiet |
|--------|----------|
| Inconsistent file naming | src/components/categories/CategoryFormDialog.tsx dung PascalCase, tat ca file khac dung kebab-case. Doi thanh category-form-dialog.tsx. |
| Hook coverage | Chi 3 hooks, da so data fetching logic inline trong page components. |

---

## 3. Error Handling

| Pattern | Danh gia |
|---------|----------|
| API routes co try/catch bao toan handler | Tot |
| catch (err) log + toast generic message | Tot - khong leak stack trace |
| catch(console.error) fire-and-forget | HIGH - xem ben duoi |

### HIGH: Fire-and-forget .catch(console.error) - 27 occurrences

logActivity({...}).catch(console.error) va notifyOtherAdmins(...).catch(console.error) xuat hien 27 lan trong production server code.
Khi Supabase insert fail, chi co raw Error object trong Vercel logs - khong trace duoc request ID, user ID, action.

| File | Occurrences |
|------|-------------|
| src/app/api/requests/[id]/route.ts | 10 |
| src/lib/telegram/commands/admin-approve.ts | 8 |
| src/app/api/proxies/[id]/route.ts | 3 |
| src/lib/telegram/commands/assign-proxy.ts | 2 |
| Others (chat, users, settings, aup, bulk-proxy) | 4 |

Fix: logger.error() co structured context { action, resourceId, err } thay cho console.error bare.

### Result pattern vs throw
Nhat quan: Supabase { data, error } cho DB ops, throw chi trong outer catch. Tot.

### User-facing errors
Supabase auth error.message forward thang vao toast o login/page.tsx:39 va forgot-password/page.tsx:37. Review de tranh email enumeration hint.

---

## 4. React Anti-patterns

### HIGH: Component definition inside render - proxy-table.tsx

ESLint react-hooks/static-components bao 7 errors tai src/components/proxies/proxy-table.tsx.
SortableHead duoc define ben trong ProxyTable component body (line 104), su dung tai line 260-274.
SortableHead bi tao moi tren moi render, gay re-mount toan bo sub-tree.

Fix: move SortableHead ra ngoai ProxyTable function.

### HIGH: setState trong useEffect body - i18n.tsx

ESLint react-hooks/set-state-in-effect tai src/lib/i18n.tsx:74.
setLocaleState(saved) goi truc tiep trong useEffect body gay double-render.

Fix: dung lazy useState initializer:
```ts
const [locale, setLocaleState] = useState<Locale>(() => {
  const s = typeof window !== "undefined" ? localStorage.getItem("locale") : null;
  return (s === "vi" || s === "en") ? s : "vi";
});
```

### MEDIUM: Missing useCallback dep - requests/page.tsx:100
useCallback missing dep "t" (i18n). Stale t neu locale thay doi.

### MEDIUM: Realtime subscription boilerplate duplicated 8 lan
createClient + channel + debounce + cleanup lap lai o 8 page/component.
Extract thanh useRealtimeChannel(table, handler) custom hook.

### Form handling
Khong dung react-hook-form - toan bo form dung controlled useState. Nhat quan nhung verbose.

---

## 5. Async Patterns

Tot:
MEDIUM: Floating fetch o src/app/(dashboard)/api-docs/page.tsx:321 - dung .then()/.catch() thay vi async/await - inconsistent.

HIGH: logActivity fire-and-forget - da de cap section 3.

---

## 6. Module Organization

### Cau truc hien tai
src/lib/ flat - 20+ files tron concerns. Sub-modules tot: telegram/, supabase/, state-machine/, security/, cron/, geoip/.

### So sanh VIA project - Thieu service layer

VIA co src/services/*.service.ts. Proxy CHUA CO - Supabase queries nam thang trong:
Hau qua:
1. Business logic (rate limit, state machine) lan voi DB plumbing
2. assign-proxy.ts va requests/[id]/route.ts DUPLICATE logic (proxy assignment, rate limit check)
3. Tests phai mock Supabase client truc tiep - fragile, nhieu any

Circular imports: Khong tim thay tu manual review.

---


## 7. Test Quality

| Metric | Gia tri |
|--------|---------|
| Test files | 58 (57 pass, 1 skip) |
| Test cases | 632 (626 pass, 6 skip) |
| Source files | 216 |
| Test/source ratio | ~27% |
| vitest --coverage | Chua co trong scripts |

### Coverage estimate

| Module | Coverage |
|--------|----------|
| src/app/api/ | ~70% |
| src/lib/telegram/commands/ | ~60% |
| src/app/(dashboard)/ page components | ~0% |
| src/components/ | ~5% |
| src/hooks/ | ~0% |

Mock layer: Mock Supabase client la dung level, nhung 10 ESLint any errors trong supabase.ts mock.
Dung vi.fn<Parameters, Return>() typed thay vi any.

---

## 8. Security Findings

| Severity | Finding | Files |
|----------|---------|-------|
| LOW | process.env.*! non-null - crash thay vi graceful startup error | 12 files |
| LOW | Supabase auth error.message forward thang ra toast - co the leak email enumeration | login/page.tsx, forgot-password/page.tsx |
| INFO | supabaseAdmin (service role) trong Telegram handlers - dung vi bot runs server-side | telegram/commands/* |

Khong tim thay: hardcoded secrets, XSS, SQL injection, path traversal, eval/new Function.

---

## 9. ESLint Summary (npm run lint)

**61 errors, 74 warnings**

| Category | Count | Action |
|----------|-------|--------|
| @typescript-eslint/no-explicit-any | ~40 | Fix test mocks (bulk), fix 7 prod occurrences |
| react-hooks/static-components | 7 | Move SortableHead ra ngoai ProxyTable |
| react-hooks/set-state-in-effect | 2 | Fix i18n.tsx + 1 khac |
| @typescript-eslint/no-unsafe-function-type | 1 | Fix Function type trong supabase mock |
| @typescript-eslint/no-unused-vars | ~12 | Cleanup dead imports |
| react-hooks/exhaustive-deps | 2 | Fix dep arrays |
| react/no-unescaped-entities | 2 | Fix quote chars |
| jsx-a11y/alt-text | 1 | Add alt vao img trong profile page |

---

## 10. Top 20 File Can Refactor Dau Tien

| Rank | File | LOC | Severity | Ly do |
|------|------|-----|----------|-------|
| 1 | src/app/api/requests/[id]/route.ts | 604 | HIGH | PUT handler 450 LOC - tach service layer |
| 2 | src/components/proxies/proxy-table.tsx | 454 | HIGH | SortableHead inside render - lint error + performance |
| 3 | src/lib/i18n.tsx | 93 | HIGH | setState trong useEffect - lint error, double-render |
| 4 | src/app/(dashboard)/profile/page.tsx | 838 | HIGH | 4 tabs nhoi 1 file - tach tab components |
| 5 | src/app/api/docs/openapi.ts | 1213 | MEDIUM | Giant spec file - split per domain |
| 6 | src/components/proxies/proxy-import.tsx | 767 | MEDIUM | Mixed concerns |
| 7 | src/app/(dashboard)/bot/simulator/page.tsx | 625 | MEDIUM | Realtime + UI lan |
| 8 | src/app/(dashboard)/settings/page.tsx | 603 | MEDIUM | Multiple sections |
| 9 | src/app/(dashboard)/proxies/page.tsx | 567 | MEDIUM | any + 4 useEffects + 5 fetch calls |
| 10 | src/lib/telegram/commands/admin-approve.ts | 338 | MEDIUM | 8 fire-and-forget .catch(console.error) |
| 11 | src/app/(dashboard)/admins/[id]/page.tsx | 523 | MEDIUM | Mixed concerns |
| 12 | src/__tests__/setup/mocks/supabase.ts | ~80 | MEDIUM | 10 ESLint any errors |
| 13 | src/lib/telegram/commands/assign-proxy.ts | 282 | MEDIUM | user: Record<string,unknown> + casts |
| 14 | src/lib/telegram/commands/bulk-proxy.ts | 285 | MEDIUM | Double-cast Supabase join |
| 15 | src/app/api/stats/analytics/route.ts | 32 | MEDIUM | (d: any) - add RPC return type |
| 16 | src/components/categories/CategoryFormDialog.tsx | 382 | LOW | PascalCase file naming |
| 17 | src/app/(dashboard)/requests/page.tsx | 200 | LOW | Missing dep trong useCallback |
| 18 | src/app/(dashboard)/dashboard/page.tsx | 100 | LOW | Realtime boilerplate duplicated |
| 19 | src/lib/supabase/client.ts | 10 | LOW | process.env.*! - validate at startup |
| 20 | src/app/api/__tests__/cron.test.ts | 1081 | LOW | Test file qua lon - split |

---

## 11. Migration Plan: Service Layer (theo VIA)

### Phase 1 - Extract shared business logic (1-2 PR)

Tao src/services/ layer:

  proxy.service.ts      findAvailable, assign, bulkAssign, updateStatus
  request.service.ts    approve, reject, restore, getById
  tele-user.service.ts  findByTelegramId, checkRateLimit, incrementUsage

PR 1: proxy.service.ts + tele-user.service.ts - loai bo duplicate logic giua requests/[id]/route.ts va assign-proxy.ts.
PR 2: request.service.ts - cleanup PUT handler tu 450 LOC xuong ~80 LOC.

### Phase 2 - Admin + settings (1 PR)

  admin.service.ts    getById, updateRole, revokeSession
  settings.service.ts getSettings, updateSettings, validateBotToken

### Phase 3 - Test layer upgrade (1 PR)

Khi services tach ra, mock service thay vi mock Supabase client.
Loai bo toan bo any trong __tests__/setup/mocks/.

---

## 12. Quick Wins (1 PR sua nhieu)

| PR | Files | Fixes | Effort |
|----|-------|-------|--------|
| QW-1: Fix ESLint errors | proxy-table.tsx, i18n.tsx, requests/page.tsx | 7 static-component + 2 set-state + 2 missing deps + 2 unescaped entities | ~2h |
| QW-2: Type mock infrastructure | src/__tests__/setup/mocks/supabase.ts, factories/* | ~30 ESLint any errors tu test code | ~3h |
| QW-3: Fix prod any | proxies/page.tsx:310, analytics/route.ts:15, assign-proxy.ts | 7 prod any -> typed | ~2h |
| QW-4: Env var validation | src/lib/supabase/client.ts + middleware.ts | Replace 12 ! assertions voi startup check | ~1h |
| QW-5: useRealtimeChannel hook | 8 pages co Supabase channel boilerplate | Giam ~80 LOC duplicated, 1 place to maintain | ~3h |

---

## Verdict

| Dimension | Score | Ghi chu |
|-----------|-------|---------|
| TypeScript strictness | 8/10 | strict: true OK, nhung env var ! rai rac |
| Type safety | 6/10 | any trong prod + test mocks |
| Error handling | 7/10 | 27 fire-and-forget thieu structured context |
| React patterns | 6/10 | SortableHead-in-render + setState-in-effect (ca 2 HIGH) |
| Async correctness | 8/10 | Promise.allSettled dung dung, khong co forEach async |
| Module organization | 5/10 | Thieu service layer - business logic leak vao route handlers |
| Test quality | 6/10 | Tot o API/bot, zero o components/hooks |
| Naming | 7/10 | 1 PascalCase file inconsistency |

**Ket luan: WARN** - Khong co CRITICAL security issue. 2 HIGH React issues (lint errors + performance).
Service layer la khoan no ky thuat lon nhat. Bat dau voi QW-1 (~2h, khong can refactor lon), sau do Phase 1 service layer.
