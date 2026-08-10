import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../server/app';
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
let funderId: string;

beforeAll(async () => {
  context = createTestContext();
  await seedContext(context);
  owner = await signIn(context.app, DEMO_USERS.owner);
  funderId = (
    context.db
      .prepare("SELECT id FROM funders WHERE name = 'Alder Point Foundation'")
      .get() as { id: string }
  ).id;
});

afterAll(() => context.cleanup());

describe('grant lifecycle', () => {
  let createdId: string;

  it('creates a grant with money stored as integer cents', async () => {
    const response = await post(owner, '/api/grants').send({
      title: 'Winter Warming Centers',
      program: 'Emergency Services',
      funderId,
      ownerUserId: owner.session.user.id,
      status: 'SUBMITTED',
      requestedCents: '145,250.75',
      probability: 55,
      applicationDate: '2026-08-01',
      purpose: 'Overnight warming centers on severe weather nights.',
      requirements: 'Monthly headcount reporting.',
    });

    expect(response.status).toBe(201);
    createdId = response.body.id;
    expect(response.body.requestedCents).toBe(14_525_075);
    expect(response.body.title).toBe('Winter Warming Centers');
    expect(response.body.health.reasons.length).toBeGreaterThan(0);

    const row = context.db.prepare('SELECT requested_cents AS c FROM grants WHERE id = ?').get(createdId) as { c: number };
    expect(row.c).toBe(14_525_075);
    expect(Number.isInteger(row.c)).toBe(true);
  });

  it('records the creation in the activity trail', async () => {
    const detail = await owner.agent.get(`/api/grants/${createdId}`);
    const created = detail.body.activity.find((a: { action: string }) => a.action === 'CREATED');
    expect(created).toBeDefined();
    expect(created.actorName).toBe(owner.session.user.name);
    expect(created.summary).toContain('Winter Warming Centers');
  });

  it('rejects a grant whose period ends before it starts', async () => {
    const response = await post(owner, '/api/grants').send({
      title: 'Backwards period',
      funderId,
      status: 'PROSPECT',
      startDate: '2026-12-01',
      endDate: '2026-01-01',
    });
    expect(response.status).toBe(422);
    expect(response.body.error.fields.endDate).toMatch(/on or after/i);
  });

  it('requires an awarded amount once a grant is awarded', async () => {
    const response = await post(owner, '/api/grants').send({
      title: 'Award with no money',
      funderId,
      status: 'AWARDED',
    });
    expect(response.status).toBe(422);
    expect(response.body.error.fields.awardedCents).toMatch(/awarded amount/i);
  });

  it('rejects a declined grant that carries an award', async () => {
    const response = await post(owner, '/api/grants').send({
      title: 'Declined but funded',
      funderId,
      status: 'DECLINED',
      awardedCents: '5000',
    });
    expect(response.status).toBe(422);
  });

  it('rejects malformed money', async () => {
    const response = await post(owner, '/api/grants').send({
      title: 'Bad money',
      funderId,
      status: 'PROSPECT',
      requestedCents: 'ten thousand',
    });
    expect(response.status).toBe(422);
    expect(response.body.error.fields.requestedCents).toBeDefined();
  });

  it('rejects an empty title', async () => {
    const response = await post(owner, '/api/grants').send({ title: '   ', funderId, status: 'PROSPECT' });
    expect(response.status).toBe(422);
    expect(response.body.error.fields.title).toMatch(/required/i);
  });

  it('updates a grant and logs what changed', async () => {
    const response = await put(owner, `/api/grants/${createdId}`).send({
      title: 'Winter Warming Centers',
      program: 'Emergency Services',
      funderId,
      ownerUserId: owner.session.user.id,
      status: 'AWARDED',
      requestedCents: '145250.75',
      awardedCents: '120000',
      startDate: '2026-09-01',
      endDate: '2027-08-31',
    });

    expect(response.status).toBe(200);
    expect(response.body.awardedCents).toBe(12_000_000);
    expect(response.body.status).toBe('AWARDED');

    const change = response.body.activity.find((a: { action: string }) => a.action === 'UPDATED');
    expect(change.summary).toContain('Status: Submitted → Awarded');
  });

  it('blocks a status change that would skip recording the award', async () => {
    const prospect = await post(owner, '/api/grants').send({
      title: 'Unfunded prospect',
      funderId,
      status: 'PROSPECT',
      requestedCents: '1000',
    });
    const response = await patch(owner, `/api/grants/${prospect.body.id}/status`).send({ status: 'REPORTING' });
    expect(response.status).toBe(409);
    expect(response.body.error.message).toMatch(/awarded amount/i);
  });

  it('refuses to archive a live award, then archives once it is closed', async () => {
    const before = context.db.prepare('SELECT COUNT(*) AS c FROM grants').get() as { c: number };

    // The grant is AWARDED — archiving would hide live obligations.
    const denied = await patch(owner, `/api/grants/${createdId}/archive`).send({ archived: true });
    expect(denied.status).toBe(409);
    expect(denied.body.error.message).toMatch(/active awards cannot be archived/i);

    // Resolve the lifecycle first; with no open work, closing is allowed.
    const closed = await patch(owner, `/api/grants/${createdId}/status`).send({ status: 'CLOSED' });
    expect(closed.status).toBe(200);

    const archived = await patch(owner, `/api/grants/${createdId}/archive`).send({ archived: true });
    expect(archived.status).toBe(200);
    expect(archived.body.archived).toBe(true);

    const after = context.db.prepare('SELECT COUNT(*) AS c FROM grants').get() as { c: number };
    expect(after.c).toBe(before.c);

    // Hidden from the default list, visible when explicitly requested.
    const defaultList = await owner.agent.get('/api/grants?pageSize=100');
    expect(defaultList.body.items.some((g: { id: string }) => g.id === createdId)).toBe(false);

    const withArchived = await owner.agent.get('/api/grants?includeArchived=true&pageSize=100');
    expect(withArchived.body.items.some((g: { id: string }) => g.id === createdId)).toBe(true);

    const restored = await patch(owner, `/api/grants/${createdId}/archive`).send({ archived: false });
    expect(restored.body.archived).toBe(false);
  });

  it('persists across a brand new app instance on the same database', async () => {
    const secondApp = createApp({ db: context.db });
    const secondClient = await signIn(secondApp, DEMO_USERS.owner);
    const response = await secondClient.agent.get(`/api/grants/${createdId}`);
    expect(response.status).toBe(200);
    expect(response.body.title).toBe('Winter Warming Centers');
    expect(response.body.awardedCents).toBe(12_000_000);
  });
});

