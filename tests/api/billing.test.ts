import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { resetAuthThrottles } from '../../server/routes/auth';
import { applyStripeEvent } from '../../server/routes/billing';
import { assertStorageCapacity } from '../../server/lib/plans';
import { signWebhookPayload } from '../../server/lib/stripe';
import { computeWorkspaceStatus, PLANS, TRIAL_LIMITS } from '../../shared/plans';
import type { SessionPayload } from '../../shared/types';
import { createTestContext, patch, post, seedContext, type Client, type TestContext } from '../helpers/context';

let context: TestContext;

beforeAll(async () => {
  context = createTestContext();
  await seedContext(context);
});
afterAll(() => context.cleanup());
beforeEach(() => resetAuthThrottles());

let counter = 100;
async function signUp(): Promise<Client> {
  counter += 1;
  const agent = request.agent(context.app);
  const response = await agent.post('/api/auth/sign-up').send({
    name: `Billing Person ${counter}`,
    email: `billing${counter}@example.org`,
    password: 'a-long-enough-password',
    organizationName: `Billing Org ${counter}`,
  });
  expect(response.status).toBe(201);
  const session = response.body as SessionPayload;
  return { agent, session, csrf: session.csrfToken };
}

async function createFunder(client: Client): Promise<string> {
  const response = await post(client, '/api/funders').send({ name: `Funder ${Math.random()}`, type: 'PRIVATE_FOUNDATION' });
  expect(response.status).toBe(201);
  return response.body.id as string;
}

async function createGrant(client: Client, funderId: string, status = 'AWARDED') {
  return post(client, '/api/grants').send({
    title: `Grant ${Math.random()}`,
    funderId,
    status,
    awardedCents: status === 'PROSPECT' ? 0 : 1000000,
    requestedCents: 1000000,
  });
}

describe('workspace status', () => {
  it('derives trial, expiry, subscription and demo states', () => {
    const now = new Date('2026-09-06T12:00:00Z');
    const trialing = computeWorkspaceStatus({ plan: 'trial', subscription_status: 'trialing', trial_ends_at: '2026-09-16T12:00:00Z', plan_valid_until: null, is_demo: 0 }, now);
    expect(trialing.status).toBe('trialing');
    expect(trialing.trialDaysLeft).toBe(10);
    expect(trialing.readOnly).toBe(false);
    expect(trialing.limits).toEqual(TRIAL_LIMITS);

    const expired = computeWorkspaceStatus({ plan: 'trial', subscription_status: 'trialing', trial_ends_at: '2026-09-01T12:00:00Z', plan_valid_until: null, is_demo: 0 }, now);
    expect(expired.status).toBe('expired');
    expect(expired.readOnly).toBe(true);
    expect(expired.trialDaysLeft).toBe(0);

    const active = computeWorkspaceStatus({ plan: 'growth', subscription_status: 'active', trial_ends_at: null, plan_valid_until: null, is_demo: 0 }, now);
    expect(active.planName).toBe('Growth');
    expect(active.limits.activeGrants).toBe(PLANS.growth.limits.activeGrants);
    expect(active.readOnly).toBe(false);

    const canceledPaidThrough = computeWorkspaceStatus({ plan: 'starter', subscription_status: 'canceled', trial_ends_at: null, plan_valid_until: '2026-10-01T00:00:00Z', is_demo: 0 }, now);
    expect(canceledPaidThrough.readOnly).toBe(false);
    const canceledEnded = computeWorkspaceStatus({ plan: 'starter', subscription_status: 'canceled', trial_ends_at: null, plan_valid_until: '2026-09-01T00:00:00Z', is_demo: 0 }, now);
    expect(canceledEnded.readOnly).toBe(true);

    const demo = computeWorkspaceStatus({ plan: 'trial', subscription_status: 'trialing', trial_ends_at: '2020-01-01T00:00:00Z', plan_valid_until: null, is_demo: 1 }, now);
    expect(demo.isDemo).toBe(true);
    expect(demo.readOnly).toBe(false);

    // Legacy rows with no trial end date are never locked out.
    const legacy = computeWorkspaceStatus({ plan: 'trial', subscription_status: 'trialing', trial_ends_at: null, plan_valid_until: null, is_demo: 0 }, now);
    expect(legacy.readOnly).toBe(false);
  });
});

