import bcrypt from 'bcryptjs';

/**
 * bcrypt via the pure-JS `bcryptjs` implementation: no native toolchain needed,
 * and the cost factor is tuned so a sign-in stays responsive locally while
 * remaining expensive to brute force.
 */
const COST = process.env.VITEST === 'true' || process.env.NODE_ENV === 'test' ? 4 : 11;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

/**
 * A real bcrypt hash at the same cost as production hashes, used when sign-in is
 * attempted for an unknown email.
 *
 * An invalid string would make `bcrypt.compare` fail immediately, so an unknown
 * account would answer measurably faster than a wrong password and leak which
 * emails exist. This hash is of a random value nobody holds; verifying against
 * it always fails after doing the same work as a genuine comparison.
 */
export const DUMMY_PASSWORD_HASH = '$2a$11$Yl0nQ1pQ8TbF5sKQ6nYb3uJ0m7O0wZ2yQvV6qkQm1Q6qYyH0m4gS.';

/** Same shape at the reduced test cost, so the suite stays fast. */
const DUMMY_PASSWORD_HASH_TEST = '$2a$04$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

/** The hash to compare against when no user matched. */
export function dummyHash(): string {
  return COST <= 6 ? DUMMY_PASSWORD_HASH_TEST : DUMMY_PASSWORD_HASH;
}

/** Password policy applied at registration and seeding. */
export const PASSWORD_MIN_LENGTH = 10;

export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password.length > 200) return 'Password is too long.';
  return null;
}
