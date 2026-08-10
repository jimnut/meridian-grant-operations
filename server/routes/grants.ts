import { Router } from 'express';
import type { z } from 'zod';

import { currentSession, requireCapability } from '../auth/middleware';
import { describeChanges, logActivity } from '../lib/activity';
import { conflict, notFound, validationError } from '../lib/errors';
import { handler, parseBody, parseQuery } from '../lib/http';
import { newId } from '../lib/ids';
import { archiveSchema, grantQuerySchema, grantSchema, grantStatusSchema } from '../lib/validation';
import { getGrantDetail, getGrantRow, loadPortfolio } from '../services/portfolio';
import { buildReportingPacket, grantPacketCsv, portfolioCsv } from '../services/reports';
import { csvFilename } from '../../shared/csv';
import { GRANT_STATUS_LABELS, STATUS_STAGE, type GrantStatus } from '../../shared/constants';
import { archiveDenialReason, statusChangeDenialReason, type OpenObligations } from '../../shared/lifecycle';
import { todayInTimezone } from '../../shared/dates';
import type { CurrencyCode } from '../../shared/constants';
import type { GrantListItem, Paginated, SessionOrganization } from '../../shared/types';

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

function today(req: Parameters<typeof currentSession>[0]): string {
  return todayInTimezone(currentSession(req).timezone);
}

type SortKey = 'title' | 'funder' | 'status' | 'awarded' | 'requested' | 'deadline' | 'readiness' | 'health' | 'updated';

const HEALTH_ORDER = { AT_RISK: 0, WATCH: 1, ON_TRACK: 2 } as const;

export type GrantQuery = z.output<typeof grantQuerySchema>;

