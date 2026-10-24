/** Dashboard, calendar, reports, search, team and organization settings. */

import { Router } from 'express';

import fs from 'node:fs';
import path from 'node:path';

import { currentSession, requireCapability } from '../auth/middleware';
import { verifyPassword } from '../auth/password';
import { clearSessionCookie } from '../auth/session';
import { config } from '../config';
import { hasSampleData, loadSampleData, removeSampleData } from '../db/sample-data';
import { logActivity } from '../lib/activity';
import { conflict, forbidden, validationError } from '../lib/errors';
import { handler, parseBody, parseQuery } from '../lib/http';
import { newToken } from '../lib/ids';
import { loadOrganizationBilling } from '../lib/plans';
import { calendarQuerySchema, deleteOrganizationSchema, organizationSchema, searchQuerySchema } from '../lib/validation';
import { filterEventsByOwner, loadCalendarEvents } from '../services/calendar';
import { buildDashboard } from '../services/dashboard';
import { loadPortfolio } from '../services/portfolio';
import { buildPortfolioReport, filterGrants, portfolioCsv, reportScheduleCsv } from '../services/reports';
import { ACTIVITY_SELECT, mapActivity, type ActivityRow } from '../services/rows';
import { csvFilename } from '../../shared/csv';
import { MONTH_NAMES, type CurrencyCode, type Role } from '../../shared/constants';
import { todayInTimezone } from '../../shared/dates';
import type { OnboardingStatus, SessionOrganization } from '../../shared/types';

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

/* ----------------------------------------------------------- calendar feed */

function feedUrl(token: string): string {
  return `${config.appUrl}/feeds/${token}.ics`;
}

router.get(
  '/calendar/feed',
  handler((req, res) => {
    const session = currentSession(req);
    const org = loadOrganizationBilling(req.db, session.orgId);
    res.json({ url: org?.calendar_token ? feedUrl(org.calendar_token) : null });
  }),
);

/** Creates (or rotates) the secret feed address. Anyone with the link can read deadlines. */
router.post(
  '/calendar/feed',
  requireCapability('team:manage'),
  handler((req, res) => {
    const session = currentSession(req);
    const token = newToken(24).replace(/[^A-Za-z0-9]/g, '').slice(0, 40) || newToken(18).replace(/[^A-Za-z0-9]/g, '');
    req.db.prepare('UPDATE organizations SET calendar_token = ?, updated_at = ? WHERE id = ?').run(token, new Date().toISOString(), session.orgId);
    logActivity(req.db, {
      orgId: session.orgId,
      actorUserId: session.userId,
      entityType: 'ORGANIZATION',
      entityId: session.orgId,
      action: 'CALENDAR_FEED_ROTATED',
      summary: `${session.userName} created a new calendar feed address`,
    });
    res.status(201).json({ url: feedUrl(token) });
  }),
);

router.delete(
  '/calendar/feed',
  requireCapability('team:manage'),
  handler((req, res) => {
    const session = currentSession(req);
    req.db.prepare('UPDATE organizations SET calendar_token = NULL, updated_at = ? WHERE id = ?').run(new Date().toISOString(), session.orgId);
    logActivity(req.db, {
      orgId: session.orgId,
      actorUserId: session.userId,
      entityType: 'ORGANIZATION',
      entityId: session.orgId,
      action: 'CALENDAR_FEED_REVOKED',
      summary: `${session.userName} disabled the calendar feed`,
    });
    res.status(204).end();
  }),
);

/* -------------------------------------------------------------- onboarding */

function count(req: Parameters<typeof currentSession>[0], sql: string, orgId: string): number {
  return (req.db.prepare(sql).get(orgId) as { count: number }).count;
}

router.get(
  '/onboarding',
  handler((req, res) => {
    const session = currentSession(req);
    const org = loadOrganizationBilling(req.db, session.orgId);
    const status: OnboardingStatus = {
      funders: count(req, 'SELECT COUNT(*) AS count FROM funders WHERE org_id = ? AND archived = 0', session.orgId),
      grants: count(req, 'SELECT COUNT(*) AS count FROM grants WHERE org_id = ? AND archived = 0', session.orgId),
      members: count(req, 'SELECT COUNT(*) AS count FROM memberships WHERE org_id = ?', session.orgId),
      milestones: count(req, 'SELECT COUNT(*) AS count FROM milestones WHERE org_id = ?', session.orgId),
      documents: count(req, 'SELECT COUNT(*) AS count FROM documents WHERE org_id = ?', session.orgId),
      calendarConnected: Boolean(org?.calendar_token),
      hasSampleData: hasSampleData(req.db, session.orgId),
      dismissed: Boolean(org?.onboarding_dismissed_at),
    };
    res.json(status);
  }),
);

router.post(
  '/onboarding/dismiss',
  handler((req, res) => {
    const session = currentSession(req);
    req.db.prepare('UPDATE organizations SET onboarding_dismissed_at = ? WHERE id = ?').run(new Date().toISOString(), session.orgId);
    res.status(204).end();
  }),
);

router.post(
  '/onboarding/sample-data',
  requireCapability('grants:write'),
  handler((req, res) => {
    const session = currentSession(req);
    if (session.workspace.isDemo) throw conflict('The public demo already contains a seeded portfolio.');
    if (hasSampleData(req.db, session.orgId)) throw conflict('Sample data is already loaded.');
    const result = loadSampleData(req.db, {
      orgId: session.orgId,
      userId: session.userId,
      userName: session.userName,
      today: todayInTimezone(session.timezone),
      currency: session.currency,
    });
    res.status(201).json(result);
  }),
);

