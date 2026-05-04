-- ============================================================
-- 058_wave26d_bug_hunt_constraints.sql
-- Wave 26-D bug hunt — schema-level guards from 3-agent audit
-- (code-reviewer + security-reviewer + debugger).
--
-- Findings addressed:
--
--   [HIGH-1, debugger #1] Race: two simultaneous bot taps create
--     duplicate pending claims for same (user, proxy). Eligibility
--     gate is purely application-layer; no DB unique guard.
--     Fix: partial UNIQUE index on (user_id, proxy_id) WHERE status
--     = 'pending' — second insert hard-fails with 23505 unique
--     violation, API catches and returns 409.
--
--   [MEDIUM, security M2] proxies.reliability_score has no CHECK
--     constraint enforcing 0-100 range. Allocator sorts by it DESC,
--     so a value of 999 always wins (admin could game the queue).
--     Wave 26-E auto-ban logic will read this column and a negative
--     value would trigger unintended behavior.
--     Fix: CHECK (reliability_score BETWEEN 0 AND 100). Add via
--     ALTER TABLE … ADD CONSTRAINT IF NOT EXISTS pattern.
--
-- Both changes are additive + idempotent. Existing rows that already
-- violate (none expected — column defaults to 100, allocator always
-- decrements via Math.max(0,…)) would block the constraint add. We
-- pre-clamp on first run for safety.
-- ============================================================

-- ─── 1) Partial UNIQUE index — pending duplicate guard ───
CREATE UNIQUE INDEX IF NOT EXISTS warranty_claims_user_proxy_pending_uq
  ON warranty_claims (user_id, proxy_id)
  WHERE status = 'pending';

COMMENT ON INDEX warranty_claims_user_proxy_pending_uq IS
  'Wave 26-D bug hunt — prevents duplicate pending claims for same (user, proxy). Hard-fails with unique_violation (23505) on race; API translates to 409 Conflict.';

-- ─── 2) reliability_score range guard ───
-- Pre-clamp existing rows just in case manual edits drifted
-- the value out of range. Defensive — no rows expected to fail.
UPDATE proxies
SET reliability_score = LEAST(GREATEST(reliability_score, 0), 100)
WHERE reliability_score < 0 OR reliability_score > 100;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'proxies_reliability_score_range'
  ) THEN
    ALTER TABLE proxies
      ADD CONSTRAINT proxies_reliability_score_range
      CHECK (reliability_score >= 0 AND reliability_score <= 100);
  END IF;
END $$;
