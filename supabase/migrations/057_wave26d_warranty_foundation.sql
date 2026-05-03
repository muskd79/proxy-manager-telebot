-- ============================================================
-- 057_wave26d_warranty_foundation.sql
-- Wave 26-D — warranty mechanism schema foundation.
--
-- User feedback (verbatim 2026-05-03):
--   "Cần thêm cơ chế bảo hành (logic + workflow)"
--   "ai giao ai dùng khi nào, mọi thay đổi" (full audit trail)
--
-- Final decisions chốt qua 4 vòng brainstorm
-- (BRAINSTORM_PROXIES_2026-05-03.md):
--
-- A1=(a) Replacement KHÔNG trừ giới hạn yêu cầu — track riêng qua
--        warranty_claims.replacement_proxy_id, không cộng counter
--        proxies_used_*.
-- A2=HYBRID — setting toggle warranty_eligibility_unlimited.
--        Default OFF → eligibility 24h sau assigned_at.
--        ON → bất kỳ lúc nào còn HSD.
-- A3=(e) Anti-abuse: max 2 pending + max 5 claim/30 ngày + cooldown 60min.
-- A4=(d) KHÔNG auto-reject — admin xử lý khi sẵn sàng.
-- A5=(f) 3-tier allocator: cùng category+network → cùng category → bất kỳ.
-- A6=(a) HSD proxy thay thế = HSD CÒN LẠI của proxy gốc (copy ENDS_AT).
-- A7=(b) Auto-maintenance + checkbox "đồng thời mark banned"
--        + reliability_score INT DEFAULT 100 (decrement -25 mỗi approve).
-- B2=(b) Health-check history giữ N=20 lần gần nhất per proxy.
-- C1=FULL audit qua proxy_events (không reuse activity_logs).
-- E2=(a) Saved views.
-- F1=(c) Notify user qua bot Telegram + email if available.
-- F3=(a) Mọi admin role >= "admin" duyệt được claim.
-- G1=enum 6 reason_code: no_connect / slow / ip_blocked /
--        wrong_country / auth_fail / other.
-- G3=(a) KHÔNG tăng giới hạn tạm khi đang chờ admin xử lý.
--
-- ============================================================
-- 1) ENUM: proxy_status += 'reported_broken'
-- ============================================================
-- Postgres ALTER TYPE ADD VALUE phải chạy NGOÀI transaction. Supabase
-- migration runner chạy mỗi file 1 transaction implicitly, nên cần
-- COMMIT trước rồi ADD VALUE. Dùng IF NOT EXISTS để idempotent.

-- Wave 26-D — `reported_broken` chèn giữa `assigned` và `expired` để
-- ordering ENUM stable cho future queries (admin có thể ORDER BY status).
ALTER TYPE proxy_status ADD VALUE IF NOT EXISTS 'reported_broken' BEFORE 'expired';

COMMIT;

-- ============================================================
-- 2) Extension `proxies.reliability_score`
-- ============================================================
-- Wave 26-D-future use: decrement N% mỗi lần warranty được duyệt.
-- Khi reliability_score <= 0 → cron auto-mark banned. Wave 26-E sẽ wire
-- logic này; pre-fix column tồn tại sẵn để không cần thêm migration.

ALTER TABLE proxies
  ADD COLUMN IF NOT EXISTS reliability_score INT NOT NULL DEFAULT 100;

COMMENT ON COLUMN proxies.reliability_score IS
  'Wave 26-D — điểm tin cậy proxy (0-100). Decrement -25 mỗi lần admin duyệt warranty (warranty_reliability_decrement setting). Future Wave 26-E: auto-ban khi <= 0.';

CREATE INDEX IF NOT EXISTS proxies_reliability_idx
  ON proxies (reliability_score)
  WHERE reliability_score < 100 AND is_deleted = false;

-- ============================================================
-- 3) warranty_claims — bảng chính cho lifecycle bảo hành
-- ============================================================

