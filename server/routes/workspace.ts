/** Dashboard, calendar, reports, search, team and organization settings. */

import { Router } from 'express';

import { currentSession, requireCapability } from '../auth/middleware';
import { logActivity } from '../lib/activity';
import { conflict, forbidden, notFound } from '../lib/errors';
import { handler, parseBody, parseQuery } from '../lib/http';
import { calendarQuerySchema, organizationSchema, roleUpdateSchema, searchQuerySchema } from '../lib/validation';
import { filterEventsByOwner, loadCalendarEvents } from '../services/calendar';
import { buildDashboard } from '../services/dashboard';
import { loadPortfolio } from '../services/portfolio';
import { buildPortfolioReport, filterGrants, portfolioCsv, reportScheduleCsv } from '../services/reports';
import { ACTIVITY_SELECT, mapActivity, type ActivityRow } from '../services/rows';
import { csvFilename } from '../../shared/csv';
import { MONTH_NAMES, ROLE_LABELS, type CurrencyCode, type Role } from '../../shared/constants';
import { todayInTimezone } from '../../shared/dates';
import { roleChangeDenialReason } from '../../shared/permissions';
import type { SessionOrganization, TeamMember } from '../../shared/types';

const router = Router();

function orgOf(req: Parameters<typeof currentSession>[0]): SessionOrganization {
  const s = currentSession(req);
  return {
    id: s.orgId,
    name: s.orgName,
    slug: s.orgSlug,
    timezone: s.timezone,
    currency: s.currency as CurrencyCode,
    fiscalYearStartMonth: s.fiscalYearStartMonth,
  };
}

/* --------------------------------------------------------------- dashboard */

router.get(
  '/dashboard',
  handler((req, res) => {
    const session = currentSession(req);
    const today = todayInTimezone(session.timezone);
    res.json(
      buildDashboard(
        req.db,
        {
          orgId: session.orgId,
          timezone: session.timezone,
          currency: session.currency as CurrencyCode,
          fiscalYearStartMonth: session.fiscalYearStartMonth,
        },
        today,
      ),
    );
  }),
);

/* ---------------------------------------------------------------- calendar */

router.get(
  '/calendar',
  handler((req, res) => {
    const session = currentSession(req);
    const query = parseQuery(calendarQuerySchema, req.query);
    const kinds = query.kinds ? query.kinds.split(',').map((k) => k.trim()).filter(Boolean) : undefined;

    let events = loadCalendarEvents(req.db, session.orgId, {
      from: query.from,
      to: query.to,
      kinds,
      grantId: query.grantId ?? null,
      includeComplete: query.includeComplete,
    });
    if (query.ownerUserId) {
      events = filterEventsByOwner(req.db, session.orgId, events, query.ownerUserId);
    }
    res.json({ today: todayInTimezone(session.timezone), events });
  }),
);

/* ----------------------------------------------------------------- reports */

router.get(
  '/reports/portfolio',
  handler((req, res) => {
    const session = currentSession(req);
    const today = todayInTimezone(session.timezone);
    res.json(
      buildPortfolioReport(req.db, orgOf(req), today, {
        status: typeof req.query.status === 'string' ? req.query.status : null,
        ownerUserId: typeof req.query.ownerUserId === 'string' ? req.query.ownerUserId : null,
        funderId: typeof req.query.funderId === 'string' ? req.query.funderId : null,
        health: typeof req.query.health === 'string' ? req.query.health : null,
      }),
    );
  }),
);

router.get(
  '/reports/portfolio.csv',
  requireCapability('export:run'),
  handler((req, res) => {
    const session = currentSession(req);
    const today = todayInTimezone(session.timezone);
    const { grants } = loadPortfolio(req.db, session.orgId, today);
    const selected = filterGrants(grants, {
      status: typeof req.query.status === 'string' ? req.query.status : null,
      ownerUserId: typeof req.query.ownerUserId === 'string' ? req.query.ownerUserId : null,
      funderId: typeof req.query.funderId === 'string' ? req.query.funderId : null,
      health: typeof req.query.health === 'string' ? req.query.health : null,
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `attachment; filename="${csvFilename([session.orgSlug, 'portfolio-summary'], today)}"`);
    res.send(portfolioCsv(selected, today));
  }),
);

router.get(
  '/reports/report-schedule.csv',
  requireCapability('export:run'),
  handler((req, res) => {
    const session = currentSession(req);
    const today = todayInTimezone(session.timezone);
    const report = buildPortfolioReport(req.db, orgOf(req), today, {
      status: typeof req.query.status === 'string' ? req.query.status : null,
      ownerUserId: typeof req.query.ownerUserId === 'string' ? req.query.ownerUserId : null,
      funderId: typeof req.query.funderId === 'string' ? req.query.funderId : null,
      health: typeof req.query.health === 'string' ? req.query.health : null,
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `attachment; filename="${csvFilename([session.orgSlug, 'funder-report-schedule'], today)}"`);
    res.send(reportScheduleCsv(report));
  }),
);

/* ---------------------------------------------------------------- activity */

router.get(
  '/activity',
  handler((req, res) => {
    const session = currentSession(req);
    const limitRaw = Number(req.query.limit ?? 60);
    const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, Math.floor(limitRaw))) : 60;
    const rows = req.db
      .prepare(`${ACTIVITY_SELECT} WHERE a.org_id = ? ORDER BY a.created_at DESC LIMIT ?`)
      .all(session.orgId, limit) as ActivityRow[];
    res.json(rows.map(mapActivity));
  }),
);

