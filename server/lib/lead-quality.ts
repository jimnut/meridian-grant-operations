import crypto from 'node:crypto';
import type { Response } from 'express';

import { config } from '../config';
import type { Db } from '../db/connection';
import { secureMeasurementCookie } from './measurement-cookie';

export const LEAD_RECEIPT_COOKIE = 'grantconsole_lead_receipt';
const RECEIPT_TTL_MS = 15 * 60 * 1000;
export const LEAD_DUPLICATE_MS = 24 * 60 * 60 * 1000;
export const LEAD_QUALITY_STATUSES = ['unreviewed', 'flagged', 'qualified', 'spam', 'internal_test'] as const;

export function leadFingerprint(input: { email: string; message: string | null; source: string }): string {
  return crypto.createHmac('sha256', config.sessionSecret)
    .update(JSON.stringify([input.email.toLowerCase().trim(), (input.message ?? '').replace(/\s+/g, ' ').trim(), input.source]))
    .digest('hex');
}

/** A narrow triage signal, never a name/domain-based rejection of a real person. */
export function leadFlag(input: { name: string | null; organization: string | null; message: string | null }): string | null {
  const repeated = input.name?.trim();
  const opaque = (value: string) => /^[A-Z0-9]{16,80}$/.test(value) && (value.match(/\d/g)?.length ?? 0) >= 5;
  if (repeated && repeated === input.organization?.trim() && opaque(repeated) && input.message && opaque(input.message.trim())) {
    return 'repeated_opaque_fields';
  }
  return null;
}

function receiptHash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function issueLeadReceipt(db: Db, id: string, res: Response, now = new Date()): void {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('UPDATE leads SET receipt_hash = ?, receipt_expires_at = ? WHERE id = ?')
    .run(receiptHash(token), new Date(now.getTime() + RECEIPT_TTL_MS).toISOString(), id);
  res.cookie(LEAD_RECEIPT_COOKIE, token, {
    httpOnly: true, secure: secureMeasurementCookie(res.req), sameSite: 'lax', path: '/contact/thanks', maxAge: RECEIPT_TTL_MS,
  });
}

export function clearLeadReceipt(res: Response): void {
  res.clearCookie(LEAD_RECEIPT_COOKIE, { httpOnly: true, secure: secureMeasurementCookie(res.req), sameSite: 'lax', path: '/contact/thanks' });
}

/** Atomic consumption makes direct visits, refreshes and replayed cookies inert. */
export function consumeLeadReceipt(db: Db, token: unknown, now = new Date()): boolean {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return false;
  return db.prepare(`UPDATE leads SET receipt_consumed_at = ?, receipt_hash = NULL
    WHERE receipt_hash = ? AND receipt_consumed_at IS NULL AND receipt_expires_at > ?
      AND quality_status IN ('unreviewed', 'qualified')`)
    .run(now.toISOString(), receiptHash(token), now.toISOString()).changes === 1;
}
