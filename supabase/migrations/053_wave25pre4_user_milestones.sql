-- Wave 25-pre4 (Pass 3.2 + 7.4) — user milestone columns.
--
-- Two new columns on tele_users:
--
-- 1. first_proxy_at TIMESTAMPTZ
--    Set on the user's FIRST lifetime proxy assignment. Used by
--    src/lib/telegram/milestones.ts to append a "_Test bằng /checkproxy.
--    Xem all: /myproxies._" footer once. Subsequent assignments
--    don't get the footer.
--
-- 2. first_start_notified_at TIMESTAMPTZ
--    Set the FIRST time a pending user runs /start (admin
--    notification fires at the same moment). Pre-fix the dispatcher
--    used an `isNew = !updated_at || created_at === updated_at`
--    heuristic, which silently breaks if a future getOrCreateUser
--    refactor stops touching updated_at. Explicit column is the
--    canonical signal.
--
-- Backfill first_proxy_at for existing users: take MIN(assigned_at)
-- from their currently-assigned-or-historically-assigned proxies.
-- For first_start_notified_at, set to created_at on backfill (we
-- assume any non-pending user already passed the notification step;
-- worst case is one duplicate notification on next /start which is
-- benign).

ALTER TABLE tele_users
  ADD COLUMN IF NOT EXISTS first_proxy_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS first_start_notified_at TIMESTAMPTZ;

-- Backfill first_proxy_at from earliest historical assignment per user.
UPDATE tele_users u
SET first_proxy_at = sub.first_assigned
FROM (
  SELECT assigned_to AS user_id, MIN(assigned_at) AS first_assigned
  FROM proxies
  WHERE assigned_to IS NOT NULL AND assigned_at IS NOT NULL
  GROUP BY assigned_to
) sub
WHERE u.id = sub.user_id AND u.first_proxy_at IS NULL;

-- Backfill first_start_notified_at: any active/blocked user has
-- already been past the pending step (so set to created_at). Pending
-- users get NULL so the next /start triggers the notification.
UPDATE tele_users
SET first_start_notified_at = created_at
WHERE first_start_notified_at IS NULL
  AND status NOT IN ('pending');

COMMENT ON COLUMN tele_users.first_proxy_at IS
  'Wave 25-pre4: timestamp of the user''s first lifetime proxy assignment. Drives milestones.ts first-proxy footer.';
COMMENT ON COLUMN tele_users.first_start_notified_at IS
  'Wave 25-pre4: timestamp the admin "new user pending" notification was first fired. Replaces the isNew heuristic in start.ts.';