DO $$ BEGIN
  CREATE TYPE warranty_claim_status AS ENUM ('pending','approved','rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  -- G1 — 6 lý do user có thể chọn. `other` bắt buộc nhập text (H3=(c)).
  CREATE TYPE warranty_reason_code AS ENUM (
    'no_connect',     -- Không kết nối được
    'slow',           -- Chậm
    'ip_blocked',     -- IP bị block
    'wrong_country',  -- Sai quốc gia
    'auth_fail',      -- Sai user/pass
    'other'           -- Lý do khác (kèm reason_text)
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS warranty_claims (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Proxy gốc bị báo lỗi. ON DELETE RESTRICT vì warranty là audit
  -- trail vĩnh viễn — admin không xoá hard proxy có claim, phải
  -- soft-delete (is_deleted=true) thay thế.
  proxy_id              uuid NOT NULL REFERENCES proxies(id) ON DELETE RESTRICT,

  -- User tele đã báo lỗi.
  user_id               uuid NOT NULL REFERENCES tele_users(id) ON DELETE RESTRICT,

  -- Lý do báo lỗi (enum) + text bổ sung khi chọn `other`.
  reason_code           warranty_reason_code NOT NULL,
  reason_text           text,
  CONSTRAINT warranty_other_requires_text
    CHECK (reason_code != 'other' OR (reason_text IS NOT NULL AND length(trim(reason_text)) > 0)),

  -- Status lifecycle.
  status                warranty_claim_status NOT NULL DEFAULT 'pending',

  -- Khi admin duyệt: link sang proxy thay thế (nullable vì:
  -- 1) claim status='pending' chưa duyệt → null;
  -- 2) claim 'rejected' → null;
  -- 3) claim 'approved' nhưng allocator hết hàng → null + admin
  --    re-allocate sau (tracked qua proxy_events).
  replacement_proxy_id  uuid REFERENCES proxies(id) ON DELETE SET NULL,

  -- A7=(b) — admin checkbox "đồng thời mark banned" trong dialog
  -- duyệt warranty. Khi true → proxy gốc đi thẳng `assigned →
  -- banned`. Khi false (default) → `assigned → maintenance`.
  also_mark_banned      boolean NOT NULL DEFAULT false,

  -- Audit của resolution.
  resolved_by           uuid REFERENCES admins(id) ON DELETE SET NULL,
  resolved_at           timestamptz,
  rejection_reason      text,
  CONSTRAINT warranty_rejection_requires_reason
    CHECK (status != 'rejected' OR (rejection_reason IS NOT NULL AND length(trim(rejection_reason)) > 0)),
  CONSTRAINT warranty_resolved_atomicity
    CHECK ((status = 'pending') = (resolved_at IS NULL)),

  created_at            timestamptz NOT NULL DEFAULT now()
);

-- Index pending queue — admin dashboard query "claim đang chờ" rất hot.
CREATE INDEX IF NOT EXISTS warranty_claims_pending_idx
  ON warranty_claims (created_at DESC)
  WHERE status = 'pending';

-- Index user claims — anti-abuse counter cần đếm pending + 30d cap.
CREATE INDEX IF NOT EXISTS warranty_claims_user_idx
  ON warranty_claims (user_id, created_at DESC);

-- Index proxy claims — proxy detail timeline + duplicate-claim guard.
CREATE INDEX IF NOT EXISTS warranty_claims_proxy_idx
  ON warranty_claims (proxy_id, created_at DESC);

COMMENT ON TABLE warranty_claims IS
  'Wave 26-D — claim bảo hành. User báo lỗi proxy → bot insert pending → admin duyệt/từ chối.';

-- ============================================================
-- 4) proxy_events — audit table 16 event_type
-- ============================================================
-- C1 — full audit. Pre-fix lifecycle proxy rải rác giữa
-- proxies.assigned_at/to (chỉ giữ lần GẦN NHẤT) + activity_logs
-- (action overloaded — proxy.update đè lên mọi field change).
-- Bảng mới: structured + indexed cho 3 query patterns chính.

