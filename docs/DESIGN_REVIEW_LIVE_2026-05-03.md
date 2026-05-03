# Design Review (Live) — Wave 23 / 24 / 25-pre1

**Date:** 2026-05-03
**Reviewer:** Claude (primary) + brainstormer agent (outside voice — running in parallel; merge pass appended after this doc lands)
**Scope of review:** the UX changes shipped in Wave 23A → 23E, Wave 24-1 + Wave 24-checkproxy, and Wave 25-pre1 (Markdown safety + race fixes). Both surfaces:
- Telegram bot conversation UX (12 commands, 5 conversation states, 9 callback prefixes, vi/en copy)
- Admin web nav + dashboard KPI drill-down

**Method:** 7 passes, each with a 0–10 rating, top gaps with file:line refs, and one concrete fix per gap. Closes with a maintainability appendix that future devs use to add a new command / sidebar item / dashboard KPI / admin action without grepping the whole tree.

**Why this doc exists:** the user's directive 2026-05-03 — "cần làm thật cẩn thận, chi tiết, đầy đủ, đồng bộ và chuyên nghiệp mọi thứ từ chi tiết nhỏ để sau dễ dàng thêm/sửa/xóa/maintain". This is not a one-shot review; it's the canonical record future agents read when they touch UX surface area. Update the *Review log* at the bottom on every subsequent design review.

---

## 0. Pre-review system audit

### 0.1 What already exists (and is in scope)

| Surface | Files | Last touched |
|---|---|---|
| Bot welcome | `src/lib/telegram/commands/start.ts` | 23C-fix |
| Bot main menu | `src/lib/telegram/keyboard.ts::mainMenuKeyboard` | 23B-bot |
| Bot copy (vi+en) | `src/lib/telegram/messages.ts::msg` | 25-pre1 |
| Markdown safety | `src/lib/telegram/format.ts` | 25-pre1 |
| Conversation state | `src/lib/telegram/state.ts::BotStep` | 24-checkproxy |
| Callback router | `src/lib/telegram/handlers.ts` | 23D + 24-1 + 24-checkproxy |
| Approval guard | `src/lib/telegram/guards.ts::denyIfNotApproved` | 23B-bot-fix |
| /getproxy flow | `src/lib/telegram/commands/get-proxy.ts` | 23E |
| Order chooser + qty | `src/lib/telegram/commands/custom-order.ts` | 24-1 |
| Bulk assign | `src/lib/telegram/commands/bulk-proxy.ts` | 23B-bot |
| /myproxies | `src/lib/telegram/commands/my-proxies.ts` | 25-pre1 |
| /status | `src/lib/telegram/commands/status.ts` | 25-pre1 |
| /history | `src/lib/telegram/commands/history.ts` | 23B |
| /revoke | `src/lib/telegram/commands/revoke.ts` | 25-pre1 |
| /cancel | `src/lib/telegram/commands/cancel.ts` | 23D |
| /support | `src/lib/telegram/commands/support.ts` | 23B |
| /language | `src/lib/telegram/commands/language.ts` | 23B |
| /help | `src/lib/telegram/commands/help.ts` | 23B |
| /checkproxy | `src/lib/telegram/commands/check-proxy.ts` | 24-checkproxy + 25-pre1 |
| Admin approve | `src/lib/telegram/commands/admin-approve.ts` | 25-pre1 |
| Bot menu (Telegram native) | `src/lib/constants.ts::BOT_COMMANDS` | Phase 3 |
| Admin web sidebar | `src/components/layout/sidebar.tsx` | Wave 22V |
| Dashboard KPI cards | `src/components/dashboard/stats-cards.tsx` | Phase 3 |

### 0.2 What is NOT in scope

- **DB-layer concerns** (mig 027/041–049, RLS) — covered in `docs/DB_AUDIT.md`; out of UX scope.
- **Performance / Vercel cold-start** — covered in `docs/PERF_AUDIT.md`.
- **Security (CSRF, race conditions)** — covered in `docs/SECURITY_AUDIT.md`. Wave 25-pre1's Markdown escape *is* in scope here because it directly impacts whether the user sees a message or silence.
- **Vendor reseller adapter design** (Wave 26+) — see `docs/LEARN_VIA_FEATURES.md`.
- **Admin web tabs interior** (proxies / users / requests sub-tabs) — covered in `docs/REVIEW_TAB_*.md` v2 series. We only touch the sidebar IA + dashboard cards here.
- **Webhook plumbing / IP whitelist** — out of UX scope.

### 0.3 Step 0 baseline rating (where we are *today*, before this review's fixes)

| Dimension | Rating | One-line reason |
|---|---:|---|
| Information Architecture | 7/10 | Sidebar IA + bot menu both clean. Warranty→Revoke is a known smell. |
| Interaction State Coverage | 6/10 | Most happy/error states covered; expired session + 4096-char Telegram limit + "no quota" semantics are gappy. |
| User Journey | 7/10 | Pending limbo well-handled, confirm step is good. Recovery from a bad paste in `/checkproxy` is the weakest sub-flow. |
| AI Slop Risk | 6/10 | Generic acks ("Đã hủy.") repeat 3+ times across files; "Order nhanh" vs "Quick order" copy is consistent now but boilerplate-feeling. |
| Design System Alignment | 6/10 | Icon prefixes ([X]/[!]/[i]/[OK]) consistent; callback prefixes consistent; vi+en parity drifted in 3 spots. |
| Responsive & Accessibility | 7/10 | Mobile sidebar good. Bot keyboards 2-wide fit Telegram mobile. Aria labels on the sidebar logout/collapse buttons present. Color-only KPI trend deltas need a fix. |
| Unresolved Design Decisions | 6/10 | Warranty rename half-done, Help dialog vs Hướng dẫn menu duplicate, /support text says "any message" but it's actually a 30-min timer. |
| **Overall** | **6.4 / 10** | **Solid VIA-port baseline; needs polish + a maintainability layer before Wave 26 doubles surface area.** |

The remainder of this doc raises specific gaps and concrete fixes per pass.

---

## Pass 1 — Information Architecture (rating: 7/10)

**Question:** does the menu / sidebar / command surface map cleanly to user goals, with the right grouping, labelling, and depth?

### Findings

**1.1 Bot main-menu warranty → revoke (medium)**
`src/components/layout/sidebar.tsx` and `src/lib/telegram/keyboard.ts:50` both expose a "Bảo hành proxy / Warranty claim" affordance, but its callback handler (`handlers.ts:108-113`) routes verbatim to `handleRevoke`. Users who expect "open a warranty claim" (different shape: report a dead proxy + get a replacement) get the "return your proxy and lose it" flow instead. The code comment at `handlers.ts:109` admits this is a Wave 24 deferral. Wave 24 didn't pick it up.

**Fix:** either rename the button to "Trả proxy / Return proxy" so label = behaviour, or land the warranty schema. Rename is the cheap path — change `keyboard.ts:27` `warranty: "Bảo hành proxy"` → `return: "Trả proxy"` and `handlers.ts:108` `case "warranty"` → `case "return"`. Add a TODO to `docs/IMPROVEMENT_BACKLOG.md` for the real warranty model so the rename doesn't bury the work.

**Maintainability pattern:** any callback-only label in `keyboard.ts` should map 1-1 to the case in `handlers.ts`. Add a comment pointing each `keyboard.ts` label at the case it dispatches; that one comment line saves the next dev the grep.

**1.2 /help vs "Hướng dẫn" main-menu button (low)**
The main-menu button "Hướng dẫn" (`keyboard.ts:29`) routes to `handleHelp` (`handlers.ts:117-119`), which renders the same `t("help", lang)` content as the slash command `/help`. That's correct behaviour, but the bot welcome (`messages.ts:14-26`) ALSO lists every command including `/help`. So a user has THREE ways to reach the same content: welcome list, main-menu button, slash command. That's not bad — but the main-menu button label should match the slash command name visually, otherwise the user thinks they're different.

**Fix:** in `keyboard.ts:29` rename `help: "Hướng dẫn"` → `help: "Trợ giúp /help"` (vi) and `help: "Help /help"` (en). The "/help" suffix tells the user "this is the same thing as the command".

**1.3 Sidebar /check-proxy is a top-level entry but bot /checkproxy is a sub-task (medium)**
`sidebar.tsx:127-131` makes "Check proxy" a top-level sidebar entry under the PROXY group. In the bot, `/checkproxy` is a sub-task that takes a paste and returns a report. In the admin web, the same name implies "manage the checking subsystem". Mismatched mental models for the same noun.

**Fix:** rename the sidebar entry to "Probe proxy" or "Test proxy" so the verb is different from the bot's user-facing /checkproxy. Update `sidebar.tsx:128` `t("sidebar.checkProxy")` and the corresponding i18n key. If we keep the route `/check-proxy`, that's fine — only the label changes.

**1.4 BOT_COMMANDS order doesn't match welcome-list order (low)**
`constants.ts:30-43` lists 12 commands in this order: start, getproxy, myproxies, checkproxy, status, history, revoke, cancel, support, language, help, requests. The welcome list in `messages.ts:14-26` is: getproxy, myproxies, checkproxy, status, history, revoke, cancel, support, language, requests, help. `requests` and `help` are swapped. Trivial but it tells you nobody owns "the canonical order".

**Fix:** declare a single source of truth. Add to `constants.ts` directly above `BOT_COMMANDS`:

> // ORDER POLICY: surface order is alphabetised by user-task urgency, not slash name.
> //   1. start (entry)
> //   2-7. main flow: getproxy, myproxies, checkproxy, status, history, revoke
> //   8-9. recovery: cancel, support
> //   10-11. settings: language, help
> //   12. admin-only: requests
> // Mirror the same order in messages.ts welcome and help, AND in setMyCommands.

Then sort `BOT_COMMANDS` to match, sort `messages.ts:14` and `messages.ts:54` welcome/help blocks to match, and the next dev never breaks the ordering by accident. Add a unit test in `__tests__/commands.test.ts` that asserts the three lists agree.

### Pass 1 fix summary

