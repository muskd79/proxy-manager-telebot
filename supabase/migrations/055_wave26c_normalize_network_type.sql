-- ============================================================
-- 055_wave26c_normalize_network_type.sql
-- Wave 26-C (gap 4.x) — canonicalise legacy network_type rows.
--
-- User report: "cột loại mạng đang không đồng bộ" — the proxies
-- list filter sent canonical values (`datacenter_ipv4`) while
-- existing rows held legacy strings (`IPv4`, `Datacenter IPv4`,
-- `4G`, `dân cư`) written before Wave 26-A added client-side
-- normalisation. `.eq("network_type", value)` therefore failed
-- to match — admin saw "0 kết quả" with a filter while the
-- table clearly listed rows of that type.
--
-- Fix path:
--   1. Server-side normalisation on every write (Wave 26-C
--      proxy-labels.ts:normalizeNetworkType, applied in
--      api/proxies/{POST,PATCH,import,GET-filter} +
--      api/categories/{POST,PATCH}). Going forward the column
--      can only ever hold a canonical enum.
--   2. THIS migration — one-shot UPDATE that fixes existing rows
--      to match the canonical enum. Idempotent: if a row is
--      already canonical the WHERE skips it; running this twice
--      is a no-op.
--
-- Mirrors the alias map in src/lib/proxy-labels.ts so the SQL
-- and TS sources of truth stay aligned. If the alias map ever
-- changes, write a new migration — DO NOT mutate this one
-- (audit trail principle).
--
-- Tables touched:
--   - proxies.network_type
--   - proxy_categories.default_network_type
-- ============================================================

-- proxies — single UPDATE with CASE so we hit the fast path.
UPDATE proxies
SET network_type = CASE LOWER(TRIM(network_type))
  -- Direct canonical lower-case (idempotent — no-op for these)
  WHEN 'isp'                  THEN 'isp'
  WHEN 'datacenter_ipv4'      THEN 'datacenter_ipv4'
  WHEN 'datacenter_ipv6'      THEN 'datacenter_ipv6'
  WHEN 'residential'          THEN 'residential'
  WHEN 'mobile'               THEN 'mobile'
  WHEN 'static_residential'   THEN 'static_residential'
  -- Legacy aliases observed in production
  WHEN 'datacenter ipv4'      THEN 'datacenter_ipv4'
  WHEN 'datacenter-ipv4'      THEN 'datacenter_ipv4'
  WHEN 'ipv4'                 THEN 'datacenter_ipv4'
  WHEN 'dc_ipv4'              THEN 'datacenter_ipv4'
  WHEN 'dc4'                  THEN 'datacenter_ipv4'
  WHEN 'datacenter ipv6'      THEN 'datacenter_ipv6'
  WHEN 'datacenter-ipv6'      THEN 'datacenter_ipv6'
  WHEN 'ipv6'                 THEN 'datacenter_ipv6'
  WHEN 'dc_ipv6'              THEN 'datacenter_ipv6'
  WHEN 'dc6'                  THEN 'datacenter_ipv6'
  WHEN 'dân cư'               THEN 'residential'
  WHEN 'dan cu'               THEN 'residential'
  WHEN 'resi'                 THEN 'residential'
  WHEN 'res'                  THEN 'residential'
  WHEN '4g'                   THEN 'mobile'
  WHEN '5g'                   THEN 'mobile'
  WHEN '4g/5g'                THEN 'mobile'
  WHEN 'lte'                  THEN 'mobile'
  WHEN 'static residential'   THEN 'static_residential'
  WHEN 'static-residential'   THEN 'static_residential'
  WHEN 'resi tĩnh'            THEN 'static_residential'
  WHEN 'static_resi'          THEN 'static_residential'
  ELSE network_type
END
WHERE network_type IS NOT NULL
  AND network_type NOT IN (
    'isp',
    'datacenter_ipv4',
    'datacenter_ipv6',
    'residential',
    'mobile',
    'static_residential'
  );

-- proxy_categories.default_network_type — same map, same logic.
UPDATE proxy_categories
SET default_network_type = CASE LOWER(TRIM(default_network_type))
  WHEN 'isp'                  THEN 'isp'
  WHEN 'datacenter_ipv4'      THEN 'datacenter_ipv4'
  WHEN 'datacenter_ipv6'      THEN 'datacenter_ipv6'
  WHEN 'residential'          THEN 'residential'
  WHEN 'mobile'               THEN 'mobile'
  WHEN 'static_residential'   THEN 'static_residential'
  WHEN 'datacenter ipv4'      THEN 'datacenter_ipv4'
  WHEN 'datacenter-ipv4'      THEN 'datacenter_ipv4'
  WHEN 'ipv4'                 THEN 'datacenter_ipv4'
  WHEN 'dc_ipv4'              THEN 'datacenter_ipv4'
  WHEN 'dc4'                  THEN 'datacenter_ipv4'
  WHEN 'datacenter ipv6'      THEN 'datacenter_ipv6'
  WHEN 'datacenter-ipv6'      THEN 'datacenter_ipv6'
  WHEN 'ipv6'                 THEN 'datacenter_ipv6'
  WHEN 'dc_ipv6'              THEN 'datacenter_ipv6'
  WHEN 'dc6'                  THEN 'datacenter_ipv6'
  WHEN 'dân cư'               THEN 'residential'
  WHEN 'dan cu'               THEN 'residential'
  WHEN 'resi'                 THEN 'residential'
  WHEN 'res'                  THEN 'residential'
  WHEN '4g'                   THEN 'mobile'
  WHEN '5g'                   THEN 'mobile'
  WHEN '4g/5g'                THEN 'mobile'
  WHEN 'lte'                  THEN 'mobile'
  WHEN 'static residential'   THEN 'static_residential'
  WHEN 'static-residential'   THEN 'static_residential'
  WHEN 'resi tĩnh'            THEN 'static_residential'
  WHEN 'static_resi'          THEN 'static_residential'
  ELSE default_network_type
END
WHERE default_network_type IS NOT NULL
  AND default_network_type NOT IN (
    'isp',
    'datacenter_ipv4',
    'datacenter_ipv6',
    'residential',
    'mobile',
    'static_residential'
  );