DO $$ BEGIN
  CREATE TYPE proxy_event_type AS ENUM (
    'created',                   -- admin tạo proxy mới (manual)
    'imported',                  -- thuộc lô import (kèm import_batch_id)
    'edited',                    -- field thay đổi (before/after trong details)
    'category_changed',          -- riêng — query "proxy đã chuyển category nào"
    'status_changed',            -- riêng — query "proxy này từng banned chưa"
    'assigned',                  -- giao cho 1 user (kèm related_user_id)
    'unassigned',                -- thu hồi (kèm reason: expired/revoked_by_user/admin/banned/warranty_replaced)
    'reported_broken',           -- user báo lỗi qua bot
    'warranty_approved',         -- admin duyệt warranty → tạo replacement
    'warranty_rejected',         -- admin từ chối warranty
    'warranty_replacement_for',  -- proxy này được cấp THAY THẾ cho proxy hỏng nào
    'health_check_passed',
    'health_check_failed',
    'expired',                   -- trigger cron khi expires_at < now
    'soft_deleted',              -- chuyển vào thùng rác
    'restored',                  -- khôi phục từ thùng rác
    'admin_note'                 -- H4=(a) admin manual note attached to timeline
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS proxy_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proxy_id            uuid NOT NULL REFERENCES proxies(id) ON DELETE CASCADE,
  event_type          proxy_event_type NOT NULL,
  actor_type          actor_type,                                          -- 'admin' / 'tele_user' / 'system' / 'bot'
  actor_id            uuid,                                                -- admin id hoặc tele_user id
  related_user_id     uuid REFERENCES tele_users(id) ON DELETE SET NULL,  -- "ai dùng proxy này khi sự kiện xảy ra"
  related_proxy_id    uuid REFERENCES proxies(id) ON DELETE SET NULL,    -- linkage sang proxy thay thế (warranty cross-link)
  details             jsonb NOT NULL DEFAULT '{}',                        -- before/after diff cho 'edited'; reason cho 'unassigned'; speed_ms cho health
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Index per-proxy timeline (proxy detail page chính).
CREATE INDEX IF NOT EXISTS proxy_events_proxy_idx
  ON proxy_events (proxy_id, created_at DESC);

-- Index per-user history (user detail page sẽ surface).
CREATE INDEX IF NOT EXISTS proxy_events_user_idx
  ON proxy_events (related_user_id, created_at DESC)
  WHERE related_user_id IS NOT NULL;

-- Index per-event-type ("xem mọi warranty trong tháng" type query).
CREATE INDEX IF NOT EXISTS proxy_events_type_idx
  ON proxy_events (event_type, created_at DESC);

COMMENT ON TABLE proxy_events IS
  'Wave 26-D — proxy lifecycle audit log, single source of truth cho timeline page. Distinct from activity_logs (cross-resource) — proxy_events specialised cho query "mọi event của proxy X".';

-- ============================================================
-- 5) proxy_health_logs — last 20 probes per proxy
-- ============================================================
-- B2=(b) — giữ 20 lần test gần nhất. Cron health-check insert mỗi giờ.
-- Trigger sau insert: xoá rows older than 20-th newest per proxy.

CREATE TABLE IF NOT EXISTS proxy_health_logs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proxy_id     uuid NOT NULL REFERENCES proxies(id) ON DELETE CASCADE,
  ok           boolean NOT NULL,
  speed_ms     int,
  error_msg    text,
  checked_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS proxy_health_logs_idx
  ON proxy_health_logs (proxy_id, checked_at DESC);

-- Trigger: keep last 20 probes per proxy. Runs ON INSERT, deletes rows
-- 21+ rank by checked_at DESC. Idempotent (each insert prunes its own
-- proxy's tail).
CREATE OR REPLACE FUNCTION fn_proxy_health_logs_keep_last_20()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM proxy_health_logs
  WHERE proxy_id = NEW.proxy_id
    AND id NOT IN (
      SELECT id FROM proxy_health_logs
      WHERE proxy_id = NEW.proxy_id
      ORDER BY checked_at DESC
      LIMIT 20
    );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_proxy_health_logs_keep_last_20 ON proxy_health_logs;
CREATE TRIGGER trg_proxy_health_logs_keep_last_20
  AFTER INSERT ON proxy_health_logs
  FOR EACH ROW EXECUTE FUNCTION fn_proxy_health_logs_keep_last_20();

COMMENT ON TABLE proxy_health_logs IS
  'Wave 26-D — last 20 health-check probes per proxy. Trigger fn_proxy_health_logs_keep_last_20 prunes older rows per proxy on insert.';

-- ============================================================
-- 6) saved_views — admin save bộ filter của các page
-- ============================================================
-- E2=(a) admin lưu filter "Đang đợi + 7 ngày + Vendor X" thành named view.
-- Page = /requests / /warranty / /proxies. filter_json = full
-- RequestPageFilters object as snapshot.