| # | File | Line(s) | Change |
|---|---|---|---|
| 1.1 | `src/lib/telegram/keyboard.ts` | 27, 41 | `warranty: "Bảo hành proxy"` → `return: "Trả proxy"`; en: `"Return proxy"` |
| 1.1 | `src/lib/telegram/handlers.ts` | 108 | `case "warranty":` → `case "return":` |
| 1.1 | `docs/IMPROVEMENT_BACKLOG.md` | — | Add row "Wave 26: real warranty schema (claim → admin → replacement)" |
| 1.2 | `src/lib/telegram/keyboard.ts` | 29, 39 | `help: "Hướng dẫn"` → `help: "Trợ giúp /help"`; en parallel |
| 1.3 | `src/components/layout/sidebar.tsx` | 128 | rename i18n key `sidebar.checkProxy` → `sidebar.probeProxy`; vi: "Probe proxy" |
| 1.4 | `src/lib/constants.ts` | above 30 | add ORDER POLICY comment + sort `BOT_COMMANDS` |
| 1.4 | `src/lib/telegram/messages.ts` | 14, 54 | re-sort welcome + help to match policy |
| 1.4 | `src/lib/telegram/__tests__/commands.test.ts` | new | assert the 3 lists are identical order |

---

## Pass 2 — Interaction State Coverage (rating: 6/10)

**Question:** is every interaction state — loading, empty, error, partial-success, expired session, blocked, rate-limited, no-proxy-available, file-too-large, network failure — covered with a clear user-visible message?

### Findings

**2.1 Telegram message-length 4096-char ceiling unguarded (high)**
`/myproxies` (`my-proxies.ts:50-75`) builds one line per assigned proxy. A user with `max_proxies=80` and full credentials can blow past 4096 chars and Telegram returns 400 "MESSAGE_TOO_LONG". User sees nothing. Same risk in `/history` (`history.ts:34-46` — bounded by `.limit(10)`, so safe today, but if anyone changes 10 → 100 the bug arrives). Same in `/checkproxy` results (`check-proxy.ts:235`) when 20 long URLs are pasted.

**Fix:** add `src/lib/telegram/chunk.ts` exporting `chunkMessage(text: string, maxChars = 3800): string[]`. Call sites:
- `my-proxies.ts:81` — replace single `ctx.reply` with a loop
- `check-proxy.ts:240` — same
- `bulk-proxy.ts:101-123` — already has a 3-proxy threshold + file fallback, but the inline path can still overflow when 3 proxies have very long passwords. Use `chunkMessage` defensively.

**Naming convention** for this helper: `src/lib/telegram/chunk.ts` co-located with `format.ts` and `format-proxies.ts`. Future text-output utilities go in the same folder under names matching the Telegram concept (`escape.ts`, `cite.ts`, etc.).

**2.2 "No quota" status doesn't differentiate "limit=0" vs "exhausted" (medium)**
`/status` progress bar at `status.ts:31-37` returns `[----------]` for limit≤0 (admin set to 0) AND for "limit=10, used=10" if rounding edge case. User can't tell whether they're rate-limited because admin restricted them or because they used up today's quota. Subtle but matters for the support ticket "why doesn't /getproxy work?".

**Fix:** in `status.ts:43-67`, append a one-line state hint after each bar:
- `limit ≤ 0` → vi: "(không khả dụng)" / en: "(disabled)"
- `used >= limit` → vi: "(đã hết quota giờ này)" / en: "(quota exhausted)"
- `used < limit` → no extra string

Pattern: keep these strings in `messages.ts` under a new `quotaState` key with vi/en map. Don't inline them in `status.ts` — every new translatable string belongs in `messages.ts`.

**2.3 `awaiting_check_list` state has no expiry-feedback (medium)**
A user types `/checkproxy`, sees "Dán danh sách proxy…", walks away. 30 minutes later they paste. `state.ts:58` clears the state at read time, so the paste falls through to the `/help` fallback (`handlers.ts:370-373`). User thinks the bot is broken.

**Fix:** when `state.step` is in `[awaiting_quick_qty, awaiting_custom_qty, awaiting_confirm, awaiting_check_list]` *and* TTL just expired, before clearing, send a one-time message: "Phiên hết hạn. Bấm /checkproxy để bắt đầu lại." Implementation:
- Add a `getBotStateWithExpiry(teleUserId): { state, expired }` variant in `state.ts` that returns whether the read just expired.
- In `handlers.ts` `message:text` (line 328), check `expired === true` and send the recovery hint, then return.

**Naming convention:** keep state-machine internals (`getBotState`, `setBotState`, `clearBotState`, plus the new variant) in `state.ts`. Never duplicate state reads in command files — call site pattern is "read state once at the top of `message:text`, branch on `step`".

**2.4 `/checkproxy` partial-result when wall-clock budget hits (low)**
`check-proxy.ts:178-193` already times-out individual rows but doesn't surface "we ran out of time" upstream. Today the user sees mixed `[OK]` and `[-] kiểm tra timeout` rows but no top-line warning. If the first 5 of 20 succeeded and 15 timed out, the summary "5/20 alive, 15 dead" is misleading — those 15 weren't dead, they were untested.

**Fix:** distinguish `dead` vs `timed_out` in the summary header. `check-proxy.ts:213-214`:
- Add `const timedCount = results.filter((r) => r.timed_out).length;`
- Header: `Kết quả kiểm tra (X sống, Y chết, Z không kịp kiểm tra)` / `(X alive, Y dead, Z not tested)`

**2.5 Pending-pre-existing-request UX (low)**
`get-proxy.ts:51-64` correctly rejects a second `/getproxy` while a pending row exists. Message is "Bạn đã có yêu cầu đang chờ xử lý. Vui lòng đợi admin duyệt." Doesn't tell the user how long, doesn't link to `/cancel`, doesn't link to `/history`.

**Fix:** append vi: "\nDùng /history để xem yêu cầu hoặc /cancel để huỷ." / en: "\nUse /history to view or /cancel to cancel." Same string, same place. Two extra slashes, big UX win.

**2.6 No-proxy-available on auto-assign vs on no-pool (medium)**
`bulk-proxy.ts:76-81` returns `t("noProxyAvailable", lang)` when the RPC returns `assigned=0`. But the same message fires whether (a) zero proxies of that type exist in the pool or (b) all are taken right now. User has different next-actions: (a) ping admin for new proxies vs (b) wait 5 minutes.

**Fix:** in `bulk-proxy.ts:76`, before showing `noProxyAvailable`, count the pool: `select count(*) from proxies where type = ? and is_deleted = false and status in ('available','assigned')`. If 0 → message A ("loại này chưa có trong kho — liên hệ admin"). If >0 → message B ("hiện tất cả đều đang được sử dụng — thử lại sau ~5 phút"). Add both keys to `messages.ts` under `noProxyTypeMissing` + `noProxyAllTaken`.

### Pass 2 fix summary

| # | File | Line | Change |
|---|---|---|---|
| 2.1 | `src/lib/telegram/chunk.ts` | new | export `chunkMessage(text, maxChars=3800): string[]` |
| 2.1 | `src/lib/telegram/commands/my-proxies.ts` | 81 | use `chunkMessage` |
| 2.1 | `src/lib/telegram/commands/check-proxy.ts` | 240 | use `chunkMessage` |
| 2.1 | `src/lib/telegram/commands/bulk-proxy.ts` | 101–123 | guard inline branch with `chunkMessage` |
| 2.2 | `src/lib/telegram/messages.ts` | new keys | `quotaStateDisabled`, `quotaStateExhausted` |
| 2.2 | `src/lib/telegram/commands/status.ts` | 39–41 | annotate each bar with quota state |
| 2.3 | `src/lib/telegram/state.ts` | bottom | export `getBotStateWithExpiry` |
| 2.3 | `src/lib/telegram/handlers.ts` | 328 | branch on `expired` and recover |
| 2.4 | `src/lib/telegram/commands/check-proxy.ts` | 213–234 | tri-state summary |
| 2.5 | `src/lib/telegram/commands/get-proxy.ts` | 53 | append /history /cancel hint |
| 2.6 | `src/lib/telegram/messages.ts` | new keys | `noProxyTypeMissing`, `noProxyAllTaken` |
| 2.6 | `src/lib/telegram/commands/bulk-proxy.ts` | 76 | branch on pool size |

---

## Pass 3 — User Journey & Emotional Arc (rating: 7/10)

**Question:** does the user feel oriented at every step? Does the first-time success delight? Does failure feel like the system is on their side?

### Findings

**3.1 First-time pending journey is the strongest sub-flow (positive)**
`/start` correctly differentiates pending vs blocked vs active (`start.ts:34-133`), notifies all admins on first `/start`, and clears any stale reply keyboard. The pending message tells the user exactly what state they're in and what comes next. **Keep this pattern** — it's the model for the other flows.

**3.2 First-time success delight is lukewarm (medium)**
After a user gets approved, the next `/getproxy` → quick → 1 proxy delivers `proxyAssigned` (`messages.ts:102-119`). The text is functional ("[OK] Proxy đã được cấp! / `host:port:user:pass` / Loại: HTTP / Hết hạn: 2026-06-01"). No first-time-only delight, no "tap below to test it", no `/checkproxy` hint. Compare to the VIA bot's first-success path which links to the next obvious action.

**Fix:** add a "what next?" footer to the FIRST proxy assignment per user (track via a simple `tele_users.first_proxy_at` timestamp column). Copy: vi: "_Test proxy này bằng /checkproxy. Xem tất cả: /myproxies._" / en: "_Test it with /checkproxy. View all: /myproxies._" Render only when this is the user's first lifetime assignment.

**Maintainability pattern:** any "milestone-only message" (first proxy, first revoke, 100th proxy) goes through a helper `src/lib/telegram/milestones.ts` that takes `(user, milestoneKey)` and returns a footer string or empty. The lookup table sits in one file; commands stay thin. Future "100 proxies milestone" or "first month anniversary" go in the same registry.

