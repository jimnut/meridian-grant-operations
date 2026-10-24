import { Router } from 'express';
import { z } from 'zod';
import { beginMfaSetup, checkMfaRate, failMfaAttempt, mfaAvailable, mfaEnabled, replaceRecoveryCodes, verifyMfa } from '../auth/mfa';

import { config, isDemoMode } from '../config';
import { clearAcquisition, readAcquisition } from '../lib/acquisition';
import { dummyHash, hashPassword, passwordProblem, verifyPassword } from '../auth/password';
import { clearSessionCookie, destroySession, destroyUserSessions, resolveSession } from '../auth/session';
import { currentSession, requireAuth } from '../auth/middleware';
import { ApiError, conflict, forbidden, notFound, unauthenticated, validationError } from '../lib/errors';
import { handler, parseBody } from '../lib/http';
import { newId } from '../lib/ids';
import {
  acceptInviteSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  profileSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
  switchOrgSchema,
} from '../lib/validation';
import { logActivity } from '../lib/activity';
import {
  consumePasswordReset,
  createWorkspace,
  findInviteByToken,
  inviteIsLive,
  issuePasswordReset,
  resetUrl,
  startSession,
} from '../lib/accounts';
import { mailerConfigured, renderHtml, sendMail } from '../lib/mailer';
import { assertSeatCapacity, workspaceStatusFor } from '../lib/plans';
import { createThrottle } from '../lib/throttle';
import { ROLE_CAPABILITIES } from '../../shared/permissions';
import { todayInTimezone } from '../../shared/dates';
import { ROLE_LABELS, type CurrencyCode, type Role } from '../../shared/constants';
import type { InvitePreview, SessionPayload } from '../../shared/types';
import { DEMO_PASSWORD } from '../db/demo-accounts';

const router = Router();

const signInThrottle = createThrottle({
  windowMs: 10 * 60 * 1000,
  max: 12,
  message: 'Too many sign-in attempts. Wait a few minutes and try again.',
});
const signUpThrottle = createThrottle({
  windowMs: 60 * 60 * 1000,
  max: 8,
  message: 'Too many workspaces were created from this connection. Try again in an hour.',
});
const resetThrottle = createThrottle({
  windowMs: 60 * 60 * 1000,
  max: 6,
  message: 'Too many reset requests. Wait an hour and try again.',
});
const inviteThrottle = createThrottle({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: 'Too many attempts. Wait a few minutes and try again.',
});

/** Tests reset the in-memory limiters between suites. */
export function resetAuthThrottles(): void {
  signInThrottle.reset();
  signUpThrottle.reset();
  resetThrottle.reset();
  inviteThrottle.reset();
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
    workspace: session.workspace,
  };
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  isActive: number;
}

function findUserByEmail(req: Parameters<typeof currentSession>[0], email: string): UserRow | undefined {
  return req.db
    .prepare('SELECT id, name, email, password_hash AS passwordHash, is_active AS isActive FROM users WHERE email = ?')
    .get(email) as UserRow | undefined;
}

/** The organization a user should land in: highest authority first, then name. */
function primaryOrgFor(req: Parameters<typeof currentSession>[0], userId: string): string | null {
  const membership = req.db
    .prepare(
      `SELECT m.org_id AS orgId FROM memberships m
         JOIN organizations o ON o.id = m.org_id
        WHERE m.user_id = ?
        ORDER BY CASE m.role WHEN 'OWNER' THEN 0 WHEN 'MANAGER' THEN 1 WHEN 'MEMBER' THEN 2 ELSE 3 END, o.name
        LIMIT 1`,
    )
    .get(userId) as { orgId: string } | undefined;
  return membership?.orgId ?? null;
}

/* ----------------------------------------------------------------- sign-in */

