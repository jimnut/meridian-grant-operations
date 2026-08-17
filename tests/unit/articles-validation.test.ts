import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadArticlesFrom, parseArticle, slugify } from '../../server/lib/articles';

const BODY = `## What this covers

${'A useful sentence about post-award grant management for nonprofit recipients. '.repeat(40)}

## A second section

More detail with an [internal link](/signin) and a [source](https://www.ecfr.gov/current/title-2/section-200.344).

${'Another sentence explaining restricted budgets and reporting deadlines in detail. '.repeat(30)}
`;

const FRONT = `---
title: A Valid Test Article About Grant Reporting
description: A description that is comfortably long enough to satisfy the seventy character minimum for metadata.
summary: A direct answer that is long enough to count as a real lead paragraph for the reader and for structured data output.
category: guide
primaryKeyword: grant reporting
publishedAt: 2026-08-17
sources:
  - title: 2 CFR 200.344
    url: https://www.ecfr.gov/current/title-2/section-200.344
    checked: 2026-08-17
---
`;

const dirs: string[] = [];

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grantconsole-articles-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function messages(file: string, raw: string): string[] {
  return parseArticle(file, raw).problems.map((problem) => problem.message);
}

describe('article validation', () => {
  it('accepts a well-formed article and renders Markdown with heading ids and safe links', () => {
    const { article, problems } = parseArticle('/tmp/a-valid-test-article-about-grant-reporting.md', FRONT + BODY);
    expect(problems).toEqual([]);
    expect(article?.path).toBe('/resources/a-valid-test-article-about-grant-reporting');
    expect(article?.bodyHtml).toContain('<h2 id="what-this-covers">');
    expect(article?.bodyHtml).toContain('<a href="https://www.ecfr.gov/current/title-2/section-200.344" rel="noopener">');
    expect(article?.bodyHtml).toContain('<a href="/signin">');
    expect(article?.wordCount).toBeGreaterThan(500);
    expect(article?.updatedAt).toBe('2026-08-17');
    expect(article?.author).toBe('GrantConsole editorial team');
  });

  it('rejects files without front matter', () => {
    expect(messages('/tmp/x.md', '# hello\n\ntext')).toContain(
      'missing YAML front matter (file must start with --- and close with ---)',
    );
  });

  it('requires the slug to match the file name and be URL-safe', () => {
    const explicitSlug = FRONT.replace('category: guide', 'category: guide\nslug: a-valid-test-article-about-grant-reporting') + BODY;
    expect(messages('/tmp/other-name.md', explicitSlug).join('\n')).toContain('must match the file name');
    expect(messages('/tmp/Bad_Slug.md', FRONT + BODY).join('\n')).toContain('lowercase words');
  });

  it('rejects placeholders and unverifiable claims', () => {
    const bad = FRONT + BODY + '\n\nPricing starts at $499/month and we are SOC 2 certified. [VERIFY: founder]';
    const found = messages('/tmp/a-valid-test-article-about-grant-reporting.md', bad).join('\n');
    expect(found).toContain('pricing claim');
    expect(found).toContain('certification claim');
    expect(found).toContain('unresolved [VERIFY] placeholder');
  });

  it('rejects scripts, external images and an H1 in the body', () => {
    const bad = FRONT + '# Not allowed\n\n' + BODY + '\n\n![chart](https://example.com/chart.png)\n\n<script>alert(1)</script>';
    const found = messages('/tmp/a-valid-test-article-about-grant-reporting.md', bad).join('\n');
    expect(found).toContain('must not contain an H1');
    expect(found).toContain('images must be self-hosted');
    expect(found).toContain('disallowed HTML element');
  });

  it('requires a source for non-product articles and a minimum body length', () => {
    const noSources = FRONT.replace(/sources:[\s\S]*?checked: 2026-08-17\n/, '') + BODY;
    expect(messages('/tmp/a-valid-test-article-about-grant-reporting.md', noSources).join('\n')).toContain(
      'must cite at least one primary source',
    );
    const short = FRONT + '## One\n\nToo short. [link](/)\n\n## Two\n\nStill short.';
    expect(messages('/tmp/a-valid-test-article-about-grant-reporting.md', short).join('\n')).toContain('at least 500 words');
  });

  it('rejects paths that collide with application or trust routes', () => {
    const collision = FRONT.replace('category: guide', 'category: guide\npath: /grants/anything') + BODY;
    expect(messages('/tmp/a-valid-test-article-about-grant-reporting.md', collision).join('\n')).toContain('collides');
  });

  it('validates FAQ shape and question marks', () => {
    const faq = FRONT.replace('sources:', 'faq:\n  - q: Missing question mark\n    a: An answer that is long enough to pass the length check.\nsources:') + BODY;
    expect(messages('/tmp/a-valid-test-article-about-grant-reporting.md', faq).join('\n')).toContain('must end with a question mark');
  });

  it('loads a directory, excludes drafts, and reports duplicate paths and unknown related slugs', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'a-valid-test-article-about-grant-reporting.md'), FRONT + BODY);
    fs.writeFileSync(
      path.join(dir, 'second-article-about-grant-closeout.md'),
      FRONT.replace('title: A Valid Test Article About Grant Reporting', 'title: Second Article About Grant Closeout Steps')
        .replace('category: guide', 'category: guide\npath: /resources/a-valid-test-article-about-grant-reporting\nrelated: [does-not-exist]') + BODY,
    );
    fs.writeFileSync(
      path.join(dir, 'draft-article-about-something.md'),
      FRONT.replace('title: A Valid Test Article About Grant Reporting', 'title: Draft Article About Something Else').replace(
        'category: guide',
        'category: guide\ndraft: true',
      ) + BODY,
    );
    const { articles, problems } = loadArticlesFrom(dir);
    expect(articles.map((article) => article.slug)).toEqual([
      'a-valid-test-article-about-grant-reporting',
      'second-article-about-grant-closeout',
    ]);
    const text = problems.map((problem) => problem.message).join('\n');
    expect(text).toContain('is already used by');
    expect(text).toContain('related slug "does-not-exist" does not exist');
  });

  it('slugifies headings predictably', () => {
    expect(slugify('Federal vs. Foundation Grants: What Changes?')).toBe('federal-vs-foundation-grants-what-changes');
    expect(slugify('  Ünïcode & symbols ')).toBe('unicode-and-symbols');
  });
});
