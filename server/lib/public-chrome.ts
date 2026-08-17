/**
 * Shared chrome for every server-rendered public page (trust pages, the
 * resources hub, articles, and the branded 404): header, footer, base styles,
 * escaping helpers and the Organization/WebSite structured-data nodes.
 *
 * Kept dependency-free and CSP-safe: inline styles only, no scripts, system
 * fonts, no external requests.
 */

import { config } from '../config';

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function siteUrl(): string {
  return config.siteUrl;
}

export const GA_ID_PATTERN = /^G-[A-Z0-9]{4,16}$/;

/** Replaces the analytics slot with the GA4 tag when a valid measurement id is configured. */
export function injectAnalytics(html: string): string {
  const gaId = config.gaMeasurementId;
  if (!gaId || !GA_ID_PATTERN.test(gaId)) return html;
  return html.replace(
    '<!--ANALYTICS-->',
    [
      `<script async src="https://www.googletagmanager.com/gtag/js?id=${gaId}"></script>`,
      `<script>window.dataLayer=window.dataLayer||[];function gtag(){window.dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${gaId}');</script>`,
    ].join('\n  '),
  );
}

/** Organization + WebSite nodes reused by every public page's JSON-LD graph. */
export function entityGraphNodes(): Array<Record<string, unknown>> {
  return [
    {
      '@type': 'Organization',
      '@id': `${config.siteUrl}/#organization`,
      name: 'GrantConsole',
      url: `${config.siteUrl}/`,
      logo: { '@type': 'ImageObject', url: `${config.siteUrl}/favicon.svg` },
      email: 'support@grantconsole.com',
    },
    {
      '@type': 'WebSite',
      '@id': `${config.siteUrl}/#website`,
      name: 'GrantConsole',
      url: `${config.siteUrl}/`,
      publisher: { '@id': `${config.siteUrl}/#organization` },
      inLanguage: 'en-US',
    },
  ];
}

export interface HeadMeta {
  title: string;
  description: string;
  canonical: string;
  /** Open Graph type: website for hubs and trust pages, article for articles. */
  ogType?: 'website' | 'article';
  /** ISO dates, only meaningful for articles. */
  publishedTime?: string;
  modifiedTime?: string;
  /** Serialized JSON-LD document. */
  structuredData: string;
  /** Extra head tags (e.g. RSS link, prev/next). */
  extraHead?: string;
}

/** The complete <head> shared by public pages, including social cards and analytics slot. */
export function publicHead(meta: HeadMeta, extraStyles = ''): string {
  const ogType = meta.ogType ?? 'website';
  const articleMeta =
    ogType === 'article'
      ? [
          meta.publishedTime ? `<meta property="article:published_time" content="${meta.publishedTime}" />` : '',
          meta.modifiedTime ? `<meta property="article:modified_time" content="${meta.modifiedTime}" />` : '',
        ]
          .filter(Boolean)
          .join('\n  ')
      : '';
  return `<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="color-scheme" content="light" />
  <title>${escapeHtml(meta.title)}</title>
  <meta name="description" content="${escapeHtml(meta.description)}" />
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />
  <link rel="canonical" href="${meta.canonical}" />
  <meta property="og:type" content="${ogType}" />
  <meta property="og:locale" content="en_US" />
  <meta property="og:site_name" content="GrantConsole" />
  <meta property="og:title" content="${escapeHtml(meta.title)}" />
  <meta property="og:description" content="${escapeHtml(meta.description)}" />
  <meta property="og:url" content="${meta.canonical}" />
  <meta property="og:image" content="${config.siteUrl}/og-image-liquid-v3.png" />
  <meta property="og:image:width" content="1730" />
  <meta property="og:image:height" content="909" />
  <meta property="og:image:alt" content="GrantConsole post-award grant operations dashboard" />
  ${articleMeta}
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:url" content="${meta.canonical}" />
  <meta name="twitter:title" content="${escapeHtml(meta.title)}" />
  <meta name="twitter:description" content="${escapeHtml(meta.description)}" />
  <meta name="twitter:image" content="${config.siteUrl}/og-image-liquid-v3.png" />
  <meta name="twitter:image:alt" content="GrantConsole post-award grant operations dashboard" />
  <meta name="theme-color" content="#07141a" />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  ${meta.extraHead ?? ''}
  <script type="application/ld+json">${meta.structuredData}</script>
  <!--ANALYTICS-->
  <style>${publicPageStyles()}${extraStyles}</style>
</head>`;
}

export function publicHeader(): string {
  return `<header class="site-header-wrap">
    <div class="site-header">
      <a class="brand" href="/" aria-label="GrantConsole home"><img src="/favicon.svg" width="34" height="34" alt="" /><span><strong>GrantConsole</strong><small>Grant operations</small></span></a>
      <nav aria-label="Primary"><a href="/resources">Resources</a><a href="/about">About</a><a href="/security">Security</a><a href="/contact">Contact</a><a class="nav-demo" href="/signin">Open live demo</a></nav>
    </div>
  </header>`;
}

