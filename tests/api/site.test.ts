import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../server/app';
import { createTestContext, DEMO_USERS, seedContext, signIn, type TestContext } from '../helpers/context';

let context: TestContext;
let clientDir: string;

beforeAll(async () => {
  context = createTestContext();
  await seedContext(context);
  clientDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grantconsole-client-'));
  fs.writeFileSync(
    path.join(clientDir, 'index.html'),
    '<!doctype html><html><head><meta name="robots" content="noindex, nofollow"></head><body>client shell</body></html>',
  );
});

afterAll(() => {
  context.cleanup();
  fs.rmSync(clientDir, { recursive: true, force: true });
});

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

  it('ships complete social, crawler and entity metadata on the landing page', async () => {
    const response = await request(context.app).get('/');
    expect(response.text).toContain(
      '<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1"',
    );
    expect(response.text).toContain('<meta property="og:locale" content="en_US"');
    expect(response.text).toContain('<meta property="og:image:width" content="1730"');
    expect(response.text).toContain('<meta property="og:image:height" content="909"');
    expect(response.text).toContain('<meta property="og:image:alt"');
    expect(response.text).toContain('<meta name="twitter:url" content="https://grantconsole.com/"');
    expect(response.text).toContain('<meta name="twitter:image:alt"');

    const script = response.text.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/);
    expect(script?.[1]).toBeTruthy();
    const structured = JSON.parse(script![1]!) as { '@graph': Array<{ '@type': string }> };
    expect(structured['@graph'].map((entry) => entry['@type'])).toEqual([
      'Organization',
      'WebSite',
      'WebPage',
      'SoftwareApplication',
      'FAQPage',
    ]);
  });

  it('keeps important product copy and public destinations crawlable in HTML', async () => {
    const response = await request(context.app).get('/');
    expect(response.text).toContain('Post-award grant management software for nonprofits');
    expect(response.text).toContain('Built for grant recipients, not grantmakers.');
    expect(response.text).toContain('alt="GrantConsole dashboard showing awarded value');
    for (const destination of ['/about', '/contact', '/security', '/privacy', '/terms', '/signin', '/resources']) {
      expect(response.text).toContain(`href="${destination}"`);
    }
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
    expect(csp).toContain("font-src 'self' data:");
  });

  it('keeps the visible FAQ and FAQ structured data exactly aligned', async () => {
    const response = await request(context.app).get('/');
    const jsonLdMatch = response.text.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/);
    expect(jsonLdMatch).not.toBeNull();
    const structured = JSON.parse(jsonLdMatch![1]!) as {
      '@graph': Array<{
        '@type': string;
        mainEntity?: Array<{ name: string; acceptedAnswer: { text: string } }>;
      }>;
    };
    const faq = structured['@graph'].find((item) => item['@type'] === 'FAQPage');
    const structuredFaq = (faq?.mainEntity ?? []).map((item) => [item.name, item.acceptedAnswer.text]);
    const visibleFaq = [...response.text.matchAll(/<details>\s*<summary>([^<]+)<\/summary>\s*<p>([^<]+)<\/p>\s*<\/details>/g)].map(
      (match) => [match[1]!.trim(), match[2]!.trim()],
    );
    expect(visibleFaq).toHaveLength(5);
    expect(structuredFaq).toEqual(visibleFaq);
  });

  it('serves indexable, canonical trust pages without draft placeholders', async () => {
    for (const pagePath of ['/about', '/contact', '/security', '/privacy', '/terms']) {
      const response = await request(context.app).get(pagePath);
      expect(response.status, pagePath).toBe(200);
      expect(response.headers['content-type'], pagePath).toContain('text/html');
      expect(response.text, pagePath).toContain(`<link rel="canonical" href="https://grantconsole.com${pagePath}"`);
      expect(response.text, pagePath).not.toContain('noindex');
      expect(response.text, pagePath).not.toContain('[VERIFY');
    }
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

  it('serves the landing page when an expired or invalid session cookie remains', async () => {
    const response = await request(context.app)
      .get('/')
      .set('Cookie', 'grantconsole_session=stale-session-cookie');

    expect(response.status).toBe(200);
    expect(response.text).toContain('<link rel="canonical" href="https://grantconsole.com/"');
    expect(response.text).toContain('Post-award grant management software for nonprofits');
  });

  it('serves robots.txt pointing at the sitemap and shielding the API', async () => {
    const response = await request(context.app).get('/robots.txt');
    expect(response.status).toBe(200);
    expect(response.text).toContain('Disallow: /api/');
    expect(response.text).toContain('Sitemap: https://grantconsole.com/sitemap.xml');
  });

  it('serves a sitemap containing every indexable public page', async () => {
    const response = await request(context.app).get('/sitemap.xml');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('xml');
    for (const pagePath of ['/', '/about', '/contact', '/security', '/privacy', '/terms']) {
      expect(response.text).toContain(`<loc>https://grantconsole.com${pagePath}</loc>`);
    }
    // Six fixed pages plus the resources hub and every published article.
    expect(response.text.match(/<url>/g)!.length).toBeGreaterThanOrEqual(6);
    expect(response.text).toContain('<loc>https://grantconsole.com/resources</loc>');
    expect(response.text).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
  });

  it('returns a real branded 404 while preserving known SPA routes', async () => {
    const productionApp = createApp({
      db: context.db,
      uploadsDir: context.uploadsDir,
      serveStatic: true,
      clientDir,
    });

    const knownRoute = await request(productionApp).get('/signin');
    expect(knownRoute.status).toBe(200);
    expect(knownRoute.text).toContain('client shell');

    const missingRoute = await request(productionApp).get('/definitely-not-a-real-page');
    expect(missingRoute.status).toBe(404);
    expect(missingRoute.headers['content-type']).toContain('text/html');
    expect(missingRoute.text).toContain('Page not found');
    expect(missingRoute.text).toContain('noindex, nofollow');
    expect(missingRoute.text).not.toContain('client shell');
  });

  it('serves the favicon from the public directory', async () => {
    const response = await request(context.app).get('/favicon.svg');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('svg');
  });
});
