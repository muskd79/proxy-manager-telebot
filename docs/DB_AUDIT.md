# DB Audit — proxy-manager-telebot (Migrations 001–040)

Ngày audit: 2026-04-28

---

## 1. Migration trùng số

| Mức | File trùng | Vấn đề |
|-----|-----------|--------|
| HIGH | `010_webhook_dedup.sql` + `010_fix_function_signatures.sql` | Hai file cùng prefix `010_`. Supabase CLI sắp theo tên alphabet → `010_fix_function_signatures.sql` chạy trước `010_webhook_dedup.sql` (f < w). Thứ tự ngược với ý định ban đầu nhưng **vô tình đúng** vì fix_function_signatures cần webhook_dedup đã tồn tại hay không? KHÔNG — fix_function_signatures chỉ rebuild `get_dashboard_stats()`. Tuy nhiên quy tắc "mỗi số một file" bị vi phạm, CI lint sẽ fail và gây nhầm lẫn. |
| HIGH | `015_cursor_pagination_index.sql` + `015_connection_pool_index.sql` | Cùng prefix `015_`. Cả hai tạo **index giống nhau byte-for-byte**: `proxies(created_at DESC, id) WHERE is_deleted = false`. Tên khác nhau (`idx_proxies_created_at_id` vs `idx_proxies_created_desc`). PostgreSQL giữ cả hai, chỉ dùng một → lãng phí bộ nhớ + write overhead. Migration 039 đã DROP `idx_proxies_created_desc` nhưng gốc vẫn là tech debt. |

**Đề xuất:** tạo `041_rename_duplicate_migration_prefixes.sql` (chỉ comment + verify — không thể đổi tên file đã apply):

```sql
-- 041_housekeeping_notes.sql
-- RECORD: migrations 010_fix_function_signatures + 010_webhook_dedup share prefix.
-- They applied in alphabetical order (fix < web). Intended order preserved by accident.
-- RECORD: migrations 015_cursor_pagination_index + 015_connection_pool_index share prefix.
-- idx_proxies_created_desc was already dropped in mig 039. No action needed at DB level.
-- CI lint: add check in pre-commit hook: find supabase/migrations -name '*.sql' | sed 's/_.*//' | sort | uniq -d → must be empty.
DO $$ BEGIN RAISE NOTICE 'Housekeeping notes recorded. No schema change.'; END $$;
```

---

## 2. RLS Policy Gap

### 2a. Bảng thiếu policy cho `anon` role

Tất cả bảng quan trọng dùng `TO authenticated` — **không có policy nào cho `anon`**. Đây là đúng nếu Supabase project được cấu hình `anon` không thể đọc gì. Nhưng chưa có migration nào revoke anon access ở cấp schema.

**CRITICAL — cần verify + vá:**

```sql
-- 041 thêm vào:
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon;
REVOKE USAGE ON SCHEMA public FROM anon;
```

### 2b. `webhook_dedup` — RLS bật nhưng KHÔNG có policy nào

| Bảng | RLS | SELECT policy | INSERT policy | Ghi chú |
|------|-----|--------------|--------------|--------|
| `webhook_dedup` | ON (mig 010) | **KHÔNG CÓ** | **KHÔNG CÓ** | Chỉ có service_role mới bypass được; authenticated user bị block hoàn toàn — đúng ý định. Nhưng cần policy tường minh để tránh nghi ngờ. |
| `api_rate_limits` | ON (mig 039) | KHÔNG (chỉ service_role) | KHÔNG | Đúng nhưng thiếu explicit deny policy. |

**Severity: MEDIUM** — hành vi đúng nhưng thiếu tường minh. Thêm comment policy:

```sql
-- Tạo deny-all tường minh thay vì dựa vào "không có policy = block"
CREATE POLICY webhook_dedup_deny_authenticated ON webhook_dedup
  FOR ALL TO authenticated USING (false);

CREATE POLICY api_rate_limits_deny_authenticated ON api_rate_limits
  FOR ALL TO authenticated USING (false);
```

