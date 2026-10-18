import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => { vi.stubEnv('GA_MEASUREMENT_ID', 'G-TEST1234'); vi.stubEnv('RESEND_API_KEY', ''); });
import { createApp } from '../../server/app';
import { config } from '../../server/config';
import { LEAD_RECEIPT_COOKIE } from '../../server/lib/lead-quality';
import { resetPublicThrottles } from '../../server/routes/public';
import { resetAuthThrottles } from '../../server/routes/auth';
import { setMailTransport, type MailMessage } from '../../server/lib/mailer';
import { createTestContext, type TestContext } from '../helpers/context';

let ctx: TestContext;
let shellDir: string;
const outbox: MailMessage[] = [];
beforeAll(async () => {
  ctx = await createTestContext();
  shellDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-measurement-'));
  fs.writeFileSync(path.join(shellDir, 'index.html'), '<!doctype html><html><head><title>App</title></head><body>app shell</body></html>');
  setMailTransport(async (message) => { outbox.push(message); return { sent: true, transport: 'custom' }; });
});
beforeEach(() => { resetPublicThrottles(); resetAuthThrottles(); outbox.length = 0; });
afterAll(async () => {
  await ctx?.cleanup(); if (shellDir) fs.rmSync(shellDir, { recursive: true, force: true });
  setMailTransport(null); vi.unstubAllEnvs();
});
const inquiry = (email: string) => ({ email, name: 'Synthetic Reviewer', organization: 'Synthetic Nonprofit', message: 'Please explain reporting deadlines.', source: 'contact' });
const cookieValue = (response: request.Response, name: string) => (response.headers['set-cookie'] as unknown as string[] ?? []).slice().reverse().find((c) => c.startsWith(name + '=') && !c.startsWith(name + '=;'))?.split(';')[0];

