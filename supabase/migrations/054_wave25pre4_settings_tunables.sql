-- ============================================================
-- 054_wave25pre4_settings_tunables.sql
-- Wave 25-pre4 (Pass 7.2) — bot order-mode tunables in DB.
--
-- Pre-fix three thresholds were hardcoded in code:
--   - bulk-proxy.ts:14            BULK_AUTO_THRESHOLD = 5
--   - custom-order.ts:24          QUICK_MAX = 10
--   - custom-order.ts:24          CUSTOM_MAX = 100
-- Admin had to deploy a new build to tune any of them.
--
-- Now they live in the settings table next to global_max_proxies
-- and default_approval_mode. The bot reads via loadGlobalCaps in
-- rate-limit.ts (extended in commit 6) and falls back to the same
-- defaults when the key is missing — so this migration alone is
-- non-breaking; the code rollover happens in commit 6.
--
-- Tracked in docs/decision-log.md (was the open
-- "tunables in code, not in settings" maintainability crack).
-- ============================================================

INSERT INTO settings (key, value, description) VALUES
  (
    'quick_order_max',
    '{"value":10}'::jsonb,
    'Wave 25-pre4 — Max quantity per Order nhanh request. Pre-fix hardcoded at 10 in custom-order.ts.'
  ),
  (
    'custom_order_max',
    '{"value":100}'::jsonb,
    'Wave 25-pre4 — Max quantity per Order riêng request. Pre-fix hardcoded at 100 in custom-order.ts.'
  ),
  (
    'bulk_auto_threshold',
    '{"value":5}'::jsonb,
    'Wave 25-pre4 — Above this quantity, force admin approval even when user.approval_mode = "auto". Pre-fix hardcoded at 5 in bulk-proxy.ts.'
  )
ON CONFLICT (key) DO NOTHING;
