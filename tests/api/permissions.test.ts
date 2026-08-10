import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ROLE_CAPABILITIES } from '../../shared/permissions';
import {
  createTestContext,
  DEMO_USERS,
  del,
  grantIdByTitle,
  patch,
  post,
  put,
  seedContext,
  signIn,
  type Client,
  type TestContext,
} from '../helpers/context';

let context: TestContext;
let owner: Client;
let manager: Client;
let member: Client;
let viewer: Client;
let grantId: string;

beforeAll(async () => {
  context = createTestContext();
  await seedContext(context);
  [owner, manager, member, viewer] = await Promise.all([
    signIn(context.app, DEMO_USERS.owner),
    signIn(context.app, DEMO_USERS.manager),
    signIn(context.app, DEMO_USERS.member),
    signIn(context.app, DEMO_USERS.viewer),
  ]);
  grantId = grantIdByTitle(context.db, 'Family Stability Navigators');
});

afterAll(() => context.cleanup());

describe('capability matrix', () => {
  it('gives each role exactly the documented capabilities', () => {
    expect(ROLE_CAPABILITIES.VIEWER).toEqual(['grants:read', 'export:run']);
    expect(ROLE_CAPABILITIES.MEMBER).toContain('grants:write');
    expect(ROLE_CAPABILITIES.MEMBER).not.toContain('team:manage');
    expect(ROLE_CAPABILITIES.MEMBER).not.toContain('org:manage');
    expect(ROLE_CAPABILITIES.MEMBER).not.toContain('documents:delete');
    expect(ROLE_CAPABILITIES.MANAGER).toContain('team:manage');
    expect(ROLE_CAPABILITIES.MANAGER).not.toContain('org:manage');
    expect(ROLE_CAPABILITIES.OWNER).toContain('org:manage');
  });

  it('reports the same capabilities to the client that the server enforces', async () => {
    expect(viewer.session.capabilities).toEqual([...ROLE_CAPABILITIES.VIEWER]);
    expect(member.session.capabilities).toEqual([...ROLE_CAPABILITIES.MEMBER]);
  });
});

describe('viewer is read-only', () => {
  it('can read every surface', async () => {
    for (const path of ['/api/dashboard', '/api/grants', '/api/funders', '/api/calendar', '/api/team', `/api/grants/${grantId}`]) {
      const response = await viewer.agent.get(path);
      expect(response.status, `GET ${path}`).toBe(200);
    }
  });

  it('can run exports', async () => {
    const response = await viewer.agent.get('/api/grants/export.csv');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
  });

  it('is denied every mutation, with an explanatory message', async () => {
    // Each entry is a thunk so the requests run one at a time; supertest binds an
    // ephemeral port per request and firing them concurrently exhausts it.
    const attempts: Array<[string, () => Promise<{ status: number; body: { error?: { message?: string } } }>]> = [
      ['create grant', () => post(viewer, '/api/grants').send({ title: 'X', funderId: 'f', status: 'PROSPECT' })],
      ['edit grant', () => put(viewer, `/api/grants/${grantId}`).send({ title: 'X', funderId: 'f', status: 'PROSPECT' })],
      ['change status', () => patch(viewer, `/api/grants/${grantId}/status`).send({ status: 'CLOSED' })],
      ['archive grant', () => patch(viewer, `/api/grants/${grantId}/archive`).send({ archived: true })],
      ['create task', () => post(viewer, `/api/grants/${grantId}/tasks`).send({ title: 'X' })],
      ['create deliverable', () => post(viewer, `/api/grants/${grantId}/milestones`).send({ type: 'REPORT', title: 'X' })],
      ['create budget line', () => post(viewer, `/api/grants/${grantId}/budget-lines`).send({ category: 'X' })],
      ['add note', () => post(viewer, `/api/grants/${grantId}/comments`).send({ body: 'X' })],
      ['create funder', () => post(viewer, '/api/funders').send({ name: 'X', type: 'CORPORATE' })],
      ['change a role', () => patch(viewer, `/api/team/${member.session.user.id}/role`).send({ role: 'VIEWER' })],
      [
        'change settings',
        () =>
          put(viewer, '/api/organization').send({
            name: 'X',
            timezone: 'UTC',
            currency: 'USD',
            fiscalYearStartMonth: 1,
          }),
      ],
    ];

    for (const [label, attempt] of attempts) {
      const response = await attempt();
      expect(response.status, label).toBe(403);
      expect(response.body.error?.message, label).toMatch(/read-only|does not allow/i);
    }
  });

  it('leaves no trace of a denied mutation', async () => {
    const before = (context.db.prepare('SELECT COUNT(*) AS c FROM tasks').get() as { c: number }).c;
    await post(viewer, `/api/grants/${grantId}/tasks`).send({ title: 'Should not exist' });
    const after = (context.db.prepare('SELECT COUNT(*) AS c FROM tasks').get() as { c: number }).c;
    expect(after).toBe(before);
  });
});

