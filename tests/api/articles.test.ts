import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../server/app';
import { listArticles, loadArticlesFrom, resetArticleCache } from '../../server/lib/articles';
import { createTestContext, seedContext, type TestContext } from '../helpers/context';

const CONTENT_DIR = path.resolve(process.cwd(), 'content/articles');

let context: TestContext;
let clientDir: string;

beforeAll(async () => {
  resetArticleCache();
  context = createTestContext();
  await seedContext(context);
  clientDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grantconsole-client-'));
  fs.writeFileSync(path.join(clientDir, 'index.html'), '<!doctype html><html><body>client shell</body></html>');
});

afterAll(() => {
  context.cleanup();
  fs.rmSync(clientDir, { recursive: true, force: true });
});

function jsonLd(html: string): { '@graph': Array<Record<string, unknown>> } {
  const match = html.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/);
  expect(match?.[1]).toBeTruthy();
  return JSON.parse(match![1]!) as { '@graph': Array<Record<string, unknown>> };
}

describe('published resource articles', () => {
  it('every file in content/articles passes the publication rules', () => {
    const { articles, problems } = loadArticlesFrom(CONTENT_DIR);
    expect(problems.map((problem) => `${path.basename(problem.file)}: ${problem.message}`)).toEqual([]);
    expect(articles.length).toBeGreaterThanOrEqual(1);
  });

  it('serves the resources hub with every article, canonical metadata and structured data', async () => {
    const response = await request(context.app).get('/resources');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
    expect(response.text).toContain('<link rel="canonical" href="https://grantconsole.com/resources"');
    expect(response.text).not.toContain('noindex');
    expect(response.text).toContain('href="/resources/feed.xml"');
    const graph = jsonLd(response.text)['@graph'].map((entry) => entry['@type']);
    expect(graph).toEqual(['Organization', 'WebSite', 'CollectionPage']);
    for (const article of listArticles()) {
      expect(response.text).toContain(`href="${article.path}"`);
    }
  });

  it('serves each article with article metadata, breadcrumbs, sources, FAQ parity and the demo CTA', async () => {
    for (const article of listArticles()) {
      const response = await request(context.app).get(article.path);
      expect(response.status, article.path).toBe(200);
      expect(response.text, article.path).toContain(`<link rel="canonical" href="https://grantconsole.com${article.path}"`);
      expect(response.text, article.path).toContain('<meta property="og:type" content="article"');
      expect(response.text, article.path).toContain(`<meta property="article:published_time" content="${article.publishedAt}"`);
      expect(response.text, article.path).not.toContain('noindex');
      expect(response.text, article.path).not.toContain('[VERIFY');
      expect(response.text, article.path).toContain('aria-label="Breadcrumb"');
      expect(response.text, article.path).toContain('href="/signin"');
      expect(response.text, article.path).toContain('not legal, accounting or audit advice');
      // The H1 is the title, exactly once.
      expect(response.text.match(/<h1[ >]/g), article.path).toHaveLength(1);

      const graph = jsonLd(response.text)['@graph'];
      const types = graph.map((entry) => entry['@type']);
      expect(types.slice(0, 5), article.path).toEqual(['Organization', 'WebSite', 'WebPage', 'BreadcrumbList', 'Article']);
      const schemaArticle = graph.find((entry) => entry['@type'] === 'Article') as Record<string, unknown>;
      expect(schemaArticle.headline).toBe(article.title);
      expect(schemaArticle.datePublished).toBe(article.publishedAt);
      expect(schemaArticle.dateModified).toBe(article.updatedAt);

      if (article.faq.length > 0) {
        expect(types, article.path).toContain('FAQPage');
        const faq = graph.find((entry) => entry['@type'] === 'FAQPage') as {
          mainEntity: Array<{ name: string; acceptedAnswer: { text: string } }>;
        };
        const structured = faq.mainEntity.map((item) => item.name);
        const visible = [...response.text.matchAll(/<section class="faq" id="faq">[\s\S]*?<\/section>/g)]
          .flatMap((section) => [...section[0].matchAll(/<h3>([^<]+)<\/h3>/g)].map((match) => match[1]!))
          .map((question) => question.replaceAll('&#39;', "'").replaceAll('&quot;', '"').replaceAll('&amp;', '&'));
        expect(structured, article.path).toEqual(visible);
      } else {
        expect(types, article.path).not.toContain('FAQPage');
      }

      if (article.sources.length > 0) {
        expect(response.text, article.path).toContain('<section class="sources" id="sources">');
        for (const source of article.sources) {
          expect(response.text, article.path).toContain(`href="${source.url}"`);
        }
      }
    }
  });

  it('lists the hub and every article in the sitemap with real lastmod dates', async () => {
    const response = await request(context.app).get('/sitemap.xml');
    expect(response.status).toBe(200);
    expect(response.text).toContain('<loc>https://grantconsole.com/resources</loc>');
    for (const article of listArticles()) {
      expect(response.text).toContain(`<loc>https://grantconsole.com${article.path}</loc>\n    <lastmod>${article.updatedAt}</lastmod>`);
    }
  });

  it('serves an RSS feed of the articles', async () => {
    const response = await request(context.app).get('/resources/feed.xml');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('rss');
    expect(response.text).toContain('<rss version="2.0"');
    for (const article of listArticles()) {
      expect(response.text).toContain(`<link>https://grantconsole.com${article.path}</link>`);
    }
  });

  it('redirects trailing-slash variants to the canonical article URL', async () => {
    const [article] = listArticles();
    expect(article).toBeTruthy();
    const response = await request(context.app).get(`${article!.path}/`);
    expect(response.status).toBe(301);
    expect(response.headers.location).toBe(article!.path);
  });

  it('returns the branded 404 for unknown resource slugs', async () => {
    const productionApp = createApp({ db: context.db, uploadsDir: context.uploadsDir, serveStatic: true, clientDir });
    const response = await request(productionApp).get('/resources/this-article-does-not-exist');
    expect(response.status).toBe(404);
    expect(response.text).toContain('Page not found');
    expect(response.text).not.toContain('client shell');
  });

  it('links the resources hub from the landing page and trust pages', async () => {
    const landing = await request(context.app).get('/');
    expect(landing.text).toContain('href="/resources"');
    const about = await request(context.app).get('/about');
    expect(about.text).toContain('href="/resources"');
  });
});