describe('tasks', () => {
  let grantId: string;
  let taskId: string;

  beforeAll(() => {
    grantId = grantIdByTitle(context.db, 'Youth Workforce Bridge');
  });

  it('creates, reads, updates and deletes', async () => {
    const created = await post(owner, `/api/grants/${grantId}/tasks`).send({
      title: 'Draft cohort outcomes memo',
      description: 'Summarise placement rates for the employer partners.',
      priority: 'HIGH',
      dueDate: '2026-09-15',
      assigneeUserId: owner.session.user.id,
    });
    expect(created.status).toBe(201);
    taskId = created.body.id;
    expect(created.body.assigneeName).toBe(owner.session.user.name);
    expect(created.body.completedAt).toBeNull();

    const list = await owner.agent.get(`/api/grants/${grantId}/tasks`);
    expect(list.body.some((t: { id: string }) => t.id === taskId)).toBe(true);

    const done = await patch(owner, `/api/grants/${grantId}/tasks/${taskId}`).send({ status: 'DONE' });
    expect(done.body.status).toBe('DONE');
    expect(done.body.completedAt).not.toBeNull();

    const reopened = await patch(owner, `/api/grants/${grantId}/tasks/${taskId}`).send({ status: 'TODO' });
    expect(reopened.body.completedAt).toBeNull();

    const removed = await del(owner, `/api/grants/${grantId}/tasks/${taskId}`);
    expect(removed.status).toBe(204);
    expect(context.db.prepare('SELECT id FROM tasks WHERE id = ?').get(taskId)).toBeUndefined();
  });

  it('clears the due date when an empty string is sent', async () => {
    const created = await post(owner, `/api/grants/${grantId}/tasks`).send({
      title: 'Dated then undated',
      dueDate: '2026-10-01',
    });
    const cleared = await patch(owner, `/api/grants/${grantId}/tasks/${created.body.id}`).send({ dueDate: '' });
    expect(cleared.body.dueDate).toBeNull();
  });

  it('rejects an invalid due date', async () => {
    const response = await post(owner, `/api/grants/${grantId}/tasks`).send({
      title: 'Bad date',
      dueDate: '2026-02-30',
    });
    expect(response.status).toBe(422);
  });
});

