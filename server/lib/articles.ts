/**
 * Server-rendered resource articles.
 *
 * Articles are Markdown files with YAML front matter in `content/articles/`.
 * They are read once at first use, validated against the publication rules in
 * `content/CONTENT_GUIDE.md`, rendered with the shared public chrome and served
 * at `/resources/<slug>` (or an explicit `path`). The hub at `/resources`, the
 * RSS feed and the sitemap are derived from the same list.
 *
 * Validation is deliberately strict: the daily publishing job runs the test
 * suite before it pushes, so an article that breaks a rule never reaches
 * production. In production an invalid file is skipped and logged rather than
 * taking the whole site down.
 */

import fs from 'node:fs';
import path from 'node:path';

import yaml from 'js-yaml';
import { Marked, type Tokens } from 'marked';

import { config } from '../config';
import {
  entityGraphNodes,
  escapeHtml,
  injectAnalytics,
  publicFooter,
  publicHead,
  publicHeader,
} from './public-chrome';

export const ARTICLE_CATEGORIES = ['guide', 'checklist', 'template', 'explainer', 'comparison', 'product'] as const;
export type ArticleCategory = (typeof ARTICLE_CATEGORIES)[number];

const CATEGORY_LABELS: Record<ArticleCategory, string> = {
  guide: 'Guide',
  checklist: 'Checklist',
  template: 'Template',
  explainer: 'Explainer',
  comparison: 'Comparison',
  product: 'Product',
};

export interface ArticleFaq {
  q: string;
  a: string;
}

export interface ArticleSource {
  title: string;
  url: string;
  /** YYYY-MM-DD the source was last checked. */
  checked?: string;
}

export interface ArticleCta {
  label: string;
  href: string;
  text?: string;
}

export interface Article {
  slug: string;
  path: string;
  title: string;
  description: string;
  summary: string;
  category: ArticleCategory;
  primaryKeyword: string;
  keywords: string[];
  intent: string;
  publishedAt: string;
  updatedAt: string;
  factCheckedAt: string;
  author: string;
  reviewer?: string;
  faq: ArticleFaq[];
  sources: ArticleSource[];
  related: string[];
  cta?: ArticleCta;
  draft: boolean;
  /** Rendered body HTML (Markdown → HTML). */
  bodyHtml: string;
  /** Raw Markdown body, kept for validation and word counts. */
  bodyMarkdown: string;
  wordCount: number;
  file: string;
}

export interface ArticleProblem {
  file: string;
  message: string;
}

const DEFAULT_CONTENT_DIR = path.resolve(process.cwd(), 'content/articles');
const RESOURCES_PATH = '/resources';
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PATH_PATTERN = /^\/[a-z0-9]+(?:[-/][a-z0-9]+)*$/;
const RESERVED_PATH_PREFIXES = ['/api', '/signin', '/grants', '/funders', '/calendar', '/reports', '/team', '/settings'];
const RESERVED_PATHS = new Set(['/', '/about', '/contact', '/security', '/privacy', '/terms', RESOURCES_PATH]);

/**
 * Phrases that must never appear in published copy because no verified fact
 * supports them (see content/CONTENT_GUIDE.md). Matched case-insensitively
 * against the front matter and body.
 */
