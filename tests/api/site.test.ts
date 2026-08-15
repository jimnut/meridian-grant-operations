import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../server/app';
import { createTestContext, DEMO_USERS, seedContext, signIn, type TestContext } from '../helpers/context';

let context: TestContext;

beforeAll(async () => {
  context = createTestContext();
  await seedContext(context);
});

afterAll(() => context.cleanup());

describe('public marketing surface', () => {
  it('serves the indexable landing page to anonymous visitors', async () => {
    const response = await request(context.app).get('/');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.text).toContain('GrantConsole');
    expect(response.text).toContain('<link rel="canonical" href="https://grantconsole.com/"');
    expect(response.text).toContain('application/ld+json');
    // The landing must be indexable — no noindex anywhere.
    expect(response.text).not.toContain('noindex');
    expect(response.text).toContain('two organizations, eighteen grants');
  });

  it('keeps FAQ structured-data questions aligned with the visible FAQ', async () => {
    const response = await request(context.app).get('/');
    const script = response.text.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/);
    expect(script?.[1]).toBeTruthy();

    const structured = JSON.parse(script![1]!) as {
      '@graph': Array<{ '@type': string; mainEntity?: Array<{ name: string }> }>;
    };
    const faq = structured['@graph'].find((entry) => entry['@type'] === 'FAQPage');
    const structuredQuestions = faq?.mainEntity?.map((question) => question.name) ?? [];
    const visibleQuestions = [...response.text.matchAll(/<summary>([^<]+)<\/summary>/g)].map((match) => match[1]);

    expect(structuredQuestions).toEqual(visibleQuestions);
  });

  it('locks the landing page down with its own CSP', async () => {
    const response = await request(context.app).get('/');
    const csp = response.headers['content-security-policy'];
    expect(csp).toContain("default-src 'none'");
    // Analytics is off in tests, so no script host is admitted at all.
    expect(csp).toContain("script-src 'none'");
  });

  it('locks down the built app bundle even when a demo host omits NODE_ENV', async () => {
    const builtApp = createApp({ db: context.db, uploadsDir: context.uploadsDir, serveStatic: true });
    const response = await request(builtApp).get('/api/health');
    const csp = response.headers['content-security-policy'];

    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toContain('localhost:5173');
  });

  it('sends signed-in visitors past the landing page to the app', async () => {
    const client = await signIn(context.app, DEMO_USERS.owner);
    const response = await client.agent.get('/');
    // Tests run without the static client bundle, so falling through the
    // landing route surfaces as a 404 rather than the SPA shell. The point
    // being proven: a session cookie never sees the marketing page.
    expect(response.status).not.toBe(200);
    expect(response.text ?? '').not.toContain('canonical');
  });

  it('serves robots.txt pointing at the sitemap and shielding the API', async () => {
    const response = await request(context.app).get('/robots.txt');
    expect(response.status).toBe(200);
    expect(response.text).toContain('Disallow: /api/');
    expect(response.text).toContain('Sitemap: https://grantconsole.com/sitemap.xml');
  });

  it('serves a valid single-URL sitemap', async () => {
    const response = await request(context.app).get('/sitemap.xml');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('xml');
    expect(response.text).toContain('<loc>https://grantconsole.com/</loc>');
    expect(response.text).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
  });

  it('serves the favicon from the public directory', async () => {
    const response = await request(context.app).get('/favicon.svg');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('svg');
  });
});
