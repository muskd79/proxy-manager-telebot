/**
 * UUIDv7 generator — time-ordered UUIDs.
 *
 * Why v7 (not v4) for `vendor_orders.idempotency_key`:
 * - Lexicographically sortable by creation time
 * - Hot-path B-tree inserts stay clustered, not random
 * - 48-bit unix-ms prefix means we can extract issuance time for forensics
 *   without joining `created_at`
 *
 * Format (RFC 9562):
 *   |unix_ms (48b)|ver(4b)|rand_a(12b)|var(2b)|rand_b(62b)|
 *
 * Implementation note: tsconfig targets ES2017 so we avoid BigInt literals.
 * unix_ms fits in 48 bits which is safely below JS Number's 2^53 precision
 * cap until year +275760, so plain Math.floor + Math.pow are fine here.
 */

import { randomBytes } from "crypto";

const TWO32 = 0x100000000;

export function uuidv7(): string {
  const ms = Date.now();
  const rand = randomBytes(10);

  // Split 48-bit ms into high-16 + low-32 (multiplications are exact for ms).
  const msHigh = Math.floor(ms / TWO32) & 0xffff;
  const msLow = (ms % TWO32) >>> 0;

  const bytes = new Uint8Array(16);
  bytes[0] = (msHigh >>> 8) & 0xff;
  bytes[1] = msHigh & 0xff;
  bytes[2] = (msLow >>> 24) & 0xff;
  bytes[3] = (msLow >>> 16) & 0xff;
  bytes[4] = (msLow >>> 8) & 0xff;
  bytes[5] = msLow & 0xff;

  // byte 6: top nibble = version 7, low nibble = top 4 bits of rand_a
  bytes[6] = (0x70 | (rand[0] & 0x0f)) & 0xff;
  // byte 7: bottom 8 bits of rand_a
  bytes[7] = rand[1];

  // byte 8: top 2 bits = variant 0b10, bottom 6 bits = top of rand_b
  bytes[8] = (0x80 | (rand[2] & 0x3f)) & 0xff;
  bytes[9] = rand[3];
  bytes[10] = rand[4];
  bytes[11] = rand[5];
  bytes[12] = rand[6];
  bytes[13] = rand[7];
  bytes[14] = rand[8];
  bytes[15] = rand[9];

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return (
    hex.slice(0, 8) +
    "-" +
    hex.slice(8, 12) +
    "-" +
    hex.slice(12, 16) +
    "-" +
    hex.slice(16, 20) +
    "-" +
    hex.slice(20, 32)
  );
}

const UUID_V7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuidV7(s: string): boolean {
  return typeof s === "string" && UUID_V7_RE.test(s);
}