describe('member permissions', () => {
  it('can do normal grant work', async () => {
    const task = await post(member, `/api/grants/${grantId}/tasks`).send({ title: 'Member task', priority: 'LOW' });
    expect(task.status).toBe(201);

    const comment = await post(member, `/api/grants/${grantId}/comments`).send({ body: 'Member note' });
    expect(comment.status).toBe(201);

    const budget = await post(member, `/api/grants/${grantId}/budget-lines`).send({
      category: 'Member line',
      plannedCents: '100',
    });
    expect(budget.status).toBe(201);
  });

  it('cannot administer the team or organization settings', async () => {
    const role = await patch(member, `/api/team/${viewer.session.user.id}/role`).send({ role: 'MEMBER' });
    expect(role.status).toBe(403);

    const settings = await put(member, '/api/organization').send({
      name: 'Renamed by member',
      timezone: 'UTC',
      currency: 'USD',
      fiscalYearStartMonth: 1,
    });
    expect(settings.status).toBe(403);
  });

  it('cannot delete evidence', async () => {
    const documentId = (
      context.db.prepare('SELECT id FROM documents WHERE grant_id = ? LIMIT 1').get(grantId) as { id: string }
    ).id;
    const response = await del(member, `/api/grants/${grantId}/documents/${documentId}`);
    expect(response.status).toBe(403);
  });
});

describe('manager permissions', () => {
  it('can manage grant records and team roles', async () => {
    const status = await patch(manager, `/api/grants/${grantId}/status`).send({ status: 'REPORTING' });
    expect(status.status).toBe(200);

    const role = await patch(manager, `/api/team/${member.session.user.id}/role`).send({ role: 'MEMBER' });
    expect(role.status).toBe(200);
  });

  it('cannot change an owner’s role', async () => {
    const response = await patch(manager, `/api/team/${owner.session.user.id}/role`).send({ role: 'MEMBER' });
    expect(response.status).toBe(403);
    expect(response.body.error.message).toMatch(/only an owner/i);
  });

  it('cannot promote anyone to owner', async () => {
    const response = await patch(manager, `/api/team/${member.session.user.id}/role`).send({ role: 'OWNER' });
    expect(response.status).toBe(403);
    expect(response.body.error.message).toMatch(/only an owner/i);
  });

  it('cannot change organization settings', async () => {
    const response = await put(manager, '/api/organization').send({
      name: 'Renamed by manager',
      timezone: 'UTC',
      currency: 'USD',
      fiscalYearStartMonth: 1,
    });
    expect(response.status).toBe(403);
  });
});

describe('owner permissions', () => {
  it('can change organization settings', async () => {
    const response = await put(owner, '/api/organization').send({
      name: 'Riverbend Community Alliance',
      timezone: 'America/Los_Angeles',
      currency: 'USD',
      fiscalYearStartMonth: 7,
    });
    expect(response.status).toBe(200);
    expect(response.body.fiscalYearStartMonth).toBe(7);
  });

  it('rejects an invalid timezone', async () => {
    const response = await put(owner, '/api/organization').send({
      name: 'Riverbend Community Alliance',
      timezone: 'Mars/Olympus',
      currency: 'USD',
      fiscalYearStartMonth: 7,
    });
    expect(response.status).toBe(422);
    expect(response.body.error.fields.timezone).toMatch(/not recognised/i);
  });

  it('cannot demote itself while it is the only owner', async () => {
    const ownerCount = (
      context.db
        .prepare("SELECT COUNT(*) AS c FROM memberships m JOIN organizations o ON o.id = m.org_id WHERE o.slug = 'riverbend' AND m.role = 'OWNER'")
        .get() as { c: number }
    ).c;
    expect(ownerCount).toBe(1);

    const response = await patch(owner, `/api/team/${owner.session.user.id}/role`).send({ role: 'MEMBER' });
    expect(response.status).toBe(403);
    expect(response.body.error.message).toMatch(/only owner/i);
  });

  it('can promote another member to owner and then step down', async () => {
    const promote = await patch(owner, `/api/team/${manager.session.user.id}/role`).send({ role: 'OWNER' });
    expect(promote.status).toBe(200);

    const stepDown = await patch(owner, `/api/team/${owner.session.user.id}/role`).send({ role: 'MANAGER' });
    expect(stepDown.status).toBe(200);

    // Restore the seeded arrangement for any later assertions.
    const restored = await signIn(context.app, DEMO_USERS.manager);
    await patch(restored, `/api/team/${owner.session.user.id}/role`).send({ role: 'OWNER' });
    await patch(restored, `/api/team/${manager.session.user.id}/role`).send({ role: 'MANAGER' });
  });
});

describe('unauthenticated access', () => {
  it('refuses every protected route', async () => {
    const { app } = context;
    const request = (await import('supertest')).default;
    for (const path of ['/api/dashboard', '/api/grants', '/api/funders', '/api/team', '/api/reports/portfolio']) {
      const response = await request(app).get(path);
      expect(response.status, path).toBe(401);
    }
  });
});
