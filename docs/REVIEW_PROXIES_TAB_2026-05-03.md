# Deep Review — Tab Quản lý Proxy + Add-Proxy Workflow

**Date:** 2026-05-03
**Reviewer:** Claude (post Wave 26-A ship)
**Scope:** every surface a user touches when managing proxies in the admin web — from "Thêm proxy" dropdown through to bulk actions, edit dialog, list page filters, and the API routes that back them.

**Why this exists:** user feedback 2026-05-03 — "tiếp tục review thật sâu thật kĩ tab quản lý proxy và phần thêm proxy từ chi tiết nhỏ nhất tới logic, ui/ux trải nghiệm và cơ chế khi sử dụng, cùng các workflow". This document is the audit; a follow-up Wave 26-B PR ships the fixes.

**Method:** read every component + API route in scope. For each surface, list:
- ✅ what works well (so future devs don't break it)
- ⚠ medium-priority gaps (UX friction, no data loss)
- ❌ high-priority gaps (data loss, silent failures, broken UX)

---

## 0. Files in scope

| File | Purpose | LOC |
|---|---|---:|
| `src/app/(dashboard)/proxies/page.tsx` | List page + bulk actions + form orchestration | ~600 |
| `src/components/proxies/proxy-form.tsx` | Single-proxy create/edit dialog | ~382 |
| `src/components/proxies/proxy-import.tsx` | Bulk-import wizard (Wave 26-A polished) | ~970 |
| `src/components/proxies/proxy-filters.tsx` | Filter bar | ~150 |
| `src/components/proxies/proxy-table.tsx` | Desktop table + mobile cards | ~430 |
| `src/components/proxies/proxy-bulk-edit.tsx` | Bulk edit dialog | (not deep-read; cross-ref) |
| `src/components/proxies/proxy-detail.tsx` | Single proxy detail page | (not deep-read; cross-ref) |
| `src/components/proxies/category-picker.tsx` | Category dropdown + inline create | ~210 |
| `src/components/proxies/credential-cell.tsx` | Masked credential display | (small) |
| `src/app/api/proxies/route.ts` | GET list, POST create | (medium) |
| `src/app/api/proxies/[id]/route.ts` | GET/PUT/DELETE single | (medium) |
| `src/app/api/proxies/check/route.ts` | Health check (alive/dead) | (small) |
| `src/app/api/proxies/probe-batch/route.ts` | Batch probe for import wizard | (small) |
| `src/app/api/proxies/import/route.ts` | Bulk-import handler | ~170 |

---

## 1. SINGLE PROXY FORM (`ProxyForm` dialog)

The dialog opens from "Thêm đơn" in the `+ Thêm proxy` dropdown, or from the row-level "Sửa" action in the table.

### ✅ What works well

- Zod schema validation client-side with field-level errors + `aria-invalid` + `aria-describedby` (line 188-196).
- Inline `CategoryPicker` with "+ Tạo danh mục mới" so admin doesn't have to leave the form to create a new category.
- Country `<datalist>` autocomplete from `/api/proxies/stats` countries.

### ❌ HIGH-PRIORITY GAPS

#### 1.1 — `formData` initialized once; doesn't reset on prop change
Line 67-81: `useState({ host: proxy?.host || "", ...})`. React's `useState` initializer runs ONCE on mount. When admin closes the dialog and clicks "Sửa" on a DIFFERENT proxy, the dialog reopens with **the previous proxy's data**. Same bug if admin opens "Thêm đơn" right after closing an edit — the new proxy's form is pre-filled with the old proxy's host/port.

**Fix:** add `useEffect([proxy], () => setFormData({...}))` to reset state when `proxy` prop changes. Or use a `key={proxy?.id ?? "new"}` on the dialog body so React unmounts/remounts.

#### 1.2 — No success toast after save
Line 158-159: `await onSave(data); onOpenChange(false);` — the dialog closes silently. The list refetches but the user has no positive confirmation that "Tạo" / "Cập nhật" succeeded. Compare with bulk-edit which DOES toast.

**Fix:** caller (`page.tsx::handleSaveProxy`) should fire `toast.success("Đã tạo proxy")` / `toast.success("Đã cập nhật")`. Currently it doesn't.

#### 1.3 — Limited fields in Edit mode → workflow gap
The form exposes: host, port, type, network_type, username, password, country, city, category_id, notes, expires_at.

The DB (per `database.ts` Proxy interface) ALSO has: `purchase_date`, `vendor_label`, `cost_usd`, `sale_price_usd`, `isp`, `tags` (deprecated), `assigned_to`, `assigned_at`, `last_check_at`.

**Import wizard sets these → admin can't edit them in single-proxy form.** A proxy imported with `cost_usd=2.50` and `sale_price_usd=5.00` cannot have those fields corrected without bulk-edit (which is for batch operations, not 1-row tweaks).

**Fix:** add the missing editable fields (purchase_date, vendor_label, cost_usd, sale_price_usd) to the form, in a collapsible "Thông tin mua / bán" section so the dialog doesn't bloat for casual creates.

### ⚠ MEDIUM-PRIORITY GAPS

#### 1.4 — DialogTitle doesn't show which proxy is being edited
Line 171: `{isEdit ? "Sửa proxy" : "Thêm proxy"}` — generic. Admin opens a row from a 1000-proxy list, the dialog title says "Sửa proxy" with no indication of which one. They have to scroll the form to read the host/port.

**Fix:** `{isEdit ? \`Sửa ${proxy.host}:${proxy.port}\` : "Thêm proxy mới"}`.

#### 1.5 — No "+ Tạo và thêm tiếp" button
Admin creating 5 proxies one-by-one has to: click "Thêm đơn" → fill → "Tạo" → dialog closes → click "Thêm đơn" → fill → ... 5 times. Common UX pattern: a secondary submit "Tạo và thêm tiếp" that saves + resets the form without closing the dialog.

**Fix:** add `<Button variant="outline" type="button" onClick={handleSubmitAndContinue}>` next to the primary submit. Doesn't apply in edit mode.

#### 1.6 — `expires_at` no quick-fill suggestion
Wave 26-A added a "Đề xuất 30 ngày sau" button to the import wizard (commit 5). The single-proxy form has no equivalent. Inconsistent.

**Fix:** mirror the import wizard's expires_at quick-fill, anchored on `purchase_date` or `created_at`.

#### 1.7 — Category default-fill not wired
When admin picks a category, the IMPORT wizard auto-fills country/proxy_type/network_type/vendor/prices from category defaults (proxy-import.tsx:199-212). The single-proxy form does NOT — admin picks a category but other fields stay blank, even when the category has them set.

**Fix:** add the same `useEffect` watching `formData.category_id` + `categories` that fills country/network_type/etc. from defaults if the user hasn't already typed something.

#### 1.8 — `DialogDescription` could be more specific
Line 175: "Nhập thông tin proxy mới. Có thể bỏ trống các trường tuỳ chọn." Doesn't tell the user which fields are required (only `host` and `port` based on schema). Adding "Bắt buộc: Host + Cổng" helps mobile users who can't see all asterisks.

---

## 2. PROXIES LIST PAGE (`/proxies`)

### ✅ What works well

- Realtime subscription to `proxies` table changes with debounced re-fetch (line 207-232).
- Keyboard shortcuts (Ctrl+A select all, Esc deselect, Del delete) with `isInputFocused` guard so they don't fire while admin types in the filter bar.
- Bulk delete uses `Promise.allSettled` + summary toast — accurate even if some 500 individual DELETEs fail.
- Dashboard KPI drill-down lands here pre-filtered via `?status=` / `?type=` / `?category_id=`.
- Mobile card view renders correctly under 768px.

### ❌ HIGH-PRIORITY GAPS

#### 2.1 — `handleDelete` uses `window.confirm` (inconsistent with bulk delete which uses AlertDialog)
Line 269: `if (!window.confirm("Chuyển X vào Thùng rác?")) return;`

`window.confirm` is a native browser modal — different visual style, no theming, harder to test, jarring next to the AlertDialog bulk-delete confirm right above it.

**Fix:** replace with the existing `AlertDialog` pattern. Add `singleDeleteId: string | null` state that opens an AlertDialog with the same shape as `showBulkDeleteConfirm`.

#### 2.2 — `handleSaveProxy` has NO toast on success
Line 244-260: just `setEditProxy(null); fetchProxies();`. Cross-references gap 1.2 — neither the dialog nor the parent fires a toast. Bulk operations get toasts; single-proxy create/edit doesn't.

**Fix:** `toast.success(\`Đã ${editProxy ? "cập nhật" : "tạo"} ${data.host}:${data.port}\`)`.

#### 2.3 — `handleCheckAll` capped at 500 silently
Line 327: `fetch("/api/proxies?pageSize=500")`. If admin has 800 proxies, only 500 get health-checked and the toast says "Đã check 500" without warning that 300 were skipped.

**Fix:** detect `total > 500`, show a toast.warning explaining the cap + suggesting the cron job for full fleets. Or paginate through all pages.

#### 2.4 — `handleHealthCheck` (single + bulk via row dropdown) has no toast
Line 311-318: fires the API call and refetches, but no positive feedback. "Did the check run? When?" — admin has to wait for the table to update. The HTTP response has the new alive/speed for each ID; we should pass it back.

**Fix:** await response, parse alive/dead counts, fire `toast.info` summary.

### ⚠ MEDIUM-PRIORITY GAPS

#### 2.5 — Realtime channel error is silent
Line 222: `if (status === 'CHANNEL_ERROR') console.error(...)`. Admin doesn't know realtime is broken — the table just stops updating live. They might think "nothing changed" when actually the channel died.

**Fix:** show a small banner "[!] Đồng bộ realtime tạm dừng" + a "Tải lại" button. Or auto-reconnect with backoff.

#### 2.6 — Ctrl+A select all visible only (not all matching filter)
Line 181-184: `const allIds = proxies.map((p) => p.id)` — only the current page (max 500). If admin filters by `country=US` and gets 1000 results across 50 pages, Ctrl+A selects only 20 (current page).

**Fix:** either (a) document this with a hint, or (b) add a separate "Chọn toàn bộ X kết quả" link that appears after Ctrl+A on a paginated result. Pattern Gmail uses.

#### 2.7 — Bulk action bar disappears when selectedIds=0 (no animation)
Line 475-512: conditional render. Snap on/off. A height-animated transition would feel more polished.

#### 2.8 — `Last check time` only set when admin runs `handleCheckAll` (line 350)
Per-row health check via the dropdown (or selection bar) doesn't update `lastCheckTime`. Stat goes stale.

**Fix:** also set `lastCheckTime` in `handleHealthCheck` after the API response.

#### 2.9 — Pagination footer gives no "back to top" affordance for 1000-row pages
After scrolling through 100 rows, no quick-jump to top.

**Fix:** small floating "Lên đầu" button when scrolled past viewport height.

---

## 3. PROXY FILTERS (`ProxyFilters`)

### ✅ What works well

- Vietnamese throughout.
- Synthetic statuses (`expiring_soon`) handled server-side — client just passes the param.
- Search input has the `Search` icon prefix, clear-on-X.

### ⚠ MEDIUM-PRIORITY GAPS

#### 3.1 — No "Clear all filters" button
When admin has set 4 filters (status + type + country + category) and wants to reset, they have to clear each individually. Standard UX pattern: a small "Xoá tất cả filter" link that resets `filters` to defaults.

#### 3.2 — Active filter chips not visually distinct
Filtering changes the results but the bar visually looks the same as default. No "you have N filters active" badge.

**Fix:** count non-default filters and render a small primary-colored Badge "5 filter đang dùng" + the clear-all link.

#### 3.3 — Search is debounce-less
Every keystroke fires `onFiltersChange` → `fetchProxies` (parent useEffect). 1000 proxies × admin types a 10-char search = 10 wasted API calls.

**Fix:** debounce the search input 300ms.

---

## 4. PROXY TABLE (`ProxyTable`)

### ✅ What works well

- Mobile card view (<768px) preserves selection + dropdown actions.
- Sort state visible via `aria-sort` + arrow icon weight.
- WCAG-AA color contrast on type badges (Wave 22N audit).

### ⚠ MEDIUM-PRIORITY GAPS

#### 4.1 — `colSpan={14}` empty-state cell hardcoded
Line 281. If a column is added/removed, this number drifts. Easy to forget. Extract `const COL_COUNT = 14;` as a constant.

#### 4.2 — Long usernames/passwords overflow on tablet widths
The `<CredentialCell>` uses click-to-reveal but a 50-char password expanded breaks layout. Should `max-w-[12ch]` with `truncate`, full value on hover/click.

#### 4.3 — `onHealthCheck` per-row calls API every click (no rate-limit guard)
Admin clicking "Kiểm tra sống/chết" on the same row 5 times in a second fires 5 API calls. The endpoint should rate-limit, but client-side debounce or "Đang kiểm tra..." disabled state prevents double-clicks.

#### 4.4 — Column widths fixed via Tailwind utility classes — not user-resizable
Power users with 4K monitors waste horizontal space; mobile users get scrollbars. Acceptable for v1; future Wave can add column-resize via a library.

---

## 5. IMPORT WIZARD (`ProxyImport`)

**Wave 26-A just shipped 5 commits of fixes.** Remaining items (deferred from Wave 26-A's plan):

#### 5.1 — `import_batch_id` column on `proxies` (DEFERRED — needs migration)
Currently the import endpoint generates `importId = crypto.randomUUID()` in memory but never writes it to the row. Admin can't filter "show me everything from yesterday's batch". Wave 26-B should add migration `055_import_batch_id.sql`.

#### 5.2 — Multi-file drag-drop (DEFERRED — needs UX decision)
Drop file 1 (200 proxies), then file 2 (300 proxies). Currently file 2 replaces file 1's parsed rows. Should it append? UX decision.

#### 5.3 — TestID coverage for component testing
ProxyImport has 0 component tests today. The category-picker test added in Wave 26-A is a good baseline; the wizard itself needs at least: parseContent dedup, banner render, button-state state machine, handleProbe abort.

---

## 6. CROSS-COMPONENT WORKFLOW GAPS

These span multiple files — affect the user's mental model of "how do I do X?"

### 6.1 — Two paths to add 1 proxy, inconsistent fills
- Path A: `+ Thêm proxy → Thêm đơn` opens `ProxyForm` dialog.
- Path B: `+ Thêm proxy → Nhập hàng loạt` opens `ProxyImport` wizard, paste 1 line.

Path A doesn't auto-fill from category default. Path B does. Same admin, same goal, different behavior.

**Fix:** see 1.7. Apply category-default useEffect to ProxyForm.

### 6.2 — "Sửa" doesn't pre-load all editable fields
See 1.3 — admin can't change vendor or cost via single-row Sửa. Workflow forces them through bulk-edit (cumbersome for 1 proxy) or the API directly.

### 6.3 — Auto-complete data refetched per dialog open
ProxyForm and ProxyImport BOTH fetch `/api/proxies/stats` for countries on every mount. Dashboard already has the data. A shared React context (or SWR cache) would dedupe.

### 6.4 — Health-check status not visible in row immediately after `handleHealthCheck`
The check API returns alive/speed, BUT the parent `fetchProxies()` re-fetches the FULL list to update one row. ~500ms latency per check. Ideal: optimistic update — set the row's `alive` + `speed_ms` from the API response, no refetch.

### 6.5 — No "Last assigned" indicator on rows for aged proxies
The DB has `assigned_at` but the table column shows it raw. Admin scanning for "proxies not used in 30 days" has to sort + read dates manually.

**Fix:** if `assigned_at < now - 30d`, render "30 ngày trước" instead of date. Already exists in mobile card; desktop not.

### 6.6 — Trash bin behavior unclear
`handleDelete` "moves to Thùng rác" (soft delete via `is_deleted=true`). Admin cannot tell from the row alone whether deletion is recoverable. The toast says "Đã chuyển X vào Thùng rác" — good. But after the row disappears, no breadcrumb / undo.

**Fix:** toast with `action: { label: "Hoàn tác", onClick: () => undelete(id) }` for the next 5 seconds.

---

## 7. API ROUTES — CONSISTENCY

### 7.1 — `/api/proxies/import` returns `{imported, skipped, failed, errors}` but no per-proxy IDs
Cross-ref 5.1. Cannot link to "view 19 proxies just imported" without a batch_id.

### 7.2 — `/api/proxies/check` (per-row) doesn't return updated row
The endpoint silently updates the DB. Caller has to refetch. Should return `{ id, alive, speed_ms, last_check_at }` for optimistic UI updates.

### 7.3 — `/api/proxies` POST validation
Reads new proxy from body, calls `supabase.from("proxies").insert(...)`. Doesn't validate that `host:port` is unique BEFORE inserting — relies on DB unique constraint to throw, which surfaces as a generic 500 error to the admin.

**Fix:** add `selectExisting` check + return 409 with friendly message "Proxy host:port đã tồn tại".

### 7.4 — `/api/proxies/[id]` PUT doesn't preserve `created_by` / `created_at` on edit
Should it? Yes — those are immutable. If the API allows them in the body it could be abused. Add explicit allowlist of editable fields.

---

## 8. MOBILE & A11Y ROUND-UP

| Surface | Mobile | A11y |
|---|---|---|
| Proxy form dialog | ✅ Stack vertically below 640px | ⚠ Long Vietnamese labels + Input may overflow on iOS |
| Bulk action bar | ❌ Wraps but Ctrl+A hint hidden behind | ⚠ No live-region for "5 selected" announcement |
| Proxy table | ✅ Card view | ✅ aria-label on rows, aria-sort on sortable headers |
| Filters | ⚠ 4 selects in a row don't fit, wrap awkwardly | ✅ Search has aria-label |
| Import wizard | ⚠ 3-column grids break to 1 col below 640px (OK) | ⚠ AlertDialog confirm content not scrollable on mobile if many fields |
| Pagination | ✅ Hides ranges below 480px | ⚠ Page input not announced on change |

---

## 9. PROPOSED — WAVE 26-B PLAN

Tao gom thành **12 fix** trong **4 commit** (~1.5 ngày). Risk thấp — most là UX polish, không có DB migration except 5.1.

### Commit 1 — Single-proxy form fixes (5 items, low risk)
- 1.1 Reset `formData` on `proxy` prop change (`useEffect` watch + setState)
- 1.2 + 2.2 Toast on save success in `page.tsx::handleSaveProxy`
- 1.4 Dynamic DialogTitle "Sửa host:port"
- 1.5 "Tạo và thêm tiếp" secondary submit
- 1.7 Category-default useEffect in ProxyForm (mirror import wizard)

### Commit 2 — List page polish (5 items, low risk)
- 2.1 Replace `window.confirm` in handleDelete with AlertDialog
- 2.3 handleCheckAll surface "capped at 500" warning when total > 500
- 2.4 + 6.4 handleHealthCheck toast + optimistic row update
- 2.5 Realtime channel error → soft banner + reconnect
- 2.7 Last-check timestamp updated on per-row check too (gap 2.8)

### Commit 3 — Filters + table polish (5 items, low risk)
- 3.1 "Xoá tất cả filter" link
- 3.2 Active-filter count badge
- 3.3 Debounce search input 300ms
- 4.1 Extract `COL_COUNT` constant
- 4.2 max-w + truncate on credentials
- 6.6 Toast undo action on delete (5s window)

### Commit 4 — Form field expansion (3 items, medium risk)
- 1.3 Add `purchase_date`, `vendor_label`, `cost_usd`, `sale_price_usd` to ProxyForm in collapsible "Thông tin mua / bán" section
- 1.6 expires_at quick-fill suggestion (mirror import wizard)
- 1.8 DialogDescription mention required fields

### Defer to Wave 26-C
- 5.1 `import_batch_id` migration + filter
- 5.2 multi-file drag UX decision
- 5.3 ProxyImport component test suite (parseContent dedupe, button state machine)
- 6.3 SWR/context cache for shared autocomplete data
- 6.5 "30 ngày trước" relative-time on desktop assigned_at column

---

## 10. SUMMARY STATS

| Severity | Count |
|---|---:|
| ❌ HIGH (data loss / silent fail / broken UX) | **9** |
| ⚠ MEDIUM (UX friction, no data loss) | **15** |
| ✅ Working well (don't regress) | **12** |
| **Total findings** | **36** |

Wave 26-B ships 13 of these (4 high, 9 medium). Wave 26-C ships the rest pending UX decisions or DB migration.

---

## Review log

| Date | Reviewer | Wave audited | Outcome |
|---|---|---|---|
| 2026-05-03 | Claude | Wave 26-A live, post-merge | This document. 36 findings, recommended 4-commit Wave 26-B (1.5 days). |
| TBD | (next) | Wave 26-B | append after ship |