### 2c. `admin_login_logs` — super_admin không đọc được log của admin khác

| Policy | Vấn đề |
|--------|--------|
| `admin_login_logs_read_self` | Chỉ `admin_id IN (SELECT id FROM admins WHERE email = auth.jwt()→→'email')` — super_admin không xem được log của các admin khác. Có thể là ý định thiết kế, nhưng cần xác nhận. |

**Severity: MEDIUM** — nếu super_admin cần xem toàn bộ login history cho incident response, cần thêm:

```sql
DROP POLICY IF EXISTS admin_login_logs_read_self ON admin_login_logs;
CREATE POLICY admin_login_logs_read ON admin_login_logs
  FOR SELECT TO authenticated
  USING (
    -- Own logs always visible
    admin_id IN (SELECT id FROM admins WHERE email = auth.jwt() ->> 'email')
    -- super_admin can see all
    OR (SELECT get_admin_role()) = 'super_admin'
  );
```

### 2d. Helper functions `is_admin()` / `is_admin_or_viewer()` — gọi per-row

**CRITICAL (performance):** Migration 003 định nghĩa policies dùng `USING (is_admin())` không có `(SELECT ...)` wrapper. Chỉ các migration **từ 023 trở đi** (purchase_lots, proxy_categories) mới wrap đúng: `USING ((SELECT is_admin()))`.

Các bảng **cũ** bị ảnh hưởng:

| Bảng | Policy | Vấn đề |
|------|--------|--------|
| `admins` | `admins_select_all`, `admins_insert`, `admins_update` | `is_admin_or_viewer()` / `is_admin()` gọi per-row |
| `proxies` | `proxies_select`, `proxies_insert`, `proxies_update`, `proxies_delete` | per-row |
| `tele_users` | tất cả policies | per-row |
| `proxy_requests` | tất cả policies | per-row |
| `chat_messages` | tất cả policies | per-row |
| `activity_logs` | `logs_select`, `logs_insert` | per-row |
| `settings` | `settings_read`, `settings_write` | per-row |

Với 10k proxies, mỗi query `SELECT * FROM proxies` chạy `is_admin()` → subquery vào `admins` → **10.000 lần**. Dùng `(SELECT is_admin())` thì chỉ chạy **1 lần** (init plan).

**Patch cần tạo `042_rls_initplan_fix.sql`:**