describe('deliverables', () => {
  let grantId: string;

  beforeAll(() => {
    grantId = grantIdByTitle(context.db, 'Senior Meals Delivery');
  });

  it('creates a deliverable and stamps submission and completion times', async () => {
    const created = await post(owner, `/api/grants/${grantId}/milestones`).send({
      type: 'FINANCIAL_REPORT',
      title: 'Quarterly expenditure summary',
      dueDate: '2026-10-15',
      requiredEvidenceCount: 3,
    });
    expect(created.status).toBe(201);
    expect(created.body.submittedAt).toBeNull();
    expect(created.body.attachedEvidenceCount).toBe(0);

    const submitted = await patch(owner, `/api/grants/${grantId}/milestones/${created.body.id}`).send({
      status: 'SUBMITTED',
    });
    expect(submitted.body.submittedAt).not.toBeNull();
    expect(submitted.body.completedAt).toBeNull();

    const complete = await patch(owner, `/api/grants/${grantId}/milestones/${created.body.id}`).send({
      status: 'COMPLETE',
    });
    expect(complete.body.completedAt).not.toBeNull();

    const reopened = await patch(owner, `/api/grants/${grantId}/milestones/${created.body.id}`).send({
      status: 'IN_PROGRESS',
    });
    expect(reopened.body.completedAt).toBeNull();
    expect(reopened.body.submittedAt).toBeNull();

    const removed = await del(owner, `/api/grants/${grantId}/milestones/${created.body.id}`);
    expect(removed.status).toBe(204);
  });

  it('rejects an out-of-range evidence requirement', async () => {
    const response = await post(owner, `/api/grants/${grantId}/milestones`).send({
      type: 'REPORT',
      title: 'Too much evidence',
      requiredEvidenceCount: 500,
    });
    expect(response.status).toBe(422);
  });

  it('changes reporting readiness when evidence requirements change', async () => {
    const before = (await owner.agent.get(`/api/grants/${grantId}`)).body.readiness.percent;
    const created = await post(owner, `/api/grants/${grantId}/milestones`).send({
      type: 'REPORT',
      title: 'Unstarted report with evidence gap',
      dueDate: '2026-09-01',
      requiredEvidenceCount: 4,
    });
    const after = (await owner.agent.get(`/api/grants/${grantId}`)).body.readiness.percent;
    expect(after).toBeLessThan(before);

    await del(owner, `/api/grants/${grantId}/milestones/${created.body.id}`);
    const restored = (await owner.agent.get(`/api/grants/${grantId}`)).body.readiness.percent;
    expect(restored).toBe(before);
  });
});

