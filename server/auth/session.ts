import crypto from 'node:crypto';
import type { Response } from 'express';

import { config } from '../config';
import type { Db } from '../db/connection';
import { newToken } from '../lib/ids';
import type { Role } from '../../shared/constants';

export interface SessionRecord {
  id: string;
  userId: string;
  orgId: string;
  csrfToken: string;
  expiresAt: string;
}

export interface ResolvedSession extends SessionRecord {
  role: Role;
  userName: string;
  userEmail: string;
  orgName: string;
  orgSlug: string;
  timezone: string;
  currency: string;
  fiscalYearStartMonth: number;
}

/**
 * The cookie carries `<sessionId>.<hmac>`. The HMAC means a stolen or guessed
 * session id alone is not usable, and it lets us reject tampered cookies before
 * touching the database.
 */
function sign(sessionId: string): string {
  return crypto.createHmac('sha256', config.sessionSecret).update(sessionId).digest('base64url');
}

export function encodeCookie(sessionId: string): string {
  return `${sessionId}.${sign(sessionId)}`;
}

export function decodeCookie(raw: string | undefined): string | null {
  if (!raw) return null;
  const index = raw.lastIndexOf('.');
  if (index <= 0) return null;
  const id = raw.slice(0, index);
  const signature = raw.slice(index + 1);
  const expected = sign(id);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return id;
}

export function createSession(db: Db, userId: string, orgId: string): SessionRecord {
  const id = newToken(24);
  const csrfToken = newToken(24);
  const now = new Date();
  const expires = new Date(now.getTime() + config.sessionTtlHours * 3600_000);
  db.prepare(
    `INSERT INTO sessions (id, user_id, org_id, csrf_token, created_at, expires_at)
     VALUES (@id, @userId, @orgId, @csrfToken, @createdAt, @expiresAt)`,
  ).run({
    id,
    userId,
    orgId,
    csrfToken,
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
  });
  return { id, userId, orgId, csrfToken, expiresAt: expires.toISOString() };
}

export function resolveSession(db: Db, sessionId: string): ResolvedSession | null {
  const row = db
    .prepare(
      `SELECT s.id, s.user_id AS userId, s.org_id AS orgId, s.csrf_token AS csrfToken, s.expires_at AS expiresAt,
              m.role AS role, u.name AS userName, u.email AS userEmail, u.is_active AS isActive,
              o.name AS orgName, o.slug AS orgSlug, o.timezone AS timezone, o.currency AS currency,
              o.fiscal_year_start_month AS fiscalYearStartMonth
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         JOIN organizations o ON o.id = s.org_id
         JOIN memberships m ON m.user_id = s.user_id AND m.org_id = s.org_id
        WHERE s.id = ?`,
    )
    .get(sessionId) as
    | (SessionRecord & {
        role: Role;
        userName: string;
        userEmail: string;
        isActive: number;
        orgName: string;
        orgSlug: string;
        timezone: string;
        currency: string;
        fiscalYearStartMonth: number;
      })
    | undefined;

  if (!row) return null;
  if (!row.isActive) return null;
  if (new Date(row.expiresAt).getTime() <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    return null;
  }
  const { isActive: _isActive, ...rest } = row;
  return rest;
}

export function destroySession(db: Db, sessionId: string): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

export function destroyUserSessions(db: Db, userId: string): void {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export function purgeExpiredSessions(db: Db): void {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString());
}

export function setSessionCookie(res: Response, sessionId: string): void {
  res.cookie(config.sessionCookieName, encodeCookie(sessionId), {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    path: '/',
    maxAge: config.sessionTtlHours * 3600_000,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(config.sessionCookieName, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    path: '/',
  });
}