describe('contact conversion integrity', () => {
  it('emits only once for an accepted form; direct visits, refresh and receipt replay do not count', async () => {
    const direct = await request(ctx.app).get('/contact/thanks');
    expect(direct.text).not.toContain("gtag('event', 'generate_lead'");
    expect(direct.text).not.toContain('<!--ANALYTICS-->');
    const posted = await request(ctx.app).post('/api/public/leads').type('form').send(inquiry('receipt@example.org'));
    expect(posted.status).toBe(303);
    expect(outbox).toHaveLength(2);
    const receipt = cookieValue(posted, LEAD_RECEIPT_COOKIE)!;
    expect(receipt).toBeTruthy();
    const first = await request(ctx.app).get('/contact/thanks').set('Cookie', receipt);
    expect(first.text).toContain("gtag('event', 'generate_lead'");
    expect(first.headers['cache-control']).toBe('no-store');
    const replay = await request(ctx.app).get('/contact/thanks').set('Cookie', receipt);
    expect(replay.text).not.toContain("gtag('event', 'generate_lead'");
  });
  it('deduplicates submissions across limiter resets and suppresses repeat mail and receipts', async () => {
    const first = await request(ctx.app).post('/api/public/leads').send(inquiry('duplicate@example.org'));
    expect(first.status).toBe(201);
    resetPublicThrottles();
    const second = await request(ctx.app).post('/api/public/leads').type('form').send(inquiry('duplicate@example.org'));
    expect(second.status).toBe(303);
    expect(cookieValue(second, LEAD_RECEIPT_COOKIE)).toBeUndefined();
    expect(outbox).toHaveLength(2);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM leads WHERE email = ?').get('duplicate@example.org')).toEqual({ n: 1 });
  });
  it('retains opaque repeated submissions as flagged without sending mail or a receipt', async () => {
    const response = await request(ctx.app).post('/api/public/leads').send({ email: 'synthetic@example.org', name: 'EXAMPLE1858872SYNTHETIC', organization: 'EXAMPLE1858872SYNTHETIC', message: 'EXAMPLE1858872BOTSTRING', source: 'contact' });
    expect(response.status).toBe(202); expect(outbox).toHaveLength(0);
    expect(ctx.db.prepare('SELECT quality_status FROM leads WHERE email = ?').get('synthetic@example.org')).toEqual({ quality_status: 'flagged' });
  });
  it('silently discards honeypots; invalid forms and forged or expired receipts never convert', async () => {
    const honey = await request(ctx.app).post('/api/public/leads').type('form').send({ ...inquiry('honeypot@example.org'), website: 'spam.example' });
    expect(honey.status).toBe(303); expect(outbox).toHaveLength(0);
    expect(ctx.db.prepare('SELECT id FROM leads WHERE email = ?').get('honeypot@example.org')).toBeUndefined();
    expect((await request(ctx.app).post('/api/public/leads').send({ email: 'invalid' })).status).toBe(422);
    const forged = await request(ctx.app).get('/contact/thanks').set('Cookie', `${LEAD_RECEIPT_COOKIE}=${'a'.repeat(64)}`);
    expect(forged.text).not.toContain("gtag('event', 'generate_lead'");
    const posted = await request(ctx.app).post('/api/public/leads').type('form').send(inquiry('expired@example.org'));
    ctx.db.prepare("UPDATE leads SET receipt_expires_at = '2000-01-01T00:00:00.000Z' WHERE email = ?").run('expired@example.org');
    const expired = await request(ctx.app).get('/contact/thanks').set('Cookie', cookieValue(posted, LEAD_RECEIPT_COOKIE)!);
    expect(expired.text).not.toContain("gtag('event', 'generate_lead'");
  });
  it('does not trust forwarding headers from an untrusted direct connection', async () => {
    const directApp = createApp({ db: ctx.db, uploadsDir: ctx.uploadsDir });
    directApp.set('trust proxy', false); // Model an untrusted peer; loopback is explicitly trusted in normal local tests.
    const direct = await ctx.serve(directApp);
    for (let i = 0; i < 12; i++) {
      expect((await request(direct).post('/api/public/leads').set('X-Forwarded-For', `198.51.100.${i}`).send(inquiry(`limit${i}@example.org`))).status).toBe(201);
    }
    const limited = await request(direct).post('/api/public/leads').set('X-Forwarded-For', '203.0.113.99').send(inquiry('limited@example.org'));
    expect(limited.status).toBe(429);
  });
  it('restricts quality changes and lead summaries to the existing owner token', async () => {
    const lead = await request(ctx.app).post('/api/public/leads').send(inquiry('review@example.org'));
    expect((await request(ctx.app).patch('/api/admin/leads/quality').send({ id: lead.body.id, quality: 'qualified' })).status).toBe(401);
    expect((await request(ctx.app).patch('/api/admin/leads/quality').set('Authorization', `Bearer ${config.adminToken}`).send({ id: lead.body.id, quality: 'qualified' })).status).toBe(200);
    const summary = await request(ctx.app).get('/api/admin/leads/summary').set('Authorization', `Bearer ${config.adminToken}`);
    expect(summary.status).toBe(200); expect(summary.text).not.toContain('review@example.org');
    const leads = await request(ctx.app).get('/api/admin/leads').set('Authorization', `Bearer ${config.adminToken}`);
    expect(leads.text).not.toContain('receipt_hash'); expect(leads.text).not.toContain('fingerprint');
  });
});