describe('budget lines', () => {
  let grantId: string;

  beforeAll(() => {
    grantId = grantIdByTitle(context.db, 'Digital Access Lab');
  });

  it('creates lines and recomputes totals exactly', async () => {
    const a = await post(owner, `/api/grants/${grantId}/budget-lines`).send({
      category: 'Evaluation',
      plannedCents: '1,000.10',
      spentCents: '0.20',
    });
    expect(a.status).toBe(201);
    expect(a.body.plannedCents).toBe(100_010);
    expect(a.body.spentCents).toBe(20);

    const detail = await owner.agent.get(`/api/grants/${grantId}`);
    const totals = detail.body.budget;
    const summed = detail.body.budgetLines.reduce(
      (sum: number, line: { plannedCents: number }) => sum + line.plannedCents,
      0,
    );
    expect(totals.plannedCents).toBe(summed);
    expect(totals.remainingCents).toBe(totals.plannedCents - totals.spentCents);

    const updated = await put(owner, `/api/grants/${grantId}/budget-lines/${a.body.id}`).send({
      category: 'Evaluation & learning',
      plannedCents: '2000',
      spentCents: '500.55',
    });
    expect(updated.body.spentCents).toBe(50_055);

    const removed = await del(owner, `/api/grants/${grantId}/budget-lines/${a.body.id}`);
    expect(removed.status).toBe(204);
  });

  it('rejects a negative amount', async () => {
    const response = await post(owner, `/api/grants/${grantId}/budget-lines`).send({
      category: 'Negative',
      plannedCents: '-100',
    });
    expect(response.status).toBe(422);
  });
});

describe('notes', () => {
  it('stores plain text and never renders markup', async () => {
    const grantId = grantIdByTitle(context.db, 'Housing Retention Fund');
    const hostile = '<script>alert(1)</script> **not markdown**';
    const created = await post(owner, `/api/grants/${grantId}/comments`).send({ body: hostile });

    expect(created.status).toBe(201);
    // Stored verbatim as text — escaping is the renderer's job, and React escapes by default.
    expect(created.body.body).toBe(hostile);

    const stored = context.db.prepare('SELECT body FROM comments WHERE id = ?').get(created.body.id) as { body: string };
    expect(stored.body).toBe(hostile);
  });

  it('rejects an empty note', async () => {
    const grantId = grantIdByTitle(context.db, 'Housing Retention Fund');
    const response = await post(owner, `/api/grants/${grantId}/comments`).send({ body: '   ' });
    expect(response.status).toBe(422);
  });

  it('rejects an oversized note', async () => {
    const grantId = grantIdByTitle(context.db, 'Housing Retention Fund');
    const response = await post(owner, `/api/grants/${grantId}/comments`).send({ body: 'x'.repeat(5000) });
    expect(response.status).toBe(422);
  });
});

describe('funders and contacts', () => {
  let createdFunderId: string;

  it('creates, updates and prevents duplicate names', async () => {
    const created = await post(owner, '/api/funders').send({
      name: 'Cedar Ridge Trust',
      type: 'FAMILY_FOUNDATION',
      focusAreas: 'Rural health, Aging',
      website: 'https://cedarridge.example.org',
      notes: 'Annual cycle, decisions in May.',
    });
    expect(created.status).toBe(201);
    createdFunderId = created.body.id;
    expect(created.body.focusAreas).toEqual(['Rural health', 'Aging']);

    const duplicate = await post(owner, '/api/funders').send({ name: 'cedar ridge trust', type: 'CORPORATE' });
    expect(duplicate.status).toBe(409);

    const updated = await put(owner, `/api/funders/${createdFunderId}`).send({
      name: 'Cedar Ridge Charitable Trust',
      type: 'FAMILY_FOUNDATION',
      focusAreas: 'Rural health',
      website: '',
      notes: '',
    });
    expect(updated.body.name).toBe('Cedar Ridge Charitable Trust');
    expect(updated.body.website).toBeNull();
  });

  it('rejects a website that is not http(s)', async () => {
    const response = await post(owner, '/api/funders').send({
      name: 'Bad Website Fund',
      type: 'CORPORATE',
      website: 'javascript:alert(1)',
    });
    expect(response.status).toBe(422);
    expect(response.body.error.fields.website).toMatch(/http/i);
  });

  it('manages contacts and validates emails', async () => {
    const created = await post(owner, `/api/funders/${createdFunderId}/contacts`).send({
      name: 'Alma Reyes',
      title: 'Trustee',
      email: 'ALMA@cedarridge.example.org',
      phone: '(503) 555-0100',
    });
    expect(created.status).toBe(201);
    expect(created.body.email).toBe('alma@cedarridge.example.org');

    const bad = await post(owner, `/api/funders/${createdFunderId}/contacts`).send({
      name: 'Bad Email',
      email: 'not-an-email',
    });
    expect(bad.status).toBe(422);

    const updated = await put(owner, `/api/funders/${createdFunderId}/contacts/${created.body.id}`).send({
      name: 'Alma Reyes',
      title: 'Board Chair',
      email: 'alma@cedarridge.example.org',
    });
    expect(updated.body.title).toBe('Board Chair');

    const removed = await del(owner, `/api/funders/${createdFunderId}/contacts/${created.body.id}`);
    expect(removed.status).toBe(204);
  });

  it('refuses to archive a funder that still has active grants', async () => {
    const alderId = funderId;
    const response = await patch(owner, `/api/funders/${alderId}/archive`).send({ archived: true });
    expect(response.status).toBe(409);
    expect(response.body.error.message).toMatch(/active grant/i);
  });

  it('archives a funder with no active grants', async () => {
    const response = await patch(owner, `/api/funders/${createdFunderId}/archive`).send({ archived: true });
    expect(response.status).toBe(200);
    expect(response.body.archived).toBe(true);

    const lookups = await owner.agent.get('/api/lookups');
    expect(lookups.body.funders.some((f: { id: string }) => f.id === createdFunderId)).toBe(false);
  });
});

