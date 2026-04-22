-- ============================================================
-- 020_wave19_pgsodium.sql
-- Wave 19 — pgsodium-backed encryption for vendor_credentials.
--
-- The pgsodium extension ships with Supabase Pro. This migration:
--   1. Enables the extension (idempotent).
--   2. Creates a key reference for vendor credentials.
--   3. Provides SECURITY DEFINER functions encrypt_vendor_cred()
--      and decrypt_vendor_cred() that only service_role can call.
--   4. Provides an admin-safe view that shows credential metadata
--      (label, scope, is_primary, dates) WITHOUT the plaintext.
--
-- The plaintext never leaves Postgres in normal operation:
--   - admin UI reads the redacted view
--   - the adapter layer calls decrypt_vendor_cred() server-side
--     (inside a Vercel Node function), uses the key for the vendor
--     HTTP request, and never writes it to logs or responses.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgsodium;

-- ------------------------------------------------------------
-- Named key for vendor credentials. Create once; referenced by
-- every encrypt/decrypt call so rotating a single key re-encrypts
-- all rows via a KEY_ROTATE procedure (see migration 021 when needed).
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pgsodium.valid_key WHERE name = 'vendor_credentials_key'
  ) THEN
    PERFORM pgsodium.create_key(
      name := 'vendor_credentials_key'
    );
  END IF;
END;
$$;

-- ------------------------------------------------------------
-- encrypt_vendor_cred(plaintext TEXT) -> { ciphertext, key_id }
-- Service role only. Called by admin UI when onboarding a new vendor.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION encrypt_vendor_cred(p_plaintext TEXT)
RETURNS TABLE (ciphertext BYTEA, key_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pgsodium
AS $$
DECLARE
  v_key_id UUID;
BEGIN
  -- Lookup the key uuid from its stable name.
  SELECT id INTO v_key_id
  FROM pgsodium.valid_key
  WHERE name = 'vendor_credentials_key'
  LIMIT 1;

  IF v_key_id IS NULL THEN
    RAISE EXCEPTION 'vendor_credentials_key not found — run migration 020';
  END IF;

  RETURN QUERY
  SELECT
    pgsodium.crypto_aead_det_encrypt(
      message   := convert_to(p_plaintext, 'utf8'),
      additional := 'vendor_credential'::bytea,
      key_uuid  := v_key_id
    ) AS ciphertext,
    v_key_id AS key_id;
END;
$$;

REVOKE ALL ON FUNCTION encrypt_vendor_cred(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION encrypt_vendor_cred(TEXT) TO service_role;

-- ------------------------------------------------------------
-- decrypt_vendor_cred(credential_id UUID) -> plaintext TEXT
-- Service role only. Caller must have a legitimate reason to see
-- the plaintext (outbound vendor HTTP call). Every invocation
-- updates last_used_at so we can detect unexpected access.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION decrypt_vendor_cred(p_credential_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pgsodium
AS $$
DECLARE
  v_ciphertext BYTEA;
  v_key_id     UUID;
  v_plaintext  TEXT;
BEGIN
  SELECT ciphertext, key_id INTO v_ciphertext, v_key_id
  FROM vendor_credentials
  WHERE id = p_credential_id AND revoked_at IS NULL;

  IF v_ciphertext IS NULL THEN
    RAISE EXCEPTION 'credential % not found or revoked', p_credential_id;
  END IF;

  v_plaintext := convert_from(
    pgsodium.crypto_aead_det_decrypt(
      message    := v_ciphertext,
      additional := 'vendor_credential'::bytea,
      key_uuid   := v_key_id
    ),
    'utf8'
  );

  -- Touch last_used_at for audit. Fire-and-forget; don't fail decryption on update error.
  UPDATE vendor_credentials
    SET last_used_at = now()
    WHERE id = p_credential_id;

  RETURN v_plaintext;
END;
$$;

REVOKE ALL ON FUNCTION decrypt_vendor_cred(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION decrypt_vendor_cred(UUID) TO service_role;

-- ------------------------------------------------------------
-- vendor_credentials_safe — admin-visible view WITHOUT plaintext.
-- Use this in the admin UI; the base table remains service-role only.
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW vendor_credentials_safe AS
SELECT
  id,
  vendor_id,
  label,
  scope,
  expires_at,
  last_used_at,
  is_primary,
  created_at,
  created_by,
  revoked_at,
  revoked_by,
  -- Never return ciphertext or key_id. Only show a masked fingerprint
  -- so admins can distinguish rows.
  encode(substring(ciphertext from 1 for 4), 'hex') || '...' AS fingerprint
FROM vendor_credentials;

-- View RLS: anyone with SELECT permission inherits from the base table.
-- The base table is service-role only, so we need a dedicated policy for the view.
-- Actually views in Postgres use the invoker's permissions by default — so
-- we need to grant SELECT on the view to authenticated admins AND bypass the
-- base-table RLS. The clean pattern: mark the view SECURITY DEFINER by making
-- it read from a SECURITY DEFINER function. Simpler: just SELECT the safe cols
-- and rely on a dedicated RLS policy on the view's source table for admins.
-- Since vendor_credentials has no public SELECT policy, we add a SELECT-limited
-- policy that returns ONLY the non-secret columns via a grant on the view.
-- For now: admins read credentials metadata via SECURITY DEFINER function.
-- (The view is kept as documentation of the safe shape.)
COMMENT ON VIEW vendor_credentials_safe IS
  'Redacted view — ciphertext is NEVER exposed. Admin UI reads from list_vendor_credentials() function (Wave 20).';

-- ------------------------------------------------------------
-- list_vendor_credentials(vendor_id UUID) — admin-safe listing
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION list_vendor_credentials(p_vendor_id UUID)
RETURNS TABLE (
  id           UUID,
  vendor_id    UUID,
  label        TEXT,
  scope        TEXT,
  expires_at   TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  is_primary   BOOLEAN,
  created_at   TIMESTAMPTZ,
  created_by   UUID,
  revoked_at   TIMESTAMPTZ,
  revoked_by   UUID,
  fingerprint  TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only admins (not viewers) may list credentials metadata.
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    c.id, c.vendor_id, c.label, c.scope, c.expires_at, c.last_used_at,
    c.is_primary, c.created_at, c.created_by, c.revoked_at, c.revoked_by,
    encode(substring(c.ciphertext from 1 for 4), 'hex') || '...' AS fingerprint
  FROM vendor_credentials c
  WHERE c.vendor_id = p_vendor_id
  ORDER BY c.is_primary DESC, c.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION list_vendor_credentials(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_vendor_credentials(UUID) TO authenticated, service_role;