router.post(
  '/sign-in',
  handler(async (req, res) => {
    const { email, password, mfaCode } = parseBody(signInSchema, req.body);
    const key = `${req.ip ?? 'local'}:${email}`;
    signInThrottle.hit(key);

    const candidate = findUserByEmail(req, email);

    // Same message and comparable work whether the account exists or not: the
    // fallback is a real hash at the same cost, so an unknown email cannot be
    // distinguished by how quickly it fails.
    const hash = candidate?.passwordHash ?? dummyHash();
    const ok = await verifyPassword(password, hash);
    // Password verification yields. A reset, account removal or deactivation
    // during bcrypt must also invalidate this in-flight sign-in attempt.
    const user = candidate ? findUserByEmail(req, email) : undefined;
    if (!candidate || !user || !ok || !user.isActive || user.id !== candidate.id || user.passwordHash !== hash) {
      throw unauthenticated('That email and password combination is not recognised.');
    }

    const orgId = primaryOrgFor(req, user.id);
    if (!orgId) {
      throw unauthenticated('This account is not a member of any organization.');
    }

    if (mfaEnabled(req.db, user.id)) {
      checkMfaRate(req.db, user.id);
      if (!mfaCode) { res.status(202).json({ mfaRequired: true }); return; }
      if (!verifyMfa(req.db, user.id, mfaCode)) throw unauthenticated('That authenticator or recovery code is not valid.');
    }
    signInThrottle.clear(key);
    startSession(req, res, user.id, orgId, true);

    logActivity(req.db, {
      orgId,
      actorUserId: user.id,
      entityType: 'MEMBERSHIP',
      entityId: user.id,
      action: 'SIGNED_IN',
      summary: `${user.name} signed in`,
    });

    res.json(buildSessionPayload(req));
  }),
);

/* ----------------------------------------------------------------- sign-up */

router.post(
  '/sign-up',
  handler(async (req, res) => {
    if (!config.signupsEnabled) {
      throw forbidden(`Self-serve sign-up is paused. Email ${config.supportEmail} and we will set up your workspace.`);
    }
    const input = parseBody(signUpSchema, req.body);
    // Bots fill the hidden field; answer as if it worked and do nothing.
    if (input.website) {
      res.status(201).json({ ok: true });
      return;
    }
    signUpThrottle.hit(req.ip ?? 'local');

    const problem = passwordProblem(input.password);
    if (problem) throw validationError(problem, { password: problem });

    if (findUserByEmail(req, input.email)) {
      throw conflict('An account with that email already exists. Sign in instead, or reset your password.');
    }

    const passwordHash = await hashPassword(input.password);
    const { orgId, userId } = createWorkspace(req.db, {
      name: input.name,
      email: input.email,
      passwordHash,
      acquisition: readAcquisition(req),
      organizationName: input.organizationName,
      timezone: input.timezone,
      fiscalYearStartMonth: input.fiscalYearStartMonth,
    });

    clearAcquisition(res);
    startSession(req, res, userId, orgId);

    void sendMail({
      to: input.email,
      subject: `Welcome to GrantConsole — your ${config.trialDays}-day trial has started`,
      text: [
        `Hi ${input.name},`,
        '',
        `Your GrantConsole workspace for ${input.organizationName} is ready. For the next ${config.trialDays} days you have every feature on the Growth plan: deadlines, restricted budgets, evidence, risk signals and funder reporting packets.`,
        '',
        'Three things to do first:',
        '1. Add a funder and your first active grant (or import your spreadsheet from Grants → Import).',
        '2. Add each report and its due date as a deliverable so the risk rules can watch it.',
        '3. Subscribe your calendar to the deadline feed in Settings → Calendar.',
        '',
        `Open your workspace: ${config.appUrl}/`,
        '',
        `Reply to this email with any question — a real person reads it.`,
      ].join('\n'),
      html: renderHtml(
        `Welcome to GrantConsole, ${input.name}`,
        [
          `Your workspace for ${input.organizationName} is ready. For the next ${config.trialDays} days you have every feature on the Growth plan: deadlines, restricted budgets, evidence, risk signals and funder reporting packets.`,
          'First: add a funder and your first active grant, or import your spreadsheet from Grants → Import. Then add each funder report and its due date as a deliverable so the risk rules can watch it. Finally, subscribe your calendar to the deadline feed in Settings → Calendar.',
          'Reply to this email with any question — a real person reads it.',
        ],
        { label: 'Open your workspace', url: `${config.appUrl}/` },
      ),
    });

    res.status(201).json(buildSessionPayload(req));
  }),
);

