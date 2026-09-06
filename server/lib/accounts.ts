/**
 * Account, workspace, invitation and password-reset primitives shared by the
 * auth, team and admin routes. Tokens are random, delivered once, and stored
 * only as SHA-256 hashes, so a database read never yields a usable link.
 */

import crypto from 'node:crypto';
import type { Request, Response } from 'express';

import { config } from '../config';
import type { Db } from '../db/connection';
import { createSession, purgeExpiredSessions, resolveSession, setSessionCookie } from '../auth/session';
import { unauthenticated } from './errors';
import { newId, newToken } from './ids';
import { logActivity } from './activity';
import type { Role } from '../../shared/constants';

export const INVITE_TTL_DAYS = 14;
export const RESET_TTL_MINUTES = 60;

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function slugify(value: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'workspace';
}

export function uniqueSlug(db: Db, base: string): string {
  const root = slugify(base);
  let candidate = root;
  let attempt = 1;
  while (db.prepare('SELECT 1 AS ok FROM organizations WHERE slug = ?').get(candidate)) {
    attempt += 1;
    candidate = `${root}-${attempt}`;
    if (attempt > 500) {
      candidate = `${root}-${newToken(4).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6)}`;
    }
  }
  return candidate;
}

export interface CreateWorkspaceInput {
  name: string;
  email: string;
  passwordHash: string;
  title?: string | null;
  organizationName: string;
  timezone?: string;
  currency?: string;
  fiscalYearStartMonth?: number;
  now?: Date;
}

/** Creates a user, an organization on trial and the owner membership, atomically. */
export function createWorkspace(db: Db, input: CreateWorkspaceInput): { orgId: string; userId: string; slug: string } {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const trialEnds = new Date(now.getTime() + config.trialDays * 86_400_000).toISOString();
  const orgId = newId('org');
  const userId = newId('usr');
  const slug = uniqueSlug(db, input.organizationName);

  db.transaction(() => {
    db.prepare(
      `INSERT INTO users (id, name, email, password_hash, title, is_active, last_sign_in_at, created_at)
       VALUES (@id, @name, @email, @passwordHash, @title, 1, @now, @now)`,
    ).run({ id: userId, name: input.name, email: input.email, passwordHash: input.passwordHash, title: input.title ?? null, now: nowIso });

    db.prepare(
      `INSERT INTO organizations (id, name, slug, timezone, currency, fiscal_year_start_month, plan, subscription_status,
          trial_ends_at, billing_email, is_demo, created_at, updated_at)
       VALUES (@id, @name, @slug, @timezone, @currency, @fiscalYearStartMonth, 'trial', 'trialing', @trialEnds, @email, 0, @now, @now)`,
    ).run({
      id: orgId,
      name: input.organizationName,
      slug,
      timezone: input.timezone ?? 'America/New_York',
      currency: input.currency ?? 'USD',
      fiscalYearStartMonth: input.fiscalYearStartMonth ?? 7,
      trialEnds,
      email: input.email,
      now: nowIso,
    });

    db.prepare(
      `INSERT INTO memberships (id, user_id, org_id, role, created_at) VALUES (@id, @userId, @orgId, 'OWNER', @now)`,
    ).run({ id: newId('mem'), userId, orgId, now: nowIso });

    logActivity(
      db,
      {
        orgId,
        actorUserId: userId,
        entityType: 'ORGANIZATION',
        entityId: orgId,
        action: 'CREATED',
        summary: `${input.name} created the workspace and started a ${config.trialDays}-day trial`,
      },
      now,
    );
  })();

  return { orgId, userId, slug };
}

/** Issues a session cookie and populates `req.session` for the rest of the request. */
export function startSession(req: Request, res: Response, userId: string, orgId: string): void {
  purgeExpiredSessions(req.db);
  const session = createSession(req.db, userId, orgId);
  setSessionCookie(res, session.id);
  const resolved = resolveSession(req.db, session.id);
  if (!resolved) throw unauthenticated('Could not start a session. Try again.');
  req.session = resolved;
  req.db.prepare('UPDATE users SET last_sign_in_at = ? WHERE id = ?').run(new Date().toISOString(), userId);
}

