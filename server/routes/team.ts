/** Team roster, roles, invitations and owner-assisted password resets. */

import { Router } from 'express';

import { currentSession, requireCapability } from '../auth/middleware';
import { config } from '../config';
import { logActivity } from '../lib/activity';
import {
  findInviteById,
  inviteUrl,
  issueInvite,
  issuePasswordReset,
  listInvites,
  resetUrl,
  type InviteRow,
} from '../lib/accounts';
import { conflict, forbidden, notFound } from '../lib/errors';
import { handler, parseBody } from '../lib/http';
import { renderHtml, sendMail } from '../lib/mailer';
import { assertSeatCapacity } from '../lib/plans';
import { inviteSchema, roleUpdateSchema } from '../lib/validation';
import { ROLE_LABELS, type Role } from '../../shared/constants';
import { roleChangeDenialReason } from '../../shared/permissions';
import type { Invite, TeamMember } from '../../shared/types';

const router = Router();

function mapInvite(row: InviteRow): Invite {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
  };
}

function ownerCount(req: Parameters<typeof currentSession>[0], orgId: string): number {
  return (
    req.db.prepare("SELECT COUNT(*) AS count FROM memberships WHERE org_id = ? AND role = 'OWNER'").get(orgId) as {
      count: number;
    }
  ).count;
}

async function emailInvite(input: {
  to: string;
  orgName: string;
  role: Role;
  invitedBy: string;
  url: string;
}): Promise<void> {
  await sendMail({
    to: input.to,
    subject: `${input.invitedBy} invited you to ${input.orgName} on GrantConsole`,
    text: `${input.invitedBy} invited you to join ${input.orgName} on GrantConsole as ${ROLE_LABELS[input.role]}.\n\nAccept the invitation (valid for 14 days):\n${input.url}\n\nGrantConsole is the workspace where ${input.orgName} tracks grant deadlines, restricted budgets, evidence and funder reports.`,
    html: renderHtml(
      `Join ${input.orgName} on GrantConsole`,
      [
        `${input.invitedBy} invited you to join ${input.orgName} as ${ROLE_LABELS[input.role]}.`,
        `GrantConsole is where ${input.orgName} tracks grant deadlines, restricted budgets, evidence and funder reports. The invitation is valid for 14 days.`,
      ],
      { label: 'Accept invitation', url: input.url },
    ),
  });
}

/* ------------------------------------------------------------------ roster */

router.get(
  '/',
  handler((req, res) => {
    const session = currentSession(req);
    const rows = req.db
      .prepare(
        `SELECT u.id AS userId, u.name, u.email, u.is_active AS isActive, m.role, m.created_at AS joinedAt,
                (SELECT COUNT(*) FROM tasks t WHERE t.org_id = m.org_id AND t.assignee_user_id = u.id AND t.status <> 'DONE') AS openTaskCount,
                (SELECT COUNT(*) FROM grants g WHERE g.org_id = m.org_id AND g.owner_user_id = u.id AND g.archived = 0) AS grantCount
           FROM memberships m
           JOIN users u ON u.id = m.user_id
          WHERE m.org_id = ?
          ORDER BY CASE m.role WHEN 'OWNER' THEN 0 WHEN 'MANAGER' THEN 1 WHEN 'MEMBER' THEN 2 ELSE 3 END, u.name`,
      )
      .all(session.orgId) as Array<Omit<TeamMember, 'isActive'> & { isActive: number }>;

    res.json(rows.map((r): TeamMember => ({ ...r, isActive: Boolean(r.isActive) })));
  }),
);

/* ----------------------------------------------------------------- invites */

router.get(
  '/invites',
  requireCapability('team:manage'),
  handler((req, res) => {
    const session = currentSession(req);
    res.json(listInvites(req.db, session.orgId).map(mapInvite));
  }),
);