/* ---------------------------------------------------------------- session */

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
    startSession(req, res, session.userId, organizationId, true);
    res.json(buildSessionPayload(req));
  }),
);

/* ------------------------------------------------------------- passwords */

router.post(
  '/forgot-password',
  handler(async (req, res) => {
    const { email } = parseBody(forgotPasswordSchema, req.body);
    resetThrottle.hit(`${req.ip ?? 'local'}:${email}`);

    const user = findUserByEmail(req, email);
    if (user && user.isActive) {
      const { token } = issuePasswordReset(req.db, user.id);
      const url = resetUrl(token);
      const result = await sendMail({
        to: user.email,
        subject: 'Reset your GrantConsole password',
        text: `Hi ${user.name},\n\nUse this link within the next hour to choose a new password:\n${url}\n\nIf you did not ask for a reset, ignore this email — your password stays as it is.`,
        html: renderHtml(
          'Reset your password',
          [`Hi ${user.name}, use the button below within the next hour to choose a new password.`, 'If you did not ask for a reset, ignore this email — your password stays as it is.'],
          { label: 'Choose a new password', url },
        ),
      });
      if (!result.sent && !config.isTest) {
        // Never leak a usable recovery credential into operational logs.
        console.warn('[auth] password reset email was not delivered; no reset token is written to logs.');
      }
    }

    // Identical answer whether or not the account exists.
    res.status(202).json({ ok: true, emailConfigured: mailerConfigured() });
  }),
);

router.post(
  '/reset-password',
  handler(async (req, res) => {
    const { token, password } = parseBody(resetPasswordSchema, req.body);
    const problem = passwordProblem(password);
    if (problem) throw validationError(problem, { password: problem });

    const userId = consumePasswordReset(req.db, token);
    if (!userId) {
      throw new ApiError('NOT_FOUND', 'That reset link is invalid or has expired. Request a new one.');
    }
    const user = req.db.prepare('SELECT id, name, is_active AS isActive FROM users WHERE id = ?').get(userId) as
      | { id: string; name: string; isActive: number }
      | undefined;
    if (!user || !user.isActive) throw notFound('Account');

    const passwordHash = await hashPassword(password);
    req.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, userId);
    // Password reset must not bypass an enrolled second factor.
    destroyUserSessions(req.db, userId);

    const orgId = primaryOrgFor(req, userId);
    if (!orgId || mfaEnabled(req.db, userId)) {
      clearSessionCookie(res);
      res.status(200).json({ ok: true, signedIn: false });
      return;
    }
    startSession(req, res, userId, orgId);
    logActivity(req.db, {
      orgId,
      actorUserId: userId,
      entityType: 'MEMBERSHIP',
      entityId: userId,
      action: 'PASSWORD_RESET',
      summary: `${user.name} reset their password`,
    });
    res.json(buildSessionPayload(req));
  }),
);

router.put(
  '/password',
  requireAuth,
  handler(async (req, res) => {
    const session = currentSession(req);
    const { currentPassword, newPassword } = parseBody(changePasswordSchema, req.body);
    const problem = passwordProblem(newPassword);
    if (problem) throw validationError(problem, { newPassword: problem });

    const row = req.db.prepare('SELECT password_hash AS passwordHash FROM users WHERE id = ?').get(session.userId) as
      | { passwordHash: string }
      | undefined;
    if (!row || !(await verifyPassword(currentPassword, row.passwordHash))) {
      throw validationError('Your current password is not correct.', { currentPassword: 'Not correct.' });
    }

    const passwordHash = await hashPassword(newPassword);
    req.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, session.userId);
    // Other devices are signed out; this session stays.
    req.db.prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?').run(session.userId, session.id);
    res.status(204).end();
  }),
);

router.put(
  '/profile',
  requireAuth,
  handler((req, res) => {
    const session = currentSession(req);
    const input = parseBody(profileSchema, req.body);
    req.db.prepare('UPDATE users SET name = ?, title = ? WHERE id = ?').run(input.name, input.title, session.userId);
    req.session = { ...session, userName: input.name };
    res.json(buildSessionPayload(req));
  }),
);