**3.3 Bad-paste recovery in `/checkproxy` is silent (medium)**
User types `/checkproxy`, sees the prompt, pastes a malformed list (e.g. one CSV row). `parseProxyText` returns 0 valid; `check-proxy.ts:127-135` replies "Không tìm thấy proxy hợp lệ. Mỗi dòng phải là `host:port` hoặc `host:port:user:pass`." But the state is NOT cleared (line 135 `return true`, never hits `clearBotState`), so the user is still in `awaiting_check_list`. They retry with another paste — still bad — same message. They give up.

**Fix:** EITHER clear state on the third bad attempt (count attempts in the `BotState.context`) OR clear immediately and re-instruct user to `/checkproxy` again. The second is simpler. Change `check-proxy.ts:135`: before `return true`, `await clearBotState(user.id);` — and rephrase the error to mention the recovery: "[!] Không tìm thấy proxy hợp lệ. Bấm /checkproxy để thử lại."

**3.4 Admin-rejection notification is impersonal (low)**
`admin-approve.ts:243-249` sends rejected user "Yêu cầu proxy bị từ chối." That's it. No reason, no support hint, no "if you think this is a mistake, /support". User goes silent.

**Fix:** in `admin-approve.ts:222-249`, the rejection currently uses a hardcoded `rejected_reason: "Rejected via Telegram"`. Two options:
- (a) Always append "Liên hệ /support nếu bạn cho rằng đây là nhầm lẫn."
- (b) Add a 3-button rejection-reason picker to `handleAdminRejectCallback` (Spam / Out of stock / Other) and surface the picked reason to the user.

(a) is one line change. Do it now. Defer (b) to Wave 26 with a TODO.

**3.5 Language switch mid-flow is invisible (low)**
A user mid-`awaiting_quick_qty` switches language (`/language` → `lang:vi`/`lang:en`). The state survives (`language.ts:57-60` only updates `tele_users.language`). Their next text input is consumed by `handleQtyTextInput` — but the previous prompt was in the OLD language. Subtle context drift.

**Fix:** when language changes while a non-idle state exists, also clear the state and re-prompt: "Đã đổi ngôn ngữ. Bấm /getproxy để bắt đầu lại." Implementation: at end of `handleLanguageSelection` (`language.ts:64`), call `clearBotState(user.id)` if `getBotState(user.id).step !== 'idle'`.

### Pass 3 fix summary

| # | File | Change |
|---|---|---|
| 3.2 | `src/lib/telegram/milestones.ts` | new helper module |
| 3.2 | `supabase/migrations/050_first_proxy_at.sql` | add `tele_users.first_proxy_at TIMESTAMP` |
| 3.2 | `src/lib/telegram/commands/assign-proxy.ts` | call milestone helper, append footer when applicable |
| 3.3 | `src/lib/telegram/commands/check-proxy.ts:135` | clearBotState + new copy |
| 3.4 | `src/lib/telegram/commands/admin-approve.ts:243-249` | append /support hint |
| 3.5 | `src/lib/telegram/commands/language.ts:64` | clear non-idle state on lang change |

---

## Pass 4 — AI Slop Risk (rating: 6/10)

**Question:** does the copy sound like a real person picked words on purpose, or like a template generator filled blanks? Are there generic acks, leftover boilerplate, robotic ack-isms?

### Findings

**4.1 "Đã hủy." appears 5 separate times across files (medium)**
- `handlers.ts:153` (order-type cancel)
- `handlers.ts:177` (check-list cancel)
- `handlers.ts:255` (qty cancel)
- `cancel.ts:96` (cancel-confirm no)
- `revoke.ts` (handlers.ts:206)

Five copies of the same string. If the product manager wants "Đã huỷ yêu cầu." or wants to add context per cancel-source, all five must be hand-edited. Today three of the five say "Đã hủy." and two say "Đã huỷ." (different diacritic on `u`). Already inconsistent.

**Fix:** add `messages.ts::cancelled` key (vi: "Đã huỷ.", en: "Cancelled.") with optional `cancelledOrder` ("Đã huỷ yêu cầu.") and `cancelledCheck` ("Đã huỷ kiểm tra."). Replace all 5 inline strings with `t("cancelled", lang)` (or the more specific variant).

**Maintainability rule:** any string the bot says more than once goes in `messages.ts`. No exceptions. Add this rule to `docs/IMPROVEMENT_BACKLOG.md` "coding standards" section so the next dev sees it.

**4.2 Mixed-language fallbacks (high)**
- `handlers.ts:153` — `"Đã hủy."` is hardcoded Vietnamese with NO en branch. An English-speaking user clicks Cancel on the order-type chooser and sees Vietnamese.
- `handlers.ts:177` — same.
- `handlers.ts:255` — same `"Đã huỷ."`
- `support.ts:19` — `"Please use /start first."` is hardcoded English, even for Vietnamese users.

**Fix:** every `ctx.reply()` in `handlers.ts` and `support.ts` reads the user's language first (one extra `supabase.from("tele_users").select("language")` cached per webhook invocation). The handlers.ts cancel branches should use the language already loaded in scope from the user lookup performed by their case path.

**Pattern fix:** instead of repeating `select("language")` 5 times in one webhook handler, hoist a `getCallbackUser(ctx): {id, language}` helper into `src/lib/telegram/user.ts` that callbacks share. Cache via a per-`ctx.from.id` Map in module scope (cleared on cold start, fine for serverless).

**4.3 "Đang kiểm tra…" is the only progress signal for /checkproxy (low)**
`check-proxy.ts:152-156` says "Đang kiểm tra X proxy…" then 25 seconds of silence then the report. With 20 unreachable proxies the wait feels broken.

**Fix:** instead of one ack message, edit it incrementally. Keep the original `ctx.reply` message_id, then `ctx.api.editMessageText` after each chunk of `PROBE_CONCURRENCY=5` completes: "Đang kiểm tra 5/20…", "10/20…", etc. Telegram lets you edit your own messages within 48h. Cleaner UX for ~20 lines.

**Pattern:** progress-edit utility in `src/lib/telegram/progress.ts` with `createProgressMessage(ctx, total, label)` returning `{ update(done), finalize(text) }`. Reusable for any future long task (bulk-revoke, batch-import, etc.).

**4.4 Generic /support copy (low)**
`support.ts:23-37` — "Send any message in this chat and an admin will read and reply. Note: Admin may take a few minutes to respond." Two issues: (a) "any message" isn't actually true — only text within 30 minutes of /support hits the support pipeline (`handlers.ts:350-362`); (b) "few minutes" is unverified — depends on admin availability.

**Fix:** vi: "Gửi tin nhắn của bạn ngay sau khi đọc tin này. Mọi tin nhắn trong vòng 30 phút sẽ được forward tới admin. Phản hồi thường trong giờ hành chính." / en parallel. Truthful + bounded.

**4.5 Welcome card available-proxy count is misleading at zero (low)**
`start.ts:142-147` shows `*N* proxy sẵn sàng`. When N=0 the user reads "0 proxy sẵn sàng" and concludes the bot is broken. Add a one-liner contingency: `if (availableProxies === 0) line += "\n_(Đang nạp thêm proxy — vui lòng quay lại sau ít phút.)_"`.

### Pass 4 fix summary

| # | File | Change |
|---|---|---|
| 4.1 | `src/lib/telegram/messages.ts` | add `cancelled`, `cancelledOrder`, `cancelledCheck` keys |
| 4.1 | `src/lib/telegram/handlers.ts` | replace 4 hardcoded "Đã hủy." |
| 4.1 | `src/lib/telegram/commands/cancel.ts:96` | use `t("cancelled", lang)` |
| 4.2 | `src/lib/telegram/user.ts` | add `getCallbackUser(ctx)` cached helper |
| 4.2 | `src/lib/telegram/handlers.ts` | use helper in all callback branches |
| 4.2 | `src/lib/telegram/commands/support.ts:19` | i18n the "Please use /start first" |
| 4.3 | `src/lib/telegram/progress.ts` | new helper |
| 4.3 | `src/lib/telegram/commands/check-proxy.ts:152` | use progress helper |
| 4.4 | `src/lib/telegram/commands/support.ts:23-37` | rewrite copy |
| 4.5 | `src/lib/telegram/commands/start.ts:142-147` | zero-pool contingency |

---

## Pass 5 — Design System Alignment (rating: 6/10)

**Question:** are conventions enforced? Icon prefixes, callback prefixes, vi+en parity, emoji policy, button-label length.

### Findings

**5.1 Icon prefix policy is documented nowhere (medium)**
The codebase uses `[X]` (error), `[!]` (warning), `[i]` (info), `[OK]` (success), `[-]` (neutral/timeout). No file documents this. New devs invent their own (`[Approved]`, `[Rejected]`, `[Already processed]` in `bulk-proxy.ts:183, 211, 257, 259, 302, 312, 345`).

**Fix:** add `src/lib/telegram/icons.ts`:

> // ICON POLICY (no emoji per project rule). Use these prefixes verbatim:
> // [X]   error / blocked / failure
> // [!]   warning / rate limit / soft failure
> // [i]   info / pending / neutral
> // [OK]  success
> // [-]   timed out / unknown / soft-skip
> export const Icon = { error: "[X]", warn: "[!]", info: "[i]", ok: "[OK]", neutral: "[-]" } as const;

Replace literal `[X]`/`[!]`/etc. with `Icon.*`. Use grep to find non-conforming admin status badges (`[Approved]`, `[Rejected]`) and consolidate.

**5.2 Callback prefix taxonomy is implicit (medium)**
Today's prefixes (extracted from `handlers.ts`):
- `menu:` — main menu dispatcher
- `proxy_type:` — proxy type pick
- `order_quick:` / `order_custom:` / `order_type:cancel` — order-type chooser
- `qty:` / `qty:quick:` / `qty:custom:` — quantity (legacy + current)
- `confirm:` — order confirm
- `check:cancel` — checkproxy cancel
- `lang:` — language pick
- `cancel_confirm:` — pending-cancel confirm
- `revoke_confirm:` / `revoke:` — revoke flow
- `admin_approve:` / `admin_reject:` / `admin_approve_user:` / `admin_block_user:` / `admin_bulk_approve:` / `admin_bulk_reject:` — admin actions

