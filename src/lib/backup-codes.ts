import { randomBytes, createHash } from "crypto";

/**
 * Wave 22F-B — 2FA backup codes utility.
 *
 * 8 codes generated at 2FA-verify time. Each:
 *   - 12 base32 chars (no 0/O/1/I to avoid confusion) — 60 bits entropy
 *   - Formatted xxxx-xxxx-xxxx for readable display
 *   - Stored hashed with a per-code random salt: sha256(salt || code)
 *   - Plain text shown to the user ONCE in the verify response
 *
 * Per-code salt (vs single per-admin salt) costs ~8x more hash ops at
 * verify time (still microseconds — 60 bits entropy means a brute-force
 * attempt is 10^15 attempts; we don't need argon2). The benefit is
 * that a single leaked code-hash row doesn't help an attacker confirm
 * other codes from the same admin.
 *
 * Codes are single-use: `used_at` is set on consumption.
 *
 * Storage uses sha256 not bcrypt/argon because:
 *   - Codes are high-entropy random (60 bits) — brute-force isn't the
 *     threat model.
 *   - We verify against ALL active codes per attempt (up to 8 hashes).
 *     A slow hash would make this noticeably slow.
 */

// 32-char base32-like alphabet, no 0/O/1/I/L (visually ambiguous).
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/**
 * Generate one 12-char code, formatted xxxx-xxxx-xxxx.
 * 12 chars × 5 bits = 60 bits entropy.
 */
function generateOne(): string {
  const bytes = randomBytes(12);
  let code = "";
  for (let i = 0; i < 12; i++) {
    code += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}`;
}

/**
 * Generate the standard 8 codes per admin.
 * Returns plaintext + the per-code salt + hash for DB storage.
 */
export interface BackupCodeRow {
  /** Plain text — shown ONCE in the API response. */
  code: string;
  /** Hex-encoded random salt, stored alongside code_hash. */
  salt: string;
  /** Hex-encoded sha256(salt || code), stored as code_hash. */
  code_hash: string;
}

export function generateBackupCodes(count = 8): BackupCodeRow[] {
  const out: BackupCodeRow[] = [];
  for (let i = 0; i < count; i++) {
    const code = generateOne();
    const salt = randomBytes(16).toString("hex");
    const code_hash = createHash("sha256")
      .update(salt + code)
      .digest("hex");
    out.push({ code, salt, code_hash });
  }
  return out;
}

/**
 * Verify a user-supplied backup code against ONE stored row.
 * Returns true if the hash matches (constant-time comparison).
 */
export function verifyBackupCode(
  candidate: string,
  storedSalt: string,
  storedHash: string,
): boolean {
  const computed = createHash("sha256")
    .update(storedSalt + candidate.trim())
    .digest("hex");
  // Length-check first (sha256 is always 64 hex chars; defensive).
  if (computed.length !== storedHash.length) return false;
  // Constant-time compare to prevent timing oracle on the hex string.
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ storedHash.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Normalise user input. Backup codes are case-insensitive and
 * tolerate spaces or dashes anywhere. We strip all non-alphabet
 * chars and uppercase.
 */
export function normaliseBackupInput(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z2-9]/g, "");
}