describe('plan limits and read-only enforcement', () => {
  it('caps active grants on the plan and lets closed grants through', async () => {
    const client = await signUp();
    context.db.prepare("UPDATE organizations SET plan = 'starter', subscription_status = 'active' WHERE id = ?").run(client.session.organization.id);
    const funderId = await createFunder(client);
    for (let i = 0; i < 10; i += 1) {
      expect((await createGrant(client, funderId)).status).toBe(201);
    }
    const eleventh = await createGrant(client, funderId);
    expect(eleventh.status).toBe(402);
    expect(eleventh.body.error.code).toBe('PLAN_LIMIT');
    expect(eleventh.body.error.message).toContain('10 active grants');

    // A declined prospect never counts.
    const declined = await post(client, '/api/grants').send({ title: 'Lost one', funderId, status: 'DECLINED', requestedCents: 500 });
    expect(declined.status).toBe(201);
    // ...but flipping it into a counted status is refused at the cap.
    const flip = await patch(client, `/api/grants/${declined.body.id}/status`).send({ status: 'PROSPECT' });
    expect(flip.status).toBe(402);

    const billing = await client.agent.get('/api/billing');
    expect(billing.status).toBe(200);
    expect(billing.body.usage.activeGrants).toBe(10);
    expect(billing.body.workspace.limits.activeGrants).toBe(10);
    expect(billing.body.checkoutAvailable).toBe(false);
    expect(billing.body.plans).toHaveLength(3);
  });

  it('freezes edits after the trial ends but keeps reads and exports working', async () => {
    const client = await signUp();
    const funderId = await createFunder(client);
    expect((await createGrant(client, funderId)).status).toBe(201);
    context.db.prepare('UPDATE organizations SET trial_ends_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', client.session.organization.id);

    const session = await client.agent.get('/api/auth/session');
    expect(session.body.workspace.readOnly).toBe(true);
    expect(session.body.workspace.status).toBe('expired');

    const blocked = await createGrant(client, funderId);
    expect(blocked.status).toBe(402);
    expect(blocked.body.error.code).toBe('WORKSPACE_READ_ONLY');

    expect((await client.agent.get('/api/grants')).status).toBe(200);
    expect((await client.agent.get('/api/reports/portfolio.csv')).status).toBe(200);
    // Team and billing administration keep working so the owner can subscribe.
    expect((await post(client, '/api/team/invites').send({ role: 'VIEWER' })).status).toBe(201);
    expect((await client.agent.get('/api/billing')).status).toBe(200);
  });

  it('explains when online checkout is not switched on', async () => {
    const client = await signUp();
    const response = await post(client, '/api/billing/checkout').send({ plan: 'growth', interval: 'annual' });
    expect(response.status).toBe(409);
    expect(response.body.error.message).toContain('support@grantconsole.com');
  });

  it('refuses uploads beyond the storage allowance before writing anything', () => {
    const status = computeWorkspaceStatus({ plan: 'starter', subscription_status: 'active', trial_ends_at: null, plan_valid_until: null, is_demo: 0 });
    const tiny = { ...status, limits: { ...status.limits, storageMb: 1 } };
    const orgId = context.db.prepare('SELECT id FROM organizations LIMIT 1').get() as { id: string };
    expect(() => assertStorageCapacity(context.db, orgId.id, tiny, 2 * 1024 * 1024)).toThrow(/storage/);
    expect(() => assertStorageCapacity(context.db, orgId.id, status, 1024)).not.toThrow();
  });
});