/* --------------------------------------------------------- password resets */

export function issuePasswordReset(db: Db, userId: string, now: Date = new Date()): { token: string; expiresAt: string } {
  const token = newToken(32);
  const expiresAt = new Date(now.getTime() + RESET_TTL_MINUTES * 60_000).toISOString();
  db.prepare('DELETE FROM password_resets WHERE user_id = ? AND (used_at IS NOT NULL OR expires_at <= ?)').run(
    userId,
    now.toISOString(),
  );
  db.prepare(
    `INSERT INTO password_resets (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(newId('rst'), userId, hashToken(token), expiresAt, now.toISOString());
  return { token, expiresAt };
}

/** Returns the user id for a live token and burns it; null for unknown, used or expired tokens. */
export function consumePasswordReset(db: Db, token: string, now: Date = new Date()): string | null {
  const row = db
    .prepare('SELECT id, user_id AS userId, expires_at AS expiresAt, used_at AS usedAt FROM password_resets WHERE token_hash = ?')
    .get(hashToken(token)) as { id: string; userId: string; expiresAt: string; usedAt: string | null } | undefined;
  if (!row || row.usedAt || new Date(row.expiresAt).getTime() <= now.getTime()) return null;
  db.prepare('UPDATE password_resets SET used_at = ? WHERE id = ?').run(now.toISOString(), row.id);
  return row.userId;
}

export function resetUrl(token: string): string {
  return `${config.appUrl}/reset-password?token=${encodeURIComponent(token)}`;
}

/* --------------------------------------------------------------- invites */

export interface InviteRow {
  id: string;
  org_id: string;
  email: string | null;
  role: Role;
  created_by: string | null;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
  org_name: string;
  created_by_name: string | null;
}

export function issueInvite(
  db: Db,
  input: { orgId: string; email: string | null; role: Role; createdBy: string; now?: Date },
): { id: string; token: string; expiresAt: string } {
  const now = input.now ?? new Date();
  const token = newToken(32);
  const id = newId('inv');
  const expiresAt = new Date(now.getTime() + INVITE_TTL_DAYS * 86_400_000).toISOString();
  db.prepare(
    `INSERT INTO invites (id, org_id, email, role, token_hash, created_by, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.orgId, input.email, input.role, hashToken(token), input.createdBy, expiresAt, now.toISOString());
  return { id, token, expiresAt };
}

const INVITE_SELECT = `
  SELECT i.id, i.org_id, i.email, i.role, i.created_by, i.expires_at, i.accepted_at, i.revoked_at, i.created_at,
         o.name AS org_name, u.name AS created_by_name
    FROM invites i
    JOIN organizations o ON o.id = i.org_id
    LEFT JOIN users u ON u.id = i.created_by`;

export function findInviteByToken(db: Db, token: string): InviteRow | null {
  return (db.prepare(`${INVITE_SELECT} WHERE i.token_hash = ?`).get(hashToken(token)) as InviteRow | undefined) ?? null;
}

export function findInviteById(db: Db, orgId: string, id: string): InviteRow | null {
  return (db.prepare(`${INVITE_SELECT} WHERE i.org_id = ? AND i.id = ?`).get(orgId, id) as InviteRow | undefined) ?? null;
}

export function listInvites(db: Db, orgId: string, now: Date = new Date()): InviteRow[] {
  return db
    .prepare(`${INVITE_SELECT} WHERE i.org_id = ? AND i.revoked_at IS NULL AND i.accepted_at IS NULL AND i.expires_at > ? ORDER BY i.created_at DESC`)
    .all(orgId, now.toISOString()) as InviteRow[];
}

export function inviteIsLive(invite: InviteRow, now: Date = new Date()): boolean {
  return !invite.accepted_at && !invite.revoked_at && new Date(invite.expires_at).getTime() > now.getTime();
}

export function inviteUrl(token: string): string {
  return `${config.appUrl}/invite/${encodeURIComponent(token)}`;
}
