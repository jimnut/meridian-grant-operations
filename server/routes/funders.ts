import { Router } from 'express';

import { currentSession, requireCapability } from '../auth/middleware';
import { logActivity } from '../lib/activity';
import { conflict, notFound } from '../lib/errors';
import { handler, parseBody } from '../lib/http';
import { newId } from '../lib/ids';
import { archiveSchema, funderContactSchema, funderSchema } from '../lib/validation';
import { loadPortfolio } from '../services/portfolio';
import { mapFunder, mapFunderContact, type FunderContactRow, type FunderRow } from '../services/rows';
import { renewalExposure, type PortfolioGrantInput } from '../../shared/analytics';
import { ACTIVE_STATUSES } from '../../shared/constants';
import { todayInTimezone } from '../../shared/dates';
import { sumCents } from '../../shared/money';
import type { DeadlineRef, FunderSummary } from '../../shared/types';

const router = Router();

function buildSummaries(req: Parameters<typeof currentSession>[0]): FunderSummary[] {
  const session = currentSession(req);
  const today = todayInTimezone(session.timezone);

  const funderRows = req.db
    .prepare('SELECT * FROM funders WHERE org_id = ? ORDER BY archived, name')
    .all(session.orgId) as FunderRow[];
  const contactRows = req.db
    .prepare('SELECT * FROM funder_contacts WHERE org_id = ? ORDER BY name')
    .all(session.orgId) as FunderContactRow[];
  const { grants } = loadPortfolio(req.db, session.orgId, today, { includeArchived: true });

  const contactsByFunder = new Map<string, FunderContactRow[]>();
  for (const row of contactRows) {
    const list = contactsByFunder.get(row.funder_id) ?? [];
    list.push(row);
    contactsByFunder.set(row.funder_id, list);
  }

  return funderRows.map((row) => {
    const funderGrants = grants.filter((g) => g.funderId === row.id);
    const activeGrants = funderGrants.filter((g) => ACTIVE_STATUSES.includes(g.status));

    const inputs: PortfolioGrantInput[] = funderGrants.map((g) => ({
      id: g.id,
      status: g.status,
      requestedCents: g.requestedCents,
      awardedCents: g.awardedCents,
      probability: g.probability,
      startDate: g.startDate,
      endDate: g.endDate,
      renewalDate: g.renewalDate,
      decisionDate: null,
    }));

    const deadlines = funderGrants
      .map((g) => g.nextDeadline)
      .filter((d): d is DeadlineRef => Boolean(d))
      .sort((a, b) => (a.date < b.date ? -1 : 1));

    return {
      ...mapFunder(row),
      contacts: (contactsByFunder.get(row.id) ?? []).map(mapFunderContact),
      activeGrantCount: activeGrants.length,
      totalGrantCount: funderGrants.length,
      awardedCents: sumCents(funderGrants.map((g) => g.awardedCents)),
      renewalExposureCents: renewalExposure(inputs, today, 365).cents,
      nextDeadline: deadlines[0] ?? null,
    };
  });
}

router.get(
  '/',
  handler((req, res) => {
    res.json(buildSummaries(req));
  }),
);

router.get(
  '/:funderId',
  handler((req, res) => {
    const summary = buildSummaries(req).find((f) => f.id === req.params.funderId);
    if (!summary) throw notFound('Funder');

    const session = currentSession(req);
    const today = todayInTimezone(session.timezone);
    const { grants } = loadPortfolio(req.db, session.orgId, today, { includeArchived: true });
    res.json({ funder: summary, grants: grants.filter((g) => g.funderId === summary.id) });
  }),
);

