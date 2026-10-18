import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetAuthThrottles } from '../../server/routes/auth';
import { signWebhookPayload } from '../../server/lib/stripe';
import type { SessionPayload } from '../../shared/types';
import { createTestContext, patch, post, put, type Client, type TestContext } from '../helpers/context';

let context: TestContext;
let serial = 0;
beforeAll(async () => { context = await createTestContext(); });
afterAll(async () => { if (context) await context.cleanup(); });
beforeEach(() => resetAuthThrottles());
async function signUp(): Promise<Client> {
  const agent = request.agent(context.app);
  const response = await agent.post('/api/auth/sign-up').send({ name: 'Synthetic', email: `conversions${++serial}@example.org`, password: 'a-long-enough-password', organizationName: `Synthetic ${serial}` });
  expect(response.status).toBe(201);
  const session = response.body as SessionPayload;
  return { agent, session, csrf: session.csrfToken };
}
const events = (orgId: string) => context.db.prepare('SELECT event_type FROM conversion_events WHERE org_id = ? ORDER BY event_type').all(orgId);

describe('conversion integration', () => {
  it('records signup and activation on successful API mutations, not visits, samples or failed mutations', async () => {
    const client = await signUp();
    const orgId = client.session.organization.id;
    expect(events(orgId)).toEqual([{ event_type: 'trial_started' }]);
    await post(client, '/api/onboarding/sample-data').send({});
    expect(events(orgId)).toEqual([{ event_type: 'trial_started' }]);
    const funder = await post(client, '/api/funders').send({ name: 'Synthetic funder', type: 'PRIVATE_FOUNDATION' });
    const payload = { funderId: funder.body.id, title: 'Synthetic real award', status: 'AWARDED', awardedCents: 10000 };
    const grant = await post(client, '/api/grants').send(payload);
    expect(grant.status).toBe(201);
    const report = await post(client, `/api/grants/${grant.body.id}/milestones`).send({ type: 'REPORT', title: 'Entered deadline', dueDate: '2026-11-20' });
    expect(report.status).toBe(201);
    expect(events(orgId)).toEqual([{ event_type: 'trial_started' }]);
    context.db.exec(`CREATE TRIGGER reject_activation BEFORE INSERT ON conversion_events WHEN NEW.event_type = 'trial_activated' BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;`);
    expect((await put(client, `/api/grants/${grant.body.id}`).send({ ...payload, ownerUserId: client.session.user.id })).status).toBe(500);
    expect(context.db.prepare('SELECT owner_user_id FROM grants WHERE id = ?').get(grant.body.id)).toEqual({ owner_user_id: null });
    context.db.exec('DROP TRIGGER reject_activation');
    const assign = await put(client, `/api/grants/${grant.body.id}`).send({ ...payload, ownerUserId: client.session.user.id });
    expect(assign.status).toBe(200);
    expect(events(orgId)).toEqual([{ event_type: 'trial_activated' }, { event_type: 'trial_started' }]);
    await patch(client, `/api/grants/${grant.body.id}/milestones/${report.body.id}`).send({ dueDate: '2026-12-20' });
    expect(events(orgId)).toHaveLength(2);
  });

  it('records activation atomically when a report-owning viewer becomes a responsible member', async () => {
    const client = await signUp();
    const orgId = client.session.organization.id;
    const invite = await post(client, '/api/team/invites').send({ role: 'VIEWER' });
    expect(invite.status).toBe(201);
    const token = invite.body.url.split('/invite/')[1];
    const joined = await request(context.app).post(`/api/auth/invites/${token}/accept`).send({
      name: 'Synthetic Viewer', email: `viewer${++serial}@example.org`, password: 'synthetic-viewer-password',
    });
    expect(joined.status).toBe(201);
    const viewerId = joined.body.user.id;
    const funder = await post(client, '/api/funders').send({ name: 'Synthetic role-change funder', type: 'PRIVATE_FOUNDATION' });
    expect(funder.status).toBe(201);
    const grant = await post(client, '/api/grants').send({
      funderId: funder.body.id, title: 'Viewer-owned synthetic award', status: 'AWARDED', awardedCents: 10000, ownerUserId: viewerId,
    });
    expect(grant.status).toBe(201);
    const report = await post(client, `/api/grants/${grant.body.id}/milestones`).send({ type: 'REPORT', title: 'Entered deadline', dueDate: '2026-11-20' });
    expect(report.status).toBe(201);
    expect(events(orgId)).toEqual([{ event_type: 'trial_started' }]);

    context.db.exec(`CREATE TRIGGER reject_role_activation BEFORE INSERT ON conversion_events WHEN NEW.event_type = 'trial_activated' BEGIN SELECT RAISE(ABORT, 'synthetic role failure'); END;`);
    try {
      expect((await patch(client, `/api/team/${viewerId}/role`).send({ role: 'MEMBER' })).status).toBe(500);
      expect(context.db.prepare('SELECT role FROM memberships WHERE org_id = ? AND user_id = ?').get(orgId, viewerId)).toEqual({ role: 'VIEWER' });
      expect(context.db.prepare("SELECT COUNT(*) AS n FROM activities WHERE org_id = ? AND entity_id = ? AND action = 'ROLE_CHANGED'").get(orgId, viewerId)).toEqual({ n: 0 });
      expect(events(orgId)).toEqual([{ event_type: 'trial_started' }]);
    } finally {
      context.db.exec('DROP TRIGGER reject_role_activation');
    }

    expect((await patch(client, `/api/team/${viewerId}/role`).send({ role: 'MEMBER' })).status).toBe(200);
    expect(events(orgId)).toEqual([{ event_type: 'trial_activated' }, { event_type: 'trial_started' }]);
    expect((await patch(client, `/api/team/${viewerId}/role`).send({ role: 'MANAGER' })).status).toBe(200);
    expect(events(orgId)).toHaveLength(2);
  });

  it('records activation for imported owner and entered reporting date', async () => {
    const client = await signUp();
    const response = await post(client, '/api/grants/import').send({ createFunders: true, rows: [{ title: 'Imported synthetic award', funderName: 'Synthetic foundation', awarded: '1000', ownerEmail: client.session.user.email, reportDueDate: '2026-12-01' }] });
    expect(response.status).toBe(201);
    expect(events(client.session.organization.id)).toContainEqual({ event_type: 'trial_activated' });
  });

  it('keeps reporting and classification behind the admin bearer and excludes internal tests', async () => {
    const client = await signUp();
    expect((await client.agent.get('/api/admin/conversions')).status).toBe(401);
    expect((await client.agent.patch('/api/admin/conversions/quality').send({ organizationId: client.session.organization.id, quality: 'qualified' })).status).toBe(401);
    const admin = request(context.app);
    const changed = await admin.patch('/api/admin/conversions/quality').set('Authorization', 'Bearer admin-token-for-vitest-only-0123456789')
      .send({ organizationId: client.session.organization.id, quality: 'internal_test' });
    expect(changed.status).toBe(200);
    const report = await admin.get('/api/admin/conversions').set('Authorization', 'Bearer admin-token-for-vitest-only-0123456789');
    expect(report.status).toBe(200);
    expect(report.headers['cache-control']).toBe('no-store');
    expect(report.body.excluded).toContainEqual({ quality: 'internal_test', organizations: 1 });
    const serialized = JSON.stringify(report.body);
    expect(serialized).not.toContain(client.session.user.email);
    expect(serialized).not.toContain(client.session.organization.id);
  });

  it('records paid conversion only after a signed positive paid invoice and deduplicates retries', async () => {
    const client = await signUp();
    const orgId = client.session.organization.id;
    context.db.prepare('UPDATE organizations SET stripe_customer_id = ? WHERE id = ?').run('cus_api_synthetic', orgId);
    // Modern Basil shape: no paid/paid_out_of_band/charge/payment_intent fields.
    const payload = JSON.stringify({ id: 'evt_api_paid', type: 'invoice.payment_succeeded', livemode: true, created: Math.floor(Date.now() / 1000), data: { object: { id: 'in_api_synthetic', customer: 'cus_api_synthetic', parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_api_synthetic' } }, status: 'paid', amount_paid: 7900, currency: 'usd' } } });
    expect((await request(context.app).post('/api/billing/webhook').set('Content-Type', 'application/json').set('stripe-signature', 'invalid').send(payload)).status).toBe(400);
    expect(events(orgId)).toEqual([{ event_type: 'trial_started' }]);
    const signature = signWebhookPayload(payload, 'whsec_test_secret_for_vitest', Math.floor(Date.now() / 1000));
    for (let i = 0; i < 2; i += 1) {
      expect((await request(context.app).post('/api/billing/webhook').set('Content-Type', 'application/json').set('stripe-signature', signature).send(payload)).status).toBe(200);
    }
    expect(events(orgId)).toEqual([{ event_type: 'paid_started' }, { event_type: 'trial_started' }]);
  });
});