const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\[verify[:\]]/i, reason: 'unresolved [VERIFY] placeholder' },
  { pattern: /\b(todo|tbd|lorem ipsum|placeholder text)\b/i, reason: 'unfinished placeholder text' },
  { pattern: /\{\{[^}]*\}\}/, reason: 'unrendered template token' },
  { pattern: /soc\s?2[- ](certified|compliant|report)/i, reason: 'certification claim' },
  { pattern: /iso\s?27001/i, reason: 'certification claim' },
  { pattern: /hipaa[- ]compliant/i, reason: 'certification claim' },
  { pattern: /\b(trusted by|our customers|customers (love|trust)|case study|testimonial)\b/i, reason: 'customer proof claim' },
  { pattern: /\b(free forever|pricing starts at|per (seat|user) per month)\b/i, reason: 'pricing claim' },
  { pattern: /\$\s?\d[\d,]*(\.\d+)?\s*(\/|per)\s*(mo|month|yr|year|seat|user)\b/i, reason: 'pricing claim' },
  { pattern: /guarantee[sd]?\s+(compliance|approval|funding|renewal)/i, reason: 'compliance/outcome guarantee' },
  { pattern: /\b(finds|discover|discovers|search for) (new )?grants? (opportunities|for you)\b/i, reason: 'grant-discovery claim' },
  { pattern: /<\s*(script|iframe|object|embed|style|link|meta|form|input|button)\b/i, reason: 'disallowed HTML element' },
  { pattern: /\bon[a-z]+\s*=\s*["']/i, reason: 'inline event handler' },
  { pattern: /javascript:/i, reason: 'javascript: URL' },
];

let markedInstance: Marked | null = null;

function markdown(): Marked {
  if (markedInstance) return markedInstance;
  const instance = new Marked({ gfm: true, breaks: false });
  instance.use({
    renderer: {
      heading(token: Tokens.Heading): string {
        const text = this.parser.parseInline(token.tokens);
        const plain = token.text.replace(/[*_`~[\]()]/g, '');
        const id = slugify(plain);
        return `<h${token.depth} id="${id}">${text}</h${token.depth}>\n`;
      },
      link(token: Tokens.Link): string {
        const text = this.parser.parseInline(token.tokens);
        const href = escapeHtml(token.href);
        const title = token.title ? ` title="${escapeHtml(token.title)}"` : '';
        const external = /^https?:\/\//i.test(token.href) && !token.href.startsWith(`${config.siteUrl}/`);
        const rel = external ? ' rel="noopener"' : '';
        return `<a href="${href}"${title}${rel}>${text}</a>`;
      },
      table(token: Tokens.Table): string {
        const header = token.header
          .map((cell) => `<th${cell.align ? ` align="${cell.align}"` : ''}>${this.parser.parseInline(cell.tokens)}</th>`)
          .join('');
        const rows = token.rows
          .map(
            (row) =>
              `<tr>${row
                .map((cell) => `<td${cell.align ? ` align="${cell.align}"` : ''}>${this.parser.parseInline(cell.tokens)}</td>`)
                .join('')}</tr>`,
          )
          .join('\n');
        return `<div class="table-wrap"><table><thead><tr>${header}</tr></thead><tbody>\n${rows}\n</tbody></table></div>\n`;
      },
    },
  });
  markedInstance = instance;
  return instance;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined;
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim());
}

function splitFrontMatter(raw: string): { meta: unknown; body: string } | null {
  const normalized = raw.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return null;
  const end = normalized.indexOf('\n---\n', 4);
  if (end === -1) return null;
  const front = normalized.slice(4, end);
  const body = normalized.slice(end + 5);
  return { meta: yaml.load(front, { schema: yaml.JSON_SCHEMA }), body };
}

function countWords(markdownText: string): number {
  return markdownText
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`|-]/g, ' ')
    .split(/\s+/)
    .filter((token) => /[a-z0-9]/i.test(token)).length;
}

/** Parses one file into an Article, collecting every rule violation. */
export function parseArticle(file: string, raw: string): { article: Article | null; problems: ArticleProblem[] } {
  const problems: ArticleProblem[] = [];
  const fail = (message: string): void => {
    problems.push({ file, message });
  };

  const split = splitFrontMatter(raw);
  if (!split) {
    fail('missing YAML front matter (file must start with --- and close with ---)');
    return { article: null, problems };
  }
  if (!isRecord(split.meta)) {
    fail('front matter must be a mapping');
    return { article: null, problems };
  }
  const meta = split.meta;
  const bodyMarkdown = split.body.trim();

  const fileSlug = path.basename(file, '.md');
  const slug = asString(meta.slug) ?? fileSlug;
  if (!SLUG_PATTERN.test(slug)) fail(`slug "${slug}" must be lowercase words separated by single hyphens`);
  if (slug !== fileSlug) fail(`slug "${slug}" must match the file name "${fileSlug}"`);

  const pagePath = asString(meta.path) ?? `${RESOURCES_PATH}/${slug}`;
  if (!PATH_PATTERN.test(pagePath)) fail(`path "${pagePath}" is not a valid lowercase URL path`);
  if (RESERVED_PATHS.has(pagePath) || RESERVED_PATH_PREFIXES.some((prefix) => pagePath === prefix || pagePath.startsWith(`${prefix}/`))) {
    fail(`path "${pagePath}" collides with an application or trust-page route`);
  }

  const title = asString(meta.title) ?? '';
  if (title.length < 20 || title.length > 90) fail(`title must be 20–90 characters (got ${title.length})`);

  const description = asString(meta.description) ?? '';
  if (description.length < 70 || description.length > 175) {
    fail(`description must be 70–175 characters (got ${description.length})`);
  }

  const summary = asString(meta.summary) ?? '';
  if (summary.length < 100 || summary.length > 480) fail(`summary must be a 100–480 character direct answer (got ${summary.length})`);

  const category = asString(meta.category) as ArticleCategory | undefined;
  if (!category || !ARTICLE_CATEGORIES.includes(category)) {
    fail(`category must be one of ${ARTICLE_CATEGORIES.join(', ')}`);
  }

  const primaryKeyword = asString(meta.primaryKeyword) ?? '';
  if (primaryKeyword.length < 4) fail('primaryKeyword is required');
  const keywords = asStringList(meta.keywords);
  const intent = asString(meta.intent) ?? 'informational';

  const publishedAt = asString(meta.publishedAt) ?? '';
  if (!DATE_PATTERN.test(publishedAt) || Number.isNaN(Date.parse(publishedAt))) fail('publishedAt must be YYYY-MM-DD');
  const updatedAt = asString(meta.updatedAt) ?? publishedAt;
  if (!DATE_PATTERN.test(updatedAt) || Number.isNaN(Date.parse(updatedAt))) fail('updatedAt must be YYYY-MM-DD');
  if (updatedAt < publishedAt) fail('updatedAt must not be earlier than publishedAt');
  const factCheckedAt = asString(meta.factCheckedAt) ?? updatedAt;
  if (!DATE_PATTERN.test(factCheckedAt)) fail('factCheckedAt must be YYYY-MM-DD');

  const author = asString(meta.author) ?? 'GrantConsole editorial team';
  const reviewer = asString(meta.reviewer);
  const draft = meta.draft === true;

  const faq: ArticleFaq[] = [];
  if (meta.faq !== undefined) {
    if (!Array.isArray(meta.faq)) fail('faq must be a list of { q, a } items');
    else {
      for (const item of meta.faq) {
        const q = isRecord(item) ? asString(item.q) : undefined;
        const a = isRecord(item) ? asString(item.a) : undefined;
        if (!q || !a) {
          fail('every faq item needs q and a');
          continue;
        }
        if (!q.endsWith('?')) fail(`faq question "${q}" must end with a question mark`);
        if (a.length < 40) fail(`faq answer for "${q}" is too short to be useful`);
        faq.push({ q, a });
      }
    }
  }

  const sources: ArticleSource[] = [];
  if (meta.sources !== undefined) {
    if (!Array.isArray(meta.sources)) fail('sources must be a list of { title, url, checked } items');
    else {
      for (const item of meta.sources) {
        const sourceTitle = isRecord(item) ? asString(item.title) : undefined;
        const url = isRecord(item) ? asString(item.url) : undefined;
        const checked = isRecord(item) ? asString(item.checked) : undefined;
        if (!sourceTitle || !url || !/^https:\/\//.test(url)) {
          fail('every source needs a title and an https URL');
          continue;
        }
        if (checked && !DATE_PATTERN.test(checked)) fail(`source "${sourceTitle}" has an invalid checked date`);
        sources.push(checked ? { title: sourceTitle, url, checked } : { title: sourceTitle, url });
      }
    }
  }
  if (category && category !== 'product' && sources.length === 0) {
    fail('guides, checklists, templates, explainers and comparisons must cite at least one primary source');
  }

  const related = asStringList(meta.related);
  for (const relatedSlug of related) {
    if (!SLUG_PATTERN.test(relatedSlug)) fail(`related slug "${relatedSlug}" is not a valid slug`);
  }

  let cta: ArticleCta | undefined;
  if (meta.cta !== undefined) {
    const label = isRecord(meta.cta) ? asString(meta.cta.label) : undefined;
    const href = isRecord(meta.cta) ? asString(meta.cta.href) : undefined;
    const text = isRecord(meta.cta) ? asString(meta.cta.text) : undefined;
    if (!label || !href || !href.startsWith('/')) fail('cta needs a label and an internal href');
    else cta = text ? { label, href, text } : { label, href };
  }

  // Body rules.
  const wordCount = countWords(bodyMarkdown);
  if (wordCount < 500) fail(`body must be at least 500 words (got ${wordCount})`);
  if (wordCount > 4500) fail(`body must stay under 4,500 words (got ${wordCount})`);
  if (/^#\s/m.test(bodyMarkdown)) fail('body must not contain an H1 (# heading); the title is the H1');
  const h2Count = (bodyMarkdown.match(/^##\s/gm) ?? []).length;
  if (h2Count < 2) fail('body needs at least two H2 (## heading) sections');
  if (!/\]\(\/[a-z0-9#-]/.test(bodyMarkdown) && !/href="\/[a-z0-9#-]/.test(bodyMarkdown)) {
    fail('body must contain at least one internal link (e.g. to /, /signin or another resource)');
  }
  if (/!\[[^\]]*\]\((?!\/)/.test(bodyMarkdown)) fail('images must be self-hosted (CSP blocks external images)');
  const haystack = `${JSON.stringify(meta)}\n${bodyMarkdown}`;
  for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
    const match = haystack.match(pattern);
    if (match) fail(`${reason}: "${match[0]}"`);
  }

  if (problems.length > 0) return { article: null, problems };

  const bodyHtml = markdown().parse(bodyMarkdown, { async: false }) as string;
  const article: Article = {
    slug,
    path: pagePath,
    title,
    description,
    summary,
    category: category as ArticleCategory,
    primaryKeyword,
    keywords,
    intent,
    publishedAt,
    updatedAt,
    factCheckedAt,
    author,
    faq,
    sources,
    related,
    draft,
    bodyHtml,
    bodyMarkdown,
    wordCount,
    file,
  };
  if (reviewer) article.reviewer = reviewer;
  if (cta) article.cta = cta;
  return { article, problems };
}

export interface LoadResult {
  articles: Article[];
  problems: ArticleProblem[];
}

/** Loads and validates every article in a directory (newest first). Drafts are excluded. */
export function loadArticlesFrom(dir: string): LoadResult {
  const problems: ArticleProblem[] = [];
  const articles: Article[] = [];
  if (!fs.existsSync(dir)) return { articles, problems };
  const files = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .sort();
  for (const name of files) {
    const file = path.join(dir, name);
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = parseArticle(file, raw);
    problems.push(...parsed.problems);
    if (parsed.article && !parsed.article.draft) articles.push(parsed.article);
  }
  const seenPaths = new Map<string, string>();
  for (const article of articles) {
    const existing = seenPaths.get(article.path);
    if (existing) problems.push({ file: article.file, message: `path ${article.path} is already used by ${existing}` });
    seenPaths.set(article.path, article.file);
  }
  const bySlug = new Set(articles.map((article) => article.slug));
  for (const article of articles) {
    for (const relatedSlug of article.related) {
      if (!bySlug.has(relatedSlug)) {
        problems.push({ file: article.file, message: `related slug "${relatedSlug}" does not exist` });
      }
    }
  }
  articles.sort((a, b) => (a.publishedAt === b.publishedAt ? a.slug.localeCompare(b.slug) : a.publishedAt < b.publishedAt ? 1 : -1));
  return { articles, problems };
}

let cache: LoadResult | null = null;
let cacheDir: string | null = null;

/** Articles for the running server. Invalid files are logged and skipped, never fatal. */
export function listArticles(dir: string = DEFAULT_CONTENT_DIR): Article[] {
  if (!cache || cacheDir !== dir) {
    cache = loadArticlesFrom(dir);
    cacheDir = dir;
    if (cache.problems.length > 0 && !config.isTest) {
      for (const problem of cache.problems) {
        console.error(`[articles] ${path.basename(problem.file)}: ${problem.message}`);
      }
      const invalidFiles = new Set(cache.problems.map((problem) => problem.file));
      cache.articles = cache.articles.filter((article) => !invalidFiles.has(article.file));
    }
    renderedCache.clear();
  }
  return cache.articles;
}

/** Test hook: clear cached articles so a different directory can be loaded. */
export function resetArticleCache(): void {
  cache = null;
  cacheDir = null;
  renderedCache.clear();
}

export function findArticle(pagePath: string, dir?: string): Article | undefined {
  return listArticles(dir).find((article) => article.path === pagePath);
}

export function articleSitemapEntries(dir?: string): Array<{ loc: string; lastmod: string }> {
  const articles = listArticles(dir);
  const entries: Array<{ loc: string; lastmod: string }> = [];
  if (articles.length > 0) {
    const newest = articles.reduce((max, article) => (article.updatedAt > max ? article.updatedAt : max), articles[0]!.updatedAt);
    entries.push({ loc: `${config.siteUrl}${RESOURCES_PATH}`, lastmod: newest });
  }
  for (const article of articles) {
    entries.push({ loc: `${config.siteUrl}${article.path}`, lastmod: article.updatedAt });
  }
  return entries;
}

const renderedCache = new Map<string, string>();

function formatDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

function readingMinutes(wordCount: number): number {
  return Math.max(1, Math.round(wordCount / 220));
}

function articleStyles(): string {
  return `
    .crumbs { margin:0 0 22px; padding:0; list-style:none; display:flex; flex-wrap:wrap; gap:6px; color:var(--muted); font-size:13px; }
    .crumbs li + li::before { content:"›"; margin-right:6px; color:#9aa8a2; }
    .crumbs a { color:var(--muted); text-decoration:none; font-weight:600; }
    .crumbs a:hover { color:var(--signal-deep); }
    .article-hero { max-width:820px; padding-bottom:36px; border-bottom:1px solid var(--edge); }
    .article-hero h1 { font-size:clamp(38px,6vw,62px); max-width:22ch; }
    .meta-row { margin:26px 0 0; padding:0; list-style:none; display:flex; flex-wrap:wrap; gap:8px 22px; color:var(--muted); font:600 12.5px/1.5 var(--mono); letter-spacing:.02em; }
    .meta-row strong { color:var(--ink); font-weight:700; }
    .lead { margin:28px 0 0; padding:22px 24px; max-width:72ch; border-left:4px solid var(--signal); background:var(--card); border-radius:0 12px 12px 0; font-size:18px; line-height:1.6; }
    .lead p { margin:0; }
    .lead strong { display:block; margin-bottom:6px; color:var(--signal-deep); font:700 11px/1.4 var(--mono); letter-spacing:.12em; text-transform:uppercase; }
    .article-body { max-width:760px; padding:8px 0 40px; }
    .article-body h2 { margin:44px 0 14px; font-size:28px; line-height:1.18; letter-spacing:-.025em; }
    .article-body h3 { margin:30px 0 10px; font-size:20px; line-height:1.3; letter-spacing:-.015em; }
    .article-body h4 { margin:22px 0 8px; font-size:17px; }
    .article-body p { margin:0 0 17px; }
    .article-body ul,.article-body ol { margin:4px 0 20px; padding-left:24px; }
    .article-body li { margin:8px 0; }
    .article-body li > ul,.article-body li > ol { margin:6px 0 4px; }
    .article-body blockquote { margin:22px 0; padding:14px 20px; border-left:4px solid var(--edge); color:var(--muted); background:var(--card); border-radius:0 10px 10px 0; }
    .article-body blockquote p:last-child { margin-bottom:0; }
    .article-body code { padding:2px 6px; background:#e7eee9; border-radius:6px; font:.92em var(--mono); }
    .article-body pre { padding:16px 18px; overflow:auto; background:var(--night); color:#eff8f4; border-radius:12px; }
    .article-body pre code { padding:0; background:none; color:inherit; }
    .article-body hr { margin:36px 0; border:0; border-top:1px solid var(--edge); }
    .article-body img { max-width:100%; height:auto; border:1px solid var(--edge); border-radius:12px; }
    .article-body li:has(> input[type=checkbox]) { list-style:none; margin-left:-24px; }
    .article-body input[type=checkbox] { margin:0 8px 0 0; vertical-align:-1px; }
    .table-wrap { margin:20px 0 26px; overflow-x:auto; border:1px solid var(--edge); border-radius:12px; background:var(--card); }
    .article-body table { width:100%; border-collapse:collapse; font-size:15px; }
    .article-body th,.article-body td { padding:11px 14px; text-align:left; vertical-align:top; border-bottom:1px solid var(--edge); }
    .article-body th { background:#e9efeb; font-weight:700; }
    .article-body tr:last-child td { border-bottom:0; }
    .faq { max-width:760px; padding:8px 0 24px; }
    .faq h2 { margin:0 0 6px; font-size:28px; letter-spacing:-.025em; }
    .faq h3 { margin:26px 0 8px; font-size:19px; }
    .faq p { margin:0; }
    .sources { max-width:760px; padding:8px 0 20px; }
    .sources h2 { margin:0 0 10px; font-size:22px; letter-spacing:-.02em; }
    .sources ol { margin:0; padding-left:22px; font-size:15px; }
    .sources li { margin:8px 0; overflow-wrap:anywhere; }
    .sources small { color:var(--muted); }
    .disclaimer { max-width:760px; margin:8px 0 0; color:var(--muted); font-size:14px; }
    .article-cta { max-width:760px; }
    .related { max-width:960px; padding:34px 0 10px; }
    .related h2 { margin:0 0 16px; font-size:22px; letter-spacing:-.02em; }
    .card-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; }
    .card-grid a,.list-grid a { display:grid; align-content:start; gap:7px; padding:20px; border:1px solid var(--edge); border-radius:14px; color:var(--ink); background:var(--card); text-decoration:none; }
    .card-grid a:hover,.list-grid a:hover { border-color:#b9d8cc; }
    .card-grid strong,.list-grid strong { font-size:17px; line-height:1.3; letter-spacing:-.01em; }
    .card-grid span,.list-grid span { color:var(--muted); font-size:14px; line-height:1.55; }
    .card-grid small,.list-grid small { color:var(--signal-deep); font:700 11px/1.4 var(--mono); letter-spacing:.12em; text-transform:uppercase; }
    .list-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; padding:36px 0 20px; }
    .hub-count { color:var(--muted); font-size:14px; margin:14px 0 0; }
    @media (max-width:820px) { .card-grid,.list-grid { grid-template-columns:1fr; } .article-hero h1 { font-size:clamp(34px,8vw,48px); } }
  `;
}

function articleStructuredData(article: Article, canonical: string): string {
  const graph: Array<Record<string, unknown>> = [
    ...entityGraphNodes(),
    {
      '@type': 'WebPage',
      '@id': `${canonical}#webpage`,
      name: article.title,
      description: article.description,
      url: canonical,
      isPartOf: { '@id': `${config.siteUrl}/#website` },
      about: { '@id': `${config.siteUrl}/#organization` },
      inLanguage: 'en-US',
      datePublished: article.publishedAt,
      dateModified: article.updatedAt,
      breadcrumb: { '@id': `${canonical}#breadcrumb` },
    },
    {
      '@type': 'BreadcrumbList',
      '@id': `${canonical}#breadcrumb`,
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'GrantConsole', item: `${config.siteUrl}/` },
        { '@type': 'ListItem', position: 2, name: 'Resources', item: `${config.siteUrl}${RESOURCES_PATH}` },
        { '@type': 'ListItem', position: 3, name: article.title, item: canonical },
      ],
    },
    {
      '@type': 'Article',
      '@id': `${canonical}#article`,
      headline: article.title,
      description: article.description,
      abstract: article.summary,
      url: canonical,
      mainEntityOfPage: { '@id': `${canonical}#webpage` },
      isPartOf: { '@id': `${config.siteUrl}/#website` },
      author: { '@type': 'Organization', name: article.author, url: `${config.siteUrl}/about` },
      publisher: { '@id': `${config.siteUrl}/#organization` },
      datePublished: article.publishedAt,
      dateModified: article.updatedAt,
      image: `${config.siteUrl}/og-image-liquid-v3.png`,
      inLanguage: 'en-US',
      articleSection: CATEGORY_LABELS[article.category],
      keywords: [article.primaryKeyword, ...article.keywords].join(', '),
      wordCount: article.wordCount,
      ...(article.sources.length > 0 ? { citation: article.sources.map((source) => source.url) } : {}),
    },
  ];
  if (article.faq.length > 0) {
    graph.push({
      '@type': 'FAQPage',
      '@id': `${canonical}#faq`,
      mainEntity: article.faq.map((item) => ({
        '@type': 'Question',
        name: item.q,
        acceptedAnswer: { '@type': 'Answer', text: item.a },
      })),
    });
  }
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph });
}

function relatedArticles(article: Article, all: Article[]): Article[] {
  const explicit = article.related
    .map((slug) => all.find((candidate) => candidate.slug === slug))
    .filter((candidate): candidate is Article => Boolean(candidate) && candidate!.slug !== article.slug);
  if (explicit.length >= 3) return explicit.slice(0, 3);
  const fill = all.filter((candidate) => candidate.slug !== article.slug && !explicit.includes(candidate));
  return [...explicit, ...fill].slice(0, 3);
}

function cardHtml(article: Article): string {
  return `<a href="${article.path}"><small>${CATEGORY_LABELS[article.category]}</small><strong>${escapeHtml(article.title)}</strong><span>${escapeHtml(article.description)}</span></a>`;
}

/** Full HTML for one article. Cached per path for the process lifetime. */
export function articleHtml(article: Article, dir?: string): string {
  const cached = renderedCache.get(article.path);
  if (cached) return cached;

  const canonical = `${config.siteUrl}${article.path}`;
  const all = listArticles(dir);
  const related = relatedArticles(article, all);
  const cta: ArticleCta = article.cta ?? {
    label: 'Open the live demo',
    href: '/signin',
    text: 'See how GrantConsole tracks deadlines, restricted budgets, evidence and funder reports in a seeded nonprofit workspace—no sales call required.',
  };

  const meta = [
    `<li><strong>${CATEGORY_LABELS[article.category]}</strong></li>`,
    `<li>Published <time datetime="${article.publishedAt}">${formatDate(article.publishedAt)}</time></li>`,
    article.updatedAt !== article.publishedAt
      ? `<li>Updated <time datetime="${article.updatedAt}">${formatDate(article.updatedAt)}</time></li>`
      : '',
    `<li>Fact-checked <time datetime="${article.factCheckedAt}">${formatDate(article.factCheckedAt)}</time></li>`,
    `<li>${readingMinutes(article.wordCount)} min read</li>`,
    `<li>By ${escapeHtml(article.author)}${article.reviewer ? ` · Reviewed by ${escapeHtml(article.reviewer)}` : ''}</li>`,
  ]
    .filter(Boolean)
    .join('');

  const faqHtml =
    article.faq.length > 0
      ? `<section class="faq" id="faq"><h2>Frequently asked questions</h2>${article.faq
          .map((item) => `<h3>${escapeHtml(item.q)}</h3><p>${escapeHtml(item.a)}</p>`)
          .join('')}</section>`
      : '';

  const sourcesHtml =
    article.sources.length > 0
      ? `<section class="sources" id="sources"><h2>Sources</h2><ol>${article.sources
          .map(
            (source) =>
              `<li><a href="${escapeHtml(source.url)}" rel="noopener">${escapeHtml(source.title)}</a>${
                source.checked ? ` <small>· checked ${formatDate(source.checked)}</small>` : ''
              }</li>`,
          )
          .join('')}</ol></section>`
      : '';

  const relatedHtml =
    related.length > 0
      ? `<section class="related"><h2>Related resources</h2><div class="card-grid">${related.map(cardHtml).join('')}</div></section>`
      : '';

  const html = `<!doctype html>
<html lang="en">
${publicHead(
  {
    title: article.title,
    description: article.description,
    canonical,
    ogType: 'article',
    publishedTime: article.publishedAt,
    modifiedTime: article.updatedAt,
    structuredData: articleStructuredData(article, canonical),
    extraHead: `<link rel="alternate" type="application/rss+xml" title="GrantConsole resources" href="${config.siteUrl}${RESOURCES_PATH}/feed.xml" />`,
  },
  articleStyles(),
)}
<body>
  ${publicHeader()}
  <main class="page-shell">
    <nav aria-label="Breadcrumb"><ol class="crumbs"><li><a href="/">GrantConsole</a></li><li><a href="${RESOURCES_PATH}">Resources</a></li><li aria-current="page">${escapeHtml(article.title)}</li></ol></nav>
    <header class="article-hero">
      <p class="eyebrow">${CATEGORY_LABELS[article.category]} · Post-award grant management</p>
      <h1>${escapeHtml(article.title)}</h1>
      <ul class="meta-row">${meta}</ul>
      <div class="lead"><strong>Direct answer</strong><p>${escapeHtml(article.summary)}</p></div>
    </header>
    <article class="article-body">${article.bodyHtml}</article>
    ${faqHtml}
    <aside class="callout article-cta">
      <strong>${escapeHtml(cta.label)}</strong>
      <span>${escapeHtml(cta.text ?? '')}</span>
      <a class="button" href="${escapeHtml(cta.href)}">${escapeHtml(cta.label)}</a>
    </aside>
    ${sourcesHtml}
    <p class="disclaimer">This resource is general information for nonprofit grant recipients, not legal, accounting or audit advice. Verify obligations against the award agreement, funder guidance and current regulations, and consult a qualified professional for your situation.</p>
    ${relatedHtml}
  </main>
  ${publicFooter()}
</body>
</html>`;
  const rendered = injectAnalytics(html);
  renderedCache.set(article.path, rendered);
  return rendered;
}

/** The /resources hub: every published article, newest first. */
export function resourcesIndexHtml(dir?: string): string {
  const cached = renderedCache.get(RESOURCES_PATH);
  if (cached) return cached;
  const articles = listArticles(dir);
  const canonical = `${config.siteUrl}${RESOURCES_PATH}`;
  const title = 'Post-Award Grant Management Resources for Nonprofits';
  const description =
    'Guides, checklists and templates for nonprofit grant recipients: deadlines, restricted budgets, evidence, compliance, funder reports and closeout.';
  const structuredData = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      ...entityGraphNodes(),
      {
        '@type': 'CollectionPage',
        '@id': `${canonical}#webpage`,
        name: title,
        description,
        url: canonical,
        isPartOf: { '@id': `${config.siteUrl}/#website` },
        about: { '@id': `${config.siteUrl}/#organization` },
        inLanguage: 'en-US',
        mainEntity: {
          '@type': 'ItemList',
          itemListElement: articles.map((article, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            url: `${config.siteUrl}${article.path}`,
            name: article.title,
          })),
        },
      },
    ],
  });
  const list =
    articles.length > 0
      ? `<div class="list-grid">${articles
          .map(
            (article) =>
              `<a href="${article.path}"><small>${CATEGORY_LABELS[article.category]} · <time datetime="${article.updatedAt}">${formatDate(article.updatedAt)}</time></small><strong>${escapeHtml(article.title)}</strong><span>${escapeHtml(article.description)}</span></a>`,
          )
          .join('')}</div>`
      : '<p class="intro">New guides are published regularly. Check back soon.</p>';
  const html = `<!doctype html>
<html lang="en">
${publicHead(
  {
    title,
    description,
    canonical,
    structuredData,
    extraHead: `<link rel="alternate" type="application/rss+xml" title="GrantConsole resources" href="${config.siteUrl}${RESOURCES_PATH}/feed.xml" />`,
  },
  articleStyles(),
)}
<body>
  ${publicHeader()}
  <main class="page-shell">
    <header class="page-hero">
      <p class="eyebrow">Resources</p>
      <h1>Post-award grant management, explained.</h1>
      <p class="intro">Practical guides, checklists and templates for the work that starts after the award letter: deadlines, restricted budgets, evidence, compliance, funder reports and closeout. Written for nonprofit grant recipients, sourced to primary guidance, and fact-checked on the date shown.</p>
      <p class="hub-count">${articles.length} ${articles.length === 1 ? 'resource' : 'resources'} · <a href="${RESOURCES_PATH}/feed.xml">RSS feed</a></p>
    </header>
    ${list}
    <aside class="callout article-cta">
      <strong>See the workflows in a real workspace.</strong>
      <span>The public demo opens a seeded nonprofit with active grants, deadlines, restricted budgets and evidence—no sales call required.</span>
      <a class="button" href="/signin">Open the live demo</a>
    </aside>
  </main>
  ${publicFooter()}
</body>
</html>`;
  const rendered = injectAnalytics(html);
  renderedCache.set(RESOURCES_PATH, rendered);
  return rendered;
}