describe('filtering, sorting and pagination', () => {
  it('filters by status, health, owner and text', async () => {
    const reporting = await owner.agent.get('/api/grants?status=REPORTING&pageSize=100');
    expect(reporting.body.items.length).toBeGreaterThan(0);
    expect(reporting.body.items.every((g: { status: string }) => g.status === 'REPORTING')).toBe(true);

    const atRisk = await owner.agent.get('/api/grants?health=AT_RISK&pageSize=100');
    expect(atRisk.body.items.every((g: { health: { level: string } }) => g.health.level === 'AT_RISK')).toBe(true);

    const search = await owner.agent.get('/api/grants?q=food%20hub&pageSize=100');
    expect(search.body.items.length).toBe(1);
    expect(search.body.items[0].title).toContain('Food Hub');

    const unassigned = await owner.agent.get('/api/grants?ownerUserId=unassigned&pageSize=100');
    expect(unassigned.body.items.every((g: { ownerUserId: string | null }) => g.ownerUserId === null)).toBe(true);
  });

  it('sorts by awarded value in both directions', async () => {
    const desc = await owner.agent.get('/api/grants?sort=awarded&dir=desc&pageSize=100');
    const values = desc.body.items.map((g: { awardedCents: number }) => g.awardedCents);
    expect([...values].sort((a: number, b: number) => b - a)).toEqual(values);

    const asc = await owner.agent.get('/api/grants?sort=awarded&dir=asc&pageSize=100');
    const ascValues = asc.body.items.map((g: { awardedCents: number }) => g.awardedCents);
    expect([...ascValues].sort((a: number, b: number) => a - b)).toEqual(ascValues);
  });

  it('paginates without dropping or duplicating records', async () => {
    const all = await owner.agent.get('/api/grants?pageSize=100&sort=title');
    const page1 = await owner.agent.get('/api/grants?pageSize=5&page=1&sort=title');
    const page2 = await owner.agent.get('/api/grants?pageSize=5&page=2&sort=title');

    expect(page1.body.pageSize).toBe(5);
    expect(page1.body.total).toBe(all.body.total);
    expect(page1.body.items).toHaveLength(5);

    const combined = [...page1.body.items, ...page2.body.items].map((g: { id: string }) => g.id);
    expect(new Set(combined).size).toBe(combined.length);
    expect(combined).toEqual(all.body.items.slice(0, combined.length).map((g: { id: string }) => g.id));
  });

  it('clamps an out-of-range page to the last page', async () => {
    const response = await owner.agent.get('/api/grants?pageSize=5&page=9999');
    expect(response.body.page).toBe(response.body.pageCount);
    expect(response.body.items.length).toBeGreaterThan(0);
  });
});
