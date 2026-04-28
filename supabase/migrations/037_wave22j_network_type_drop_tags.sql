-- ============================================================
-- 037_wave22j_network_type_drop_tags.sql
--
-- Wave 22J: separate "phân loại proxy" (network classification)
-- from "ISP name" (free-text vendor label) and from "type" (transport
-- protocol). Drops the long-tombstoned tags column + archive table.
--
-- Three concepts had been conflated; the user surfaced the design
-- gap. We now have:
--   type         (http | https | socks5)        — wire protocol
--   network_type (isp | datacenter_ipv4 |       — proxy classification
--                 datacenter_ipv6 | residential
--                 | mobile | static_residential)
--   isp          TEXT (free-form)               — vendor / carrier name
-- ============================================================

-- ------------------------------------------------------------
-- 1. proxy_network_type enum
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'proxy_network_type') THEN
    CREATE TYPE proxy_network_type AS ENUM (
      'isp',
      'datacenter_ipv4',
      'datacenter_ipv6',
      'residential',
      'mobile',
      'static_residential'
    );
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2. proxies.network_type column
-- ------------------------------------------------------------
ALTER TABLE proxies
  ADD COLUMN IF NOT EXISTS network_type proxy_network_type;

COMMENT ON COLUMN proxies.network_type IS
  'Wave 22J — proxy classification (independent of transport protocol). NULL for un-classified rows; UI shows "Chưa phân loại" badge. Distinct from `type` (wire protocol) and `isp` (free-text vendor name).';

CREATE INDEX IF NOT EXISTS idx_proxies_network_type
  ON proxies (network_type)
  WHERE is_deleted = false AND hidden = false AND network_type IS NOT NULL;

-- ------------------------------------------------------------
-- 3. Heuristic backfill for existing rows
--    A best-effort guess based on isp text + IP shape; admin can
--    bulk-edit later via /proxies bulk action.
-- ------------------------------------------------------------
UPDATE proxies
SET network_type = CASE
  -- IPv6 host literal
  WHEN host ~ '^[0-9a-fA-F]*:[0-9a-fA-F:]+$' THEN 'datacenter_ipv6'::proxy_network_type
  -- ISP-named patterns (Vietnamese telcos + common residential providers)
  WHEN isp IS NOT NULL AND isp ~* '(viettel|vnpt|fpt|mobifone|vinaphone|comcast|verizon|att|t-mobile|cox|spectrum|residential|home)'
       THEN 'residential'::proxy_network_type
  -- Mobile carrier hints
  WHEN isp IS NOT NULL AND isp ~* '(4g|5g|lte|mobile|cellular)'
       THEN 'mobile'::proxy_network_type
  -- Default datacenter IPv4 — that's what most resold proxies are
  ELSE 'datacenter_ipv4'::proxy_network_type
END
WHERE network_type IS NULL
  AND is_deleted = false;

-- ------------------------------------------------------------
-- 4. proxy_categories.default_network_type — snapshot prefill
-- ------------------------------------------------------------
ALTER TABLE proxy_categories
  ADD COLUMN IF NOT EXISTS default_network_type proxy_network_type;

COMMENT ON COLUMN proxy_categories.default_network_type IS
  'Wave 22J — snapshot prefill for new proxies. Same semantics as default_country / default_proxy_type / default_isp from Wave 22G — frontend prefills, server stores per-row, future category edits do NOT retroactively change existing proxies.';

-- ------------------------------------------------------------
-- 5. FINAL TAGS DROP — archive table + column
--    Wave 22A deprecated, Wave 22C stripped UI/API, Wave 22G
--    tombstoned + archived. The 1-week observation buffer is
--    now well past — drop the column.
-- ------------------------------------------------------------
DROP TABLE IF EXISTS proxies_tags_archive;

ALTER TABLE proxies DROP COLUMN IF EXISTS tags;