/** RSS 2.0 feed of published articles (newest first, 50 max). */
export function resourcesFeedXml(dir?: string): string {
  const articles = listArticles(dir).slice(0, 50);
  const items = articles
    .map((article) => {
      const link = `${config.siteUrl}${article.path}`;
      return [
        '    <item>',
        `      <title>${escapeXml(article.title)}</title>`,
        `      <link>${link}</link>`,
        `      <guid isPermaLink="true">${link}</guid>`,
        `      <pubDate>${new Date(`${article.publishedAt}T09:00:00Z`).toUTCString()}</pubDate>`,
        `      <description>${escapeXml(article.description)}</description>`,
        `      <category>${escapeXml(CATEGORY_LABELS[article.category])}</category>`,
        '    </item>',
      ].join('\n');
    })
    .join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    '    <title>GrantConsole resources</title>',
    `    <link>${config.siteUrl}${RESOURCES_PATH}</link>`,
    `    <atom:link href="${config.siteUrl}${RESOURCES_PATH}/feed.xml" rel="self" type="application/rss+xml" />`,
    '    <description>Guides, checklists and templates for post-award grant management at nonprofits.</description>',
    '    <language>en-us</language>',
    items,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n');
}

function escapeXml(value: string): string {
  return escapeHtml(value);
}

export const RESOURCES_ROUTE = RESOURCES_PATH;
