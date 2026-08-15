import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DEMO_PASSWORD } from '../../server/db/demo-accounts';
import { createTestContext, DEMO_USERS, patch, post, seedContext, signIn, type TestContext } from '../helpers/context';

let context: TestContext;

beforeAll(async () => {
  context = createTestContext();
  await seedContext(context);
});

afterAll(() => context.cleanup());

describe('sign-in', () => {
  it('issues a session for valid credentials', async () => {
    const client = await signIn(context.app, DEMO_USERS.owner);
    expect(client.session.user.email).toBe(DEMO_USERS.owner);
    expect(client.session.role).toBe('OWNER');
    expect(client.session.organization.name).toBe('Riverbend Community Alliance');
    expect(client.session.csrfToken).toBeTruthy();
    expect(client.session.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('sets an HttpOnly, SameSite session cookie and never returns a password', async () => {
    const response = await request(context.app)
      .post('/api/auth/sign-in')
      .send({ email: DEMO_USERS.member, password: DEMO_PASSWORD });

    const cookies = response.headers['set-cookie'] as unknown as string[];
    expect(cookies).toBeDefined();
    const sessionCookie = cookies.find((c) => c.startsWith('grantconsole_session='));
    expect(sessionCookie).toContain('HttpOnly');
    expect(sessionCookie).toContain('SameSite=Lax');
    expect(sessionCookie).toContain('Path=/');
    expect(JSON.stringify(response.body)).not.toContain(DEMO_PASSWORD);
    expect(JSON.stringify(response.body)).not.toContain('password_hash');
  });

  it('sets Secure on the session cookie when HTTPS terminates at the trusted proxy', async () => {
    const response = await request(context.app)
      .post('/api/auth/sign-in')
      .set('Origin', 'https://grantconsole.com')
      .set('Host', 'grantconsole.com')
      .set('X-Forwarded-Proto', 'https')
      .send({ email: DEMO_USERS.member, password: DEMO_PASSWORD });

    const cookies = response.headers['set-cookie'] as unknown as string[];
    expect(response.status).toBe(200);
    expect(cookies.find((cookie) => cookie.startsWith('grantconsole_session='))).toContain('Secure');
  });

  it('rejects a wrong password with the same message as an unknown email', async () => {
    const wrongPassword = await request(context.app)
      .post('/api/auth/sign-in')
      .send({ email: DEMO_USERS.owner, password: 'not-the-password' });
    const unknownEmail = await request(context.app)
      .post('/api/auth/sign-in')
      .send({ email: 'nobody@example.org', password: DEMO_PASSWORD });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body.error.message).toBe(unknownEmail.body.error.message);
  });

  it('validates the request body', async () => {
    const response = await request(context.app).post('/api/auth/sign-in').send({ email: 'not-an-email', password: '' });
    expect(response.status).toBe(422);
    expect(response.body.error.fields).toBeDefined();
  });

  it('lands a multi-org user in the organization where they hold the most authority', async () => {
    // Dana owns Riverbend and is only a viewer at Cascade, which sorts first alphabetically.
    const client = await signIn(context.app, DEMO_USERS.owner);
    expect(client.session.organization.slug).toBe('riverbend');
    expect(client.session.memberships).toHaveLength(2);
  });
});

describe('session lifecycle', () => {
  it('returns 401 for an anonymous session request', async () => {
    const response = await request(context.app).get('/api/auth/session');
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('returns the session for a signed-in agent', async () => {
    const client = await signIn(context.app, DEMO_USERS.manager);
    const response = await client.agent.get('/api/auth/session');
    expect(response.status).toBe(200);
    expect(response.body.role).toBe('MANAGER');
    expect(response.body.capabilities).toContain('grants:write');
    expect(response.body.capabilities).not.toContain('org:manage');
  });

  it('invalidates the session on sign-out', async () => {
    const client = await signIn(context.app, DEMO_USERS.member);
    expect((await client.agent.get('/api/auth/session')).status).toBe(200);

    const signOut = await post(client, '/api/auth/sign-out');
    expect(signOut.status).toBe(204);
    expect((await client.agent.get('/api/auth/session')).status).toBe(401);
  });

  it('rejects a tampered session cookie', async () => {
    const client = await signIn(context.app, DEMO_USERS.member);
    const response = await request(context.app)
      .get('/api/auth/session')
      .set('Cookie', 'grantconsole_session=forged-id.forged-signature');
    expect(response.status).toBe(401);
    // The genuine agent still works, proving the rejection was signature based.
    expect((await client.agent.get('/api/auth/session')).status).toBe(200);
  });

  it('switches organization and re-scopes the session', async () => {
    const client = await signIn(context.app, DEMO_USERS.owner);
    const cascade = client.session.memberships.find((m) => m.organizationName === 'Cascade Youth Collective');
    expect(cascade).toBeDefined();

    const response = await post(client, '/api/auth/switch-organization').send({
      organizationId: cascade!.organizationId,
    });
    expect(response.status).toBe(200);
    expect(response.body.organization.slug).toBe('cascade-youth');
    expect(response.body.role).toBe('VIEWER');

    // The grant list now shows the other tenant's records only.
    const grants = await client.agent.get('/api/grants').set('x-csrf-token', response.body.csrfToken);
    expect(grants.body.items.every((g: { funderName: string }) => !g.funderName.includes('Alder Point'))).toBe(true);
  });

  it('refuses to switch into an organization the user does not belong to', async () => {
    const client = await signIn(context.app, DEMO_USERS.member);
    const cascadeId = (
      context.db.prepare("SELECT id FROM organizations WHERE slug = 'cascade-youth'").get() as { id: string }
    ).id;

    const response = await post(client, '/api/auth/switch-organization').send({ organizationId: cascadeId });
    expect(response.status).toBe(404);
  });
});

describe('CSRF protection', () => {
  it('requires an origin for an HTTPS mutation even when NODE_ENV was omitted', async () => {
    const response = await request(context.app)
      .post('/api/auth/sign-in')
      .set('Host', 'grantconsole.com')
      .set('X-Forwarded-Proto', 'https')
      .send({ email: DEMO_USERS.member, password: DEMO_PASSWORD });

    expect(response.status).toBe(403);
    expect(response.body.error.message).toMatch(/missing origin/i);
  });

  it('rejects an authenticated mutation without the CSRF header', async () => {
    const client = await signIn(context.app, DEMO_USERS.owner);
    const response = await client.agent.post('/api/funders').send({ name: 'No Token Foundation', type: 'CORPORATE' });
    expect(response.status).toBe(403);
    expect(response.body.error.message).toMatch(/session expired/i);
  });

  it('rejects a mutation carrying another session’s CSRF token', async () => {
    const owner = await signIn(context.app, DEMO_USERS.owner);
    const manager = await signIn(context.app, DEMO_USERS.manager);

    const response = await owner.agent
      .post('/api/funders')
      .set('x-csrf-token', manager.csrf)
      .send({ name: 'Borrowed Token Foundation', type: 'CORPORATE' });
    expect(response.status).toBe(403);
  });

  it('rejects a mutation from a foreign origin', async () => {
    const client = await signIn(context.app, DEMO_USERS.owner);
    const response = await client.agent
      .post('/api/funders')
      .set('x-csrf-token', client.csrf)
      .set('Origin', 'https://evil.example.com')
      .send({ name: 'Cross Site Foundation', type: 'CORPORATE' });
    expect(response.status).toBe(403);
    expect(response.body.error.message).toMatch(/origin/i);
  });

  it('accepts a mutation with a matching token', async () => {
    const client = await signIn(context.app, DEMO_USERS.owner);
    const response = await post(client, '/api/funders').send({ name: 'Valid Token Trust', type: 'CORPORATE' });
    expect(response.status).toBe(201);
  });

  it('does not require a CSRF token to read', async () => {
    const client = await signIn(context.app, DEMO_USERS.viewer);
    expect((await client.agent.get('/api/dashboard')).status).toBe(200);
  });

  it('never accepts a mutation over GET', async () => {
    const client = await signIn(context.app, DEMO_USERS.owner);
    // There is no GET route that archives; the archive route only answers PATCH.
    const grantId = (context.db.prepare('SELECT id FROM grants LIMIT 1').get() as { id: string }).id;
    const viaGet = await client.agent.get(`/api/grants/${grantId}/archive`);
    expect(viaGet.status).toBe(404);

    const viaPatch = await patch(client, `/api/grants/${grantId}/archive`).send({ archived: false });
    expect(viaPatch.status).toBe(200);
  });
});

describe('demo accounts endpoint', () => {
  it('is hidden unless DEMO_MODE is explicitly enabled', async () => {
    const response = await request(context.app).get('/api/auth/demo-accounts');
    expect(response.status).toBe(404);
  });

  it('lists every seeded role for one-click sign-in when DEMO_MODE=true', async () => {
    process.env.DEMO_MODE = 'true';
    try {
      const response = await request(context.app).get('/api/auth/demo-accounts');
      expect(response.status).toBe(200);
      expect(response.body.password).toBe(DEMO_PASSWORD);
      const roles = new Set(response.body.accounts.map((a: { role: string }) => a.role));
      expect(roles).toEqual(new Set(['OWNER', 'MANAGER', 'MEMBER', 'VIEWER']));
    } finally {
      delete process.env.DEMO_MODE;
    }
  });

  it('stays hidden in production even if DEMO_MODE is set', async () => {
    process.env.DEMO_MODE = 'true';
    process.env.NODE_ENV = 'production';
    try {
      const response = await request(context.app).get('/api/auth/demo-accounts');
      expect(response.status).toBe(404);
    } finally {
      delete process.env.DEMO_MODE;
      process.env.NODE_ENV = 'test';
    }
  });
});
