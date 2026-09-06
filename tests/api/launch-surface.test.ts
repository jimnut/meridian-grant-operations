import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../server/app';

import { resetAuthThrottles } from '../../server/routes/auth';
import { resetPublicThrottles } from '../../server/routes/public';
import { PLANS } from '../../shared/plans';
import type { SessionPayload } from '../../shared/types';
import { createTestContext, del, post, seedContext, signIn, DEMO_USERS, type Client, type TestContext } from '../helpers/context';

let context: TestContext;

beforeAll(async () => {
  context = createTestContext();
  await seedContext(context);
});
afterAll(() => context.cleanup());
beforeEach(() => {
  resetAuthThrottles();
  resetPublicThrottles();
});

let counter = 500;
async function signUp(): Promise<Client> {
  counter += 1;
  const agent = request.agent(context.app);
  const response = await agent.post('/api/auth/sign-up').send({
    name: `Launch Person ${counter}`,
    email: `launch${counter}@example.org`,
    password: 'a-long-enough-password',
    organizationName: `Launch Org ${counter}`,
  });
  expect(response.status).toBe(201);
  const session = response.body as SessionPayload;
  return { agent, session, csrf: session.csrfToken };
}

describe('pricing page', () => {
  it('renders every plan with monthly and annual prices, offers and an aligned FAQ', async () => {
    const response = await request(context.app).get('/pricing');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.text).toContain('<link rel="canonical" href="https://grantconsole.com/pricing"');
    expect(response.text).not.toContain('noindex');
    for (const plan of Object.values(PLANS)) {
      expect(response.text).toContain(`$${plan.priceMonthlyUsd}`);
      expect(response.text).toContain(`$${plan.priceAnnualUsdPerMonth}`);
      expect(response.text).toContain(`href="/signup?plan=${plan.id}"`);
    }
    const script = response.text.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/);
    const graph = (JSON.parse(script![1]!) as { '@graph': Array<Record<string, unknown>> })['@graph'];
    const software = graph.find((node) => node['@type'] === 'SoftwareApplication') as { offers: Array<{ price: string }> };
    expect(software.offers).toHaveLength(3);
    expect(software.offers.map((o) => o.price)).toEqual(Object.values(PLANS).map((p) => String(p.priceAnnualUsdPerMonth)));
    const faq = graph.find((node) => node['@type'] === 'FAQPage') as { mainEntity: Array<{ name: string; acceptedAnswer: { text: string } }> };
    const visible = [...response.text.matchAll(/<details><summary>([^<]+)<\/summary><p>([^<]+)<\/p><\/details>/g)].map((m) => [m[1], m[2]]);
    expect(visible.length).toBeGreaterThanOrEqual(6);
    expect(faq.mainEntity.map((q) => [q.name, q.acceptedAnswer.text.replaceAll('—', '—')])).toHaveLength(visible.length);
    expect(faq.mainEntity.map((q) => q.name)).toEqual(visible.map((v) => v[0]!.replaceAll('&#39;', "'")));
  });

  it('is in the sitemap and linked from the public chrome', async () => {
    const sitemap = await request(context.app).get('/sitemap.xml');
    expect(sitemap.text).toContain('<loc>https://grantconsole.com/pricing</loc>');
    const landing = await request(context.app).get('/');
    expect(landing.text).toContain('href="/pricing"');
    expect(landing.text).toContain('href="/signup"');
    const about = await request(context.app).get('/about');
    expect(about.text).toContain('href="/pricing"');
    expect(about.text).toContain('Start free trial');
  });

  it('serves the app shell for the sign-up, invite and settings routes', async () => {
    const clientDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grantconsole-shell-'));
    fs.writeFileSync(path.join(clientDir, 'index.html'), '<!doctype html><html><head></head><body>shell</body></html>');
    try {
      const app = createApp({ db: context.db, serveStatic: true, clientDir, uploadsDir: context.uploadsDir });
      for (const spaPath of ['/signup', '/forgot-password', '/reset-password', '/invite/abc123', '/settings/billing', '/grants/import']) {
        const response = await request(app).get(spaPath);
        expect(response.status, spaPath).toBe(200);
        expect(response.text, spaPath).toContain('shell');
      }
      expect((await request(app).get('/settings/not-a-tab-with-CAPS')).status).toBe(404);
    } finally {
      fs.rmSync(clientDir, { recursive: true, force: true });
    }
  });
});