```sql
-- 042_rls_initplan_fix.sql
-- Wrap all is_admin / is_admin_or_viewer calls in (SELECT ...) to force
-- InitPlan evaluation (once per statement, not once per row).

-- proxies
DROP POLICY IF EXISTS proxies_select ON proxies;
CREATE POLICY proxies_select ON proxies
  FOR SELECT TO authenticated USING ((SELECT is_admin_or_viewer()));

DROP POLICY IF EXISTS proxies_insert ON proxies;
CREATE POLICY proxies_insert ON proxies
  FOR INSERT TO authenticated WITH CHECK ((SELECT is_admin()));

DROP POLICY IF EXISTS proxies_update ON proxies;
CREATE POLICY proxies_update ON proxies
  FOR UPDATE TO authenticated
  USING ((SELECT is_admin())) WITH CHECK ((SELECT is_admin()));

DROP POLICY IF EXISTS proxies_delete ON proxies;
CREATE POLICY proxies_delete ON proxies
  FOR DELETE TO authenticated USING ((SELECT is_admin()));

-- tele_users
DROP POLICY IF EXISTS tele_users_select ON tele_users;
CREATE POLICY tele_users_select ON tele_users
  FOR SELECT TO authenticated USING ((SELECT is_admin_or_viewer()));

DROP POLICY IF EXISTS tele_users_insert ON tele_users;
CREATE POLICY tele_users_insert ON tele_users
  FOR INSERT TO authenticated WITH CHECK ((SELECT is_admin()));

DROP POLICY IF EXISTS tele_users_update ON tele_users;
CREATE POLICY tele_users_update ON tele_users
  FOR UPDATE TO authenticated
  USING ((SELECT is_admin())) WITH CHECK ((SELECT is_admin()));

DROP POLICY IF EXISTS tele_users_delete ON tele_users;
CREATE POLICY tele_users_delete ON tele_users
  FOR DELETE TO authenticated USING ((SELECT is_admin()));

-- proxy_requests
DROP POLICY IF EXISTS requests_select ON proxy_requests;
CREATE POLICY requests_select ON proxy_requests
  FOR SELECT TO authenticated USING ((SELECT is_admin_or_viewer()));

DROP POLICY IF EXISTS requests_insert ON proxy_requests;
CREATE POLICY requests_insert ON proxy_requests
  FOR INSERT TO authenticated WITH CHECK ((SELECT is_admin()));

DROP POLICY IF EXISTS requests_update ON proxy_requests;
CREATE POLICY requests_update ON proxy_requests
  FOR UPDATE TO authenticated
  USING ((SELECT is_admin())) WITH CHECK ((SELECT is_admin()));

DROP POLICY IF EXISTS requests_delete ON proxy_requests;
CREATE POLICY requests_delete ON proxy_requests
  FOR DELETE TO authenticated USING ((SELECT is_admin()));

-- chat_messages
DROP POLICY IF EXISTS chat_select ON chat_messages;
CREATE POLICY chat_select ON chat_messages
  FOR SELECT TO authenticated USING ((SELECT is_admin_or_viewer()));

DROP POLICY IF EXISTS chat_insert ON chat_messages;
CREATE POLICY chat_insert ON chat_messages
  FOR INSERT TO authenticated WITH CHECK ((SELECT is_admin()));

DROP POLICY IF EXISTS chat_update ON chat_messages;
CREATE POLICY chat_update ON chat_messages
  FOR UPDATE TO authenticated
  USING ((SELECT is_admin())) WITH CHECK ((SELECT is_admin()));

DROP POLICY IF EXISTS chat_delete ON chat_messages;
CREATE POLICY chat_delete ON chat_messages
  FOR DELETE TO authenticated USING ((SELECT is_admin()));

-- activity_logs
DROP POLICY IF EXISTS logs_select ON activity_logs;
CREATE POLICY logs_select ON activity_logs
  FOR SELECT TO authenticated USING ((SELECT is_admin_or_viewer()));

DROP POLICY IF EXISTS logs_insert ON activity_logs;
CREATE POLICY logs_insert ON activity_logs
  FOR INSERT TO authenticated WITH CHECK ((SELECT is_admin()));

-- settings (mig 005 đã tạo policies mới tên khác)
DROP POLICY IF EXISTS settings_read ON settings;
CREATE POLICY settings_read ON settings
  FOR SELECT TO authenticated USING ((SELECT is_admin_or_viewer()));

DROP POLICY IF EXISTS settings_write ON settings;
CREATE POLICY settings_write ON settings
  FOR ALL TO authenticated
  USING ((SELECT get_admin_role()) = 'super_admin')
  WITH CHECK ((SELECT get_admin_role()) = 'super_admin');

-- admins
DROP POLICY IF EXISTS admins_select_all ON admins;
CREATE POLICY admins_select_all ON admins
  FOR SELECT TO authenticated USING ((SELECT is_admin_or_viewer()));

DROP POLICY IF EXISTS admins_insert ON admins;
CREATE POLICY admins_insert ON admins
  FOR INSERT TO authenticated WITH CHECK ((SELECT is_admin()));

DROP POLICY IF EXISTS admins_update ON admins;
CREATE POLICY admins_update ON admins
  FOR UPDATE TO authenticated
  USING ((SELECT is_admin())) WITH CHECK ((SELECT is_admin()));
```

### 2e. `is_admin()` dùng `auth.email()` thay vì `auth.uid()` — SQL injection tiềm ẩn