router.post(
  '/invites',
  requireCapability('team:manage'),
  handler(async (req, res) => {
    const session = currentSession(req);
    const input = parseBody(inviteSchema, req.body);

    if (input.role === 'OWNER' && session.role !== 'OWNER') {
      throw forbidden('Only an owner can invite another owner.');
    }
    if (session.workspace.isDemo) {
      throw forbidden('The public demo workspace cannot send invitations.');
    }
    if (input.email) {
      const member = req.db
        .prepare('SELECT 1 AS ok FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = ? AND u.email = ?')
        .get(session.orgId, input.email);
      if (member) throw conflict('That person is already a member of this organization.');
      const pending = listInvites(req.db, session.orgId).find((invite) => invite.email === input.email);
      if (pending) throw conflict('An invitation for that email is already pending. Resend or revoke it below.');
    }

    assertSeatCapacity(req.db, session.orgId, session.workspace, true, input.role);

    const { id, token, expiresAt } = issueInvite(req.db, {
      orgId: session.orgId,
      email: input.email,
      role: input.role,
      createdBy: session.userId,
    });
    const url = inviteUrl(token);

    let emailed = false;
    if (input.email) {
      await emailInvite({ to: input.email, orgName: session.orgName, role: input.role, invitedBy: session.userName, url });
      emailed = Boolean(config.resendApiKey);
    }

    logActivity(req.db, {
      orgId: session.orgId,
      actorUserId: session.userId,
      entityType: 'MEMBERSHIP',
      entityId: id,
      action: 'INVITED',
      summary: `${session.userName} invited ${input.email ?? 'a teammate (link)'} as ${ROLE_LABELS[input.role]}`,
    });

    const invite = findInviteById(req.db, session.orgId, id);
    res.status(201).json({ ...(invite ? mapInvite(invite) : { id, email: input.email, role: input.role, createdByName: session.userName, createdAt: new Date().toISOString(), expiresAt, acceptedAt: null }), url, emailed });
  }),
);

router.post(
  '/invites/:inviteId/resend',
  requireCapability('team:manage'),
  handler(async (req, res) => {
    const session = currentSession(req);
    const invite = findInviteById(req.db, session.orgId, req.params.inviteId ?? '');
    if (!invite || invite.accepted_at || invite.revoked_at) throw notFound('Invitation');
    // Tokens are never stored in clear, so resending issues a fresh link and retires the old one.
    req.db.prepare('UPDATE invites SET revoked_at = ? WHERE id = ?').run(new Date().toISOString(), invite.id);
    const fresh = issueInvite(req.db, { orgId: session.orgId, email: invite.email, role: invite.role, createdBy: session.userId });
    const url = inviteUrl(fresh.token);
    if (invite.email) {
      await emailInvite({ to: invite.email, orgName: session.orgName, role: invite.role, invitedBy: session.userName, url });
    }
    const row = findInviteById(req.db, session.orgId, fresh.id);
    res.json({ ...(row ? mapInvite(row) : { id: fresh.id, email: invite.email, role: invite.role, createdByName: session.userName, createdAt: new Date().toISOString(), expiresAt: fresh.expiresAt, acceptedAt: null }), url, emailed: Boolean(invite.email && config.resendApiKey) });
  }),
);

router.delete(
  '/invites/:inviteId',
  requireCapability('team:manage'),
  handler((req, res) => {
    const session = currentSession(req);
    const invite = findInviteById(req.db, session.orgId, req.params.inviteId ?? '');
    if (!invite) throw notFound('Invitation');
    req.db.prepare('UPDATE invites SET revoked_at = ? WHERE id = ? AND org_id = ?').run(new Date().toISOString(), invite.id, session.orgId);
    logActivity(req.db, {
      orgId: session.orgId,
      actorUserId: session.userId,
      entityType: 'MEMBERSHIP',
      entityId: invite.id,
      action: 'INVITE_REVOKED',
      summary: `${session.userName} revoked the invitation for ${invite.email ?? 'a link invite'}`,
    });
    res.status(204).end();
  }),
);

/* ------------------------------------------------------------------- roles */