export function applyGrantFilters(grants: GrantListItem[], query: GrantQuery): GrantListItem[] {
  const statuses = query.status
    ? new Set(query.status.split(',').map((s) => s.trim()).filter(Boolean) as GrantStatus[])
    : null;
  const stages = query.stage ? new Set(query.stage.split(',').map((s) => s.trim()).filter(Boolean)) : null;
  const healths = query.health ? new Set(query.health.split(',').map((s) => s.trim()).filter(Boolean)) : null;
  const needle = query.q?.toLowerCase().trim();

  return grants.filter((g) => {
    if (statuses && !statuses.has(g.status)) return false;
    if (stages && !stages.has(STATUS_STAGE[g.status])) return false;
    if (healths && !healths.has(g.health.level)) return false;
    if (query.ownerUserId) {
      if (query.ownerUserId === 'unassigned') {
        if (g.ownerUserId) return false;
      } else if (g.ownerUserId !== query.ownerUserId) {
        return false;
      }
    }
    if (query.funderId && g.funderId !== query.funderId) return false;
    if (query.dueBefore) {
      if (!g.nextDeadline || g.nextDeadline.date > query.dueBefore) return false;
    }
    if (query.dueAfter) {
      if (!g.nextDeadline || g.nextDeadline.date < query.dueAfter) return false;
    }
    if (needle) {
      const haystack = [g.title, g.program ?? '', g.funderName, g.ownerName ?? '', GRANT_STATUS_LABELS[g.status]]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}

export function sortGrants(grants: GrantListItem[], sort: SortKey, dir: 'asc' | 'desc'): GrantListItem[] {
  const factor = dir === 'desc' ? -1 : 1;
  const far = '9999-12-31';
  const sorted = [...grants].sort((a, b) => {
    switch (sort) {
      case 'funder':
        return a.funderName.localeCompare(b.funderName) * factor;
      case 'status':
        return a.status.localeCompare(b.status) * factor;
      case 'awarded':
        return (a.awardedCents - b.awardedCents) * factor;
      case 'requested':
        return (a.requestedCents - b.requestedCents) * factor;
      case 'deadline': {
        const aDate = a.nextDeadline?.date ?? far;
        const bDate = b.nextDeadline?.date ?? far;
        return (aDate < bDate ? -1 : aDate > bDate ? 1 : 0) * factor;
      }
      case 'readiness':
        return (a.readiness.percent - b.readiness.percent) * factor;
      case 'health':
        return (HEALTH_ORDER[a.health.level] - HEALTH_ORDER[b.health.level]) * factor;
      case 'updated':
        return (a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : 0) * factor;
      case 'title':
      default:
        return a.title.localeCompare(b.title) * factor;
    }
  });
  return sorted;
}

/* -------------------------------------------------------------------- list */

router.get(
  '/',
  handler((req, res) => {
    const session = currentSession(req);
    const query = parseQuery(grantQuerySchema, req.query);
    const { grants } = loadPortfolio(req.db, session.orgId, today(req), {
      includeArchived: query.includeArchived,
    });

    const filtered = applyGrantFilters(grants, query);
    const sorted = sortGrants(filtered, (query.sort as SortKey) ?? 'deadline', query.dir ?? 'asc');

    const total = sorted.length;
    const pageCount = Math.max(1, Math.ceil(total / query.pageSize));
    const page = Math.min(query.page, pageCount);
    const start = (page - 1) * query.pageSize;

    const payload: Paginated<GrantListItem> = {
      items: sorted.slice(start, start + query.pageSize),
      total,
      page,
      pageSize: query.pageSize,
      pageCount,
    };
    res.json(payload);
  }),
);

/** CSV export of the current filtered view. */
router.get(
  '/export.csv',
  requireCapability('export:run'),
  handler((req, res) => {
    const session = currentSession(req);
    const query = parseQuery(grantQuerySchema, req.query);
    const day = today(req);
    const { grants } = loadPortfolio(req.db, session.orgId, day, { includeArchived: query.includeArchived });
    const filtered = sortGrants(applyGrantFilters(grants, query), (query.sort as SortKey) ?? 'deadline', query.dir ?? 'asc');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${csvFilename([session.orgSlug, 'grant-portfolio'], day)}"`,
    );
    res.send(portfolioCsv(filtered, day));
  }),
);

/* ------------------------------------------------------------------ detail */

router.get(
  '/:grantId',
  handler((req, res) => {
    const session = currentSession(req);
    res.json(getGrantDetail(req.db, session.orgId, req.params.grantId!, today(req)));
  }),
);

router.get(
  '/:grantId/packet',
  handler((req, res) => {
    const session = currentSession(req);
    res.json(buildReportingPacket(req.db, orgOf(req), req.params.grantId!, todayInTimezone(session.timezone)));
  }),
);

router.get(
  '/:grantId/packet.csv',
  requireCapability('export:run'),
  handler((req, res) => {
    const day = today(req);
    const packet = buildReportingPacket(req.db, orgOf(req), req.params.grantId!, day);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${csvFilename(['reporting-packet', packet.grant.title], day)}"`,
    );
    res.send(grantPacketCsv(packet));
  }),
);

/* ------------------------------------------------------------------ create */

router.post(
  '/',
  requireCapability('grants:write'),
  handler((req, res) => {
    const session = currentSession(req);
    const input = parseBody(grantSchema, req.body);

    const funder = req.db
      .prepare('SELECT id, name FROM funders WHERE org_id = ? AND id = ?')
      .get(session.orgId, input.funderId) as { id: string; name: string } | undefined;
    if (!funder) throw notFound('Funder');

    if (input.ownerUserId && !isMember(req.db, session.orgId, input.ownerUserId)) {
      throw notFound('Owner');
    }

    const currency = input.currency ?? session.currency;
    assertOrgCurrency(currency, session.currency);

    const now = new Date().toISOString();
    const id = newId('gr');

    req.db
      .prepare(
        `INSERT INTO grants (id, org_id, funder_id, owner_user_id, title, program, status, requested_cents,
            awarded_cents, currency, probability, purpose, requirements, next_action, notes, application_date,
            decision_date, start_date, end_date, renewal_date, closeout_date, archived, created_at, updated_at)
         VALUES (@id, @orgId, @funderId, @ownerUserId, @title, @program, @status, @requestedCents, @awardedCents,
            @currency, @probability, @purpose, @requirements, @nextAction, @notes, @applicationDate, @decisionDate,
            @startDate, @endDate, @renewalDate, @closeoutDate, 0, @now, @now)`,
      )
      .run({ id, orgId: session.orgId, now, ...input, currency });

    logActivity(req.db, {
      orgId: session.orgId,
      actorUserId: session.userId,
      entityType: 'GRANT',
      entityId: id,
      grantId: id,
      action: 'CREATED',
      summary: `Created grant “${input.title}” for ${funder.name}`,
      metadata: { status: input.status },
    });

    res.status(201).json(getGrantDetail(req.db, session.orgId, id, today(req)));
  }),
);

/* ------------------------------------------------------------------ update */

router.put(
  '/:grantId',
  requireCapability('grants:write'),
  handler((req, res) => {
    const session = currentSession(req);
    const grantId = req.params.grantId!;
    const existing = getGrantRow(req.db, session.orgId, grantId);
    const input = parseBody(grantSchema, req.body);

    const funder = req.db
      .prepare('SELECT id, name FROM funders WHERE org_id = ? AND id = ?')
      .get(session.orgId, input.funderId) as { id: string; name: string } | undefined;
    if (!funder) throw notFound('Funder');

    if (input.ownerUserId && !isMember(req.db, session.orgId, input.ownerUserId)) {
      throw notFound('Owner');
    }

    const currency = input.currency ?? session.currency;
    assertOrgCurrency(currency, session.currency);

    // The status-only route enforces exactly these rules; keep them in lockstep.
    if (input.status !== existing.status) {
      const denial = statusChangeDenialReason(input.status, {
        status: existing.status,
        awardedCents: input.awardedCents,
        ...openObligations(req.db, session.orgId, grantId),
      });
      if (denial) throw conflict(denial);
    }

    const now = new Date().toISOString();
    req.db
      .prepare(
        `UPDATE grants SET funder_id = @funderId, owner_user_id = @ownerUserId, title = @title, program = @program,
            status = @status, requested_cents = @requestedCents, awarded_cents = @awardedCents, currency = @currency,
            probability = @probability, purpose = @purpose, requirements = @requirements, next_action = @nextAction,
            notes = @notes, application_date = @applicationDate, decision_date = @decisionDate,
            start_date = @startDate, end_date = @endDate, renewal_date = @renewalDate,
            closeout_date = @closeoutDate, updated_at = @now
          WHERE id = @id AND org_id = @orgId`,
      )
      .run({ id: grantId, orgId: session.orgId, now, ...input, currency });

    const changes = describeChanges([
      { label: 'Status', from: GRANT_STATUS_LABELS[existing.status], to: GRANT_STATUS_LABELS[input.status] },
      { label: 'Title', from: existing.title, to: input.title },
      { label: 'Awarded', from: existing.awarded_cents, to: input.awardedCents },
      { label: 'Period end', from: existing.end_date, to: input.endDate },
      { label: 'Owner', from: existing.owner_user_id, to: input.ownerUserId },
    ]);

    logActivity(req.db, {
      orgId: session.orgId,
      actorUserId: session.userId,
      entityType: 'GRANT',
      entityId: grantId,
      grantId,
      action: 'UPDATED',
      summary: changes ? `Updated grant — ${changes}` : `Updated grant “${input.title}”`,
    });

    res.json(getGrantDetail(req.db, session.orgId, grantId, today(req)));
  }),
);

/** Status-only change, used by the board view and the header control. */
router.patch(
  '/:grantId/status',
  requireCapability('grants:write'),
  handler((req, res) => {
    const session = currentSession(req);
    const grantId = req.params.grantId!;
    const existing = getGrantRow(req.db, session.orgId, grantId);
    const { status } = parseBody(grantStatusSchema, req.body);

    if (status === existing.status) {
      res.json(getGrantDetail(req.db, session.orgId, grantId, today(req)));
      return;
    }

    // Same invariants as the full edit route — see shared/lifecycle.ts.
    const denial = statusChangeDenialReason(status, {
      status: existing.status,
      awardedCents: existing.awarded_cents,
      ...openObligations(req.db, session.orgId, grantId),
    });
    if (denial) throw conflict(denial);

    const now = new Date().toISOString();
    req.db
      .prepare('UPDATE grants SET status = ?, updated_at = ? WHERE id = ? AND org_id = ?')
      .run(status, now, grantId, session.orgId);

    logActivity(req.db, {
      orgId: session.orgId,
      actorUserId: session.userId,
      entityType: 'GRANT',
      entityId: grantId,
      grantId,
      action: 'STATUS_CHANGED',
      summary: `Status changed from ${GRANT_STATUS_LABELS[existing.status]} to ${GRANT_STATUS_LABELS[status]}`,
      metadata: { from: existing.status, to: status },
    });

    res.json(getGrantDetail(req.db, session.orgId, grantId, today(req)));
  }),
);

/** Archive / restore. The main UI never hard-deletes a grant. */
router.patch(
  '/:grantId/archive',
  requireCapability('grants:archive'),
  handler((req, res) => {
    const session = currentSession(req);
    const grantId = req.params.grantId!;
    const existing = getGrantRow(req.db, session.orgId, grantId);
    const { archived } = parseBody(archiveSchema, req.body);

    // Restoring is always safe; archiving must never hide live obligations.
    if (archived) {
      const denial = archiveDenialReason({
        status: existing.status,
        awardedCents: existing.awarded_cents,
        ...openObligations(req.db, session.orgId, grantId),
      });
      if (denial) throw conflict(denial);
    }

    req.db
      .prepare('UPDATE grants SET archived = ?, updated_at = ? WHERE id = ? AND org_id = ?')
      .run(archived ? 1 : 0, new Date().toISOString(), grantId, session.orgId);

    logActivity(req.db, {
      orgId: session.orgId,
      actorUserId: session.userId,
      entityType: 'GRANT',
      entityId: grantId,
      grantId,
      action: archived ? 'ARCHIVED' : 'RESTORED',
      summary: `${archived ? 'Archived' : 'Restored'} grant “${existing.title}”`,
    });

    res.json(getGrantDetail(req.db, session.orgId, grantId, today(req)));
  }),
);

export function isMember(db: Parameters<typeof getGrantRow>[0], orgId: string, userId: string): boolean {
  const row = db.prepare('SELECT 1 AS ok FROM memberships WHERE org_id = ? AND user_id = ?').get(orgId, userId);
  return Boolean(row);
}

/**
 * Every grant in an organization uses that organization's currency.
 *
 * Portfolio totals sum grants directly, so allowing mixed currencies would
 * produce a meaningless number. Multi-currency with FX conversion is out of
 * scope for this MVP, and silently adding CAD to USD would be worse than
 * refusing.
 */
export function assertOrgCurrency(currency: string, orgCurrency: string): void {
  if (currency !== orgCurrency) {
    throw validationError(
      `Grants must use the organization currency (${orgCurrency}). Change it in Settings to record grants in another currency.`,
      { currency: `Must be ${orgCurrency}.` },
    );
  }
}

/** Live obligations on a grant, used by every lifecycle guard. */
export function openObligations(
  db: Parameters<typeof getGrantRow>[0],
  orgId: string,
  grantId: string,
): OpenObligations {
  const tasks = db
    .prepare("SELECT COUNT(*) AS count FROM tasks WHERE org_id = ? AND grant_id = ? AND status <> 'DONE'")
    .get(orgId, grantId) as { count: number };
  const milestones = db
    .prepare(
      "SELECT COUNT(*) AS count FROM milestones WHERE org_id = ? AND grant_id = ? AND status NOT IN ('COMPLETE','WAIVED')",
    )
    .get(orgId, grantId) as { count: number };
  return { openTaskCount: tasks.count, openMilestoneCount: milestones.count };
}

export default router;