Mig 005 đổi `is_admin()` từ `auth.uid()` (UUID, an toàn) sang `auth.email()` (TEXT). Email là JWT claim, không phải cột được DB kiểm soát. Bản thân SQL không inject được nhưng nếu Supabase Auth bị bypass và JWT được forge với email = admin, thì check vẫn pass. **Khuyến nghị đổi lại sang `auth.uid()`** và đảm bảo `admins.id` khớp với `auth.users.id`.

---

## 3. Index

### 3a. Thừa / trùng

| Mức | Index | Migration | Vấn đề |
|-----|-------|-----------|--------|
| HIGH | `idx_proxies_created_desc` | 015_connection_pool_index | Trùng với `idx_proxies_created_at_id` (015_cursor_pagination_index). Mig 039 đã DROP — OK. |
| MEDIUM | `idx_activity_logs_created_at` | 014 | Trùng với `idx_logs_created` (mig 002). Mig 032 đã DROP CONCURRENTLY — OK. |
| LOW | `idx_proxies_host_trgm` (unfiltered, mig 011) | Mig 039 đã DROP và recreate với `WHERE is_deleted = false` — OK. |

**Tổng kết:** mig 039 đã cleanup tốt. Không còn index thừa active.

### 3b. Thiếu index

| Mức | Bảng | Cột | Lý do cần |
|-----|------|-----|----------|
| HIGH | `activity_logs` | `actor_id` (standalone) | `idx_logs_actor` cover `(actor_type, actor_id)`. OK nếu query luôn filter actor_type. Nếu có query `WHERE actor_id = $uuid` không có actor_type, cần index riêng. |
| HIGH | `proxies` | `(status, geo_country_iso, type)` cho query distribute | `idx_proxies_distribute_priority` đã cover: `(type, geo_country_iso, expires_at DESC, speed_ms ASC, last_distributed_at ASC)` — OK. |
| MEDIUM | `admin_login_logs` | `ip_address` | Incident response: "tất cả login từ IP X" — không có index. |
| MEDIUM | `proxies` | `assigned_at` | Query "proxy được assign hôm nay" — không có index. |
| MEDIUM | `tele_users` | `(status, is_deleted)` composite | `idx_tele_users_status` filter `WHERE is_deleted = false` đủ cho hầu hết queries. |
| LOW | `proxy_requests` | `(approved_by)` | Query "admin X đã approve bao nhiêu" — FK `approved_by → admins(id)` chưa có index. |
| LOW | `proxy_requests` | `proxy_id` FK | FK `proxy_id → proxies(id)` có index chưa? Không thấy trong migrations. Cần thêm. |

**Patch `043_missing_fk_indexes.sql`:**

```sql
-- 043_missing_fk_indexes.sql
-- FK indexes thiếu (luôn phải index FK column)

-- proxy_requests.proxy_id → proxies(id)
CREATE INDEX IF NOT EXISTS idx_proxy_requests_proxy_id
  ON proxy_requests (proxy_id)
  WHERE proxy_id IS NOT NULL;

-- proxy_requests.approved_by → admins(id)
CREATE INDEX IF NOT EXISTS idx_proxy_requests_approved_by
  ON proxy_requests (approved_by)
  WHERE approved_by IS NOT NULL;

-- admin_login_logs.ip_address (incident response)
CREATE INDEX IF NOT EXISTS idx_admin_login_logs_ip
  ON admin_login_logs (ip_address)
  WHERE ip_address IS NOT NULL;

-- proxies.assigned_at (cron + audit)
CREATE INDEX IF NOT EXISTS idx_proxies_assigned_at
  ON proxies (assigned_at DESC)
  WHERE assigned_at IS NOT NULL AND is_deleted = false;
```

### 3c. Composite index order sai

`idx_proxies_avail_geo_type` (mig 023): `(geo_country_iso, type, status, created_at DESC, id) WHERE status='available'`. Vì `status = 'available'` đã là filter trong WHERE predicate, cột `status` trong index là thừa — nó luôn = 'available'. Không phải bug, chỉ là micro-waste (1 byte/row).

