/**
 * Shared chrome for every server-rendered public page (trust pages, the
 * resources hub, articles, and the branded 404): header, footer, base styles,
 * escaping helpers and the Organization/WebSite structured-data nodes.
 *
 * Kept dependency-free and CSP-safe: inline styles, a locally hosted font,
 * and no external requests beyond configured analytics.
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
  <meta property="og:image" content="${config.siteUrl}/og-image-daylight.png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="GrantConsole post-award grant operations dashboard" />
  ${articleMeta}
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:url" content="${meta.canonical}" />
  <meta name="twitter:title" content="${escapeHtml(meta.title)}" />
  <meta name="twitter:description" content="${escapeHtml(meta.description)}" />
  <meta name="twitter:image" content="${config.siteUrl}/og-image-daylight.png" />
  <meta name="twitter:image:alt" content="GrantConsole post-award grant operations dashboard" />
  <meta name="theme-color" content="#f7f8f5" />
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
      <a class="brand" href="/" aria-label="GrantConsole home"><img src="/favicon.svg" width="32" height="32" alt="" /><strong>GrantConsole</strong></a>
      <nav aria-label="Primary"><a href="/pricing">Pricing</a><a href="/resources">Resources</a><a href="/about">About</a><a href="/security">Security</a><a href="/contact">Contact</a><a class="nav-signin" href="/signin">Sign in</a><a class="nav-demo" href="/signup">Start free trial</a></nav>
    </div>
  </header>`;
}

export function publicFooter(): string {
  return `<footer class="site-footer-wrap">
    <div class="site-footer">
      <div class="footer-intro"><a class="brand" href="/" aria-label="GrantConsole home"><img src="/favicon.svg" width="32" height="32" alt="" /><strong>GrantConsole</strong></a><p>Post-award grant management for nonprofits.</p><span>© GrantConsole</span></div>
      <nav aria-label="Footer"><a href="/pricing">Pricing</a><a href="/signup">Start free trial</a><a href="/signin">Live demo</a><a href="/resources">Resources</a><a href="/about">About</a><a href="/contact">Contact</a><a href="/security">Security</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a></nav>
    </div>
  </footer>`;
}

export function publicPageStyles(): string {
  return `
    @font-face { font-family:'Archivo'; font-style:normal; font-weight:100 900; font-display:swap; src:url('/fonts/archivo-latin.woff2') format('woff2'); }
    :root { --night:#111512; --night-soft:#1d271e; --paper:#f7f8f5; --card:#fff; --ink:#111512; --muted:#626962; --edge:#dde2dc; --signal:#2f6f2b; --signal-deep:#2f6f2b; --signal-soft:#eaf5e5; --lime:#d8ff75; --watch-soft:#fff6d1; --mono:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace; --serif:ui-serif,'Iowan Old Style','Palatino Linotype',Palatino,Georgia,serif; --sans:'Archivo',ui-sans-serif,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif; }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--paper); color:var(--ink); font:16px/1.7 var(--sans); -webkit-font-smoothing:antialiased; }
    a { color:var(--signal-deep); text-underline-offset:4px; }
    a:focus-visible,button:focus-visible,input:focus-visible,textarea:focus-visible,summary:focus-visible { outline:3px solid var(--signal); outline-offset:4px; border-radius:5px; }
    .site-header-wrap { padding-top:20px; color:var(--ink); }
    .site-header,.site-footer,.page-shell { width:min(100% - 48px,1120px); margin-inline:auto; }
    .site-header { min-height:76px; padding:16px 24px; display:flex; align-items:center; justify-content:space-between; gap:24px; background:var(--card); border:1px solid var(--edge); border-radius:18px; box-shadow:0 8px 24px rgba(17,21,18,.025); }
    .brand { display:flex; align-items:center; gap:10px; color:inherit; text-decoration:none; }
    .brand img { width:32px; height:32px; flex:none; }
    .brand strong { display:block; font-size:18px; font-weight:650; letter-spacing:-.045em; line-height:1.2; }
    .site-header nav,.site-footer nav { display:flex; align-items:center; gap:22px; flex-wrap:wrap; }
    .site-header nav a { color:var(--muted); text-decoration:none; font-size:13px; font-weight:550; }
    .site-header nav a:hover { color:var(--signal); }
    .site-header nav .nav-demo { color:#fff; background:var(--signal); padding:11px 17px; border-radius:9px; font-weight:600; }
    .site-header nav .nav-demo:hover { background:#245822; color:#fff; }
    .site-header nav .nav-signin { color:var(--ink); }
    .contact-form { display:grid; gap:12px; max-width:560px; margin:8px 0 0; }
    .contact-form label { display:grid; gap:7px; font:550 14px/1.4 var(--sans); color:var(--muted); }
    .contact-form input,.contact-form textarea { width:100%; padding:11px 12px; border:1px solid var(--edge); border-radius:10px; background:var(--card); color:var(--ink); font:15px/1.4 var(--sans); }
    .contact-form textarea { min-height:110px; resize:vertical; }
    .contact-form button { justify-self:start; padding:14px 20px; background:var(--signal); color:#fff; border:0; border-radius:9px; font:600 15px var(--sans); cursor:pointer; }
    .contact-form .hp { position:absolute; left:-9999px; width:1px; height:1px; overflow:hidden; }
    .page-shell { padding:80px 0 24px; }
    .page-hero { max-width:820px; margin-inline:auto; padding-bottom:48px; border-bottom:1px solid var(--edge); text-align:center; }
    .eyebrow { margin:0 0 20px; color:var(--signal-deep); font:600 12px/1.4 var(--sans); letter-spacing:.09em; text-transform:uppercase; }
    h1 { margin:0 auto; max-width:19ch; font-family:var(--sans); font-size:clamp(40px,6.5vw,72px); font-weight:550; line-height:1.04; letter-spacing:-.06em; text-wrap:balance; }
    .intro { margin:24px auto 0; max-width:64ch; color:var(--muted); font-size:18px; line-height:1.7; }
    .content { max-width:790px; margin-inline:auto; padding:20px 0 56px; }
    .content section { padding:34px 0 4px; }
    .content h2 { margin:0 0 13px; font-size:27px; line-height:1.18; letter-spacing:-.025em; }
    .content p { margin:0 0 16px; }
    .content ul { margin:4px 0 18px; padding-left:22px; }
    .content li { margin:9px 0; }
    .callout,.notice { margin:36px 0 4px; padding:28px; border:1px solid #d4e5cd; background:var(--signal-soft); border-radius:18px; display:grid; gap:10px; }
    .notice--amber { border-color:#eeda8a; background:var(--watch-soft); }
    .callout strong,.notice strong { font-size:18px; }
    .callout span,.notice span { color:var(--muted); }
    .button { justify-self:start; display:inline-block; margin-top:5px; padding:13px 20px; color:#fff; background:var(--signal); border:1px solid transparent; border-radius:9px; text-decoration:none; font-weight:600; transition:background 160ms ease,border-color 160ms ease; }
    .button:hover,.contact-form button:hover { background:#245822; }
    .contact-link { font:700 clamp(20px,4vw,30px)/1.3 var(--mono); overflow-wrap:anywhere; }
    .link-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; }
    .link-grid a { display:grid; gap:5px; padding:19px; border:1px solid var(--edge); border-radius:12px; color:var(--ink); background:var(--card); text-decoration:none; }
    .link-grid span { color:var(--muted); font-size:14px; }
    .site-footer-wrap { margin-top:88px; background:var(--card); border-top:1px solid var(--edge); }
    .site-footer { padding:46px 0; display:flex; align-items:flex-start; justify-content:space-between; gap:32px; color:var(--muted); font-size:13px; }
    .footer-intro { max-width:330px; }
    .footer-intro .brand { color:var(--ink); }
    .footer-intro p { margin:16px 0 10px; }
    .site-footer nav { max-width:540px; justify-content:flex-end; gap:16px 26px; }
    .site-footer nav a { color:var(--muted); text-decoration:none; font-weight:500; }
    .site-footer nav a:hover { color:var(--signal); }
    .error-page { min-height:62vh; display:flex; flex-direction:column; justify-content:center; }
    .actions { margin-top:28px; display:flex; align-items:center; gap:20px; flex-wrap:wrap; }
    .text-link { font-weight:750; }
    @media (max-width:1000px) { .site-header nav { gap:16px; } .site-header nav a[href='/about'],.site-header nav a[href='/security'],.site-header nav a[href='/contact'] { display:none; } }
    @media (max-width:700px) { .site-header-wrap { padding-top:12px; } .site-header,.site-footer,.page-shell { width:calc(100% - 32px); } .site-header { padding:14px 16px; flex-wrap:wrap; gap:16px; } .site-header nav { width:100%; justify-content:space-between; gap:10px; } .site-header nav a { font-size:12px; } .site-header nav .nav-demo { padding:9px 12px; } .page-shell { padding-top:52px; } .page-hero { padding-bottom:32px; } .intro { font-size:16px; } .link-grid { grid-template-columns:1fr; } .site-footer { flex-direction:column; } .site-footer nav { justify-content:flex-start; } .contact-link { font-size:clamp(18px,5vw,25px); } }
    @media (prefers-reduced-motion:reduce) { *,*::before,*::after { transition:none!important; } }
  `;
}
