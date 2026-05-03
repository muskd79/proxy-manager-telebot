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
<!-- aup-cleanup — closed in Wave 25-pre4 (mig 052 + commit 7 deletes the file). See review log + Closed decisions table. -->
| `legacy-qty-callback` | **Wave 25-pre3 partial:** breadcrumb added in `callbacks.ts::parseCallback` for both `menu:warranty` alias AND `qty:<type>:<n>` 2-arg shape. Emits `captureError(level: "info")`. **Still pending:** delete the legacy parse paths after 90 days of zero breadcrumb hits. | partial — observability live | After 2026-08-01 (≥ 90 days zero breadcrumbs) | unassigned | `src/lib/telegram/callbacks.ts` parseCallback (remove `if (action === "warranty")` and `if (parts.length === 3)` branches) | DESIGN_REVIEW_LIVE_2026-05-03.md Pass 7.B |
| `button-label-length` | Tighten the inline-button label-length budget from 14 to 12 chars. Today the `keyboard.test.ts` budget test asserts ≤ 14 because labels like "Yêu cầu proxy" (13), "Limit yêu cầu" (13), "Quota & limits" (14) exceed 12. Shortening labels needs UX input to avoid losing meaning. | open | Wave 25-pre3 | needs UX input | keyboard.ts mainMenuKeyboard labels + keyboard.test.ts threshold + i18n keys (if used) | DESIGN_REVIEW_LIVE_2026-05-03.md Pass 6.2 |
| `messages-only-in-messages-ts` | Add an ESLint rule that blocks `lang === "vi" ? "..." : "..."` ternaries with string literals outside `messages.ts` and `keyboard.ts`. Today every command file has 2-10 inline language ternaries (~30 sites). Wave 26 adds a third language → 30 files to edit. | open | Wave 25-pre3 | unassigned | new ESLint rule + sweep call sites + extend messages.ts | DESIGN_REVIEW_LIVE_2026-05-03.md Pass 4.1 / 4.2 / 5.3 |
<!-- callback-registry — closed in Wave 25-pre3 (commit 3 + commit 4 sweep). See review log. -->

<!-- state-machine-union — closed in Wave 25-pre4 (commit 2). See review log. -->
<!-- vercel-timeout-checkproxy — closed in Wave 25-pre4 (commit 5, platform-aware budget). See review log. -->
| `support-rejection-reason` | Surface the actual `proxy_requests.rejected_reason` to the user in the rejection notification, plus a 3-button reject-reason picker for admins (Spam / Out of stock / Other). Today reject ships a generic "Liên hệ /support" hint (added 25-pre2 Pass 3.4). | open | Wave 26 | unassigned | admin-approve.ts + new keyboard + new messages.ts key | DESIGN_REVIEW_LIVE_2026-05-03.md Pass 3.C |
<!-- pending-eta — v1 closed in Wave 25-pre4 (commit 4 hardcodes "trong 24 giờ"). v2 (Supabase-view-driven ETA) deferred to Wave 26 if/when sample size warrants. -->
<!-- first-success-delight — closed in Wave 25-pre4 (mig 053 + milestones.ts + 3 apply sites in commit 4). See review log. -->
| `sidebar-probe-rename` | Rename the admin web sidebar entry "Check proxy" → "Probe proxy" (i18n key `sidebar.checkProxy` → `sidebar.probeProxy`) so the verb differs from the bot's user-facing `/checkproxy`. | open | Wave 25-pre3 | needs UX input | sidebar.tsx + locales/{vi,en}.json | DESIGN_REVIEW_LIVE_2026-05-03.md Pass 1.3 |

---

## Closed decisions (audit trail; delete when this section gets unwieldy)

| Slug | Closed in | Closure note |
|---|---|---|
| `callback-registry` | Wave 25-pre3 (a00b199 → wave-25-pre3) | `src/lib/telegram/callbacks.ts` shipped with `parseCallback` / `serializeCallback` / `CB.*` builders + 67-test coverage. `handlers.ts` dispatcher refactored to `switch (parsed.kind)`. All call-sites (keyboard.ts + 8 command files) sweeping done. Highest-leverage refactor of the audit closed. |
| `aup-cleanup` | Wave 25-pre4 (mig 052 + commit 7) | DB columns dropped, `_deprecated/aup.ts` deleted. AUP gate fully retired. |
| `state-machine-union` | Wave 25-pre4 (commit 2) | `BotState` is now a discriminated union per step. Pairs with the callback union from pre-3. Top maintainability crack #2 closed. |
| `vercel-timeout-checkproxy` | Wave 25-pre4 (commit 5) | `BATCH_WALL_CLOCK_MS` reads `VERCEL_FUNCTION_MAX_DURATION` env var with hobby fallback 9s and hard cap 59s. |
| `first-success-delight` | Wave 25-pre4 (mig 053 + commits 3+4) | `milestones.ts::getFirstProxyFooter` + `proxyAssignedAfterApproval` distinct copy + applied at 3 success sites. |
| `pending-eta` (v1) | Wave 25-pre4 (commit 4) | Hardcoded "Thời gian thường: trong 24 giờ" in `accountPendingApproval`. v2 (compute from Supabase view) deferred to Wave 26 if needed. |