---

## 4. FK + CASCADE

### 4a. Thiếu FK

| Mức | Bảng | Cột | Vấn đề |
|-----|------|-----|--------|
| HIGH | `activity_logs` | `actor_id` | Không có FK constraint. `actor_id` có thể trỏ đến `admins.id` hoặc `tele_users.id` tùy `actor_type`. Polymorphic FK — không thể enforce bằng FK thông thường. Đây là thiết kế có chủ ý, nhưng cần comment giải thích để tránh confuse. |
| MEDIUM | `proxies` | `created_by → admins(id)` | FK có, ON DELETE SET NULL — OK. |
| LOW | `admin_login_logs` | `admin_id → admins(id)` | FK có, ON DELETE SET NULL — đúng vì cần giữ log kể cả khi admin bị xóa. |

### 4b. CASCADE an toàn hay không

| Quan hệ | CASCADE type | Đánh giá |
|---------|-------------|---------|
| `proxy_requests.tele_user_id → tele_users` | ON DELETE CASCADE | **HIGH RISK**: xóa tele_user → xóa toàn bộ proxy_requests lịch sử. Đúng cho multi-tenant nhưng ở đây admin cần giữ lịch sử audit. Nên đổi thành `ON DELETE SET NULL` hoặc `RESTRICT`. |
| `chat_messages.tele_user_id → tele_users` | ON DELETE CASCADE | **HIGH RISK**: tương tự — mất lịch sử chat khi xóa user. |
| `admin_backup_codes.admin_id → admins` | ON DELETE CASCADE | OK — backup codes không có ý nghĩa khi admin bị xóa. |
| `import_lot_keys → purchase_lots` | ON DELETE CASCADE | OK — mig 040 đã DROP cả hai bảng. |

**Patch `044_fix_cascade_policies.sql`:**

```sql
-- 044_fix_cascade_policies.sql
-- Đổi CASCADE thành RESTRICT để bảo vệ audit data.
-- Hard-delete tele_user nên bị block nếu còn records liên quan.

-- proxy_requests: đổi từ CASCADE sang RESTRICT
ALTER TABLE proxy_requests
  DROP CONSTRAINT proxy_requests_tele_user_id_fkey;
ALTER TABLE proxy_requests
  ADD CONSTRAINT proxy_requests_tele_user_id_fkey
  FOREIGN KEY (tele_user_id)
  REFERENCES tele_users(id)
  ON DELETE RESTRICT;

-- chat_messages: đổi từ CASCADE sang RESTRICT
ALTER TABLE chat_messages
  DROP CONSTRAINT chat_messages_tele_user_id_fkey;
ALTER TABLE chat_messages
  ADD CONSTRAINT chat_messages_tele_user_id_fkey
  FOREIGN KEY (tele_user_id)
  REFERENCES tele_users(id)
  ON DELETE RESTRICT;
```

> Lưu ý: Hard delete tele_user hiện tại dùng soft delete (is_deleted=true), CASCADE chỉ fire khi DELETE thật sự. Nếu app không bao giờ hard-delete, đây là low-risk. Nhưng RESTRICT an toàn hơn.

---

## 5. pgsodium (mig 020 + 024)

### 5a. Key rotation plan

Mig 020 tạo key `vendor_credentials_key` nhưng **không có migration nào định nghĩa key rotation procedure**. Comment trong mig 020 nói "see migration 021 when needed" — mig 021 không implement rotation, chỉ implement saga prereqs. Mig 024 drop toàn bộ vendor stack nhưng **giữ lại `vendor_credentials_key`** với lý do "PITR safety".

**Vấn đề:**
- Key còn tồn tại trong `pgsodium.valid_key` nhưng không còn được dùng (vendor_credentials table đã drop).
- Không có cron hay procedure để rotate key.
- Nếu key bị compromise, không có rollback path.

