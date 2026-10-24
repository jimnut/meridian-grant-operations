import crypto from 'node:crypto';
import type { Request, Response } from 'express';

import { config } from '../config';
import type { Db } from '../db/connection';
import { secureMeasurementCookie } from './measurement-cookie';

export const LEAD_FORM_COOKIE = 'grantconsole_lead_form';
export const LEAD_FORM_TTL_MS = 2 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function hash(purpose: string, value: string): string {
  return crypto.createHmac('sha256', config.sessionSecret).update(`${purpose}:${value}`).digest('hex');
}

/** Stateless issuance: fetching forms cannot fill the database with unused tokens. */
export function protectLeadForm(html: string, req: Request, res: Response, now = Date.now()): string {
  const existing = req.cookies?.[LEAD_FORM_COOKIE];
  const browser = typeof existing === 'string' && /^[a-f0-9]{64}$/.test(existing)
    ? existing : crypto.randomBytes(32).toString('hex');
  const payload = `${now}.${crypto.randomBytes(24).toString('hex')}`;
  const token = `${payload}.${hash('lead-form', `${payload}:${browser}`)}`;
  res.cookie(LEAD_FORM_COOKIE, browser, {
    httpOnly: true, secure: secureMeasurementCookie(req), sameSite: 'strict', path: '/', maxAge: LEAD_FORM_TTL_MS,
  });
  // The cached page template is safe to reuse; the response containing a token is not.
  res.setHeader('Cache-Control', 'private, no-store');
  return html.replace('action="/api/public/leads">', `action="/api/public/leads"><input type="hidden" name="formToken" value="${token}" />`);
}

/** Returns a hash for atomic consumption only after signature, browser and age checks. */
export function verifiedLeadToken(req: Request, token: unknown, now = Date.now()): string | null {
  if (req.get('sec-fetch-site') === 'cross-site') return null;
  const browser = req.cookies?.[LEAD_FORM_COOKIE];
  if (typeof browser !== 'string' || !/^[a-f0-9]{64}$/.test(browser) || typeof token !== 'string') return null;
  const match = /^(\d{13})\.([a-f0-9]{48})\.([a-f0-9]{64})$/.exec(token);
  if (!match) return null;
  const age = now - Number(match[1]);
  if (age < 0 || age >= LEAD_FORM_TTL_MS) return null;
  const expected = hash('lead-form', `${match[1]}.${match[2]}:${browser}`);
  if (!crypto.timingSafeEqual(Buffer.from(match[3]!, 'hex'), Buffer.from(expected, 'hex'))) return null;
  return hash('lead-token', token);
}

/** Must run inside the same IMMEDIATE transaction as the lead and mail reservation. */
export function consumeLeadToken(db: Db, tokenHash: string, now: number): boolean {
  db.prepare('DELETE FROM lead_form_uses WHERE used_at <= ?').run(now - LEAD_FORM_TTL_MS);
  return db.prepare('INSERT OR IGNORE INTO lead_form_uses (token_hash, used_at) VALUES (?, ?)').run(tokenHash, now).changes === 1;
}

/** Reserve before sending. Failed or ambiguous sends still consume the budget. */
export function reserveLeadNotification(db: Db, input: { id: string; email: string; ip: string }, now: number): string | null {
  db.prepare('DELETE FROM lead_mail_attempts WHERE attempted_at <= ?').run(now - DAY);
  const email = hash('lead-email', input.email.toLowerCase().trim());
  const ip = hash('lead-ip', input.ip);
  const counts = db.prepare(`SELECT
    COUNT(*) AS daily,
    COUNT(CASE WHEN attempted_at > @hour THEN 1 END) AS hourly,
    COUNT(CASE WHEN email_hash = @email THEN 1 END) AS emailDaily,
    COUNT(CASE WHEN email_hash = @email AND attempted_at > @hour THEN 1 END) AS emailHourly,
    COUNT(CASE WHEN ip_hash = @ip AND attempted_at > @hour THEN 1 END) AS ipHourly
    FROM lead_mail_attempts`).get({ hour: now - HOUR, email, ip }) as {
      daily: number; hourly: number; emailDaily: number; emailHourly: number; ipHourly: number;
    };
  if (counts.daily >= 15 || counts.hourly >= 5) return 'notification_global_limit';
  if (counts.emailDaily >= 4 || counts.emailHourly >= 2) return 'notification_sender_limit';
  if (counts.ipHourly >= 3) return 'notification_connection_limit';
  db.prepare('INSERT INTO lead_mail_attempts (lead_id, email_hash, ip_hash, attempted_at) VALUES (?, ?, ?, ?)')
    .run(input.id, email, ip, now);
  return null;
}