/* ---------------------------------------------------------------- invites */

router.get(
  '/invites/:token',
  handler((req, res) => {
    inviteThrottle.hit(req.ip ?? 'local');
    const invite = findInviteByToken(req.db, req.params.token ?? '');
    if (!invite || !inviteIsLive(invite)) {
      throw new ApiError('NOT_FOUND', 'That invitation is no longer valid. Ask your organization to send a new one.');
    }
    const preview: InvitePreview = {
      organizationName: invite.org_name,
      role: invite.role,
      email: invite.email,
      invitedBy: invite.created_by_name,
      expiresAt: invite.expires_at,
      requiresAccount: !req.session,
    };
    res.json(preview);
  }),
);

router.post(
  '/invites/:token/accept',
  handler(async (req, res) => {
    inviteThrottle.hit(req.ip ?? 'local');
    const invite = findInviteByToken(req.db, req.params.token ?? '');
    if (!invite || !inviteIsLive(invite)) {
      throw new ApiError('NOT_FOUND', 'That invitation is no longer valid. Ask your organization to send a new one.');
    }
    const input = parseBody(acceptInviteSchema, req.body);
    let userId: string;
    let userName: string;
    let userEmail: string;
    let verifiedPasswordHash: string | undefined;
    let pendingUser: { id: string; name: string; email: string; passwordHash: string } | undefined;
    let created = false;

    if (req.session) {
      if (invite.email && invite.email !== req.session.userEmail) {
        throw forbidden(`This invitation was sent to ${invite.email}. Sign out and accept it from that account.`);
      }
      userId = req.session.userId;
      userName = req.session.userName;
      userEmail = req.session.userEmail;
    } else {
      const email = invite.email ?? input.email;
      if (!email) throw validationError('Enter your email address.', { email: 'Enter your email address.' });
      const existing = findUserByEmail(req, email);
      if (existing) {
        // A returning user proves who they are with their password.
        const ok = existing.isActive && (await verifyPassword(input.password, existing.passwordHash));
        if (!ok) {
          throw unauthenticated('An account with that email already exists. Enter its password to join, or reset it first.');
        }
        if (mfaEnabled(req.db, existing.id)) {
          checkMfaRate(req.db, existing.id);
          if (!input.mfaCode) { res.status(202).json({ mfaRequired: true }); return; }
          if (!verifyMfa(req.db, existing.id, input.mfaCode)) throw unauthenticated('That authenticator or recovery code is not valid.');
        }
        userId = existing.id;
        userName = existing.name;
        userEmail = existing.email;
        verifiedPasswordHash = existing.passwordHash;
      } else {
        if (!input.name) throw validationError('Enter your name.', { name: 'Enter your name.' });
        const problem = passwordProblem(input.password);
        if (problem) throw validationError(problem, { password: problem });
        const passwordHash = await hashPassword(input.password);
        userId = newId('usr');
        userName = input.name;
        userEmail = email;
        pendingUser = { id: userId, name: input.name, email, passwordHash };
        created = true;
      }
    }

    // Password hashing/comparison yields to other requests. Re-read the invite
    // after every await, then claim it and create the account/membership under
    // the same write lock. A concurrent accept, revoke or expiry must win over
    // an earlier read of a live invite, without leaving an orphan new account.
    const joinedOrgId = req.db.transaction(() => {
      const now = new Date();
      const liveInvite = findInviteByToken(req.db, req.params.token ?? '');
      if (!liveInvite || !inviteIsLive(liveInvite, now)) {
        throw new ApiError('NOT_FOUND', 'That invitation is no longer valid. Ask your organization to send a new one.');
      }
      if (liveInvite.email && liveInvite.email !== userEmail) throw forbidden('This invitation belongs to a different account.');
      if (verifiedPasswordHash) {
        const current = findUserByEmail(req, userEmail);
        if (!current?.isActive || current.id !== userId || current.passwordHash !== verifiedPasswordHash) {
          throw unauthenticated('Your account credentials changed. Sign in again before accepting the invitation.');
        }
      }
      if (pendingUser) {
        if (findUserByEmail(req, pendingUser.email)) throw conflict('An account with that email already exists. Sign in to accept the invitation.');
        req.db.prepare(`INSERT INTO users (id, name, email, password_hash, title, is_active, created_at)
          VALUES (?, ?, ?, ?, NULL, 1, ?)`)
          .run(pendingUser.id, pendingUser.name, pendingUser.email, pendingUser.passwordHash, now.toISOString());
      }
      const claimed = req.db.prepare(`UPDATE invites SET accepted_at = ?, accepted_by = ?
        WHERE id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?`)
        .run(now.toISOString(), userId, liveInvite.id, now.toISOString());
      if (claimed.changes !== 1) throw new ApiError('NOT_FOUND', 'That invitation is no longer valid. Ask your organization to send a new one.');
      const already = req.db
        .prepare('SELECT role FROM memberships WHERE org_id = ? AND user_id = ?')
        .get(liveInvite.org_id, userId) as { role: Role } | undefined;
      if (!already) {
        const status = workspaceStatusFor(req.db, liveInvite.org_id);
        if (status) assertSeatCapacity(req.db, liveInvite.org_id, status, false, liveInvite.role);
        req.db.prepare('INSERT INTO memberships (id, user_id, org_id, role, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(newId('mem'), userId, liveInvite.org_id, liveInvite.role, now.toISOString());
      }
      logActivity(req.db, {
        orgId: liveInvite.org_id,
        actorUserId: userId,
        entityType: 'MEMBERSHIP',
        entityId: userId,
        action: 'JOINED',
        summary: `${userName} joined as ${ROLE_LABELS[liveInvite.role]}${created ? ' (new account)' : ''}`,
      });
      return liveInvite.org_id;
    }).immediate();

    if (req.session) destroySession(req.db, req.session.id);
    startSession(req, res, userId, joinedOrgId, true);
    res.status(created ? 201 : 200).json(buildSessionPayload(req));
  }),
);

/* ------------------------------------------------------ authenticator MFA */

const mfaCredentials = z.object({ password: z.string().min(1).max(200), code: z.string().trim().max(80).default('') });

async function reauthenticateMfa(req: Parameters<typeof currentSession>[0], password: string): Promise<void> {
  const session = currentSession(req);
  if (session.workspace.isDemo) throw forbidden('Security settings cannot be changed on shared demo accounts.');
  checkMfaRate(req.db, session.userId);
  const row = req.db.prepare('SELECT password_hash AS hash FROM users WHERE id = ?').get(session.userId) as { hash: string } | undefined;
  const ok = await verifyPassword(password, row?.hash ?? dummyHash());
  // Never resurrect a session revoked by a concurrent password reset, sign-out,
  // membership removal or MFA change while bcrypt was running.
  const freshSession = resolveSession(req.db, session.id);
  const freshPassword = req.db.prepare('SELECT password_hash AS hash FROM users WHERE id = ?').get(session.userId) as { hash: string } | undefined;
  if (!row || !freshSession || freshSession.userId !== session.userId || freshSession.orgId !== session.orgId || freshPassword?.hash !== row.hash) {
    throw unauthenticated('Your account or session changed. Sign in again before changing security settings.');
  }
  if (freshSession.workspace.isDemo) throw forbidden('Security settings cannot be changed on shared demo accounts.');
  req.session = freshSession;
  checkMfaRate(req.db, session.userId);
  if (!ok) {
    failMfaAttempt(req.db, session.userId);
    throw unauthenticated('Your current password is not correct.');
  }
}

function rotateMfaSession(req: Parameters<typeof currentSession>[0], res: Parameters<typeof startSession>[1]): void {
  const session = currentSession(req);
  destroyUserSessions(req.db, session.userId);
  startSession(req, res, session.userId, session.orgId, true);
}

router.get('/mfa', requireAuth, handler((req, res) => {
  const userId = currentSession(req).userId;
  res.setHeader('Cache-Control', 'no-store');
  const count = req.db.prepare('SELECT COUNT(*) AS n FROM mfa_recovery_codes WHERE user_id = ?').get(userId) as { n: number };
  res.json({ available: mfaAvailable(), enabled: mfaEnabled(req.db, userId), recoveryCodesRemaining: count.n });
}));

router.post('/mfa/setup', requireAuth, handler(async (req, res) => {
  const { password } = parseBody(mfaCredentials, req.body);
  await reauthenticateMfa(req, password);
  const session = currentSession(req);
  const secret = beginMfaSetup(req.db, session.userId, session.id);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ secret, issuer: 'GrantConsole', account: session.userEmail, expiresInSeconds: 600 });
}));

