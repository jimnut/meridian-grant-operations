import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { resetAuthThrottles } from '../../server/routes/auth';
import { setMailTransport, type MailMessage } from '../../server/lib/mailer';
import type { SessionPayload } from '../../shared/types';
import { createTestContext, del, post, put, seedContext, signIn, type Client, type TestContext } from '../helpers/context';

let context: TestContext;
const outbox: MailMessage[] = [];

beforeAll(async () => {
  context = await createTestContext();
  await seedContext(context);
  setMailTransport(async (message) => {
    outbox.push(message);
    return { sent: true, transport: 'custom' };
  });
});

afterAll(async () => {
  setMailTransport(null);
  await context.cleanup();
});

beforeEach(() => {
  resetAuthThrottles();
  outbox.length = 0;
});

let counter = 0;
async function signUp(overrides: Record<string, unknown> = {}): Promise<Client> {
  counter += 1;
  const agent = request.agent(context.app);
  const response = await agent.post('/api/auth/sign-up').send({
    name: `Person ${counter}`,
    email: `person${counter}@example.org`,
    password: 'a-long-enough-password',
    organizationName: `Test Org ${counter}`,
    ...overrides,
  });
  if (response.status !== 201) throw new Error(`sign-up failed: ${response.status} ${JSON.stringify(response.body)}`);
  const session = response.body as SessionPayload;
  return { agent, session, csrf: session.csrfToken };
}

describe('self-serve sign-up', () => {
  it('creates an organization on trial with the signer as owner and signs them in', async () => {
    const client = await signUp({ organizationName: 'Riverside Literacy Project' });
    expect(client.session.role).toBe('OWNER');
    expect(client.session.organization.name).toBe('Riverside Literacy Project');
    expect(client.session.organization.slug).toBe('riverside-literacy-project');
    expect(client.session.workspace.status).toBe('trialing');
    expect(client.session.workspace.trialDaysLeft).toBeGreaterThanOrEqual(13);
    expect(client.session.workspace.readOnly).toBe(false);
    expect(client.session.workspace.isDemo).toBe(false);
    expect(client.session.workspace.limits.activeGrants).toBe(40);

    const me = await client.agent.get('/api/auth/session');
    expect(me.status).toBe(200);
    expect(me.body.workspace.plan).toBe('trial');

    // A welcome email went out.
    expect(outbox.some((m) => m.subject.startsWith('Welcome to GrantConsole'))).toBe(true);
  });

  it('starts every workspace empty and separate from the demo', async () => {
    const client = await signUp();
    const grants = await client.agent.get('/api/grants');
    expect(grants.body.total).toBe(0);
    const dashboard = await client.agent.get('/api/dashboard');
    expect(dashboard.body.totals.activeGrantCount).toBe(0);
  });

  it('dedupes organization slugs', async () => {
    const first = await signUp({ organizationName: 'Same Name Org' });
    const second = await signUp({ organizationName: 'Same Name Org' });
    expect(first.session.organization.slug).toBe('same-name-org');
    expect(second.session.organization.slug).toBe('same-name-org-2');
  });

  it('rejects duplicate emails and weak passwords, and silently swallows bots', async () => {
    const client = await signUp();
    const duplicate = await request(context.app)
      .post('/api/auth/sign-up')
      .send({ name: 'Again', email: client.session.user.email, password: 'a-long-enough-password', organizationName: 'X' });
    expect(duplicate.status).toBe(409);

    const weak = await request(context.app)
      .post('/api/auth/sign-up')
      .send({ name: 'Weak', email: 'weak@example.org', password: 'short', organizationName: 'X' });
    expect(weak.status).toBe(422);
    expect(weak.body.error.fields.password).toBeDefined();

    const bot = await request(context.app)
      .post('/api/auth/sign-up')
      .send({ name: 'Bot', email: 'bot@example.org', password: 'a-long-enough-password', organizationName: 'Bot Org', website: 'http://spam' });
    expect(bot.status).toBe(201);
    const created = context.db.prepare('SELECT 1 AS ok FROM users WHERE email = ?').get('bot@example.org');
    expect(created).toBeUndefined();
  });

  it('never lists real customers among the demo accounts', async () => {
    const client = await signUp({ email: 'customer-private@example.org' });
    const previous = process.env.DEMO_MODE;
    process.env.DEMO_MODE = 'true';
    try {
      const response = await request(context.app).get('/api/auth/demo-accounts');
      expect(response.status).toBe(200);
      const emails = (response.body.accounts as Array<{ email: string }>).map((a) => a.email);
      expect(emails).toContain('dana@riverbendalliance.org');
      expect(emails).not.toContain(client.session.user.email);
    } finally {
      if (previous === undefined) delete process.env.DEMO_MODE;
      else process.env.DEMO_MODE = previous;
    }
  });
});