/* ------------------------------------------------------------------ search */

router.get(
  '/search',
  handler((req, res) => {
    const session = currentSession(req);
    const { q } = parseQuery(searchQuerySchema, req.query);
    const today = todayInTimezone(session.timezone);
    const needle = q.toLowerCase();

    const { grants } = loadPortfolio(req.db, session.orgId, today, { includeArchived: true });
    const grantHits = grants
      .filter((g) =>
        [g.title, g.program ?? '', g.funderName, g.ownerName ?? ''].join(' ').toLowerCase().includes(needle),
      )
      .slice(0, 8)
      .map((g) => ({
        type: 'grant' as const,
        id: g.id,
        title: g.title,
        subtitle: `${g.funderName} · ${g.ownerName ?? 'Unassigned'}`,
      }));

    const funderHits = (
      req.db
        .prepare('SELECT id, name, type FROM funders WHERE org_id = ? AND lower(name) LIKE ? ORDER BY name LIMIT 6')
        .all(session.orgId, `%${needle}%`) as Array<{ id: string; name: string; type: string }>
    ).map((f) => ({ type: 'funder' as const, id: f.id, title: f.name, subtitle: 'Funder' }));

    res.json({ grants: grantHits, funders: funderHits });
  }),
);

/* -------------------------------------------------------------------- team */

router.get(
  '/team',
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

router.patch(
  '/team/:userId/role',
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

    const ownerCount = (
      req.db.prepare("SELECT COUNT(*) AS count FROM memberships WHERE org_id = ? AND role = 'OWNER'").get(
        session.orgId,
      ) as { count: number }
    ).count;

    const denial = roleChangeDenialReason({
      actorRole: session.role,
      actorUserId: session.userId,
      targetRole: target.role,
      targetUserId,
      nextRole: role,
      ownerCount,
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

/* ------------------------------------------------------------ organization */

router.get(
  '/organization',
  handler((req, res) => {
    res.json(orgOf(req));
  }),
);

router.put(
  '/organization',
  requireCapability('org:manage'),
  handler((req, res) => {
    const session = currentSession(req);
    const input = parseBody(organizationSchema, req.body);

    const duplicate = req.db
      .prepare('SELECT id FROM organizations WHERE lower(name) = lower(?) AND id <> ?')
      .get(input.name, session.orgId);
    if (duplicate) throw conflict('Another organization already uses that name.');

    req.db
      .prepare(
        `UPDATE organizations SET name = @name, timezone = @timezone, currency = @currency,
            fiscal_year_start_month = @fiscalYearStartMonth, updated_at = @now
          WHERE id = @id`,
      )
      .run({ id: session.orgId, now: new Date().toISOString(), ...input });

    logActivity(req.db, {
      orgId: session.orgId,
      actorUserId: session.userId,
      entityType: 'ORGANIZATION',
      entityId: session.orgId,
      action: 'UPDATED',
      summary: `Settings updated — timezone ${input.timezone}, currency ${input.currency}, fiscal year starts ${MONTH_NAMES[input.fiscalYearStartMonth - 1]}`,
    });

    req.session = {
      ...session,
      orgName: input.name,
      timezone: input.timezone,
      currency: input.currency,
      fiscalYearStartMonth: input.fiscalYearStartMonth,
    };
    res.json(orgOf(req));
  }),
);

/* -------------------------------------------------------------- lookup data */

router.get(
  '/lookups',
  handler((req, res) => {
    const session = currentSession(req);
    const members = req.db
      .prepare(
        `SELECT u.id, u.name, m.role FROM memberships m JOIN users u ON u.id = m.user_id
          WHERE m.org_id = ? AND u.is_active = 1 ORDER BY u.name`,
      )
      .all(session.orgId) as Array<{ id: string; name: string; role: Role }>;
    const funders = req.db
      .prepare('SELECT id, name FROM funders WHERE org_id = ? AND archived = 0 ORDER BY name')
      .all(session.orgId) as Array<{ id: string; name: string }>;
    const grants = req.db
      .prepare('SELECT id, title FROM grants WHERE org_id = ? AND archived = 0 ORDER BY title')
      .all(session.orgId) as Array<{ id: string; title: string }>;
    res.json({ members, funders, grants });
  }),
);

export default router;