describe('lead capture', () => {
  it('stores JSON leads and redirects plain form posts to the thank-you page', async () => {
    const json = await request(context.app)
      .post('/api/public/leads')
      .send({ email: 'ed@nonprofit.org', name: 'Ed Director', organization: 'Helping Hands', message: 'We manage 14 grants.', source: 'pricing' });
    expect(json.status).toBe(201);
    const stored = context.db.prepare('SELECT * FROM leads WHERE email = ?').get('ed@nonprofit.org') as { source: string; organization: string };
    expect(stored.source).toBe('pricing');
    expect(stored.organization).toBe('Helping Hands');

    const form = await request(context.app)
      .post('/api/public/leads')
      .set('Accept', 'text/html')
      .type('form')
      .send({ email: 'form@nonprofit.org', message: 'Hello', source: 'contact' });
    expect(form.status).toBe(303);
    expect(form.headers.location).toBe('/contact/thanks');
    const thanks = await request(context.app).get('/contact/thanks');
    expect(thanks.status).toBe(200);
    expect(thanks.text).toContain('Message received');

    const bot = await request(context.app).post('/api/public/leads').send({ email: 'bot@spam.org', website: 'x' });
    expect(bot.status).toBe(202);
    expect(context.db.prepare('SELECT 1 AS ok FROM leads WHERE email = ?').get('bot@spam.org')).toBeUndefined();

    const invalid = await request(context.app).post('/api/public/leads').send({ email: 'not-an-email' });
    expect(invalid.status).toBe(422);
  });

  it('serves a contact form on the contact page', async () => {
    const response = await request(context.app).get('/contact');
    expect(response.text).toContain('action="/api/public/leads"');
    expect(response.text).toContain('name="website"');
  });
});

describe('calendar feed', () => {
  it('publishes a secret ICS feed that an owner can rotate and disable', async () => {
    const owner = await signIn(context.app, DEMO_USERS.owner);
    expect((await owner.agent.get('/api/calendar/feed')).body.url).toBeNull();
    const created = await post(owner, '/api/calendar/feed');
    expect(created.status).toBe(201);
    const url = created.body.url as string;
    expect(url).toMatch(/\/feeds\/[A-Za-z0-9]+\.ics$/);
    const token = url.split('/feeds/')[1]!.replace('.ics', '');

    const feed = await request(context.app).get(`/feeds/${token}.ics`);
    expect(feed.status).toBe(200);
    expect(feed.headers['content-type']).toContain('text/calendar');
    expect(feed.text).toContain('BEGIN:VCALENDAR');
    expect(feed.text).toContain('BEGIN:VEVENT');
    expect(feed.text).toContain('X-WR-CALNAME:Riverbend Community Alliance');
    expect(feed.text.split('BEGIN:VEVENT').length).toBeGreaterThan(5);
    // Lines are folded to the RFC limit.
    for (const line of feed.text.split('\r\n')) expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);

    expect((await request(context.app).get('/feeds/not-a-real-token-value.ics')).status).toBe(404);

    const rotated = await post(owner, '/api/calendar/feed');
    expect(rotated.body.url).not.toBe(url);
    expect((await request(context.app).get(`/feeds/${token}.ics`)).status).toBe(404);

    const viewer = await signIn(context.app, DEMO_USERS.viewer);
    expect((await post(viewer, '/api/calendar/feed')).status).toBe(403);

    expect((await del(owner, '/api/calendar/feed')).status).toBe(204);
    expect((await owner.agent.get('/api/calendar/feed')).body.url).toBeNull();
  });
});