**Đề xuất:**
```sql
-- Trong migration 045 (future):
-- Xóa key nếu không còn dùng, hoặc document rotation procedure:
-- SELECT pgsodium.create_key(name := 'vendor_credentials_key_v2');
-- UPDATE vendor_credentials SET ciphertext = re_encrypt(...), key_id = v2_id;
-- UPDATE pgsodium.key SET status = 'invalid' WHERE name = 'vendor_credentials_key';
```

### 5b. Key access pattern

- `encrypt_vendor_cred()` và `decrypt_vendor_cred()` — REVOKE ALL, GRANT TO service_role — **ĐÚNG**
- `list_vendor_credentials()` — GRANT TO authenticated + service_role — **ĐÚNG** (không trả plaintext)
- Tất cả đã DROP trong mig 024 — không còn exposure.

**Verdict:** pgsodium implementation đúng. Vấn đề duy nhất là orphaned key sau mig 024.

---

## 6. Function/RPC Security

### 6a. SECURITY DEFINER không set `search_path`

| Mức | Function | Migration | Vấn đề |
|-----|----------|-----------|--------|
| CRITICAL | `is_admin()` | 003, 005 | Không có `SET search_path = public` — attacker có thể tạo schema/function giả nếu có CREATE SCHEMA permission. |
| CRITICAL | `is_admin_or_viewer()` | 003, 005 | Tương tự |
| CRITICAL | `get_admin_role()` | 005 | Tương tự |
| CRITICAL | `handle_updated_at()` | 004 | Không SECURITY DEFINER nhưng cũng không có search_path |
| HIGH | `check_and_increment_usage()` | 012 | Không có `SET search_path` |
| HIGH | `get_dashboard_stats()`, `get_analytics()` | 011 | Không có `SET search_path` |
| HIGH | `safe_assign_proxy()` | 008, 027 | Mig 027 không set search_path |
| HIGH | `decrement_usage()` | 009 | Không có `SET search_path` |
| HIGH | `bulk_assign_proxies()` | 013 | Không có `SET search_path` |
| HIGH | `cascade_user_soft_delete()`, `cascade_proxy_soft_delete()` | 014 | Không có `SET search_path` |
| HIGH | `increment_login_count()` | 016 | Không có `SET search_path` |
| OK | `import_lot()` | 025 | Có `SET search_path = public` |
| OK | `bulk_proxy_ops()` | 026 | Có `SET search_path = public` (đã drop) |
| OK | `safe_bulk_edit_proxies()` | 030, 031 | Có `SET search_path = public` |
| OK | `safe_revoke_proxy()` | 029 | Có `SET search_path = public` |
| OK | `smart_pick_proxy()` | 027 | OK |
| OK | Tất cả Wave 22 RPCs | 028+ | Có `SET search_path = public` |

**Patch `042_rls_initplan_fix.sql` bổ sung (hoặc tạo migration riêng):**

```sql
-- Fix search_path cho các functions cũ
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM admins
    WHERE email = auth.email()
      AND is_active = true
      AND role IN ('super_admin', 'admin')
  );
END;
$$;

CREATE OR REPLACE FUNCTION is_admin_or_viewer()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM admins
    WHERE email = auth.email()
      AND is_active = true
  );
END;
$$;

CREATE OR REPLACE FUNCTION get_admin_role()
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN (
    SELECT role::text FROM admins
    WHERE email = auth.email()
      AND is_active = true
    LIMIT 1
  );
END;
$$;

CREATE OR REPLACE FUNCTION decrement_usage(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE tele_users
  SET proxies_used_hourly = GREATEST(proxies_used_hourly - 1, 0),
      proxies_used_daily  = GREATEST(proxies_used_daily - 1, 0),
      proxies_used_total  = GREATEST(proxies_used_total - 1, 0),
      updated_at          = now()
  WHERE id = p_user_id
    AND is_deleted = false;
END;
$$;

CREATE OR REPLACE FUNCTION increment_login_count(p_email TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE admins
  SET login_count = login_count + 1
  WHERE email = p_email;
END;
$$;
```

### 6b. Dynamic SQL injection risk

