-- ============================================================
-- 033_wave22d4_chat_conversations.sql
-- Fix 5000-row in-memory dedup bug in conversation list.
-- Replaces JS Map dedup with SQL DISTINCT ON so memory usage
-- is O(distinct_users), not O(all_messages).
-- ============================================================

-- Smoke test expectation:
--   noisy_user  has 6000 messages (dominates recency window)
--   quiet_user  has 1 message older than the 5000th most-recent message
--   => quiet_user MUST appear in results (was silently dropped before)

-- ------------------------------------------------------------
-- Supporting index (covers the DISTINCT ON scan + JOIN filter)
-- idx_chat_tele_user already exists: (tele_user_id, created_at DESC)
-- Add a partial index to accelerate the is_deleted JOIN filter.
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_tele_users_active
    ON tele_users (id)
    WHERE is_deleted = false;

-- ------------------------------------------------------------
-- RPC: get_recent_conversations
--
-- Returns one row per tele_user (latest message matching optional
-- search), joined with tele_user profile columns.
-- Search applies BEFORE dedup so we find the latest matching msg,
-- not just whether the user's latest msg happens to match.
--
-- Parameters:
--   p_limit   INT  default 50, max 100
--   p_offset  INT  default 0  (simple offset pagination; cursor
--                              pagination can replace later)
--   p_search  TEXT default NULL
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_recent_conversations(
    p_limit  INT  DEFAULT 50,
    p_offset INT  DEFAULT 0,
    p_search TEXT DEFAULT NULL
)
RETURNS TABLE (
    -- chat_messages columns
    msg_id               UUID,
    tele_user_id         UUID,
    telegram_message_id  BIGINT,
    direction            message_direction,
    message_text         TEXT,
    message_type         message_type,
    raw_data             JSONB,
    msg_created_at       TIMESTAMPTZ,
    -- tele_users columns
    user_id              UUID,
    username             TEXT,
    first_name           TEXT,
    last_name            TEXT,
    telegram_id          BIGINT,
    status               tele_user_status,
    -- pagination metadata
    total_count          BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    -- Step 1: filter candidate messages (search before dedup)
    WITH filtered AS (
        SELECT
            cm.id,
            cm.tele_user_id,
            cm.telegram_message_id,
            cm.direction,
            cm.message_text,
            cm.message_type,
            cm.raw_data,
            cm.created_at
        FROM chat_messages cm
        INNER JOIN tele_users tu ON tu.id = cm.tele_user_id
        WHERE tu.is_deleted = false
          AND (
              p_search IS NULL
              OR cm.message_text ILIKE '%' || p_search || '%'
          )
    ),
    -- Step 2: DISTINCT ON — one row per user, most-recent matching msg
    deduped AS (
        SELECT DISTINCT ON (tele_user_id)
            id,
            tele_user_id,
            telegram_message_id,
            direction,
            message_text,
            message_type,
            raw_data,
            created_at
        FROM filtered
        ORDER BY tele_user_id, created_at DESC
    ),
    -- Step 3: count total distinct users for pagination
    counted AS (
        SELECT COUNT(*) AS total FROM deduped
    )
    SELECT
        d.id,
        d.tele_user_id,
        d.telegram_message_id,
        d.direction,
        d.message_text,
        d.message_type,
        d.raw_data,
        d.created_at,
        tu.id,
        tu.username,
        tu.first_name,
        tu.last_name,
        tu.telegram_id,
        tu.status,
        c.total
    FROM deduped d
    INNER JOIN tele_users tu ON tu.id = d.tele_user_id
    CROSS JOIN counted c
    ORDER BY d.created_at DESC
    LIMIT  LEAST(p_limit, 100)
    OFFSET p_offset;
$$;

-- Grant execute to authenticated role (admins use authenticated session)
GRANT EXECUTE ON FUNCTION get_recent_conversations(INT, INT, TEXT)
    TO authenticated;

COMMENT ON FUNCTION get_recent_conversations IS
    'Wave 22D-4: returns one row per tele_user (latest matching message). '
    'Replaces 5000-row JS dedup. Search filters before DISTINCT ON so quiet '
    'users with old matching messages are never silently dropped.';