describe('spreadsheet import', () => {
  it('creates grants and funders, skips duplicates and reports bad rows', async () => {
    const owner = await signUp();
    const rows = [
      { title: 'Youth Mentoring Expansion', funderName: 'Harbor Light Foundation', funderType: 'Private foundation', status: 'Awarded', awarded: '$85,000', requested: '90000', startDate: '05/01/2026', endDate: '2027-04-30', reportTitle: 'Mid-year report', reportDueDate: 'Oct 15, 2026' },
      { title: 'Community Health Navigators', funderName: 'State Department of Health', status: 'reporting', awarded: '240000', startDate: '2025-11-01', endDate: '2026-10-31', ownerEmail: owner.session.user.email },
      { title: 'youth mentoring expansion', funderName: 'harbor light foundation', awarded: '1' },
      { title: '', funderName: 'Nobody' },
      { title: 'Bad date', funderName: 'Harbor Light Foundation', awarded: '10', startDate: 'yesterday' },
    ];
    const response = await post(owner, '/api/grants/import').send({ rows, createFunders: true });
    expect(response.status).toBe(201);
    expect(response.body.created).toBe(2);
    expect(response.body.skipped).toBe(1);
    expect(response.body.errors).toBe(2);
    expect(response.body.fundersCreated).toBe(2);
    const outcomes = (response.body.rows as Array<{ outcome: string; message: string | null }>).map((r) => r.outcome);
    expect(outcomes).toEqual(['created', 'created', 'skipped', 'error', 'error']);

    const grants = await owner.agent.get('/api/grants');
    expect(grants.body.total).toBe(2);
    const mentoring = (grants.body.items as Array<{ title: string; id: string; status: string; awardedCents: number; ownerName: string | null }>).find((g) => g.title === 'Youth Mentoring Expansion')!;
    expect(mentoring.status).toBe('AWARDED');
    expect(mentoring.awardedCents).toBe(8_500_000);
    const detail = await owner.agent.get(`/api/grants/${mentoring.id}`);
    expect(detail.body.startDate).toBe('2026-05-01');
    expect(detail.body.milestones).toHaveLength(1);
    expect(detail.body.milestones[0].dueDate).toBe('2026-10-15');
    const navigators = (grants.body.items as Array<{ title: string; ownerName: string | null }>).find((g) => g.title === 'Community Health Navigators')!;
    expect(navigators.ownerName).toBe(owner.session.user.name);
  });

  it('serves the import template', async () => {
    const response = await request(context.app).get('/templates/grant-import-template.csv');
    expect(response.status).toBe(200);
    expect(response.text.split('\n')[0]).toContain('Grant title,Funder');
  });
});

describe('onboarding and sample data', () => {
  it('reports progress, loads and removes the sample portfolio, and can be dismissed', async () => {
    const owner = await signUp();
    const before = await owner.agent.get('/api/onboarding');
    expect(before.body).toMatchObject({ funders: 0, grants: 0, members: 1, hasSampleData: false, dismissed: false });

    const load = await post(owner, '/api/onboarding/sample-data');
    expect(load.status).toBe(201);
    expect(load.body).toEqual({ funders: 2, grants: 3 });
    expect((await post(owner, '/api/onboarding/sample-data')).status).toBe(409);
    const dashboard = await owner.agent.get('/api/dashboard');
    expect(dashboard.body.totals.atRiskCount).toBeGreaterThan(0);
    expect(dashboard.body.attention.length).toBeGreaterThan(0);

    const removed = await del(owner, '/api/onboarding/sample-data');
    expect(removed.body.grants).toBe(3);
    expect((await owner.agent.get('/api/grants')).body.total).toBe(0);
    expect((await owner.agent.get('/api/funders')).body.length ?? 0).toBe(0);

    expect((await post(owner, '/api/onboarding/dismiss')).status).toBe(204);
    expect((await owner.agent.get('/api/onboarding')).body.dismissed).toBe(true);
  });
});

describe('organization deletion', () => {
  it('requires the exact name and password, then removes everything and ends the session', async () => {
    const owner = await signUp();
    await post(owner, '/api/onboarding/sample-data');
    const orgId = owner.session.organization.id;

    const wrongName = await del(owner, '/api/organization').send({ password: 'a-long-enough-password', confirmName: 'Not It' });
    expect(wrongName.status).toBe(422);
    const wrongPassword = await del(owner, '/api/organization').send({ password: 'nope', confirmName: owner.session.organization.name });
    expect(wrongPassword.status).toBe(422);

    const ok = await del(owner, '/api/organization').send({ password: 'a-long-enough-password', confirmName: owner.session.organization.name });
    expect(ok.status).toBe(204);
    expect(context.db.prepare('SELECT 1 AS ok FROM organizations WHERE id = ?').get(orgId)).toBeUndefined();
    expect(context.db.prepare('SELECT COUNT(*) AS count FROM grants WHERE org_id = ?').get(orgId)).toEqual({ count: 0 });
    expect((await owner.agent.get('/api/auth/session')).status).toBe(401);
    // Sign-in is refused for a person whose only organization is gone.
    const again = await request(context.app).post('/api/auth/sign-in').send({ email: owner.session.user.email, password: 'a-long-enough-password' });
    expect(again.status).toBe(401);
  });

  it('never deletes the public demo', async () => {
    const dana = await signIn(context.app, DEMO_USERS.owner);
    const response = await del(dana, '/api/organization').send({ password: 'GrantConsole!Demo2026', confirmName: 'Riverbend Community Alliance' });
    expect(response.status).toBe(403);
  });
});