router.patch(
  '/:userId/role',
  requireCapability('team:manage'),
  handler((req, res) => {
    const session = currentSession(req);
    const targetUserId = req.params.userId!;
    const { role } = parseBody(roleUpdateSchema, req.body);

    const target = req.db
      .prepare(
        `SELECT m.role AS role, u.name AS name FROM memberships m JOIN users u ON u.id = m.user_id
          WHERE m.org_id = ? AND m.user_id = ?`,
      )
      .get(session.orgId, targetUserId) as { role: Role; name: string } | undefined;
    if (!target) throw notFound('Team member');

    const denial = roleChangeDenialReason({
      actorRole: session.role,
      actorUserId: session.userId,
      targetRole: target.role,
      targetUserId,
      nextRole: role,
      ownerCount: ownerCount(req, session.orgId),
    });
    if (denial) throw forbidden(denial);

    if (target.role === role) {
      res.json({ userId: targetUserId, role });
      return;
    }

    req.db
      .prepare('UPDATE memberships SET role = ? WHERE org_id = ? AND user_id = ?')
      .run(role, session.orgId, targetUserId);

    logActivity(req.db, {
      orgId: session.orgId,
      actorUserId: session.userId,
      entityType: 'MEMBERSHIP',
      entityId: targetUserId,
      action: 'ROLE_CHANGED',
      summary: `${target.name}: ${ROLE_LABELS[target.role]} → ${ROLE_LABELS[role]}`,
    });

    res.json({ userId: targetUserId, role });
  }),
);

/* ------------------------------------------------------------------ remove */

router.delete(
  '/:userId',
  requireCapability('team:manage'),
  handler((req, res) => {
    const session = currentSession(req);
    const targetUserId = req.params.userId!;
    const target = req.db
      .prepare(
        `SELECT m.role AS role, u.name AS name FROM memberships m JOIN users u ON u.id = m.user_id
          WHERE m.org_id = ? AND m.user_id = ?`,
      )
      .get(session.orgId, targetUserId) as { role: Role; name: string } | undefined;
    if (!target) throw notFound('Team member');

    if (session.workspace.isDemo) throw forbidden('The public demo workspace keeps its seeded team.');
    if (target.role === 'OWNER' && session.role !== 'OWNER') throw forbidden('Only an owner can remove an owner.');
    if (target.role === 'OWNER' && ownerCount(req, session.orgId) <= 1) {
      throw forbidden('An organization must keep at least one owner. Promote someone else first.');
    }

    req.db.transaction(() => {
      req.db.prepare('DELETE FROM memberships WHERE org_id = ? AND user_id = ?').run(session.orgId, targetUserId);
      req.db.prepare('DELETE FROM sessions WHERE org_id = ? AND user_id = ?').run(session.orgId, targetUserId);
      req.db.prepare('UPDATE grants SET owner_user_id = NULL WHERE org_id = ? AND owner_user_id = ?').run(session.orgId, targetUserId);
      req.db.prepare('UPDATE tasks SET assignee_user_id = NULL WHERE org_id = ? AND assignee_user_id = ?').run(session.orgId, targetUserId);
    })();

    logActivity(req.db, {
      orgId: session.orgId,
      actorUserId: session.userId,
      entityType: 'MEMBERSHIP',
      entityId: targetUserId,
      action: 'REMOVED',
      summary: `${session.userName} removed ${target.name} (${ROLE_LABELS[target.role]}) from the organization`,
    });

    res.status(204).end();
  }),
);

/**
 * Owner-assisted reset: when email is not configured (or a teammate lost
 * access to their inbox), an owner or manager can hand over a one-hour link.
 */
router.post(
  '/:userId/reset-link',
  requireCapability('team:manage'),
  handler((req, res) => {
    const session = currentSession(req);
    const targetUserId = req.params.userId!;
    const target = req.db
      .prepare(
        `SELECT m.role AS role, u.name AS name, u.email AS email FROM memberships m JOIN users u ON u.id = m.user_id
          WHERE m.org_id = ? AND m.user_id = ? AND u.is_active = 1`,
      )
      .get(session.orgId, targetUserId) as { role: Role; name: string; email: string } | undefined;
    if (!target) throw notFound('Team member');
    if (session.workspace.isDemo) throw forbidden('Demo accounts share a published password and cannot be reset.');
    if (target.role === 'OWNER' && session.role !== 'OWNER' && targetUserId !== session.userId) {
      throw forbidden('Only an owner can issue a reset link for an owner.');
    }
    const { token, expiresAt } = issuePasswordReset(req.db, targetUserId);
    logActivity(req.db, {
      orgId: session.orgId,
      actorUserId: session.userId,
      entityType: 'MEMBERSHIP',
      entityId: targetUserId,
      action: 'RESET_LINK_ISSUED',
      summary: `${session.userName} issued a password reset link for ${target.name}`,
    });
    res.json({ url: resetUrl(token), expiresAt, email: target.email });
  }),
);

export default router;
