import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createTestContext,
  DEMO_USERS,
  del,
  patch,
  post,
  put,
  seedContext,
  signIn,
  type Client,
  type TestContext,
} from '../helpers/context';

let context: TestContext;
let riverbend: Client;
let cascade: Client;

/** IDs that genuinely exist, but in the other tenant. */
let foreignGrantId: string;
let foreignFunderId: string;
let foreignTaskId: string;
let foreignMilestoneId: string;
let foreignDocumentId: string;
let foreignBudgetLineId: string;
let foreignUserId: string;

beforeAll(async () => {
  context = createTestContext();
  await seedContext(context);
  riverbend = await signIn(context.app, DEMO_USERS.member); // Riverbend only
  cascade = await signIn(context.app, DEMO_USERS.otherOrgMember); // Cascade only

  const cascadeOrgId = (
    context.db.prepare("SELECT id FROM organizations WHERE slug = 'cascade-youth'").get() as { id: string }
  ).id;

  foreignGrantId = (
    context.db.prepare('SELECT id FROM grants WHERE org_id = ? LIMIT 1').get(cascadeOrgId) as { id: string }
  ).id;
  foreignFunderId = (
    context.db.prepare('SELECT id FROM funders WHERE org_id = ? LIMIT 1').get(cascadeOrgId) as { id: string }
  ).id;
  foreignTaskId = (
    context.db.prepare('SELECT id FROM tasks WHERE org_id = ? LIMIT 1').get(cascadeOrgId) as { id: string }
  ).id;
  foreignMilestoneId = (
    context.db.prepare('SELECT id FROM milestones WHERE org_id = ? LIMIT 1').get(cascadeOrgId) as { id: string }
  ).id;
  foreignBudgetLineId = (
    context.db.prepare('SELECT id FROM budget_lines WHERE org_id = ? LIMIT 1').get(cascadeOrgId) as { id: string }
  ).id;
  // Dana sits on both boards, so pick a user who belongs to Cascade *only*.
  foreignUserId = (
    context.db
      .prepare(
        `SELECT m.user_id AS id FROM memberships m
          WHERE m.org_id = ?
            AND m.user_id NOT IN (
              SELECT user_id FROM memberships
               WHERE org_id = (SELECT id FROM organizations WHERE slug = 'riverbend')
            )
          LIMIT 1`,
      )
      .get(cascadeOrgId) as { id: string }
  ).id;

  // The Riverbend tenant owns every seeded document; use one of its own for the
  // reverse-direction check.
  foreignDocumentId = (context.db.prepare('SELECT id FROM documents LIMIT 1').get() as { id: string }).id;
});

afterAll(() => context.cleanup());

describe('list endpoints never leak across tenants', () => {
  it('returns only the signed-in organization’s grants', async () => {
    const mine = await riverbend.agent.get('/api/grants?pageSize=100');
    const theirs = await cascade.agent.get('/api/grants?pageSize=100');

    expect(mine.body.total).toBeGreaterThan(0);
    expect(theirs.body.total).toBeGreaterThan(0);

    const mineIds = new Set(mine.body.items.map((g: { id: string }) => g.id));
    const theirIds = new Set(theirs.body.items.map((g: { id: string }) => g.id));
    for (const id of theirIds) {
      expect(mineIds.has(id as string)).toBe(false);
    }
    expect(mineIds.has(foreignGrantId)).toBe(false);
  });

  it('scopes funders, calendar, team, activity and reports', async () => {
    const funders = await riverbend.agent.get('/api/funders');
    expect(funders.body.some((f: { id: string }) => f.id === foreignFunderId)).toBe(false);

    const calendar = await riverbend.agent.get('/api/calendar?includeComplete=true');
    expect(calendar.body.events.some((e: { grantId: string }) => e.grantId === foreignGrantId)).toBe(false);

    const team = await riverbend.agent.get('/api/team');
    expect(team.body.some((m: { userId: string }) => m.userId === foreignUserId)).toBe(false);

    const activity = await riverbend.agent.get('/api/activity?limit=200');
    expect(activity.body.some((a: { grantId: string | null }) => a.grantId === foreignGrantId)).toBe(false);

    const report = await riverbend.agent.get('/api/reports/portfolio');
    expect(report.body.byFunder.some((f: { funderId: string }) => f.funderId === foreignFunderId)).toBe(false);
  });

  it('scopes search results', async () => {
    const results = await riverbend.agent.get('/api/search?q=Peer');
    expect(results.status).toBe(200);
    expect(results.body.grants.some((g: { id: string }) => g.id === foreignGrantId)).toBe(false);
  });

  it('scopes lookups used by forms', async () => {
    const lookups = await riverbend.agent.get('/api/lookups');
    expect(lookups.body.funders.some((f: { id: string }) => f.id === foreignFunderId)).toBe(false);
    expect(lookups.body.members.some((m: { id: string }) => m.id === foreignUserId)).toBe(false);
  });

  it('computes dashboards from the signed-in tenant only', async () => {
    const mine = await riverbend.agent.get('/api/dashboard');
    const theirs = await cascade.agent.get('/api/dashboard');
    expect(mine.body.totals.activeAwardedCents).not.toBe(theirs.body.totals.activeAwardedCents);
    expect(mine.body.attention.every((a: { grantId: string }) => a.grantId !== foreignGrantId)).toBe(true);
  });
});