Không có `EXECUTE format(...)` nào dùng untrusted user input trực tiếp. Các DO blocks trong mig 019 dùng format với tên bảng hard-coded từ ARRAY literal — an toàn.

### 6c. `check_api_rate_limit()` — interval injection

```sql
(p_window_seconds || ' seconds')::interval
```

`p_window_seconds` là `INTEGER` — không inject được. An toàn.

### 6d. `get_recent_conversations()` — ILIKE với unparameterized search

```sql
OR cm.message_text ILIKE '%' || p_search || '%'
```

`p_search` là parameter của function, KHÔNG phải string concatenation trong SQL statement — an toàn. Nhưng leading + trailing `%` → full table scan nếu không có trigram index trên `chat_messages.message_text`.

**Thiếu index:**
```sql
-- Thêm vào 043:
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_chat_messages_text_trgm
  ON chat_messages USING GIN (message_text gin_trgm_ops)
  WHERE message_text IS NOT NULL;
```

---

## 7. Performance — Slow Query Candidates

### 7a. `activity_logs` — retention

Bảng append-only, không có partition, không có TTL. `idx_logs_created` (DESC) + `idx_activity_logs_search` (GIN) tốt cho read. Nhưng không có DELETE/archive mechanism.

Ước tính: 100 actions/giờ × 24 × 365 = **876,000 rows/năm**. Tại 5M rows, GIN index build sẽ chậm.

**Đề xuất partition by month + retention 90 ngày:**

```sql
-- Migration 045_activity_logs_retention.sql (future)
-- Option A: thêm cron job DELETE
DELETE FROM activity_logs
WHERE created_at < now() - INTERVAL '90 days'
  AND actor_type IN ('bot', 'system');  -- giữ admin actions vĩnh viễn

-- Option B (tốt hơn): pg_partman monthly partition
-- Cần enable pg_partman extension trước.
```

### 7b. `webhook_dedup` — không có TTL

`webhook_dedup` rows tích lũy vĩnh viễn. Không có index cleanup trigger.

```sql
-- Thêm cron hoặc trong migration:
CREATE INDEX IF NOT EXISTS idx_webhook_dedup_processed ON webhook_dedup(processed_at);
-- Cron: DELETE FROM webhook_dedup WHERE processed_at < now() - INTERVAL '7 days';
```

### 7c. `get_dashboard_stats()` — full scan mỗi lần gọi

Function scan toàn bộ `proxies`, `tele_users`, `proxy_requests` (3 scans). Với 10k proxies, mỗi lần dashboard load = 3 seq scans. `idx_proxies_status` (partial, WHERE is_deleted=false) giúp được nhưng vẫn cần index scan cho mỗi status.

**Đề xuất cache trong `settings` table với TTL 60s** hoặc dùng materialized view + refresh mỗi 5 phút.

### 7d. `get_analytics()` — N correlated subqueries

Mig 011 đã optimize từ 56 subqueries xuống còn N correlated subqueries per day (active_users COUNT DISTINCT). Với 14 ngày × 1 subquery = 14 subqueries. Có thể tối ưu thêm bằng cách JOIN chat_messages trong cùng CTE, nhưng ở scale hiện tại (<1M rows) đủ dùng.

### 7e. `proxies` table — nhiều trigger chồng nhau

Bảng `proxies` hiện có các triggers:
1. `set_updated_at_proxies` (mig 004)
2. `tele_users_soft_delete_cascade` (mig 014, trên tele_users, UPDATE proxies)
3. `proxies_soft_delete_cascade` (mig 014, trên proxies)
4. `trg_proxy_lot_count` (mig 023, DROP trong mig 040)
5. `trg_proxies_category_recount` (mig 031, AFTER INSERT/UPDATE/DELETE)
6. `trg_proxies_inherit_hidden` (mig 036, BEFORE INSERT/UPDATE)