Mixed underscore vs colon, mixed singular vs plural. New dev adds Wave 26 vendor button → guesses at `vendor_pick:` or `vendor:pick:`. Both work.

**Fix:** declare convention in `src/lib/telegram/callbacks.ts`:

> // CALLBACK PREFIX CONVENTION
> //   <namespace>:<verb>[:<arg1>[:<arg2>]]
> //   namespace = lowercase, no underscores. Use the noun the user clicks.
> //   verb      = lowercase, dash-separated when needed.
> //   args      = ids, ints, "cancel".
> // Existing namespaces: menu, type, order, qty, confirm, check, lang, cancel, revoke, admin.
> // Migration: `proxy_type:` → `type:`; `order_quick:` → `order:quick:`; etc.
> export const CB = {
>   menu: (a: string) => `menu:${a}`,
>   type: (t: string) => `type:${t}`,
>   orderQuick: (t: string) => `order:quick:${t}`,
>   ...
> }

Refactor in two passes: (a) NEW callbacks use `CB.*`. (b) Legacy `proxy_type:`/`order_quick:` keep working in the dispatcher for ~30 days then get removed. Document the deprecation in the file header.

**Pattern for adding a new callback:** "1. Add a `CB.foo()` builder. 2. Use it in `keyboard.ts` when constructing the button. 3. Add the `if (data.startsWith(...))` branch in `handlers.ts`. 4. Write the handler in `commands/<feature>.ts`." Four steps, in four files, predictable.

**5.3 vi+en parity drift (medium)**
`messages.ts:107-118` — vi+en have same 5 lines. ✅
`messages.ts:138-141` — `chooseOrderType` vi has 3 lines plus tip line; en has 3 lines plus tip line. ✅
But:
- `cancel.ts:42-45` — "[i] Không có yêu cầu nào đang chờ để hủy." vs "[i] No pending requests to cancel." → vi uses "hủy", el8 lines later vi-key in `messages.ts:185` uses "huỷ". Two diacritic spellings of the same word.
- `bulk-proxy.ts:91-95` — vi uses non-accented `cap`, `khong kha dung`, while the rest of the file uses accented Vietnamese. Inconsistent.

