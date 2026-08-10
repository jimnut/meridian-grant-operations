import { Router } from 'express';

import { isDemoMode } from '../config';
import { dummyHash, verifyPassword } from '../auth/password';
import {
  clearSessionCookie,
  createSession,
  destroySession,
  purgeExpiredSessions,
  resolveSession,
  setSessionCookie,
} from '../auth/session';
import { currentSession, requireAuth } from '../auth/middleware';
import { ApiError, unauthenticated } from '../lib/errors';
import { handler, parseBody } from '../lib/http';
import { signInSchema, switchOrgSchema } from '../lib/validation';
import { logActivity } from '../lib/activity';
import { ROLE_CAPABILITIES } from '../../shared/permissions';
import { todayInTimezone } from '../../shared/dates';
import type { CurrencyCode, Role } from '../../shared/constants';
import type { SessionPayload } from '../../shared/types';
import { DEMO_PASSWORD } from '../db/demo-accounts';

const router = Router();

/** Small in-memory throttle so the demo cannot be brute forced from a script. */
const attempts = new Map<string, { count: number; firstAt: number }>();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 12;

function throttle(key: string): void {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now - entry.firstAt > WINDOW_MS) {
    attempts.set(key, { count: 1, firstAt: now });
    return;
  }
  entry.count += 1;
  if (entry.count > MAX_ATTEMPTS) {
    throw new ApiError('RATE_LIMITED', 'Too many sign-in attempts. Wait a few minutes and try again.');
  }
}

function clearThrottle(key: string): void {
  attempts.delete(key);
}

export function buildSessionPayload(req: Parameters<typeof currentSession>[0]): SessionPayload {
  const session = currentSession(req);
  const memberships = req.db
    .prepare(
      `SELECT m.org_id AS organizationId, o.name AS organizationName, m.role AS role
         FROM memberships m JOIN organizations o ON o.id = m.org_id
        WHERE m.user_id = ? ORDER BY o.name`,
    )
    .all(session.userId) as Array<{ organizationId: string; organizationName: string; role: Role }>;

  return {
    user: { id: session.userId, name: session.userName, email: session.userEmail },
    organization: {
      id: session.orgId,
      name: session.orgName,
      slug: session.orgSlug,
      timezone: session.timezone,
      currency: session.currency as CurrencyCode,
      fiscalYearStartMonth: session.fiscalYearStartMonth,
    },
    role: session.role,
    capabilities: [...ROLE_CAPABILITIES[session.role]],
    csrfToken: session.csrfToken,
    today: todayInTimezone(session.timezone),
    memberships,
  };
}

router.post(
  '/sign-in',
  handler(async (req, res) => {
    const { email, password } = parseBody(signInSchema, req.body);
    const key = `${req.ip ?? 'local'}:${email}`;
    throttle(key);

    const user = req.db
      .prepare('SELECT id, name, email, password_hash AS passwordHash, is_active AS isActive FROM users WHERE email = ?')
      .get(email) as { id: string; name: string; email: string; passwordHash: string; isActive: number } | undefined;

    // Same message and comparable work whether the account exists or not: the
    // fallback is a real hash at the same cost, so an unknown email cannot be
    // distinguished by how quickly it fails.
    const hash = user?.passwordHash ?? dummyHash();
    const ok = await verifyPassword(password, hash);
    if (!user || !ok || !user.isActive) {
      throw unauthenticated('That email and password combination is not recognised.');
    }

    // Land in the organization where the user carries the most authority, so a
    // board member with a viewer seat elsewhere still starts in their own workspace.
    const membership = req.db
      .prepare(
        `SELECT m.org_id AS orgId FROM memberships m
           JOIN organizations o ON o.id = m.org_id
          WHERE m.user_id = ?
          ORDER BY CASE m.role WHEN 'OWNER' THEN 0 WHEN 'MANAGER' THEN 1 WHEN 'MEMBER' THEN 2 ELSE 3 END, o.name
          LIMIT 1`,
      )
      .get(user.id) as { orgId: string } | undefined;
    if (!membership) {
      throw unauthenticated('This account is not a member of any organization.');
    }

    clearThrottle(key);
    purgeExpiredSessions(req.db);
    const session = createSession(req.db, user.id, membership.orgId);
    setSessionCookie(res, session.id);

    const resolved = resolveSession(req.db, session.id);
    if (!resolved) throw unauthenticated('Could not start a session. Try again.');
    req.session = resolved;

    logActivity(req.db, {
      orgId: membership.orgId,
      actorUserId: user.id,
      entityType: 'MEMBERSHIP',
      entityId: user.id,
      action: 'SIGNED_IN',
      summary: `${user.name} signed in`,
    });

    res.json(buildSessionPayload(req));
  }),
);

router.post(
  '/sign-out',
  handler((req, res) => {
    if (req.session) destroySession(req.db, req.session.id);
    clearSessionCookie(res);
    res.status(204).end();
  }),
);

router.get(
  '/session',
  handler((req, res) => {
    if (!req.session) {
      res.status(401).json({ error: { message: 'Not signed in.', code: 'UNAUTHENTICATED' } });
      return;
    }
    res.json(buildSessionPayload(req));
  }),
);

/** Switch the active organization for users who belong to more than one. */
router.post(
  '/switch-organization',
  requireAuth,
  handler((req, res) => {
    const session = currentSession(req);
    const { organizationId } = parseBody(switchOrgSchema, req.body);

    const membership = req.db
      .prepare('SELECT role FROM memberships WHERE user_id = ? AND org_id = ?')
      .get(session.userId, organizationId) as { role: Role } | undefined;
    if (!membership) {
      throw new ApiError('NOT_FOUND', 'Organization not found.');
    }

    destroySession(req.db, session.id);
    const next = createSession(req.db, session.userId, organizationId);
    setSessionCookie(res, next.id);

    const resolved = resolveSession(req.db, next.id);
    if (!resolved) throw new ApiError('NOT_FOUND', 'Organization not found.');
    req.session = resolved;

    res.json(buildSessionPayload(req));
  }),
);

/**
 * Demo shortcuts for the sign-in screen.
 *
 * Gated on an explicit `DEMO_MODE=true`, never inferred from NODE_ENV: a staging
 * or self-hosted deployment is "not production" and must still not advertise
 * account names and a shared password.
 */
router.get(
  '/demo-accounts',
  handler((req, res) => {
    if (!isDemoMode()) {
      res.status(404).json({ error: { message: 'Not available.', code: 'NOT_FOUND' } });
      return;
    }
    const rows = req.db
      .prepare(
        `SELECT u.name, u.email, u.title, m.role, o.name AS organizationName, o.slug AS organizationSlug
           FROM users u
           JOIN memberships m ON m.user_id = u.id
           JOIN organizations o ON o.id = m.org_id
          WHERE u.is_active = 1
          ORDER BY (SELECT COUNT(*) FROM grants g WHERE g.org_id = o.id) DESC,
                   o.name,
                   CASE m.role WHEN 'OWNER' THEN 0 WHEN 'MANAGER' THEN 1 WHEN 'MEMBER' THEN 2 ELSE 3 END,
                   u.name`,
      )
      .all() as Array<{
      name: string;
      email: string;
      title: string | null;
      role: Role;
      organizationName: string;
      organizationSlug: string;
    }>;
    res.json({ password: DEMO_PASSWORD, accounts: rows });
  }),
);

export default router;