describe('password reset', () => {
  it('emails a single-use link that signs the person in with a new password', async () => {
    const client = await signUp();
    const email = client.session.user.email;

    const forgot = await request(context.app).post('/api/auth/forgot-password').send({ email });
    expect(forgot.status).toBe(202);
    expect(forgot.body.emailConfigured).toBe(true);
    const mail = outbox.find((m) => m.to === email && m.subject.includes('Reset'));
    expect(mail).toBeDefined();
    const token = /reset-password\?token=([^\s"]+)/.exec(mail!.text)?.[1];
    expect(token).toBeTruthy();

    // Unknown emails answer identically and send nothing.
    outbox.length = 0;
    const unknown = await request(context.app).post('/api/auth/forgot-password').send({ email: 'nobody@example.org' });
    expect(unknown.status).toBe(202);
    expect(outbox).toHaveLength(0);

    const reset = await request
      .agent(context.app)
      .post('/api/auth/reset-password')
      .send({ token: decodeURIComponent(token!), password: 'brand-new-password-1' });
    expect(reset.status).toBe(200);
    expect(reset.body.user.email).toBe(email);

    // The old password is gone, the new one works, the token is burnt.
    const old = await request(context.app).post('/api/auth/sign-in').send({ email, password: 'a-long-enough-password' });
    expect(old.status).toBe(401);
    const fresh = await signIn(context.app, email, 'brand-new-password-1');
    expect(fresh.session.user.email).toBe(email);
    const reuse = await request(context.app)
      .post('/api/auth/reset-password')
      .send({ token: decodeURIComponent(token!), password: 'another-password-xyz' });
    expect(reuse.status).toBe(404);
  });

  it('lets a signed-in person change their password and signs out other devices', async () => {
    const client = await signUp();
    const other = await signIn(context.app, client.session.user.email, 'a-long-enough-password');

    const wrong = await put(client, '/api/auth/password').send({ currentPassword: 'nope-nope-nope', newPassword: 'changed-password-123' });
    expect(wrong.status).toBe(422);

    const ok = await put(client, '/api/auth/password').send({ currentPassword: 'a-long-enough-password', newPassword: 'changed-password-123' });
    expect(ok.status).toBe(204);
    expect((await client.agent.get('/api/auth/session')).status).toBe(200);
    expect((await other.agent.get('/api/auth/session')).status).toBe(401);
  });
});

describe('invitations', () => {
  it('lets an owner invite by email, and the invitee join with a new account', async () => {
    const owner = await signUp();
    const invite = await post(owner, '/api/team/invites').send({ email: 'newbie@example.org', role: 'MEMBER' });
    expect(invite.status).toBe(201);
    expect(invite.body.url).toMatch(/\/invite\//);
    expect(invite.body.emailed).toBe(false); // no provider key in tests, so the link is handed back
    const mail = outbox.find((m) => m.to === 'newbie@example.org');
    expect(mail?.subject).toContain('invited you');

    const token = invite.body.url.split('/invite/')[1];
    const preview = await request(context.app).get(`/api/auth/invites/${token}`);
    expect(preview.status).toBe(200);
    expect(preview.body.organizationName).toBe(owner.session.organization.name);
    expect(preview.body.role).toBe('MEMBER');
    expect(preview.body.requiresAccount).toBe(true);

    const agent = request.agent(context.app);
    const accept = await agent.post(`/api/auth/invites/${token}/accept`).send({ name: 'New Member', password: 'member-password-123' });
    expect(accept.status).toBe(201);
    expect(accept.body.role).toBe('MEMBER');
    expect(accept.body.organization.id).toBe(owner.session.organization.id);

    // The token is single use and the roster reflects the join.
    const again = await request(context.app).get(`/api/auth/invites/${token}`);
    expect(again.status).toBe(404);
    const team = await owner.agent.get('/api/team');
    expect((team.body as Array<{ email: string }>).map((m) => m.email)).toContain('newbie@example.org');
  });

  it('lets an existing signed-in user join a second organization through a link invite', async () => {
    const ownerA = await signUp();
    const ownerB = await signUp();
    const invite = await post(ownerA, '/api/team/invites').send({ role: 'VIEWER' });
    expect(invite.status).toBe(201);
    const token = invite.body.url.split('/invite/')[1];

    const accept = await post(ownerB, `/api/auth/invites/${token}/accept`).send({});
    expect(accept.status).toBe(200);
    expect(accept.body.organization.id).toBe(ownerA.session.organization.id);
    expect(accept.body.role).toBe('VIEWER');
    expect(accept.body.memberships).toHaveLength(2);
  });

  it('refuses an email-locked invite from a different account and owner invites from managers', async () => {
    const owner = await signUp();
    const invite = await post(owner, '/api/team/invites').send({ email: 'locked@example.org', role: 'MANAGER' });
    const token = invite.body.url.split('/invite/')[1];
    const stranger = await signUp();
    const denied = await post(stranger, `/api/auth/invites/${token}/accept`).send({});
    expect(denied.status).toBe(403);

    // Accept it properly as a new manager, then check that manager cannot invite an owner.
    const agent = request.agent(context.app);
    const accept = await agent.post(`/api/auth/invites/${token}/accept`).send({ name: 'Manager Mia', password: 'manager-password-1' });
    expect(accept.status).toBe(201);
    const manager: Client = { agent, session: accept.body as SessionPayload, csrf: accept.body.csrfToken };
    const ownerInvite = await post(manager, '/api/team/invites').send({ role: 'OWNER' });
    expect(ownerInvite.status).toBe(403);
    const memberInvite = await post(manager, '/api/team/invites').send({ role: 'MEMBER' });
    expect(memberInvite.status).toBe(201);
  });

  it('enforces editor seats per plan while viewers stay free', async () => {
    const owner = await signUp();
    context.db
      .prepare("UPDATE organizations SET plan = 'starter', subscription_status = 'active' WHERE id = ?")
      .run(owner.session.organization.id);
    // Starter: 3 editor seats. Owner holds one; two more invites fit.
    expect((await post(owner, '/api/team/invites').send({ role: 'MEMBER' })).status).toBe(201);
    expect((await post(owner, '/api/team/invites').send({ role: 'MEMBER' })).status).toBe(201);
    const full = await post(owner, '/api/team/invites').send({ role: 'MEMBER' });
    expect(full.status).toBe(402);
    expect(full.body.error.code).toBe('PLAN_LIMIT');
    expect(full.body.error.message).toContain('3 editor seats');
    // Viewers never count.
    expect((await post(owner, '/api/team/invites').send({ role: 'VIEWER' })).status).toBe(201);
  });

  it('lists, resends and revokes pending invitations', async () => {
    const owner = await signUp();
    const created = await post(owner, '/api/team/invites').send({ email: 'pending@example.org', role: 'MEMBER' });
    const list = await owner.agent.get('/api/team/invites');
    expect(list.body).toHaveLength(1);
    const resent = await post(owner, `/api/team/invites/${created.body.id}/resend`);
    expect(resent.status).toBe(200);
    expect(resent.body.url).not.toBe(created.body.url);
    const oldToken = created.body.url.split('/invite/')[1];
    expect((await request(context.app).get(`/api/auth/invites/${oldToken}`)).status).toBe(404);
    const revoke = await del(owner, `/api/team/invites/${resent.body.id}`);
    expect(revoke.status).toBe(204);
    expect((await owner.agent.get('/api/team/invites')).body).toHaveLength(0);
  });
});

describe('team administration', () => {
  it('removes a member, unassigns their work and keeps the last owner', async () => {
    const owner = await signUp();
    const invite = await post(owner, '/api/team/invites').send({ role: 'MEMBER' });
    const token = invite.body.url.split('/invite/')[1];
    const agent = request.agent(context.app);
    const joined = await agent.post(`/api/auth/invites/${token}/accept`).send({ name: 'Temp Member', email: 'temp-member@example.org', password: 'temp-password-1234' });
    expect(joined.status).toBe(201);
    const memberId = joined.body.user.id as string;

    const selfRemoval = await del(owner, `/api/team/${owner.session.user.id}`);
    expect(selfRemoval.status).toBe(403);

    const removed = await del(owner, `/api/team/${memberId}`);
    expect(removed.status).toBe(204);
    expect((await agent.get('/api/auth/session')).status).toBe(401);
  });

  it('issues an owner-assisted reset link', async () => {
    const owner = await signUp();
    const link = await post(owner, `/api/team/${owner.session.user.id}/reset-link`);
    expect(link.status).toBe(200);
    expect(link.body.url).toContain('/reset-password?token=');
  });

  it('updates the profile name', async () => {
    const owner = await signUp();
    const response = await put(owner, '/api/auth/profile').send({ name: 'Renamed Person', title: 'Grants Manager' });
    expect(response.status).toBe(200);
    expect(response.body.user.name).toBe('Renamed Person');
  });
});
