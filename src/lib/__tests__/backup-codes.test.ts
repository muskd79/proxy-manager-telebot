import { describe, it, expect } from "vitest";
import {
  generateBackupCodes,
  verifyBackupCode,
  normaliseBackupInput,
} from "@/lib/backup-codes";

/**
 * Wave 22F-B regression tests for the backup-codes utility.
 *
 * Codes:
 *   - 12 base32-like chars, formatted xxxx-xxxx-xxxx
 *   - Per-code random salt
 *   - sha256(salt + code) hash
 *   - Single-use (caller is responsible for marking used_at)
 *   - 60 bits entropy → brute-force cost is high enough that sha256
 *     (without bcrypt-style work factor) is fine
 */

describe("generateBackupCodes — Wave 22F-B", () => {
  it("generates 8 codes by default", () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(8);
  });

  it("respects custom count", () => {
    expect(generateBackupCodes(3)).toHaveLength(3);
    expect(generateBackupCodes(16)).toHaveLength(16);
  });

  it("each code is xxxx-xxxx-xxxx format", () => {
    const codes = generateBackupCodes();
    for (const c of codes) {
      expect(c.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    }
  });

  it("excludes ambiguous chars (0, O, 1, I, L)", () => {
    // Generate many codes; verify the alphabet exclusion holds.
    for (let i = 0; i < 50; i++) {
      const codes = generateBackupCodes(8);
      for (const c of codes) {
        expect(c.code).not.toMatch(/[01ILO]/);
      }
    }
  });

  it("each code has a unique salt", () => {
    const codes = generateBackupCodes(8);
    const salts = new Set(codes.map((c) => c.salt));
    expect(salts.size).toBe(8);
  });

  it("salt is 32 hex chars (16 bytes)", () => {
    const codes = generateBackupCodes(2);
    for (const c of codes) {
      expect(c.salt).toMatch(/^[0-9a-f]{32}$/);
    }
  });

  it("code_hash is 64 hex chars (sha256)", () => {
    const codes = generateBackupCodes(2);
    for (const c of codes) {
      expect(c.code_hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("codes are unique within a batch", () => {
    // Probabilistic: 60 bits entropy means collision probability is
    // ~10^-15 per pair — running this 50× still won't collide.
    const codes = generateBackupCodes(8);
    const set = new Set(codes.map((c) => c.code));
    expect(set.size).toBe(8);
  });
});

describe("verifyBackupCode — Wave 22F-B", () => {
  it("returns true for the matching code+salt+hash triple", () => {
    const [{ code, salt, code_hash }] = generateBackupCodes(1);
    expect(verifyBackupCode(code, salt, code_hash)).toBe(true);
  });

  it("returns false when code doesn't match", () => {
    const [{ salt, code_hash }] = generateBackupCodes(1);
    expect(verifyBackupCode("WRONG-CODE-1234", salt, code_hash)).toBe(false);
  });

  it("returns false when salt doesn't match (cross-row tampering)", () => {
    const [a, b] = generateBackupCodes(2);
    // Try a's code with b's salt — must fail (proves per-code salt
    // isolation — a leaked code+salt of one row doesn't authenticate
    // against another row's hash).
    expect(verifyBackupCode(a.code, b.salt, a.code_hash)).toBe(false);
  });

  it("trims whitespace before hashing", () => {
    const [{ code, salt, code_hash }] = generateBackupCodes(1);
    expect(verifyBackupCode(`  ${code}  `, salt, code_hash)).toBe(true);
  });
});

describe("normaliseBackupInput — Wave 22F-B", () => {
  it("strips dashes", () => {
    expect(normaliseBackupInput("ABCD-EFGH-2345")).toBe("ABCDEFGH2345");
  });

  it("strips spaces", () => {
    expect(normaliseBackupInput("ABCD EFGH 2345")).toBe("ABCDEFGH2345");
  });

  it("uppercases lowercase input", () => {
    expect(normaliseBackupInput("abcd-efgh-2345")).toBe("ABCDEFGH2345");
  });

  it("strips ambiguous chars from input (defensive)", () => {
    // If a user types '0' or 'O' (ambiguous) we strip — these
    // can never appear in a real code, so anything not in the
    // alphabet is noise.
    expect(normaliseBackupInput("ABCD-0000-2345")).toBe("ABCD2345");
  });
});