describe('privacy and acquisition boundaries', () => {
  it('never admits GA on app/auth/token-bearing routes even with a configured ID', async () => {
    const app = await ctx.serve(createApp({ db: ctx.db, uploadsDir: ctx.uploadsDir, serveStatic: true, clientDir: shellDir }));
    for (const route of ['/signin', '/signup', '/invite/synthetic-private-token', '/reset-password?token=synthetic', '/grants/private-id/packet', '/settings/billing?checkout=success']) {
      const result = await request(app).get(route);
      expect(result.status).toBe(200); expect(result.text).not.toContain('grantconsole-ga');
      expect(result.headers['content-security-policy']).not.toMatch(/google-analytics|googletagmanager/);
      expect(result.text).not.toContain('gtag');
    }
    const publicPage = await request(app).get('/pricing');
    expect(publicPage.text).toContain('G-TEST1234');
  });
  it('keeps signed coarse attribution without storing search terms or query input; freezes it on successful signup', async () => {
    const agent = request.agent(ctx.app);
    const landing = await agent.get('/resources/grant-management-spreadsheet-template?private=do-not-store').set('Referer', 'https://www.google.com/search?q=private-search-term');
    expect(landing.status).toBe(200); expect(landing.headers['cache-control']).toBe('private, no-store');
    const cookie = cookieValue(landing, 'grantconsole_acquisition')!;
    const encoded = cookie.split('=')[1]!.split('.')[0]!;
    const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
    expect(decoded).not.toContain('private'); expect(decoded).toContain('google_organic');
    const signup = await agent.post('/api/auth/sign-up').send({ name: 'Synthetic User', email: 'attribution@example.org', password: 'Synthetic-password-123!', organizationName: 'Synthetic Measurement Org' });
    expect(signup.status).toBe(201);
    expect(ctx.db.prepare('SELECT acquisition_channel, acquisition_landing FROM organizations WHERE id = ?').get(signup.body.organization.id)).toEqual({ acquisition_channel: 'google_organic', acquisition_landing: '/resources/grant-management-spreadsheet-template' });
  });
  it('respects privacy signals, excludes paid Google clicks and leaves unknown routes/cookies unattributed', async () => {
    for (const signal of ['DNT', 'Sec-GPC']) {
      const result = await request(ctx.app).get('/pricing').set('Referer', 'https://www.google.com/').set(signal, '1');
      expect(cookieValue(result, 'grantconsole_acquisition')).toBeUndefined();
    }
    const paid = await request(ctx.app).get('/pricing?gclid=synthetic').set('Referer', 'https://www.google.com/');
    const value = cookieValue(paid, 'grantconsole_acquisition')!.split('=')[1]!.split('.')[0]!;
    expect(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')).channel).toBe('other');
    const unknown = await request(ctx.app).get('/invite/synthetic').set('Referer', 'https://www.google.com/');
    expect(cookieValue(unknown, 'grantconsole_acquisition')).toBeUndefined();
    const signup = await request(ctx.app).post('/api/auth/sign-up').set('Cookie', 'grantconsole_acquisition=forged.signature').send({ name: 'Synthetic Unknown', email: 'unknown@example.org', password: 'Synthetic-password-123!', organizationName: 'Synthetic Unknown Org' });
    expect(signup.status).toBe(201);
    expect(ctx.db.prepare('SELECT acquisition_channel FROM organizations WHERE id = ?').get(signup.body.organization.id)).toEqual({ acquisition_channel: 'unknown' });
  });
  it('retains the same allowed landing routes at capture and signup, including top-level product pages', async () => {
    for (const [index, route] of ['/grant-tracking-software-for-nonprofits', '/about'].entries()) {
      const agent = request.agent(ctx.app);
      const landing = await agent.get(route).set('Referer', 'https://www.google.com/');
      expect(landing.status).toBe(200);
      expect(cookieValue(landing, 'grantconsole_acquisition')).toBeTruthy();
      const signup = await agent.post('/api/auth/sign-up').send({ name: 'Synthetic Landing', email: `landing${index}@example.org`, password: 'Synthetic-password-123!', organizationName: `Synthetic Landing ${index}` });
      expect(signup.status).toBe(201);
      expect(ctx.db.prepare('SELECT acquisition_channel, acquisition_landing FROM organizations WHERE id = ?').get(signup.body.organization.id))
        .toEqual({ acquisition_channel: 'google_organic', acquisition_landing: route });
    }
  });
  it('does not pretend public-page startup time is an editorial lastmod', async () => {
    const response = await request(ctx.app).get('/sitemap.xml');
    const pricing = response.text.match(/<url>\s*<loc>https:\/\/grantconsole.com\/pricing<\/loc>([\s\S]*?)<\/url>/)![1];
    expect(pricing).not.toContain('lastmod');
    expect(response.text).toContain('<lastmod>2026-10-18</lastmod>');
  });
});