export function publicFooter(): string {
  return `<footer class="site-footer-wrap">
    <div class="site-footer">
      <span>© GrantConsole · post-award grant management for nonprofits</span>
      <nav aria-label="Footer"><a href="/resources">Resources</a><a href="/about">About</a><a href="/contact">Contact</a><a href="/security">Security</a><a href="/privacy">Privacy</a><a href="/terms">Demo terms</a></nav>
    </div>
  </footer>`;
}

export function publicPageStyles(): string {
  return `
    :root { --night:#07141a; --night-soft:#0d2027; --paper:#f3f6f2; --card:#fff; --ink:#10201b; --muted:#5c6b65; --edge:#d8e1db; --signal:#49dda9; --signal-deep:#08785b; --signal-soft:#dff7ed; --watch-soft:#fff2dc; --mono:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace; --serif:ui-serif,'Iowan Old Style','Palatino Linotype',Palatino,Georgia,serif; --sans:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif; }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--paper); color:var(--ink); font:16px/1.7 var(--sans); -webkit-font-smoothing:antialiased; }
    a { color:var(--signal-deep); text-underline-offset:4px; }
    a:focus-visible { outline:3px solid var(--signal); outline-offset:4px; border-radius:5px; }
    .site-header-wrap { color:#eff8f4; background:var(--night); }
    .site-header,.site-footer,.page-shell { width:min(100% - 40px,960px); margin-inline:auto; }
    .site-header { min-height:82px; display:flex; align-items:center; justify-content:space-between; gap:24px; border-bottom:1px solid rgba(255,255,255,.1); }
    .brand { display:flex; align-items:center; gap:10px; color:inherit; text-decoration:none; }
    .brand img { width:34px; height:34px; }
    .brand strong,.brand small { display:block; line-height:1.22; }
    .brand strong { font-size:17px; }
    .brand small { margin-top:3px; color:#8fa9a0; font:600 10px/1.2 var(--mono); letter-spacing:.12em; text-transform:uppercase; }
    .site-header nav,.site-footer nav { display:flex; align-items:center; gap:18px; flex-wrap:wrap; }
    .site-header nav a { color:#aebfba; text-decoration:none; font-size:14px; font-weight:650; }
    .site-header nav a:hover { color:#fff; }
    .site-header nav .nav-demo { color:#06140f; background:var(--signal); padding:9px 14px; border-radius:10px; font-weight:800; }
    .page-shell { padding:84px 0 24px; }
    .page-hero { max-width:790px; padding-bottom:48px; border-bottom:1px solid var(--edge); }
    .eyebrow { margin:0 0 15px; color:var(--signal-deep); font:700 12px/1.4 var(--mono); letter-spacing:.12em; text-transform:uppercase; }
    h1 { margin:0; max-width:17ch; font-family:var(--serif); font-size:clamp(44px,7vw,74px); font-weight:500; line-height:.99; letter-spacing:-.045em; text-wrap:balance; }
    .intro { margin:25px 0 0; max-width:68ch; color:var(--muted); font-size:19px; line-height:1.65; }
    .content { max-width:790px; padding:20px 0 56px; }
    .content section { padding:34px 0 4px; }
    .content h2 { margin:0 0 13px; font-size:27px; line-height:1.18; letter-spacing:-.025em; }
    .content p { margin:0 0 16px; }
    .content ul { margin:4px 0 18px; padding-left:22px; }
    .content li { margin:9px 0; }
    .callout,.notice { margin:36px 0 4px; padding:25px; border:1px solid #b9d8cc; background:var(--signal-soft); border-radius:14px; display:grid; gap:10px; }
    .notice--amber { border-color:#ead2a8; background:var(--watch-soft); }
    .callout strong,.notice strong { font-size:18px; }
    .callout span,.notice span { color:var(--muted); }
    .button { justify-self:start; display:inline-block; margin-top:5px; padding:12px 17px; color:#06140f; background:var(--signal); border-radius:11px; text-decoration:none; font-weight:800; }
    .contact-link { font:700 clamp(20px,4vw,30px)/1.3 var(--mono); overflow-wrap:anywhere; }
    .link-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; }
    .link-grid a { display:grid; gap:5px; padding:19px; border:1px solid var(--edge); border-radius:12px; color:var(--ink); background:var(--card); text-decoration:none; }
    .link-grid span { color:var(--muted); font-size:14px; }
    .site-footer-wrap { margin-top:58px; background:#e9efeb; border-top:1px solid var(--edge); }
    .site-footer { padding:29px 0 42px; display:flex; justify-content:space-between; gap:18px; flex-wrap:wrap; color:var(--muted); font-size:13px; }
    .site-footer nav a { color:var(--muted); text-decoration:none; font-weight:600; }
    .error-page { min-height:62vh; display:flex; flex-direction:column; justify-content:center; }
    .actions { margin-top:28px; display:flex; align-items:center; gap:20px; }
    .text-link { font-weight:750; }
    @media (max-width:700px) { .site-header { align-items:flex-start; padding:19px 0; } .site-header nav { justify-content:flex-end; gap:10px 14px; } .site-header nav a:not(.nav-demo) { display:none; } .page-shell { padding-top:56px; } .link-grid { grid-template-columns:1fr; } }
  `;
}