Mỗi `UPDATE proxies` có thể fire tới 3 triggers. Với bulk_assign 1000 proxies = 3000 trigger executions. Dùng `AFTER UPDATE` + statement-level trigger thay row-level khi có thể. Hiện tại acceptable, nhưng cần monitor nếu scale lên.

---

## 8. Bảng quan trọng nhất cần audit RLS riêng

Ưu tiên giảm dần:

| # | Bảng | Lý do cần audit riêng |
|---|------|----------------------|
| 1 | `proxies` | Core business object, 10k+ rows, nhiều RPC write, RLS per-row issue |
| 2 | `activity_logs` | Audit trail — phải append-only, không ai được UPDATE/DELETE |
| 3 | `admin_backup_codes` | Sensitive 2FA data, policy hiện dùng `auth.jwt()` không qua `admins` table |
| 4 | `tele_users` | User PII, policies per-row |
| 5 | `settings` | Config sensitive, chỉ super_admin được write |

**Vấn đề bổ sung `activity_logs`:** hiện có policy `logs_insert` cho `authenticated` — nghĩa là bất kỳ authenticated admin nào cũng có thể INSERT vào activity_logs tùy ý. Nên đổi thành service_role only:

```sql
-- 042 bổ sung:
DROP POLICY IF EXISTS logs_insert ON activity_logs;
-- Chỉ service_role được INSERT (app luôn dùng supabaseAdmin cho logging)
-- authenticated không insert trực tiếp
```

---

## 9. Tóm tắt Severity

| ID | Severity | Vấn đề | Migration đề xuất |
|----|----------|--------|-------------------|
| R1 | CRITICAL | RLS per-row: `is_admin()` không wrap `(SELECT ...)` ở bảng 003-era | 042 |
| R2 | CRITICAL | `anon` role chưa bị revoke khỏi schema public | 041 |
| R3 | CRITICAL | `is_admin()` / helper functions thiếu `SET search_path` | 042 |
| R4 | HIGH | `proxy_requests` CASCADE DELETE → mất audit trail | 044 |
| R5 | HIGH | `chat_messages` CASCADE DELETE → mất chat history | 044 |
| R6 | HIGH | FK `proxy_requests.proxy_id` chưa có index | 043 |
| R7 | HIGH | FK `proxy_requests.approved_by` chưa có index | 043 |
| R8 | HIGH | `decrement_usage()`, `increment_login_count()`, `get_dashboard_stats()` thiếu `search_path` | 042 |
| R9 | MEDIUM | Migration trùng số 010 + 015 (CI lint) | 041 (comment) |
| R10 | MEDIUM | `webhook_dedup` + `api_rate_limits` thiếu explicit deny policy | 041 |
| R11 | MEDIUM | `admin_login_logs`: super_admin không xem log của admin khác | 042 |
| R12 | MEDIUM | `activity_logs`: không có retention/archive plan | 045 (future) |
| R13 | MEDIUM | `chat_messages.message_text` thiếu trigram index | 043 |
| R14 | MEDIUM | pgsodium orphaned key sau mig 024 | 045 (future) |
| R15 | LOW | `activity_logs.logs_insert` cho authenticated — nên service_role only | 042 |
| R16 | LOW | `is_admin()` dùng `auth.email()` thay `auth.uid()` | note |

---

## 10. Kế hoạch Migration đề xuất

| Migration | Nội dung | Priority |
|-----------|---------|---------|
| `041_housekeeping.sql` | Ghi note trùng số, revoke anon, explicit deny policies | URGENT |
| `042_rls_security_hardening.sql` | InitPlan fix toàn bộ, search_path fix, logs_insert restrict | URGENT |
| `043_missing_indexes.sql` | FK indexes, trigram chat_messages | HIGH |
| `044_fix_cascade_restrict.sql` | proxy_requests + chat_messages ON DELETE RESTRICT | HIGH |
| `045_retention_plan.sql` | activity_logs cleanup cron, webhook_dedup TTL | MEDIUM |

---

*Audit thực hiện trên 40 migration files (001–040). Không có live DB connection — analysis dựa trên static SQL review.*