router.post(
  '/',
  requireCapability('funders:write'),
  handler((req, res) => {
    const session = currentSession(req);
    const input = parseBody(funderSchema, req.body);

    const duplicate = req.db
      .prepare('SELECT id FROM funders WHERE org_id = ? AND lower(name) = lower(?)')
      .get(session.orgId, input.name);
    if (duplicate) throw conflict('A funder with that name already exists.');

    const id = newId('fnd');
    const now = new Date().toISOString();
    req.db
      .prepare(
        `INSERT INTO funders (id, org_id, name, type, focus_areas, website, notes, archived, created_at, updated_at)
         VALUES (@id, @orgId, @name, @type, @focusAreas, @website, @notes, 0, @now, @now)`,
      )
      .run({ id, orgId: session.orgId, now, ...input, focusAreas: input.focusAreas.join('|') });

    logActivity(req.db, {
      orgId: session.orgId,
      actorUserId: session.userId,
      entityType: 'FUNDER',
      entityId: id,
      action: 'CREATED',
      summary: `Added funder “${input.name}”`,
    });

    const created = req.db.prepare('SELECT * FROM funders WHERE id = ?').get(id) as FunderRow;
    res.status(201).json(mapFunder(created));
  }),
);

router.put(
  '/:funderId',
  requireCapability('funders:write'),
  handler((req, res) => {
    const session = currentSession(req);
    const funderId = req.params.funderId!;
    const existing = req.db.prepare('SELECT * FROM funders WHERE org_id = ? AND id = ?').get(session.orgId, funderId) as
      | FunderRow
      | undefined;
    if (!existing) throw notFound('Funder');

    const input = parseBody(funderSchema, req.body);
    const duplicate = req.db
      .prepare('SELECT id FROM funders WHERE org_id = ? AND lower(name) = lower(?) AND id <> ?')
      .get(session.orgId, input.name, funderId);
    if (duplicate) throw conflict('Another funder already uses that name.');

    req.db
      .prepare(
        `UPDATE funders SET name = @name, type = @type, focus_areas = @focusAreas, website = @website,
            notes = @notes, updated_at = @now
          WHERE id = @id AND org_id = @orgId`,
      )
      .run({
        id: funderId,
        orgId: session.orgId,
        now: new Date().toISOString(),
        ...input,
        focusAreas: input.focusAreas.join('|'),
      });

    logActivity(req.db, {
      orgId: session.orgId,
      actorUserId: session.userId,
      entityType: 'FUNDER',
      entityId: funderId,
      action: 'UPDATED',
      summary: `Updated funder “${input.name}”`,
    });

    const updated = req.db.prepare('SELECT * FROM funders WHERE id = ?').get(funderId) as FunderRow;
    res.json(mapFunder(updated));
  }),
);

router.patch(
  '/:funderId/archive',
  requireCapability('funders:write'),
  handler((req, res) => {
    const session = currentSession(req);
    const funderId = req.params.funderId!;
    const existing = req.db.prepare('SELECT * FROM funders WHERE org_id = ? AND id = ?').get(session.orgId, funderId) as
      | FunderRow
      | undefined;
    if (!existing) throw notFound('Funder');

    const { archived } = parseBody(archiveSchema, req.body);
    if (archived) {
      const activeGrants = req.db
        .prepare(
          `SELECT COUNT(*) AS count FROM grants
            WHERE org_id = ? AND funder_id = ? AND archived = 0
              AND status IN ('AWARDED','REPORTING','RENEWAL','CLOSEOUT')`,
        )
        .get(session.orgId, funderId) as { count: number };
      if (activeGrants.count > 0) {
        throw conflict(
          `This funder still has ${activeGrants.count} active grant${activeGrants.count === 1 ? '' : 's'}. Close or archive them first.`,
        );
      }
    }

    req.db
      .prepare('UPDATE funders SET archived = ?, updated_at = ? WHERE id = ? AND org_id = ?')
      .run(archived ? 1 : 0, new Date().toISOString(), funderId, session.orgId);

    logActivity(req.db, {
      orgId: session.orgId,
      actorUserId: session.userId,
      entityType: 'FUNDER',
      entityId: funderId,
      action: archived ? 'ARCHIVED' : 'RESTORED',
      summary: `${archived ? 'Archived' : 'Restored'} funder “${existing.name}”`,
    });

    const updated = req.db.prepare('SELECT * FROM funders WHERE id = ?').get(funderId) as FunderRow;
    res.json(mapFunder(updated));
  }),
);