router.post('/mfa/enable', requireAuth, handler((req, res) => {
  const { code } = parseBody(z.object({ code: z.string().trim().min(1).max(80) }), req.body);
  const session = currentSession(req);
  if (session.workspace.isDemo) throw forbidden('Security settings cannot be changed on shared demo accounts.');
  const codes = req.db.transaction(() => {
    if (!verifyMfa(req.db, session.userId, code, { setupSession: session.id, allowRecovery: false })) return null;
    req.db.prepare('UPDATE user_mfa SET enabled_at = ?, pending_expires_at = NULL, pending_session_id = NULL WHERE user_id = ?')
      .run(new Date().toISOString(), session.userId);
    const recoveryCodes = replaceRecoveryCodes(req.db, session.userId);
    rotateMfaSession(req, res);
    return recoveryCodes;
  }).immediate();
  if (!codes) throw unauthenticated('The code is invalid or setup expired. Start again if necessary.');
  logActivity(req.db, { orgId: session.orgId, actorUserId: session.userId, entityType: 'MEMBERSHIP', entityId: session.userId, action: 'MFA_ENABLED', summary: 'Two-factor authentication enabled' });
  res.setHeader('Cache-Control', 'no-store');
  res.json({ recoveryCodes: codes, ...buildSessionPayload(req) });
}));

