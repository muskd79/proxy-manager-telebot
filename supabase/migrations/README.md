# Supabase Migrations

## Naming convention

- Files must be prefixed with a **unique numeric prefix**: `NNN_descriptive_name.sql`.
- The counter is strictly monotonic — each new migration gets a number one higher than the last applied migration.
- Do NOT rename or delete existing migration files that have been applied to production. Supabase tracks applied migrations by filename; renaming a file will cause it to be treated as a new (unapplied) migration and break rollout.

## Known duplicate prefixes (do not rename)

Two pairs of files share numeric prefixes due to a past merge collision. These are already applied; leave them as-is:

- `010_webhook_dedup.sql` + `010_fix_function_signatures.sql` — applied in alphabetical order
- `015_connection_pool_index.sql` + `015_cursor_pagination_index.sql` — applied in alphabetical order

**Prevention:** When multiple branches add migrations in parallel, the one that lands second MUST bump its prefix to the next unused number before merging. CI should enforce this — see `.github/workflows/ci.yml` for the "detect duplicate migration prefix" step (to be added).

## Wave tagging

Recent migrations are tagged with the wave they belong to (e.g. `017_wave18a_*`). This is informational only; the order of application is determined purely by the numeric prefix.

## Writing new migrations

- Always use `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for idempotency.
- Every migration must be safe to run twice.
- Comment every non-obvious column/index/RPC with `COMMENT ON ... IS '...'` explaining **why** (future readers already see the *what* from the DDL).
- Destructive changes (DROP COLUMN) require an explicit review comment at the top of the file explaining the data-loss blast radius.
- Rollback plan: every migration should have an inverse SQL block documented in the PR description, even if not committed.