describe('foreign record IDs return a safe 404', () => {
  it('hides a foreign grant behind the same message as a missing one', async () => {
    const foreign = await riverbend.agent.get(`/api/grants/${foreignGrantId}`);
    const missing = await riverbend.agent.get('/api/grants/gr_doesnotexist');

    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(foreign.body.error.message).toBe(missing.body.error.message);
    // No metadata about the foreign record leaks.
    expect(JSON.stringify(foreign.body)).not.toContain('Peer Mentoring');
  });

  it('hides foreign funders', async () => {
    const response = await riverbend.agent.get(`/api/funders/${foreignFunderId}`);
    expect(response.status).toBe(404);
    expect(JSON.stringify(response.body)).not.toContain('Tri-County');
  });

  it('hides foreign reporting packets', async () => {
    const response = await riverbend.agent.get(`/api/grants/${foreignGrantId}/packet`);
    expect(response.status).toBe(404);
  });

  it('hides foreign evidence downloads', async () => {
    const response = await cascade.agent.get(`/api/grants/${foreignGrantId}/documents/${foreignDocumentId}/download`);
    expect(response.status).toBe(404);
  });
});

describe('foreign record IDs cannot be mutated', () => {
  it('refuses to edit, restatus or archive a foreign grant', async () => {
    const edit = await put(riverbend, `/api/grants/${foreignGrantId}`).send({
      title: 'Hijacked',
      funderId: foreignFunderId,
      status: 'AWARDED',
      awardedCents: '1',
    });
    expect(edit.status).toBe(404);

    const status = await patch(riverbend, `/api/grants/${foreignGrantId}/status`).send({ status: 'CLOSED' });
    expect(status.status).toBe(404);

    const archive = await patch(riverbend, `/api/grants/${foreignGrantId}/archive`).send({ archived: true });
    expect(archive.status).toBe(404);

    const stillThere = context.db.prepare('SELECT title, status, archived FROM grants WHERE id = ?').get(foreignGrantId) as {
      title: string;
      status: string;
      archived: number;
    };
    expect(stillThere.title).not.toBe('Hijacked');
    expect(stillThere.archived).toBe(0);
  });

  it('refuses to add children to a foreign grant', async () => {
    for (const [path, body] of [
      [`/api/grants/${foreignGrantId}/tasks`, { title: 'Injected task' }],
      [`/api/grants/${foreignGrantId}/milestones`, { type: 'REPORT', title: 'Injected report' }],
      [`/api/grants/${foreignGrantId}/budget-lines`, { category: 'Injected line' }],
      [`/api/grants/${foreignGrantId}/comments`, { body: 'Injected note' }],
    ] as const) {
      const response = await post(riverbend, path).send(body);
      expect(response.status, path).toBe(404);
    }

    const injected = context.db
      .prepare("SELECT COUNT(*) AS c FROM tasks WHERE title = 'Injected task'")
      .get() as { c: number };
    expect(injected.c).toBe(0);
  });

  it('refuses to modify foreign children even via the correct grant id', async () => {
    const task = await patch(riverbend, `/api/grants/${foreignGrantId}/tasks/${foreignTaskId}`).send({ status: 'DONE' });
    expect(task.status).toBe(404);

    const milestone = await patch(riverbend, `/api/grants/${foreignGrantId}/milestones/${foreignMilestoneId}`).send({
      status: 'COMPLETE',
    });
    expect(milestone.status).toBe(404);

    const budget = await put(riverbend, `/api/grants/${foreignGrantId}/budget-lines/${foreignBudgetLineId}`).send({
      category: 'Hijacked',
      plannedCents: '1',
    });
    expect(budget.status).toBe(404);

    const deleted = await del(riverbend, `/api/grants/${foreignGrantId}/tasks/${foreignTaskId}`);
    expect(deleted.status).toBe(404);

    const untouched = context.db.prepare('SELECT status FROM tasks WHERE id = ?').get(foreignTaskId) as {
      status: string;
    };
    expect(untouched.status).not.toBe('DONE');
  });

  it('refuses to change a foreign team member’s role', async () => {
    const owner = await signIn(context.app, DEMO_USERS.owner);
    const response = await patch(owner, `/api/team/${foreignUserId}/role`).send({ role: 'VIEWER' });
    expect(response.status).toBe(404);
  });

  it('refuses to attach a foreign funder to a new grant', async () => {
    const response = await post(riverbend, '/api/grants').send({
      title: 'Cross-tenant grant',
      funderId: foreignFunderId,
      status: 'PROSPECT',
    });
    expect(response.status).toBe(404);
    expect(response.body.error.message).toMatch(/not found/i);
  });

  it('refuses to assign a foreign user as grant owner', async () => {
    const ownFunderId = (
      context.db
        .prepare('SELECT id FROM funders WHERE org_id = (SELECT id FROM organizations WHERE slug = ?) LIMIT 1')
        .get('riverbend') as { id: string }
    ).id;

    const response = await post(riverbend, '/api/grants').send({
      title: 'Foreign owner grant',
      funderId: ownFunderId,
      ownerUserId: foreignUserId,
      status: 'PROSPECT',
    });
    expect(response.status).toBe(404);
  });

  it('refuses to assign a foreign user as task assignee', async () => {
    const ownGrantId = (
      context.db
        .prepare('SELECT id FROM grants WHERE org_id = (SELECT id FROM organizations WHERE slug = ?) LIMIT 1')
        .get('riverbend') as { id: string }
    ).id;

    const response = await post(riverbend, `/api/grants/${ownGrantId}/tasks`).send({
      title: 'Assigned across tenants',
      assigneeUserId: foreignUserId,
    });
    expect(response.status).toBe(404);
  });
});

describe('organization id is never taken from the client', () => {
  it('ignores an orgId supplied in the body', async () => {
    const cascadeOrgId = (
      context.db.prepare("SELECT id FROM organizations WHERE slug = 'cascade-youth'").get() as { id: string }
    ).id;
    const ownFunderId = (
      context.db
        .prepare('SELECT id FROM funders WHERE org_id = (SELECT id FROM organizations WHERE slug = ?) LIMIT 1')
        .get('riverbend') as { id: string }
    ).id;

    const response = await post(riverbend, '/api/grants').send({
      title: 'Org override attempt',
      funderId: ownFunderId,
      status: 'PROSPECT',
      orgId: cascadeOrgId,
      org_id: cascadeOrgId,
      organizationId: cascadeOrgId,
    });
    expect(response.status).toBe(201);

    const created = context.db
      .prepare("SELECT org_id AS orgId FROM grants WHERE title = 'Org override attempt'")
      .get() as { orgId: string };
    expect(created.orgId).not.toBe(cascadeOrgId);
  });
});