router.post('/mfa/disable', requireAuth, handler(async (req, res) => {
  const { password, code } = parseBody(mfaCredentials, req.body);
  await reauthenticateMfa(req, password);
  const session = currentSession(req);
  const changed = req.db.transaction(() => {
    if (!verifyMfa(req.db, session.userId, code)) return false;
    req.db.prepare('DELETE FROM user_mfa WHERE user_id = ?').run(session.userId);
    req.db.prepare('DELETE FROM mfa_recovery_codes WHERE user_id = ?').run(session.userId);
    req.db.prepare('DELETE FROM mfa_rate_limits WHERE user_id = ?').run(session.userId);
    rotateMfaSession(req, res); return true;
  }).immediate();
  if (!changed) throw unauthenticated('That authenticator or recovery code is not valid.');
  logActivity(req.db, { orgId: session.orgId, actorUserId: session.userId, entityType: 'MEMBERSHIP', entityId: session.userId, action: 'MFA_DISABLED', summary: 'Two-factor authentication disabled' });
  res.json(buildSessionPayload(req));
}));

router.post('/mfa/recovery-codes', requireAuth, handler(async (req, res) => {
  const { password, code } = parseBody(mfaCredentials, req.body);
  await reauthenticateMfa(req, password);
  const session = currentSession(req);
  const codes = req.db.transaction(() => {
    if (!verifyMfa(req.db, session.userId, code)) return null;
    const recoveryCodes = replaceRecoveryCodes(req.db, session.userId);
    rotateMfaSession(req, res); return recoveryCodes;
  }).immediate();
  if (!codes) throw unauthenticated('That authenticator or recovery code is not valid.');
  logActivity(req.db, { orgId: session.orgId, actorUserId: session.userId, entityType: 'MEMBERSHIP', entityId: session.userId, action: 'MFA_RECOVERY_REPLACED', summary: 'Two-factor recovery codes replaced' });
  res.setHeader('Cache-Control', 'no-store');
  res.json({ recoveryCodes: codes, ...buildSessionPayload(req) });
}));

/* ------------------------------------------------------------------- demo */

/**
 * Demo shortcuts for the sign-in screen.
 *
 * Gated on an explicit `DEMO_MODE=true`, never inferred from NODE_ENV, and
 * limited to organizations flagged as demo workspaces, so a real customer's
 * account never appears on the public sign-in page.
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
          WHERE u.is_active = 1 AND o.is_demo = 1
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