**Fix:** sweep accent. Add a CI test (`__tests__/via-format.test.ts` already does this for `messages.ts` and `BOT_COMMANDS`, extend to scan all `.ts` files under `src/lib/telegram/` for the unaccented spellings: `huy`, `huong dan`, `khong`, `cap`, `kiem tra`, `tai khoan`. Fail CI on hit unless the line has a `// allow-unaccented` comment.

**5.4 Two diacritic spellings of "huỷ" vs "hủy" (low)**
The Vietnamese language allows both — but pick one and stick. Today the codebase has both. Pick `huỷ` (modern + matches VIA project) and sweep.

**5.5 No emoji policy enforcement (low)**
Comment in `messages.ts:6` says "no emojis". Nothing enforces it — a new dev pastes 🚀 and CI doesn't catch.

**Fix:** add to the same CI test (5.3): scan for any character in the Unicode range U+1F300-U+1FAFF inside `src/lib/telegram/**/*.ts`. Fail if found. Document in `docs/IMPROVEMENT_BACKLOG.md` "bot copy policy".

### Pass 5 fix summary

| # | File | Change |
|---|---|---|
| 5.1 | `src/lib/telegram/icons.ts` | new module + policy |
| 5.1 | all bot command files | replace literals with `Icon.*` |
| 5.2 | `src/lib/telegram/callbacks.ts` | new module with `CB` builders + convention doc |
| 5.2 | `src/lib/telegram/keyboard.ts` | switch builders |
| 5.2 | `src/lib/telegram/handlers.ts` | route via builder constants |
| 5.3 | `src/lib/telegram/__tests__/via-format.test.ts` | extend scan + add coding-standard rules |
| 5.4 | sweep | replace `hủy` → `huỷ` consistently |
| 5.5 | CI test | block unicode emoji range |

---

## Pass 6 — Responsive & Accessibility (rating: 7/10)

**Question:** does the bot UX hold on a small Telegram screen (mobile keyboards)? Does the admin web hold on small viewports? Are screen readers / keyboard-only users covered?

### Findings

**6.1 Inline keyboards are 2-column max — good (positive)**
`keyboard.ts` mainMenuKeyboard, proxyTypeKeyboard, orderTypeKeyboard, quantityKeyboard all 2-column or 3-column. On Telegram's smallest mobile width (~320px) all labels render. ✅

**6.2 Long inline-button labels overflow on iOS (medium)**
`keyboard.ts:23` "Yêu cầu proxy" + `keyboard.ts:24` "Proxy của tôi" — both 13 chars — render as two-row buttons on iOS Telegram in compact mode. Looks broken.

**Fix:** keep main-menu labels under 11 chars. Rename: `request: "Yêu cầu proxy"` → `request: "Lấy proxy"` (9 chars) or stay with `Yêu cầu` (7). Same for `Proxy của tôi` → `Proxy của tôi` is 13; abbreviate to `Của tôi` only on the button (the welcome card explains what "của tôi" means). `Bảo hành proxy` (14 chars) is the worst offender.

**Maintainability:** add a unit test in `__tests__/keyboard.test.ts` that asserts every inline-button label is ≤ 12 chars. Catches this drift on every PR.

**6.3 Admin sidebar collapse-button needs aria-controls (low)**
`sidebar.tsx:299` has `aria-label` and `aria-expanded` but no `aria-controls` pointing to the nav region. Screen readers can announce state but not target. Add `aria-controls="nav-region"` and `id="nav-region"` to the `<nav>` at line 170.

**6.4 KPI cards trend signal is color-only (medium)**
`stats-cards.tsx:48-61` — trend up/down is rendered as green/red TrendingUp/TrendingDown. Colorblind users (8% of men) lose the signal. The `<TrendingUp />` icon DOES carry shape, but the color is the dominant cue.

**Fix:** prepend `+` or `-` to the trend value, so a colorblind user sees `+12%` (up) or `-3%` (down) without needing the color. Change `stats-cards.tsx:60` `${trend.value}%` → `${trend.positive ? "+" : "-"}${Math.abs(trend.value)}%`.

**6.5 Sidebar focus ring (low)**
`sidebar.tsx:192-204` Link has `transition-colors` and an active state but no `:focus-visible:` ring. Tab-only users (keyboard nav) lose the cursor. Add `focus-visible:ring-2 focus-visible:ring-primary` to the className.

**6.6 Status progress bar is text-only — works for all (positive)**
`status.ts:36` returns `[##########]` — 100% accessible since it's literal characters. No emoji, no image. ✅

### Pass 6 fix summary

| # | File | Change |
|---|---|---|
| 6.2 | `src/lib/telegram/keyboard.ts` | shorten labels >12 chars |
| 6.2 | `src/lib/telegram/__tests__/keyboard.test.ts` | label-length assertion |
| 6.3 | `src/components/layout/sidebar.tsx:170, 299` | aria-controls + id |
| 6.4 | `src/components/dashboard/stats-cards.tsx:60` | sign prefix on trend |
| 6.5 | `src/components/layout/sidebar.tsx:194` | focus-visible ring |

---

## Pass 7 — Unresolved Design Decisions (rating: 6/10)

**Question:** what's still ambiguous, half-shipped, or kicked-down-the-road?

### Findings

**7.1 Warranty rename is half-done (high)**
Same as 1.1. Decision: rename now, defer real warranty model to Wave 26. Already written above.

**7.2 Order nhanh threshold is hardcoded (medium)**
`bulk-proxy.ts:14` `BULK_AUTO_THRESHOLD = 5` and `custom-order.ts:24` `QUICK_MAX = 10`, `CUSTOM_MAX = 100`. Three constants, three files, no single source of truth. Admin in `/settings` can't tune them without a deploy.

**Fix:** move to `settings` table (already exists for `global_max_proxies`). New keys: `quick_order_max`, `custom_order_max`, `bulk_auto_threshold`. Read once at handler invocation; default to current values if missing.

**Pattern:** any tunable that ops might want to change at runtime goes into the `settings` table, NOT into code. Add a comment to `src/lib/constants.ts` enumerating which constants are static (in code) vs dynamic (in settings) and why.

**7.3 `/support` chat-message timeout window (low)**
`handlers.ts:362` `RECENT_MESSAGE_WINDOW_MS = 30 * 60 * 1000` — 30 minutes. Where? `constants.ts:55`. Document in /support copy what the window is (already covered in 4.4).

**7.4 Pending-user notification fires on every /start, not first one (medium)**
`start.ts:34-44` — `if (isNew && user.status === "pending")` runs the admin notification. `isNew` is computed via `!user.updated_at || user.created_at === user.updated_at`. If a pending user sends `/start` twice, the second time `updated_at` IS set (by getOrCreateUser), so `isNew=false`. Only the first /start notifies. ✅ Actually this is correct — but it depends on `getOrCreateUser` always touching `updated_at`. If a future refactor makes that conditional, the duplicate-notify bug returns silently.

**Fix:** add an explicit `tele_users.first_start_notified_at` column. Set it in `start.ts:42` on success. Check it in `start.ts:34` instead of the `isNew` heuristic. Migration: `supabase/migrations/051_first_start_notified.sql`.

**7.5 `chooseOrderType` text duplicates `selectQuantity` text intent (low)**
`messages.ts:138-141` chooseOrderType + the prompts in `get-proxy.ts:214-228` both say things like "tối đa N/lần". Three near-identical phrasings. Pick one wording "(tối đa M/lần)" and use it in only one place; reference the same string from both prompts via a helper.

**7.6 Admin approve / block user notifications mention "approved by ${label}" but reject doesn't (low)**
`admin-approve.ts:312` (approve user) vs `admin-approve.ts:363` (block user) both append `- by ${adminInfo.label}`. But `admin-approve.ts:253` (reject request) just says "Request rejected." with no admin attribution. Inconsistent audit trail.

**Fix:** standardize. All admin actions should append `- by <admin label>` to the visible admin message. Add to `admin-approve.ts:253` `await ctx.editMessageText(\`Request rejected - by \${adminInfo.label}\`);` and require `getAdminByTelegramId(ctx.from.id)` at the top of every admin-action handler. Yes, an extra DB lookup; that's the cost of accountability.

### Pass 7 fix summary

| # | File | Change |
|---|---|---|
| 7.1 | (see 1.1) | warranty rename |
| 7.2 | `supabase/migrations/052_settings_order_caps.sql` | add 3 settings keys |
| 7.2 | `src/lib/telegram/commands/bulk-proxy.ts`, `custom-order.ts` | read from settings |
| 7.4 | `supabase/migrations/051_first_start_notified.sql` | new column |
| 7.4 | `src/lib/telegram/commands/start.ts:34, 42` | explicit gate |
| 7.6 | `src/lib/telegram/commands/admin-approve.ts:243-253` | attribute reject |

---

## Maintainability appendix

This is the part that future agents (and humans) read FIRST when they touch UX surface area. Keep it accurate every Wave.

### A. File map (Telegram bot)

```
src/lib/telegram/
├── bot.ts                    # grammy client + global config (parse_mode, etc.)
├── handlers.ts               # ROUTER: command + callback + text + media dispatchers
├── messages.ts               # ALL user-visible strings (vi+en). Source of truth.
├── format.ts                 # Markdown escape + safeCredentialString
├── format-proxies.ts         # proxy → text/buffer formatting
├── icons.ts                  # (proposed) Icon prefix policy + constants
├── callbacks.ts              # (proposed) CB builder + prefix taxonomy
├── chunk.ts                  # (proposed) chunkMessage(text, max=3800)
├── milestones.ts             # (proposed) first-time / nth-time message helpers
├── progress.ts               # (proposed) progress-edit helper for long tasks
├── state.ts                  # bot_conversation_state CRUD + BotStep enum
├── guards.ts                 # denyIfNotApproved (auth)
├── user.ts                   # getOrCreateUser + getUserLanguage + (proposed) getCallbackUser
├── logging.ts                # logChatMessage (audit row)
├── send.ts                   # sendTelegramMessage / sendTelegramDocument
├── notify-admins.ts          # notifyAllAdmins / notifyOtherAdmins / getAdminByTelegramId
├── rate-limit.ts             # checkRateLimit + loadGlobalCaps
├── revoke.ts                 # revokeProxy RPC wrapper
├── webhook-queue.ts          # webhook ingestion buffer
├── ip-whitelist.ts           # IP whitelist enforcement
├── simulator.ts              # admin-side simulator
└── commands/
    ├── index.ts              # barrel export — keep alphabetical
    ├── start.ts
    ├── help.ts
    ├── get-proxy.ts          # /getproxy + handleProxyTypeSelection + handleOrderModeSelection
    ├── bulk-proxy.ts         # handleQuantitySelection + admin bulk approve/reject
    ├── custom-order.ts       # handleQtyTextInput + handleConfirmCallback
    ├── my-proxies.ts
    ├── status.ts
    ├── history.ts
    ├── revoke.ts             # /revoke + handleRevokeConfirm + handleRevokeSelection
    ├── cancel.ts
    ├── support.ts
    ├── language.ts
    ├── check-proxy.ts        # /checkproxy + handleCheckListInput
    ├── admin-approve.ts      # request-level approve/reject + user-level approve/block
    └── assign-proxy.ts       # autoAssignProxy + createManualRequest
```

### B. File map (admin web — UX-surface only)

```
src/components/
├── layout/
│   ├── sidebar.tsx           # Sidebar IA. ANY new top-level entry → here.
│   └── header.tsx
├── dashboard/
│   ├── stats-cards.tsx       # KPI cards. New KPI → add a StatCard with href.
│   ├── recent-requests.tsx
│   ├── active-users.tsx
│   └── proxy-chart.tsx
├── shared/                   # generic widgets (buttons, modals, table-skeleton)
└── (per-domain)/             # proxies/, users/, requests/, bot/, trash/, categories/, chat/, logs/
```

### C. Recipes

#### C.1 Add a new bot command `/foo`

1. Create `src/lib/telegram/commands/foo.ts`. Export `handleFoo(ctx)`.
2. In `commands/index.ts` add `export * from "./foo"`. Keep alphabetical.
3. In `handlers.ts` register: `bot.command("foo", handleFoo)`. Group with other `bot.command(...)` lines.
4. In `constants.ts` `BOT_COMMANDS` array, add `{ command: "foo", description_vi: "...", description_en: "..." }`. Place per ORDER POLICY (Pass 1.4).
5. In `messages.ts` welcome + help blocks, add `/foo - <description>` in matching position.
6. In `__tests__/commands.test.ts`, the order-parity test will fail until you sort the three lists; that's intentional.
7. If `/foo` returns text, prefer keys in `messages.ts` over inline strings. Min 1 vi + 1 en string.
8. If `/foo` is admin-only, gate at the top via `getAdminByTelegramId`. If user-only-when-approved, gate via `denyIfNotApproved`.
9. Add a row to the file map (this doc, section A) under `commands/`.

#### C.2 Add a new bot callback `<ns>:<verb>[:<args>]`

1. In `callbacks.ts`, add a builder: `CB.fooDo: (id: string) => \`foo:do:${id}\``.
2. In `keyboard.ts`, use the builder when constructing the InlineKeyboard.
3. In `handlers.ts` callback router, add `if (data.startsWith("foo:")) { ... }` block. Group with existing prefixes.
4. Implement the handler in `commands/foo.ts`.
5. ALWAYS call `ctx.answerCallbackQuery()` — Telegram shows a spinner forever otherwise. If the action is silent-success, pass empty arg; if it's an error, pass the error string.

#### C.3 Add a new sidebar item

1. In `sidebar.tsx`, append to the `navItems` array. Set `section` ONLY on the first entry of a new section group.
2. Choose icon from `lucide-react` — already imported set is at top of file. No new icon libraries.
3. If the page has sub-tabs (e.g. /users + /chat), declare `altPaths`.
4. If the page is admin-only, set `minRole: "admin"` or `"super_admin"`.
5. Add the i18n key in `src/lib/i18n/`. Both vi + en.
6. Verify `aria-label` and `focus-visible` work (handled by the shared Link template).

#### C.4 Add a new dashboard KPI card

1. In `stats-cards.tsx`, add a `<StatCard>` block. Always set `href` to the FILTERED page that matches the KPI value (drill-down convention).
2. Update `src/types/api.ts::DashboardStats` interface with the new field.
3. Update `src/app/api/dashboard/route.ts` (or wherever stats are computed) to populate the field.
4. Stay 4-card-per-row max (`lg:grid-cols-4`). If a 5th card joins, restructure to `lg:grid-cols-5` + verify breakpoints.

#### C.5 Add a new admin keyboard action (e.g. "Refund")

1. Add a CB builder in `callbacks.ts`: `CB.adminRefund: (reqId) => \`admin:refund:${reqId}\``.
2. Add the button to whichever admin keyboard is relevant (e.g. inside `notifyAllAdmins`'s inlineKeyboard).
3. Add the handler in `commands/admin-approve.ts` (or split to `commands/admin-refund.ts` if logic is large).
4. Always: `getAdminByTelegramId` at top → 401-equivalent if not admin → action → `notifyOtherAdmins` to update other admins' messages.
5. Always attribute action with admin label in user-visible message (Pass 7.6 standard).

### D. String policy

| Rule | Where enforced |
|---|---|
| Every user-visible string in `messages.ts` (or per-command file via inline only when it's truly one-off) | Coding-standards section in `docs/IMPROVEMENT_BACKLOG.md` + CI test |
| vi + en parity (every key has both) | `__tests__/messages.test.ts` |
| No raw emoji (Unicode 1F300-1FAFF) | `__tests__/via-format.test.ts` (extended in 5.5) |
| Vietnamese accented (no `huy`/`khong`/`tai khoan`) unless `// allow-unaccented` | same test |
| Markdown special chars escaped via `escapeMarkdown` when interpolating user input | code-reviewer agent |
| Icon prefix from `Icon.*` only (no inline `[X]`) | grep CI |

### E. Coding standards (proposed addition to `docs/IMPROVEMENT_BACKLOG.md`)

```
## Bot UX coding standards
- All user-visible strings live in src/lib/telegram/messages.ts.
- All callback prefixes use the CB builder in src/lib/telegram/callbacks.ts.
- All status icons use Icon.* from src/lib/telegram/icons.ts.
- All progress / multi-step messages use src/lib/telegram/progress.ts.
- All long messages route through chunkMessage to respect Telegram's 4096 limit.
- All admin actions log via logChatMessage AND attribute via getAdminByTelegramId.
- All command handlers gate via denyIfNotApproved (user-only) or getAdminByTelegramId (admin-only).
- All conversation state via setBotState / clearBotState — never inline supabase.
```

### F. When you delete a feature

1. Remove the `bot.command(...)` registration in `handlers.ts`.
2. Remove the `BOT_COMMANDS` entry in `constants.ts`.
3. Remove the welcome + help line in `messages.ts`.
4. Remove the file under `commands/`.
5. Remove the export in `commands/index.ts`.
6. Remove any callbacks routed only to it from `handlers.ts`.
7. Remove the corresponding `messages.ts` keys IF no other handler uses them.
8. Remove tests under `__tests__/`.
9. Push setMyCommands again on next deploy (bot menu refreshes).
10. Update file map in this doc (section A).

---

## Completion summary

| Pass | Rating | Findings | Critical | Medium | Low |
|---|---:|---:|---:|---:|---:|
| 1 — Information Architecture | 7/10 | 4 | 0 | 2 | 2 |
| 2 — Interaction State Coverage | 6/10 | 6 | 1 (msg-len 4096) | 4 | 1 |
| 3 — User Journey | 7/10 | 5 | 0 | 3 | 2 |
| 4 — AI Slop Risk | 6/10 | 5 | 1 (mixed-lang fallbacks) | 1 | 3 |
| 5 — Design System Alignment | 6/10 | 5 | 0 | 3 | 2 |
| 6 — Responsive & A11y | 7/10 | 6 | 0 | 2 | 4 |
| 7 — Unresolved Decisions | 6/10 | 6 | 1 (warranty) | 3 | 2 |
| **Total** | **6.4/10** | **37** | **3** | **18** | **16** |

### Top 5 maintainability cracks (most likely to bite Wave 26)

1. **No callback prefix taxonomy** — Wave 26 vendor adapters will add 5+ new prefixes. Without `CB.*` builders the dispatcher in `handlers.ts` becomes a 500-line ladder.
2. **String duplication ("Đã hủy.", error fallbacks)** — every refactor risks drift. messages.ts must become non-negotiable.
3. **No icon registry** — admin status badges (`[Approved]`/`[Rejected]`) and user-facing icons (`[X]`/`[OK]`) are different vocabularies; future code review can't tell them apart.
4. **Tunables in code, not in `settings`** — every threshold change today requires a deploy. Wave 26 onboarding will demand admin tuning of vendor caps, retry limits, etc.
5. **Half-shipped warranty button** — first thing a real user reports as a bug. Either rename or build it.

---

## Recommended ship ordering

If we ship the 37 fixes, do them in 3 mini-waves so each PR is reviewable:

**Wave 25-pre2 — Quick wins (1 day, 14 fixes)**
- 1.1 warranty rename
- 1.2 help label
- 1.4 ORDER POLICY + sort
- 2.5 /getproxy pending hint
- 3.3 /checkproxy bad-paste recovery
- 3.4 reject /support hint
- 3.5 language clear-state
- 4.4 /support copy rewrite
- 4.5 zero-pool contingency
- 6.4 trend sign prefix
- 6.5 focus ring
- 7.6 reject attribution
- 5.4 huỷ sweep
- 1.3 sidebar Probe rename

**Wave 25-pre3 — Foundations (2 days, 13 fixes)**
- 4.1 + 4.2 + 5.3 messages.ts policy + parity sweep
- 5.1 icons.ts
- 5.2 callbacks.ts + dispatcher refactor
- 5.5 emoji CI test
- 6.2 keyboard label-length test
- 6.3 sidebar aria-controls
- 2.2 quotaState keys
- 2.4 /checkproxy tri-state summary
- 2.6 noProxy sub-cases
- 4.3 progress.ts + checkproxy use

**Wave 25-pre4 — Patterns (2 days, 10 fixes)**
- 2.1 chunk.ts + 3 call sites
- 2.3 getBotStateWithExpiry
- 3.2 milestones.ts + first_proxy_at migration
- 7.2 settings table for caps
- 7.4 first_start_notified migration

Total: 5 days for all 37 fixes. Wave 26 starts on a clean foundation.

---

## Merged outside-voice critique (brainstormer agent)

The brainstormer agent ran the same 7 passes independently. It surfaced 12 additional findings + reinforced 6 of mine. Convergence (both reviewers raised the same point) is high signal — those go to the top of the ship list.

### Convergent findings (both reviewers)

| Pass | Finding | My ref | Outside ref |
|---|---|---|---|
| 1 | Warranty button → revoke is a lie label | 1.1 | Pass 1 #1 |
| 1 | /help and main-menu Hướng dẫn duplicate the welcome card content | 1.2 | Pass 1 #2 |
| 4 | Five copies of "Đã hủy." with diacritic drift | 4.1 | Pass 4 #2 |
| 4 | Generic "/help" fallback terminator after media-unsupported | 4.4 | Pass 4 #3 |
| 5 | Callback prefix taxonomy is implicit / inconsistent | 5.2 | Pass 5 #1 (highest leverage) |
| 5 | Icon vocabulary is not enforced ([X]/[!]/[OK]/[i]/[-]) | 5.1 | Pass 5 #2 |
| 5 | Vi+en parity drift not structurally enforced | 5.3 | Pass 5 #3 |
| 6 | Inline button labels too long for mobile Telegram | 6.2 | Pass 6 #1 |

### NEW findings from outside voice (added below as Pass <N>.<letter>)

**Pass 2.A — Handler precedence bug (medium)**
`handlers.ts:329-338` checks `awaiting_quick_qty` / `awaiting_custom_qty` BEFORE `awaiting_check_list`. If a user is mid-qty-input and sends a multi-line proxy paste (mistakenly thinking they're in /checkproxy), the qty parser at `custom-order.ts:65-71` rejects it with "Please enter a number" — and never tells them they're in the wrong flow. Fix: extract a state→handler dispatch table:

```ts
// In handlers.ts (top of file)
const STATE_HANDLERS: Record<BotStep, (ctx, state, text) => Promise<boolean>> = {
  idle: async () => false,
  awaiting_quick_qty: (ctx, _s, t) => handleQtyTextInput(ctx, "awaiting_quick_qty", _s.proxyType, t),
  awaiting_custom_qty: (ctx, _s, t) => handleQtyTextInput(ctx, "awaiting_custom_qty", _s.proxyType, t),
  awaiting_confirm: async () => false, // confirm goes through callback, not text
  awaiting_check_list: (ctx, _s, t) => handleCheckListInput(ctx, t),
};
```
Adding Wave 26 states becomes "one new key in the dispatch table" instead of one more `if` branch.

**Pass 2.B — No "Bắt đầu lại" recovery keyboard (medium)**
`custom-order.ts:160-169` correctly handles state drift but with plain text. No restart button. User has to remember the slash command. Fix: extract `src/lib/telegram/recovery-keyboard.ts::restartFlowKeyboard(lang, target)` returning a single button mapped to `menu:request` (or other targets). Reuse from `custom-order.ts:166`, `get-proxy.ts` pending-block, `start.ts` pending-welcome.

**Pass 2.C — `/checkproxy` 25s budget exceeds Vercel hobby 10s timeout (high)**
`check-proxy.ts:39` `BATCH_WALL_CLOCK_MS = 25_000` — the comment claims Vercel Pro is 60s, but if the deployment is on hobby (10s) or default Pro (15s for serverless functions), the function is killed mid-probe and the user sees nothing. Fix: read the actual platform timeout from `process.env.VERCEL_FUNCTION_MAX_DURATION` if Vercel exposes it (it does for Pro+); otherwise cap to a known-safe `9_000` for hobby. Better — split the probe into two webhook invocations (start probe → store partial results → resume on next webhook). Wave 26 candidate.

**Pass 3.A — `proxyAssignedAfterApproval` is missing (medium)**
After admin approves, user gets the SAME `proxyAssigned` message as a self-serve auto-assign. The wait was hours; the reveal looks like an instant grab. No "Cảm ơn đã đợi". Fix: add `messages.ts::proxyAssignedAfterApproval` with a longer body ("Yêu cầu của bạn đã được duyệt. Cảm ơn đã đợi. Proxy: ..."). Branch in `admin-approve.ts:182-186`.

**Pass 3.B — Pending limbo has no ETA (medium)**
`messages.ts:133-134` says "Bạn sẽ được thông báo khi được phê duyệt" with no timeline. Users will spam /start. Fix: hardcode "thường trong 24h" as v1; v2 compute from `admin_response_avg_seconds` (Supabase view). Add `messages.ts::pendingApprovalWithEta` with `{eta}` template.

**Pass 3.C — Rejection has no reason surfaced (medium)**
`admin-approve.ts:222-228` writes `rejected_reason: "Rejected via Telegram"` to DB but the user-facing message at `admin-approve.ts:246` is "Yêu cầu proxy bị từ chối." with no reason and no /support link. Fix: read `proxy_requests.rejected_reason` and include it in the user notification: "Yêu cầu proxy đã bị từ chối. Lý do: {reason}\n\nDùng /support nếu cần khiếu nại." Add `messages.ts::requestRejectedWithReason`. Defer the 3-button reason picker (Wave 26).

**Pass 4.A — *** CRITICAL *** Missing diacritics in `admin-approve.ts:246` (high)**
`admin-approve.ts:246` has `"Yeu cau proxy bi tu choi."` — should be `"Yêu cầu proxy bị từ chối."`. This is a pre-existing AI-slop bug that ships to real users. Fix immediately. Then build the lint to catch others:

```ts
// scripts/lint-vi-strings.ts
// Scan src/lib/telegram/**/*.ts for any string preceded by `lang === "vi" ?`
// or appearing in a `vi:` map field. If the string contains a Vietnamese
// stem like "Yeu", "Khong", "Tai khoan", "Huy", "Kiem tra" without the
// expected diacritics, fail the build.
```

Wire as pre-commit hook AND CI check. Run on existing tree to surface peer cases (the audit summary in `bulk-proxy.ts:91-95` already flagged similar `cap` / `khong kha dung`).

**Pass 4.B — Context-aware media-unsupported reply (low)**
`handlers.ts:444-446` always says "Sử dụng /help…". A user in `awaiting_check_list` who pasted a screenshot wants to be told "I see an image — paste text instead". Fix: branch on `state.step` in `handlers.ts:444`. Add `messages.ts::mediaUnsupportedDuringCheck` and `mediaUnsupportedDuringQty`.

**Pass 5.A — Sidebar Badge aria-label is hardcoded Vietnamese (medium)**
`sidebar.tsx:217,227` — `aria-label="${item.badge} chưa duyệt"`. English screen-reader users hear Vietnamese. Fix: use i18n key `sidebar.pendingBadge` with `{count}` template. Add `aria-current="page"` on active links while editing.

**Pass 5.B — `parse_mode` Markdown safety (medium)**
Multiple files use `parse_mode: "Markdown"` with user-supplied data interpolated into a backtick block. `format.ts::safeCredentialString` covers credentials, but other places (e.g. `cancel.ts:64-65` "Hủy tất cả?", `history.ts:46` `(ID: ${shortId})`) interpolate without escape. Most are safe today (admin-controlled or UUID), but the policy needs to be: *every* `parse_mode: "Markdown"` reply runs the user-controlled fragment through `escapeMarkdown` first. Fix: code-reviewer checklist item + grep CI.

**Pass 6.A — Status bar should lead with percentage (low)**
`status.ts:53-55` reads as "open square pound pound… 5/10". Screen-reader UX (and human scanning) is better with the meaningful number first. Fix: prefix the bar with the percentage:

```ts
// status.ts:53
`Theo giờ: 50% ${hBar} ${user.proxies_used_hourly}/${user.rate_limit_hourly}`
```

**Pass 7.A — `aup.ts` is dead but file remains (low)**
`handlers.ts:127-130` says "AUP callbacks removed per user request 2026-04-29" but `aup.ts` is still on disk. Future devs will import from it. Fix: move to `src/lib/telegram/_deprecated/aup.ts` with a `_deprecated/README.md` listing the deletion plan + DB migration to drop `aup_accepted_at` (Wave 26).

**Pass 7.B — Legacy `qty:<type>:<n>` fallback has no expiry (low)**
`handlers.ts:266-271` keeps the legacy 2-arg callback shape for in-flight clicks but no removal date. Fix: add `// TODO remove after 2026-08-01 — legacy callback shape` + a `captureError(..., {level: 'info', message: 'legacy qty callback'})` so we can verify it's quiet before deleting.

**Pass 7.C — stat-cards subtitle text hardcoded English (low)**
`stats-cards.tsx:100,107,114,121` hardcoded English ("available / assigned / expired") inside an i18n product. Fix: i18n via `t("dashboard.statSubtitle.proxies", {available, assigned, expired})`. Add to en + vi locale.

**Pass 7.D — Drill-down hrefs hardcoded as raw strings (low)**
`stats-cards.tsx:102,109,116,123` — `/proxies?status=available` etc. Fix: extract `src/lib/routes.ts` exporting builders `routes.proxies({status: 'available'})`. URL refactors stop breaking the dashboard.

**Pass 7.E — Decision log file (medium)**
`docs/WARRANTY_RENAME_ANALYSIS.md`, `docs/IMPROVEMENT_BACKLOG.md`, and inline TODOs scatter pending decisions. Fix: create `docs/decision-log.md` with one row per pending decision: `{ id, title, current-state, deferred-until-wave, owner, files-touched }`. Cross-reference from comments: `// see decision-log.md#warranty-rename`. Wave-N closes decisions by deleting the row.

### Reinforced recommendation: discriminated-union state machine

Both reviewers flagged the state machine as a maintainability risk, but the outside voice articulated the fix more sharply:

```ts
// state.ts (proposed)
export type BotState =
  | { step: "idle" }
  | { step: "awaiting_quick_qty"; proxyType: string }
  | { step: "awaiting_custom_qty"; proxyType: string }
  | { step: "awaiting_confirm"; proxyType: string; quantity: number; mode: OrderMode }
  | { step: "awaiting_check_list" };
```

This is the strongest type-level lever in the codebase. The runtime checks at `custom-order.ts:161` collapse to TypeScript exhaustiveness. Wave 26's new states (e.g. `awaiting_payment_proof`) require a new union member — TypeScript then forces every dispatcher / serializer to handle it.

### Strongest leverage point

Both reviewers independently named the **callback registry / discriminated union** as the highest-leverage refactor. Outside voice formalised it:

```ts
// src/lib/telegram/callbacks.ts (proposed)
type CallbackData =
  | { kind: "menu"; action: MenuAction }
  | { kind: "proxy_type"; proxyType: ProxyType | "cancel" }
  | { kind: "order"; mode: "quick" | "custom" | "cancel"; proxyType?: string }
  | { kind: "qty"; mode: OrderMode | "cancel"; proxyType?: string; quantity?: number }
  | { kind: "confirm"; result: "yes" | "no" }
  | { kind: "check"; action: "cancel" }
  | { kind: "lang"; lang: SupportedLanguage }
  | { kind: "cancel_confirm"; result: "yes" | "no" }
  | { kind: "revoke"; target: string | "all" | "cancel" }
  | { kind: "revoke_confirm"; count: string }
  | { kind: "admin"; action: "approve" | "reject" | "approve_user" | "block_user" | "bulk_approve" | "bulk_reject"; targetId: string };

export function parseCallback(data: string): CallbackData | null { /* ... */ }
export function serializeCallback(cb: CallbackData): string { /* ... */ }
```

Then `handlers.ts:86-292` becomes one `switch (parsed.kind)`. Adding Wave 26 vendor callbacks is one new union member + one new switch case. No string parsing in command files.

---

## Updated completion summary (post-merge)

| Pass | Original rating | Findings | Plus outside voice | Total |
|---|---:|---:|---:|---:|
| 1 — IA | 7/10 | 4 | 0 (convergent) | 4 |
| 2 — State Coverage | 6/10 | 6 | 3 (2.A 2.B 2.C) | 9 |
| 3 — Journey | 7/10 | 5 | 3 (3.A 3.B 3.C) | 8 |
| 4 — AI Slop | 6/10 | 5 | 2 (4.A 4.B) | 7 |
| 5 — Design System | 6/10 | 5 | 2 (5.A 5.B) | 7 |
| 6 — Responsive & A11y | 7/10 | 6 | 1 (6.A) | 7 |
| 7 — Unresolved | 6/10 | 6 | 5 (7.A–E) | 11 |
| **Total** | **6.4 → 6.0/10** | **37** | **16** | **53** |

Critical: 4 (was 3, +1 for 4.A diacritics bug)
Medium: 26 (was 18, +8)
Low: 23 (was 16, +7)

### Updated Top 5 maintainability cracks

1. **Callback prefix taxonomy → discriminated-union registry** (5.2 + outside Pass 5 #1). Highest leverage. Land before any Wave 26 callback ships.
2. **Conversation state → discriminated union** (outside Pass 7 closing). Same pattern, different file. Pair with crack #1.
3. **All user-visible strings in `messages.ts` only** (4.1 + 4.2 + 5.3 + outside Pass 4 #2 + Pass 5 #3). Lint rule blocking inline `lang === "vi" ? "..." : "..."` outside `messages.ts` and `keyboard.ts`. Force everything through `t()` + `fillTemplate`.
4. **Vietnamese-diacritic + emoji + label-length CI** (4.A + 5.5 + 6.2). Three lints, one PR, surface every regression.
5. **Tunables move from code to `settings`** (7.2). Quick-order max, custom-order max, bulk-auto threshold, support window, /checkproxy max, /checkproxy concurrency.

### Updated ship ordering

**Wave 25-pre2 — Quick wins + critical fix (1.5 days)**
- 4.A *** CRITICAL *** missing diacritics in admin-approve.ts:246 + run lint sweep
- All Wave 25-pre2 items from original (1.1, 1.2, 1.4, 2.5, 3.3, 3.4, 3.5, 4.4, 4.5, 6.4, 6.5, 7.6, 5.4, 1.3)
- 5.A sidebar Badge aria-label
- 6.A status bar percentage prefix
- 7.C stat-cards i18n
- 7.D routes.ts extraction
- 7.E decision-log.md created

**Wave 25-pre3 — Foundations (3 days)**
- All Wave 25-pre3 items from original (4.1, 4.2, 5.3, 5.1, 5.2, 5.5, 6.2, 6.3, 2.2, 2.4, 2.6, 4.3)
- 2.A state-handler dispatch table
- 2.B recovery-keyboard.ts
- 3.A proxyAssignedAfterApproval branch
- 3.B pending limbo ETA
- 3.C rejection reason surfaced
- 4.B context-aware media-unsupported
- 5.B Markdown escape policy + grep CI
- 7.A `_deprecated/` folder + aup.ts move
- 7.B legacy callback expiry stamp + breadcrumb

**Wave 25-pre4 — Patterns + maintainability (3 days)**
- All Wave 25-pre4 items from original (2.1, 2.3, 3.2, 7.2, 7.4)
- Discriminated-union state machine (state.ts refactor + every handler updated)
- 2.C /checkproxy timeout split (Vercel hobby safety)
- Comprehensive lint suite (vi-diacritic, emoji, label-length, inline-string)

Total now: 7.5 days for all 53 fixes. Wave 26 starts on a maintainability foundation that survives feature growth.

---

## Review log

| Date | Reviewer | Wave audited | Outcome |
|---|---|---|---|
| 2026-05-03 | Claude (primary) + brainstormer (outside voice, parallel) | 23A → 25-pre1 | This document. **53 findings** (4 critical, 26 medium, 23 low). Recommended split into Wave 25-pre2/pre3/pre4 (7.5 days total). Convergence on 8 findings — high-confidence ship targets. Diacritic bug `admin-approve.ts:246` is the only same-day critical. |
| 2026-05-03 | Claude | Wave 25-pre2 shipped on branch `wave-25-pre2` | **18 fixes landed across 5 commits.** Critical: P0 4.A diacritic restored in `admin-approve.ts:246` + 2 extra unaccented strings swept in `bulk-proxy.ts`. IA: warranty rename (label + callback `menu:warranty` → `menu:return`), canonical command order (BOT_COMMANDS + welcome + help in lock-step). Recovery copy: pending hint, bad-paste recovery, reject `/support` hint, language clear-state, truthful `/support` window, zero-pool contingency, reject attribution. A11y: trend-sign prefix, sidebar focus-ring, sidebar Badge i18n + aria-current, status-bar percentage prefix. Foundations: `routes.ts` URL builder + 14 tests, dashboard cards i18n, command-order parity test, label-length budget test (≤14), command-files diacritic lint, `decision-log.md` (12 deferred items). Tests: 718 → 741 (+23). Typecheck 0. Build green. Diff 713 / 88. Lint count 25 → 24 (one pre-existing unused-var fixed as side effect). 12 items deferred to 25-pre3/pre4 with rows in `decision-log.md`. |
| 2026-05-03 | Claude | Wave 25-pre3 shipped on branch `wave-25-pre3` | **Foundation refactor — 11 fixes across 5 commits, +1110 LOC.** Highest-leverage refactor (Pass 5.2): created `callbacks.ts` discriminated union with `parseCallback` / `serializeCallback` / `CB.*` builders covering all 17 wire shapes; refactored `handlers.ts` callback dispatcher from 200-line if-ladder to one `switch (parsed.kind)` over the union. Backward-compat alias for `menu:warranty` and legacy `qty:<type>:<n>` 2-arg shape both emit Sentry breadcrumbs (level=info) for 90-day deletion verification. Other foundations: `icons.ts` Icon vocab registry + test pinning the 5 ASCII prefixes; `STATE_TEXT_HANDLERS` dispatch table replacing if-cascade in message:text handler; `recovery-keyboard.ts` module → `restartFlowKeyboard(lang, target)` returns 1-button InlineKeyboard, applied to 2 dead-end recovery paths (custom-order session-drift, language-switch mid-flow). UX polish: `/checkproxy` tri-state summary (alive/dead/timed_out distinct), `/status` quota-state hint differentiating disabled vs exhausted, `/getproxy` noProxy sub-cases (kho rỗng vs all-assigned). Cleanup: `aup.ts` moved to `src/lib/telegram/_deprecated/` via `git mv` with README explaining the convention. Sweep all 8 command files + `keyboard.ts` to use `CB.*` builders instead of raw template-literal callback strings — drift-impossible. New emoji-block CI test (Pass 5.5) scans entire bot tree for U+1F300–U+1FAFF + `// allow-emoji` exception comment. Tests: 741 → 813 (+72 mostly from `callbacks.test.ts` 67 cases covering every wire shape + round-trip). Typecheck 0. Build green. Lint 24 (no new). Diff 1378/+268 across 20 files. |
| 2026-05-03 | Claude | Wave 25-pre4 shipped on branch `wave-25-pre4` | **Final phase of series 25 — 15 fixes across 7 commits, +856 LOC, 3 DB migrations.** Migrations (commit 1): mig 052 drop `tele_users.aup_accepted_at` + `aup_version` (closes aup-cleanup); mig 053 add `first_proxy_at` + `first_start_notified_at` with backfill; mig 054 seed `quick_order_max` / `custom_order_max` / `bulk_auto_threshold` settings rows. Type-safety (commit 2): `BotState` becomes discriminated union per step (Top maintainability crack #2). Adding a Wave 26 state = one new union member; TypeScript exhaustiveness ensures every dispatcher handles it. Pairs with the callback union from pre-3. Helpers (commit 3): `chunk.ts::chunkMessage` splits long replies on Telegram's 4096-char ceiling — applied at /myproxies, /checkproxy result, bulk-proxy. `getBotStateWithExpiry` + recovery hint in handlers.ts when state TTL just expired. `milestones.ts::getFirstProxyFooter` race-safe one-time delight footer. Personalization (commit 4): `proxyAssignedAfterApproval` distinct copy ("Cảm ơn đã đợi"); pending-approval ETA hint v1 ("trong 24 giờ"); first-proxy footer applied at autoAssignProxy + bulk-proxy + admin-approve success paths. Polish (commit 5): /checkproxy platform-aware Vercel timeout (hobby fallback 9s, Pro 14-59s based on env); context-aware media-unsupported reply (state-aware hint instead of generic /help); sidebar aria-controls + nav region id for screen readers. Tunables (commit 6): rate-limit.ts loadGlobalCaps extended to read order-mode tunables; bulk-proxy + custom-order read from settings (with hardcoded fallback); admins tune via /settings without redeploy. Markdown-escape CI policy: scan bot tree for `parse_mode: "Markdown"` + interpolation, require escapeMarkdown import OR explicit opt-out comment with rationale. 9 files audited and opt-out'd (all interpolations are Markdown-safe enums/integers/code-spans today). Cleanup (commit 7): delete `_deprecated/aup.ts` now that columns are gone; README updated with first row in "Deleted" audit table. Tests: 813 → 821 (+8 from chunk + markdown-escape). Typecheck 0. Build green. Lint 24 (no new). |
| 2026-05-03 | Claude | Wave 26-A shipped on branch `wave-26-a-proxy-import-polish` | **Import wizard polish — 12 fixes.** Auto-detect button states, post-import success toast detail breakdown, normalisation of network_type client-side, robust error handling on non-OK import response, BULK_CONFIRM_THRESHOLD dialog, abort-able probe with progress + cancel, host:port dedupe fed back as "Trùng dòng N", category default propagation, skipped-rows count fix, drag-and-drop drop zone state. |
| 2026-05-03 | Claude | Wave 26-B shipped on branch `wave-26-b-proxy-polish` | **Add-proxy + table polish — ~12 fixes.** `buildInitialFormData` single-source-of-truth (resets stale data on re-open), `validProxyTypes` literal narrowing fix on `ProxyType`, "Sửa" toast on edit, "Tạo và thêm tiếp" mode (preserves type/network/country/category/purchase + vendor + prices), purchase metadata exposed for single-edit (vendor / cost / sale price / purchase_date), DESKTOP_COLUMN_COUNT colspan source-of-truth. |
| 2026-05-03 | Claude | Wave 26-C shipped on branch `wave-26-c-proxies-polish` | **Proxies tab UX hardening — 5 commits, 23 files, +1700 / -191 LOC, 2 migrations.** Commit 1: realtime banner false positive on filter change + cleanup CLOSED. Commit 2: extracted `dedupeByHostPort` to `src/lib/proxy-parse.ts` + 7 regression tests. Commit 3: `normalizeNetworkType` alias map applied on EVERY write path (api/proxies POST/PATCH/import/GET-filter + api/categories POST/PATCH); `networkTypeLabel` normalises before rendering so legacy DB rows still display correctly; mig 055 cleans existing rows; desktop "Thời gian giao" switches from absolute timestamp to relative "30 ngày trước" via new `formatRelativeVi` util with absolute timestamp on hover. Commit 4: mig 056 adds `proxies.import_batch_id UUID NULL` + partial index; POST /api/proxies/import stamps every row with the same UUID; wizard's success toast + Result card deep-link to `/proxies?import_batch_id=<id>`; page renders a clearable banner. Commit 5: SWR-style `<SharedCacheProvider>` mounted in dashboard layout; `/api/categories` + `/api/proxies/stats` shared across page + form + wizard with cache write-through on inline-create — ~70% drop in redundant network calls per session. Tests: 833 → 881 (+48). Typecheck 0. Build green. Plus brainstorm doc `BRAINSTORM_PROXIES_2026-05-03.md` (10-gap audit on proxy-detail.tsx, full warranty schema design, 5 candidate sub-tabs for /requests, ship-order suggestion). |
| 2026-05-04 | Claude | Wave 26-D-pre1 shipped (#7) | **Storyteller proxy detail rebuild.** 288-line monolith → 7-file detail/ subdir. New `health-strip.tsx` (20-dot), `metadata-rail.tsx` (6 sections fully VN), `timeline.tsx` (filterable, 6 chips), `quick-actions.tsx` (state-contextual + reason input), `event-mappers.ts` (pure mapper /api/requests + /api/logs → unified TimelineEvent). API extension: `/api/logs` accepts `?resourceId=` filter. Tests +37 (875 → 912). |
| 2026-05-04 | Claude | Wave 26-D-post1 shipped (#8) | **/requests filter mạnh + sweep vocab + Loại detect cleanup + Trash polish.** 4 commits. Commit A: bỏ Tabs trong /requests, single-table + 5 dropdown filter (Trạng thái + Khoảng TG + Loại proxy + Cách duyệt + Quốc gia + search) + URL state codec. Commit B: sweep "quota" → "request limit"/"giới hạn" trong 5 file bot. Commit C: drop "Loại detect" column khỏi proxy-import preview. Commit D: trash-proxies polish — bulk-restore + bulk-permanent-delete (typed-confirm) + countdown badge "Tự xoá sau" với tone (ok/warn/danger). Tests +29 (912 → 941). |
| 2026-05-04 | Claude | Wave 26-D-pre2 shipped (#9) | **Trash-users + trash-requests polish + proxy-form schema split.** Mirror trash-proxies pattern. proxy-form.tsx 718 → 658 dòng (schema + buildInitialFormData extracted to subdir). Tests stay 941 (no new logic, just refactor). |
| 2026-05-04 | Claude | Wave 26-D-1 shipped (#10) | **Warranty foundation.** Migration 057: ENUM proxy_status += 'reported_broken', proxies.reliability_score column, 4 new tables (warranty_claims, proxy_events, proxy_health_logs, saved_views), trigger fn_proxy_health_logs_keep_last_20, 5 settings rows, RLS on saved_views. State machine 4 new transitions. Pure service layer: eligibility.ts (gate with 8 reject codes), allocator.ts (3-tier replacement), settings.ts (load 5 keys), events.ts (logProxyEvent + logProxyEdit with diff). Tests +26 (941 → 967). |
| 2026-05-04 | Claude | Wave 26-D-2A shipped (#11) | **Warranty admin web.** API routes: GET/POST /api/warranty + PATCH /api/warranty/[id] (approve runs allocator + 3 row writes + 3 audit events; reject reverts proxy.status + audit). /warranty page mirror /requests pattern (single-table + 6 dropdown filter). Approve dialog với checkbox "đồng thời mark banned" (A7=b) + allocator preview hint. Reject dialog với required reason. Sidebar entry "Bảo hành" + usePendingWarranty hook (realtime + browser notification). Tests stay 967. |
| 2026-05-04 | Claude | Wave 26-D-2B shipped (#12) | **Warranty bot flow + DM notifications + settings UI.** Closes warranty mechanism end-to-end. Bot: 3 new callback kinds + 1 new BotState step (awaiting_warranty_reason_text) + warranty.ts command file (280 lines: handleWarrantyClaim/Reason/ReasonText/Cancel + submitWarrantyClaim helper). /myproxies posts follow-up message với 1 "Báo lỗi #N" inline button per proxy. PATCH route adds notifyUserApproved + notifyUserRejected — bot DM Vietnamese/English với credentials masked via safeCredentialString, best-effort (void+catch). Settings UI: new "Bảo hành proxy" card với 5 fields (toggle + 4 number inputs). escapeMarkdown applied to user-typed reason_text + proxy host:port. Tests +14 callback round-trip (967 → 981). |
| TBD | (next) | Wave 26-E | append after Wave 26-E ships |

> **Convention:** every subsequent design review appends a row here AND links its own DESIGN_REVIEW_LIVE_<DATE>.md. Don't overwrite this file — fork it. The trail matters.