router.delete(
  '/onboarding/sample-data',
  requireCapability('grants:archive'),
  handler((req, res) => {
    const session = currentSession(req);
    res.json(removeSampleData(req.db, { orgId: session.orgId, userId: session.userId, userName: session.userName }));
  }),
);

/* ------------------------------------------------------ delete organization */

/**
 * Irreversible. The owner re-enters their password and the organization name;
 * Live records and uploads are removed. People without other memberships are
 * erased, except an anonymous identity stub needed by another workspace's
 * retained evidence. Provider billing records and backup retention are separate.
 */
router.delete(
  '/organization',
  requireCapability('org:manage'),
  handler(async (req, res) => {
    const session = currentSession(req);
    const input = parseBody(deleteOrganizationSchema, req.body);
    if (session.workspace.isDemo) throw forbidden('The public demo workspace cannot be deleted.');
    if (input.confirmName.trim().toLowerCase() !== session.orgName.trim().toLowerCase()) {
      throw validationError('Type the organization name exactly as it appears to confirm.', { confirmName: 'Does not match.' });
    }
    const row = req.db.prepare('SELECT password_hash AS passwordHash FROM users WHERE id = ?').get(session.userId) as
      | { passwordHash: string }
      | undefined;
    if (!row || !(await verifyPassword(input.password, row.passwordHash))) {
      throw validationError('Your password is not correct.', { password: 'Not correct.' });
    }

    // Include former members still referenced by this workspace, otherwise their
    // account credentials survive simply because membership was removed first.
    const relatedUserIds = (req.db.prepare(`
      SELECT user_id AS userId FROM memberships WHERE org_id = @orgId
      UNION SELECT uploaded_by FROM documents WHERE org_id = @orgId
      UNION SELECT author_user_id FROM comments WHERE org_id = @orgId
      UNION SELECT actor_user_id FROM activities WHERE org_id = @orgId AND actor_user_id IS NOT NULL
      UNION SELECT owner_user_id FROM grants WHERE org_id = @orgId AND owner_user_id IS NOT NULL
      UNION SELECT assignee_user_id FROM tasks WHERE org_id = @orgId AND assignee_user_id IS NOT NULL
      UNION SELECT created_by FROM invites WHERE org_id = @orgId AND created_by IS NOT NULL
      UNION SELECT accepted_by FROM invites WHERE org_id = @orgId AND accepted_by IS NOT NULL
    `).all({ orgId: session.orgId }) as Array<{ userId: string }>).map((m) => m.userId);
    const storageKeys = (req.db.prepare('SELECT storage_key AS storageKey FROM documents WHERE org_id = ?').all(session.orgId) as Array<{ storageKey: string }>).map((d) => d.storageKey);

    // Never remove a path belonging to another tenant, including a corrupt
    // storage key. Removing only this generated directory also avoids following
    // file symlinks to files outside it. Node's recursive rm unlinks symlinks.
    const directoryName = session.orgId.replace(/[^A-Za-z0-9_-]/g, '');
    const uploadsRoot = path.resolve(req.uploadsDir);
    const organizationDirectory = path.resolve(uploadsRoot, directoryName);
    if (!directoryName || path.dirname(organizationDirectory) !== uploadsRoot || storageKeys.some((key) => {
      const relative = path.relative(organizationDirectory, path.resolve(uploadsRoot, key));
      return !relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
    })) {
      throw conflict('Deletion could not safely locate the workspace uploads. Contact support to complete deletion.');
    }
    // Filesystem removal cannot be rolled back by SQLite. Keep the organization,
    // document metadata and authenticated session when it fails so the same
    // authorized request can retry; some files may already have been removed.
    try {
      fs.rmSync(organizationDirectory, { recursive: true, force: true });
    } catch {
      console.error('[org] upload erasure failed; organization deletion requires retry');
      throw conflict('Workspace deletion is incomplete because some uploads could not be removed. Retry deletion; contact support if this continues.');
    }

    req.db.transaction(() => {
      // Local webhook copies can contain billing contact details. This does not
      // cancel a Stripe subscription or remove Stripe's statutory records.
      req.db.prepare('DELETE FROM billing_events WHERE org_id = ?').run(session.orgId);
      req.db.prepare('DELETE FROM organizations WHERE id = ?').run(session.orgId);
      for (const userId of relatedUserIds) {
        const remaining = (req.db.prepare('SELECT COUNT(*) AS count FROM memberships WHERE user_id = ?').get(userId) as { count: number }).count;
        if (remaining === 0) {
          const retainedEvidence = req.db.prepare(`
            SELECT 1 FROM documents WHERE uploaded_by = ?
            UNION ALL SELECT 1 FROM comments WHERE author_user_id = ? LIMIT 1
          `).get(userId, userId);
          if (retainedEvidence) {
            // Another controller's records must remain intact. Keep only an
            // inactive anonymous attribution stub with no usable credentials.
            req.db.prepare(`UPDATE users SET name = 'Deleted user', email = ?, password_hash = '',
              title = NULL, last_sign_in_at = NULL, is_active = 0 WHERE id = ?`)
              .run(`deleted-${newToken(24)}@deleted.invalid`, userId);
            for (const table of ['sessions', 'password_resets', 'user_mfa', 'mfa_recovery_codes', 'mfa_rate_limits']) {
              req.db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(userId);
            }
          } else {
            req.db.prepare('DELETE FROM users WHERE id = ?').run(userId);
          }
        }
      }
    })();

    console.info('[org] organization live-data erasure completed');
    clearSessionCookie(res);
    res.status(204).end();
  }),
);

export default router;