describe('stripe webhook', () => {
  function event(type: string, object: Record<string, unknown>, id = `evt_${Math.random().toString(36).slice(2)}`) {
    return { id, type, data: { object } };
  }

  it('activates a plan from a signed checkout.session.completed and ignores replays', async () => {
    const client = await signUp();
    const orgId = client.session.organization.id;
    const payload = JSON.stringify(
      event('checkout.session.completed', {
        client_reference_id: orgId,
        customer: 'cus_123',
        subscription: 'sub_123',
        metadata: { orgId, plan: 'growth', interval: 'annual' },
        customer_details: { email: 'finance@example.org' },
      }, 'evt_checkout_1'),
    );
    const now = Math.floor(Date.now() / 1000);
    const signature = signWebhookPayload(payload, 'whsec_test_secret_for_vitest', now);

    const response = await request(context.app)
      .post('/api/billing/webhook')
      .set('Stripe-Signature', signature)
      .set('Content-Type', 'application/json')
      .send(payload);
    expect(response.status).toBe(200);
    expect(response.body.applied).toBe(true);

    const session = await client.agent.get('/api/auth/session');
    expect(session.body.workspace.status).toBe('active');
    expect(session.body.workspace.plan).toBe('growth');
    const billing = await client.agent.get('/api/billing');
    expect(billing.body.billingEmail).toBe('finance@example.org');
    expect(billing.body.portalAvailable).toBe(true);

    const replay = await request(context.app)
      .post('/api/billing/webhook')
      .set('Stripe-Signature', signWebhookPayload(payload, 'whsec_test_secret_for_vitest', now))
      .set('Content-Type', 'application/json')
      .send(payload);
    expect(replay.body.applied).toBe(false);
  });

  it('rejects bad or stale signatures', async () => {
    const payload = JSON.stringify(event('invoice.paid', { customer: 'cus_none' }));
    const bad = await request(context.app).post('/api/billing/webhook').set('Stripe-Signature', 't=1,v1=deadbeef').set('Content-Type', 'application/json').send(payload);
    expect(bad.status).toBe(400);
    const stale = signWebhookPayload(payload, 'whsec_test_secret_for_vitest', Math.floor(Date.now() / 1000) - 3600);
    const old = await request(context.app).post('/api/billing/webhook').set('Stripe-Signature', stale).set('Content-Type', 'application/json').send(payload);
    expect(old.status).toBe(400);
  });

  it('tracks subscription changes, failed payments and cancellations', async () => {
    const client = await signUp();
    const orgId = client.session.organization.id;
    applyStripeEvent(context.db, event('checkout.session.completed', { client_reference_id: orgId, customer: 'cus_777', subscription: 'sub_777', metadata: { orgId, plan: 'starter' } }));
    applyStripeEvent(context.db, event('invoice.payment_failed', { customer: 'cus_777', subscription: 'sub_777' }));
    expect((await client.agent.get('/api/auth/session')).body.workspace.status).toBe('past_due');
    applyStripeEvent(context.db, event('invoice.paid', { customer: 'cus_777', subscription: 'sub_777' }));
    expect((await client.agent.get('/api/auth/session')).body.workspace.status).toBe('active');
    const periodEnd = Math.floor(Date.now() / 1000) + 30 * 86400;
    applyStripeEvent(context.db, event('customer.subscription.deleted', { id: 'sub_777', customer: 'cus_777', status: 'canceled', current_period_end: periodEnd, items: { data: [] }, metadata: { plan: 'starter' } }));
    const after = (await client.agent.get('/api/auth/session')).body.workspace;
    expect(after.status).toBe('canceled');
    expect(after.readOnly).toBe(false); // paid through the period end
    expect(after.validUntil).toBeTruthy();
  });
});

describe('stripe 2025+ payload shapes', () => {
  function event(type: string, object: Record<string, unknown>) {
    return { id: `evt_${Math.random().toString(36).slice(2)}`, type, data: { object } };
  }

  it('reads the period end from subscription items and the invoice subscription from parent', async () => {
    const client = await signUp();
    const orgId = client.session.organization.id;
    applyStripeEvent(context.db, event('checkout.session.completed', { client_reference_id: orgId, customer: 'cus_new', subscription: 'sub_new', metadata: { orgId, plan: 'growth' } }));
    applyStripeEvent(context.db, event('invoice.payment_failed', { customer: 'cus_new', parent: { subscription_details: { subscription: 'sub_new' } } }));
    expect((await client.agent.get('/api/auth/session')).body.workspace.status).toBe('past_due');
    const periodEnd = Math.floor(Date.now() / 1000) + 20 * 86400;
    applyStripeEvent(context.db, event('customer.subscription.deleted', { id: 'sub_new', customer: 'cus_new', status: 'canceled', items: { data: [{ price: { id: 'price_x' }, current_period_end: periodEnd }] }, metadata: { orgId } }));
    const ws = (await client.agent.get('/api/auth/session')).body.workspace;
    expect(ws.status).toBe('canceled');
    expect(ws.readOnly).toBe(false);
    expect(ws.validUntil?.slice(0, 10)).toBe(new Date(periodEnd * 1000).toISOString().slice(0, 10));
  });
});

describe('admin plan override', () => {
  it('requires the bearer token and sets a complimentary plan by slug', async () => {
    const client = await signUp();
    const slug = client.session.organization.slug;
    const anonymous = await request(context.app).post('/api/admin/plan').send({ organizationSlug: slug, plan: 'scale', status: 'complimentary' });
    expect(anonymous.status).toBe(401);
    const set = await request(context.app)
      .post('/api/admin/plan')
      .set('Authorization', 'Bearer admin-token-for-vitest-only-0123456789')
      .send({ organizationSlug: slug, plan: 'scale', status: 'complimentary', validUntil: '2027-06-30' });
    expect(set.status).toBe(200);
    expect(set.body.status.planName).toBe('Scale');
    expect(set.body.status.readOnly).toBe(false);
    const session = await client.agent.get('/api/auth/session');
    expect(session.body.workspace.limits.activeGrants).toBeNull();

    const list = await request(context.app).get('/api/admin/organizations').set('Authorization', 'Bearer admin-token-for-vitest-only-0123456789');
    expect(list.status).toBe(200);
    expect((list.body as Array<{ slug: string }>).some((o) => o.slug === slug)).toBe(true);
  });
});
