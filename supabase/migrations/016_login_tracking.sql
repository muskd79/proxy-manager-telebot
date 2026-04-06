-- Add login tracking columns to admins table
ALTER TABLE admins ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS last_login_ip TEXT;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS login_count INTEGER NOT NULL DEFAULT 0;

-- RPC function to atomically increment login_count
CREATE OR REPLACE FUNCTION increment_login_count(p_email TEXT)
RETURNS VOID AS $$
BEGIN
  UPDATE admins
  SET login_count = login_count + 1
  WHERE email = p_email;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
