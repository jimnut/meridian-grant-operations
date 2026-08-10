import crypto from 'node:crypto';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Short, URL-safe, collision-resistant identifier with a type prefix so IDs are
 * self-describing in logs and activity metadata (e.g. `gr_8f2k...`).
 */
export function newId(prefix: string, size = 16): string {
  const bytes = crypto.randomBytes(size);
  let out = '';
  for (let i = 0; i < size; i += 1) {
    out += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return `${prefix}_${out}`;
}

/** High-entropy opaque token for session ids and CSRF tokens. */
export function newToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

/**
 * Deterministic ID used by the seeder so re-running it updates the same rows
 * instead of creating duplicates.
 */
export function seedId(prefix: string, ...parts: string[]): string {
  const hash = crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16);
  return `${prefix}_${hash}`;
}

/** Constant-time string comparison for tokens. */
export function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
