import crypto from 'node:crypto';
import type { Db } from '../db/connection';
import { config } from '../config';
import { ApiError, forbidden } from '../lib/errors';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const WINDOW = 10 * 60_000;
export const SETUP_TTL = 10 * 60_000;

/** RFC 4648 base32; authenticator seeds never pass through an external QR service. */
export function base32(bytes: Buffer): string {
  let bits = 0; let value = 0; let result = '';
  for (const byte of bytes) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { result += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits) result += ALPHABET[(value << (5 - bits)) & 31];
  return result;
}

function decode32(secret: string): Buffer {
  let bits = 0; let value = 0; const bytes: number[] = [];
  for (const char of secret) {
    const digit = ALPHABET.indexOf(char);
    if (digit < 0) throw new Error('Invalid authenticator seed');
    value = (value << 5) | digit; bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(bytes);
}

/** RFC 4226/6238: HMAC-SHA1, 30-second time step, six digits. */
export function totp(secret: string, step = Math.floor(Date.now() / 30_000), digits = 6): string {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(step));
  const digest = crypto.createHmac('sha1', decode32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % (10 ** digits)).padStart(digits, '0');
}

export function mfaAvailable(): boolean { return /^[a-fA-F0-9]{64}$/.test(config.mfaEncryptionKey); }

function key(): Buffer {
  if (!mfaAvailable()) throw new ApiError('INTERNAL', 'Authenticator service is unavailable. Please contact support.');
  return Buffer.from(config.mfaEncryptionKey, 'hex');
}

export function encryptMfaSecret(secret: string, userId: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(`grantconsole-mfa-v1:${userId}`));
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

function decryptSecret(value: string, userId: string): string {
  const [version, iv, tag, encrypted] = value.split('.');
  if (version !== 'v1' || !iv || !tag || !encrypted) throw new Error('Invalid authenticator storage');
  const cipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  cipher.setAAD(Buffer.from(`grantconsole-mfa-v1:${userId}`)); cipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([cipher.update(Buffer.from(encrypted, 'base64url')), cipher.final()]).toString('utf8');
}

export function mfaEnabled(db: Db, userId: string): boolean {
  return Boolean(db.prepare('SELECT 1 FROM user_mfa WHERE user_id = ? AND enabled_at IS NOT NULL').get(userId));
}

export function checkMfaRate(db: Db, userId: string, now = Date.now()): void {
  const row = db.prepare('SELECT window_started AS start, failures FROM mfa_rate_limits WHERE user_id = ?').get(userId) as
    { start: number; failures: number } | undefined;
  if (row && now - row.start < WINDOW && row.failures >= 5) {
    throw new ApiError('RATE_LIMITED', 'Too many verification attempts. Wait ten minutes and try again.');
  }
}

export function failMfaAttempt(db: Db, userId: string, now = Date.now()): void {
  db.prepare(`INSERT INTO mfa_rate_limits(user_id, window_started, failures) VALUES (?, ?, 1)
    ON CONFLICT(user_id) DO UPDATE SET failures = CASE WHEN window_started <= ? THEN 1 ELSE failures + 1 END,
    window_started = CASE WHEN window_started <= ? THEN excluded.window_started ELSE window_started END`)
    .run(userId, now, now - WINDOW, now - WINDOW);
}

function recoveryHash(userId: string, code: string): string {
  return crypto.createHash('sha256').update(`grantconsole-recovery-v1:${userId}:${code.replace(/[\s-]/g, '').toUpperCase()}`).digest('hex');
}

/** Call inside the same transaction as enabling or replacing recovery codes. */
export function replaceRecoveryCodes(db: Db, userId: string): string[] {
  const codes = Array.from({ length: 10 }, () => crypto.randomBytes(16).toString('hex').toUpperCase());
  db.prepare('DELETE FROM mfa_recovery_codes WHERE user_id = ?').run(userId);
  const insert = db.prepare('INSERT INTO mfa_recovery_codes(user_id, code_hash) VALUES (?, ?)');
  for (const code of codes) insert.run(userId, recoveryHash(userId, code));
  return codes.map((code) => code.match(/.{1,4}/g)!.join('-'));
}

interface MfaRow { encrypted_secret: string; enabled_at: string | null; last_step: number; pending_expires_at: number | null; pending_session_id: string | null }

/** Atomic single-use TOTP or recovery verification; failures survive restarts. */
export function verifyMfa(db: Db, userId: string, code: string, options: { setupSession?: string; allowRecovery?: boolean; now?: number } = {}): boolean {
  const now = options.now ?? Date.now();
  return db.transaction(() => {
    checkMfaRate(db, userId, now);
    const row = db.prepare('SELECT * FROM user_mfa WHERE user_id = ?').get(userId) as MfaRow | undefined;
    if (!row) return false;
    const setup = options.setupSession !== undefined;
    if (setup && (row.enabled_at || row.pending_session_id !== options.setupSession || !row.pending_expires_at || row.pending_expires_at <= now)) {
      failMfaAttempt(db, userId, now); return false;
    }
    if (!setup && !row.enabled_at) return false;
    const normalized = code.replace(/\s/g, '');
    let accepted = false;
    if (/^\d{6}$/.test(normalized)) {
      const secret = decryptSecret(row.encrypted_secret, userId);
      const current = Math.floor(now / 30_000);
      for (const step of [current, current - 1, current + 1]) {
        if (step <= row.last_step) continue;
        if (crypto.timingSafeEqual(Buffer.from(totp(secret, step)), Buffer.from(normalized))) {
          db.prepare('UPDATE user_mfa SET last_step = ? WHERE user_id = ?').run(step, userId);
          accepted = true; break;
        }
      }
    } else if (!setup && options.allowRecovery !== false && /^[a-fA-F0-9\s-]{32,80}$/.test(code)) {
      accepted = db.prepare('DELETE FROM mfa_recovery_codes WHERE user_id = ? AND code_hash = ?').run(userId, recoveryHash(userId, code)).changes === 1;
    }
    if (accepted) db.prepare('DELETE FROM mfa_rate_limits WHERE user_id = ?').run(userId);
    else failMfaAttempt(db, userId, now);
    return accepted;
  }).immediate();
}

export function beginMfaSetup(db: Db, userId: string, sessionId: string): string {
  if (mfaEnabled(db, userId)) throw forbidden('Two-factor authentication is already enabled.');
  const secret = base32(crypto.randomBytes(20));
  db.prepare(`INSERT INTO user_mfa(user_id, encrypted_secret, pending_expires_at, pending_session_id)
    VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET encrypted_secret = excluded.encrypted_secret,
    pending_expires_at = excluded.pending_expires_at, pending_session_id = excluded.pending_session_id, last_step = -1`)
    .run(userId, encryptMfaSecret(secret, userId), Date.now() + SETUP_TTL, sessionId);
  return secret;
}