CREATE TABLE IF NOT EXISTS saved_views (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id        uuid NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  page            text NOT NULL CHECK (page IN ('requests', 'warranty', 'proxies')),
  name            text NOT NULL CHECK (length(trim(name)) > 0 AND length(name) <= 80),
  filter_json     jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Unique per (admin, page, name) — admin cùng page không có 2 view cùng tên.
CREATE UNIQUE INDEX IF NOT EXISTS saved_views_uq
  ON saved_views (admin_id, page, lower(name));

-- Index per admin — sidebar load tất cả view của admin.
CREATE INDEX IF NOT EXISTS saved_views_admin_idx
  ON saved_views (admin_id, created_at DESC);

COMMENT ON TABLE saved_views IS
  'Wave 26-D — admin saved filter views per page. Unique by (admin, page, lowercase(name)).';

-- ============================================================
-- 7) Settings rows — 5 keys cho warranty
-- ============================================================
-- Pre-fix các thresholds hardcoded trong code; admin phải deploy mới
-- tune. Wave 25-pre4 đã establish pattern dùng settings table; Wave
-- 26-D extend cho warranty.

INSERT INTO settings (key, value, description) VALUES
  (
    'warranty_eligibility_unlimited',
    '{"value": false}'::jsonb,
    'Wave 26-D (A2) — Khi true: user được báo lỗi proxy bất kỳ lúc nào còn HSD. Khi false (default): chỉ trong 24h sau assigned_at.'
  ),
  (
    'warranty_max_pending',
    '{"value": 2}'::jsonb,
    'Wave 26-D (A3-a) — Số claim đang chờ duyệt cùng lúc tối đa cho 1 user.'
  ),
  (
    'warranty_max_per_30d',
    '{"value": 5}'::jsonb,
    'Wave 26-D (A3-b) — Số claim tối đa user submit trong 30 ngày trượt.'
  ),
  (
    'warranty_cooldown_minutes',
    '{"value": 60}'::jsonb,
    'Wave 26-D (A3-c) — Phút phải đợi giữa 2 claim liên tiếp của cùng user.'
  ),
  (
    'warranty_reliability_decrement',
    '{"value": 25}'::jsonb,
    'Wave 26-D (A7-bonus) — Số điểm proxy.reliability_score giảm mỗi lần warranty được admin duyệt. Default 25 → sau 4 lần claim approved proxy reliability_score=0 (Wave 26-E auto-ban).'
  )
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 8) RLS policies — saved_views per-admin scope
-- ============================================================
-- saved_views là per-admin private — admin A không xem được view của
-- admin B. Wave 23A audit confirmed RLS enabled on settings/admins;
-- saved_views inherits the same approach.

ALTER TABLE saved_views ENABLE ROW LEVEL SECURITY;

-- Admin chỉ SELECT/INSERT/UPDATE/DELETE rows của chính mình.
DROP POLICY IF EXISTS saved_views_self_only ON saved_views;
CREATE POLICY saved_views_self_only
  ON saved_views
  FOR ALL
  USING (admin_id = (SELECT id FROM admins WHERE email = auth.jwt() ->> 'email'))
  WITH CHECK (admin_id = (SELECT id FROM admins WHERE email = auth.jwt() ->> 'email'));

-- warranty_claims + proxy_events + proxy_health_logs đều là admin-scope
-- audit data — KHÔNG enable RLS (tất cả admin cùng xem). Service role
-- (bot) cũng cần insert; service role bypass RLS by design.
EOF
