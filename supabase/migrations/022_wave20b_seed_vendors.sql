-- ============================================================
-- 022_wave20b_seed_vendors.sql
-- Wave 20B — Mark the IPRoyal adapter_key deprecated (its ToS
-- explicitly prohibits resale per 2026 research), and seed
-- Infatica + Evomi rows. Both are reseller-friendly GREEN vendors.
--
-- All rows start status='paused'. An admin must add a primary
-- credential via the UI before flipping to 'active'.
-- ============================================================

-- Deprecate any existing vendor row whose adapter_key became invalid
-- after the registry change in src/lib/vendors/registry.ts. Rows are
-- left in place (not deleted) so historical vendor_orders keep their FK.
UPDATE vendors
  SET status     = 'deprecated',
      notes      = COALESCE(notes, '')
                   || E'\n[Wave 20B] Adapter removed: ToS prohibits resale.'
  WHERE adapter_key = 'iproyal' AND status != 'deprecated';

-- Seed Evomi (green reseller, Wave 20B primary adapter).
INSERT INTO vendors
  (slug, display_name, status, base_url, adapter_key,
   default_currency, support_email, rate_limit_rpm, notes)
VALUES
  (
    'evomi',
    'Evomi',
    'paused',
    'https://reseller.evomi.com/v2',
    'evomi',
    'USD',
    'support@evomi.com',
    30,
    'Reseller-friendly. ISP + residential. No idempotency header — adapter uses client_reference for pre-flight dedup. Add primary credential before activating.'
  )
ON CONFLICT (slug) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      base_url     = EXCLUDED.base_url,
      adapter_key  = EXCLUDED.adapter_key;

-- Seed Infatica placeholder (Wave 20E adapter). Kept paused; adapter
-- implementation deferred until after a live API spike in Wave 20E.
INSERT INTO vendors
  (slug, display_name, status, base_url, adapter_key,
   default_currency, support_email, rate_limit_rpm, notes)
VALUES
  (
    'infatica',
    'Infatica',
    'paused',
    'https://dashboard.infatica.io/includes/api/reseller',
    'webshare',           -- temporary until Wave 20E Infatica adapter ships
    'USD',
    'support@infatica.io',
    30,
    'Placeholder row. Infatica adapter is a Wave 20E deliverable pending live API spike; adapter_key is set to a safe stub to keep the vendors row valid.'
  )
ON CONFLICT (slug) DO NOTHING;
