# `_deprecated/` — code on its way out

Files here are **not** wired into any production path. They are kept
for backward-compat audit (database columns still exist, log greps
might still match old strings) and for git-blame lineage.

**Convention:**

- Files in this folder are NOT exported from `commands/index.ts`.
- They are NOT registered as bot commands or callback handlers.
- ESLint should flag any `import` from this folder (rule TBD in
  Wave 25-pre4).
- Each file gets a header comment stating WHEN it was deprecated and
  WHEN it will be deleted.

**Current contents:**

_Empty._ Files arrive here on their way out; this README explains
the convention. See "Deleted" table below for the audit trail.

**To delete a file** (when its row above is closed):

1. Verify zero call-sites: `grep -rn "from.*_deprecated" src/`
2. Verify the underlying DB schema is gone (if any).
3. `git rm src/lib/telegram/_deprecated/<file>`
4. Update this README — move the row to "Deleted" section.
5. Reference the closure in `docs/decision-log.md`.

**Deleted:**

| File | Quarantined | Deleted | Closure note |
|---|---|---|---|
| `aup.ts` | Wave 25-pre3 | Wave 25-pre4 | DB columns `tele_users.aup_accepted_at` + `aup_version` dropped by migration 052. Closes `docs/decision-log.md#aup-cleanup`. |
