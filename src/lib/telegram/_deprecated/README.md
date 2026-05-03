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

| File | Deprecated since | Deletion plan |
|---|---|---|
| `aup.ts` | Wave 23C-fix (2026-04-29) | Delete after migration `050_drop_aup_accepted_at.sql` lands and `tele_users.aup_accepted_at` column is dropped. Tracked in `docs/decision-log.md#aup-cleanup`. |

**To delete a file** (when its row above is closed):

1. Verify zero call-sites: `grep -rn "from.*_deprecated" src/`
2. Verify the underlying DB schema is gone (if any).
3. `git rm src/lib/telegram/_deprecated/<file>`
4. Update this README — move the row to "Deleted" section.
5. Reference the closure in `docs/decision-log.md`.

**Deleted:**

_None yet._