/* ---------------------------------------------------------------- contacts */

router.post(
  '/:funderId/contacts',
  requireCapability('funders:write'),
  handler((req, res) => {
    const session = currentSession(req);
    const funderId = req.params.funderId!;
    const funder = req.db.prepare('SELECT name FROM funders WHERE org_id = ? AND id = ?').get(session.orgId, funderId) as
      | { name: string }
      | undefined;
    if (!funder) throw notFound('Funder');

    const input = parseBody(funderContactSchema, req.body);
    const id = newId('fct');
    const now = new Date().toISOString();
    req.db
      .prepare(
        `INSERT INTO funder_contacts (id, org_id, funder_id, name, title, email, phone, notes, created_at, updated_at)
         VALUES (@id, @orgId, @funderId, @name, @title, @email, @phone, @notes, @now, @now)`,
      )
      .run({ id, orgId: session.orgId, funderId, now, ...input });

    logActivity(req.db, {
      orgId: session.orgId,
      actorUserId: session.userId,
      entityType: 'FUNDER_CONTACT',
      entityId: id,
      action: 'CREATED',
      summary: `Added contact ${input.name} at ${funder.name}`,
    });

    const created = req.db.prepare('SELECT * FROM funder_contacts WHERE id = ?').get(id) as FunderContactRow;
    res.status(201).json(mapFunderContact(created));
  }),
);

router.put(
  '/:funderId/contacts/:contactId',
  requireCapability('funders:write'),
  handler((req, res) => {
    const session = currentSession(req);
    const { funderId, contactId } = req.params as { funderId: string; contactId: string };
    const existing = req.db
      .prepare('SELECT * FROM funder_contacts WHERE org_id = ? AND funder_id = ? AND id = ?')
      .get(session.orgId, funderId, contactId) as FunderContactRow | undefined;
    if (!existing) throw notFound('Contact');

    const input = parseBody(funderContactSchema, req.body);
    req.db
      .prepare(
        `UPDATE funder_contacts SET name = @name, title = @title, email = @email, phone = @phone, notes = @notes,
            updated_at = @now
          WHERE id = @id AND org_id = @orgId`,
      )
      .run({ id: contactId, orgId: session.orgId, now: new Date().toISOString(), ...input });

    logActivity(req.db, {
      orgId: session.orgId,
      actorUserId: session.userId,
      entityType: 'FUNDER_CONTACT',
      entityId: contactId,
      action: 'UPDATED',
      summary: `Updated contact ${input.name}`,
    });

    const updated = req.db.prepare('SELECT * FROM funder_contacts WHERE id = ?').get(contactId) as FunderContactRow;
    res.json(mapFunderContact(updated));
  }),
);

router.delete(
  '/:funderId/contacts/:contactId',
  requireCapability('funders:write'),
  handler((req, res) => {
    const session = currentSession(req);
    const { funderId, contactId } = req.params as { funderId: string; contactId: string };
    const existing = req.db
      .prepare('SELECT name FROM funder_contacts WHERE org_id = ? AND funder_id = ? AND id = ?')
      .get(session.orgId, funderId, contactId) as { name: string } | undefined;
    if (!existing) throw notFound('Contact');

    req.db.prepare('DELETE FROM funder_contacts WHERE id = ? AND org_id = ?').run(contactId, session.orgId);
    logActivity(req.db, {
      orgId: session.orgId,
      actorUserId: session.userId,
      entityType: 'FUNDER_CONTACT',
      entityId: contactId,
      action: 'DELETED',
      summary: `Removed contact ${existing.name}`,
    });
    res.status(204).end();
  }),
);

export default router;
