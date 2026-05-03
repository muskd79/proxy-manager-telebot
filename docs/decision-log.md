# Decision log

> Open design / architecture decisions that have been **deferred** but not abandoned.
> Each row is a known unknown that future agents and humans can resolve in one place.
>
> **Convention:**
> - Add a row when a fix is intentionally postponed (with reason).
> - Cross-reference from code with `// see decision-log.md#<slug>`.
> - When a decision lands, **delete the row** (don't strike it through). The git history is the audit trail.
> - Keep the table dense — long context belongs in linked design-review docs, not here.

| Slug | Decision | Status | Deferred until | Owner | Files touched | Source |
|---|---|---|---|---|---|---|
| `warranty-schema` | Build a real warranty model: a user reports a dead/slow proxy → admin confirms → replacement assigned without consuming user's quota. Currently the "Trả proxy" button (renamed from "Bảo hành proxy" in 25-pre2 Pass 1.1) just runs the revoke flow — return without replacement. | open | Wave 26 | unassigned | new migration + new commands + admin UI; reuse `menu:warranty` callback prefix freed in 25-pre2 | DESIGN_REVIEW_LIVE_2026-05-03.md Pass 1.1 / 7.1 |
| `aup-cleanup` | Move `src/lib/telegram/commands/aup.ts` to `src/lib/telegram/_deprecated/aup.ts` and add a migration to drop `tele_users.aup_accepted_at`. AUP gate was removed 2026-04-29 per user request "bỏ đoạn chấp nhận chính sách đi" but the file + DB column remain. | open | Wave 25-pre3 | unassigned | move file, add migration 050_drop_aup_accepted_at.sql | DESIGN_REVIEW_LIVE_2026-05-03.md Pass 7.A |
| `legacy-qty-callback` | Delete the legacy 2-arg `qty:<type>:<n>` callback fallback in `handlers.ts:266-271`. Keep until breadcrumb shows zero hits for ≥ 7 days. Add a `captureError(level: 'info')` breadcrumb when the legacy branch fires so we have data. | open | After 2026-08-01 (≥ 90 days post 25-pre1 ship + zero breadcrumbs) | unassigned | handlers.ts | DESIGN_REVIEW_LIVE_2026-05-03.md Pass 7.B |
| `button-label-length` | Tighten the inline-button label-length budget from 14 to 12 chars. Today the `keyboard.test.ts` budget test asserts ≤ 14 because labels like "Yêu cầu proxy" (13), "Limit yêu cầu" (13), "Quota & limits" (14) exceed 12. Shortening labels needs UX input to avoid losing meaning. | open | Wave 25-pre3 | needs UX input | keyboard.ts mainMenuKeyboard labels + keyboard.test.ts threshold + i18n keys (if used) | DESIGN_REVIEW_LIVE_2026-05-03.md Pass 6.2 |
| `messages-only-in-messages-ts` | Add an ESLint rule that blocks `lang === "vi" ? "..." : "..."` ternaries with string literals outside `messages.ts` and `keyboard.ts`. Today every command file has 2-10 inline language ternaries (~30 sites). Wave 26 adds a third language → 30 files to edit. | open | Wave 25-pre3 | unassigned | new ESLint rule + sweep call sites + extend messages.ts | DESIGN_REVIEW_LIVE_2026-05-03.md Pass 4.1 / 4.2 / 5.3 |
| `callback-registry` | Replace the `if (data.startsWith(...))` ladder in `handlers.ts:86-292` with a discriminated union + `parseCallback` / `serializeCallback` helpers. Highest-leverage maintainability refactor in the audit. | open | Wave 25-pre4 | unassigned | new `src/lib/telegram/callbacks.ts`, refactor `handlers.ts`, `keyboard.ts`, every command file emitting callbacks | DESIGN_REVIEW_LIVE_2026-05-03.md Pass 5.2 / Top maintainability crack #1 |
| `state-machine-union` | Replace the flat `BotState` interface with a discriminated union per step so TypeScript exhaustiveness enforces handler coverage. | open | Wave 25-pre4 | unassigned | `src/lib/telegram/state.ts` + every state caller | DESIGN_REVIEW_LIVE_2026-05-03.md Top maintainability crack #2 |
| `vercel-timeout-checkproxy` | `BATCH_WALL_CLOCK_MS = 25_000` in `check-proxy.ts:39` exceeds Vercel hobby (10s) and default Pro (15s). Detect platform max via `process.env.VERCEL_FUNCTION_MAX_DURATION` or split probe across two webhook invocations. | open | Wave 25-pre4 | unassigned | check-proxy.ts | DESIGN_REVIEW_LIVE_2026-05-03.md Pass 2.C |
| `support-rejection-reason` | Surface the actual `proxy_requests.rejected_reason` to the user in the rejection notification, plus a 3-button reject-reason picker for admins (Spam / Out of stock / Other). Today reject ships a generic "Liên hệ /support" hint (added 25-pre2 Pass 3.4). | open | Wave 26 | unassigned | admin-approve.ts + new keyboard + new messages.ts key | DESIGN_REVIEW_LIVE_2026-05-03.md Pass 3.C |
| `pending-eta` | Show the average admin response time in the pending welcome message so users have an ETA. v1: hardcode "thường trong 24h"; v2: compute from `admin_response_avg_seconds` Supabase view. | open | Wave 25-pre3 (v1) | unassigned | start.ts + new messages.ts key + (v2) supabase view | DESIGN_REVIEW_LIVE_2026-05-03.md Pass 3.B |
| `first-success-delight` | Branch the post-approval success message from the self-serve auto-assign one. After the user waits hours, the reveal should not look identical to an instant grab. Add `proxyAssignedAfterApproval` key + a milestone helper for "first lifetime proxy" footer. | open | Wave 25-pre4 | unassigned | messages.ts + admin-approve.ts + milestones.ts (new) + migration `tele_users.first_proxy_at` | DESIGN_REVIEW_LIVE_2026-05-03.md Pass 3.A / 3.2 |
| `sidebar-probe-rename` | Rename the admin web sidebar entry "Check proxy" → "Probe proxy" (i18n key `sidebar.checkProxy` → `sidebar.probeProxy`) so the verb differs from the bot's user-facing `/checkproxy`. | open | Wave 25-pre3 | needs UX input | sidebar.tsx + locales/{vi,en}.json | DESIGN_REVIEW_LIVE_2026-05-03.md Pass 1.3 |

---

## Closed decisions (audit trail; delete when this section gets unwieldy)

_None yet. Wave 25-pre2 is the first wave to use this log._
