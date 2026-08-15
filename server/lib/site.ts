/**
 * Public marketing surface: indexable pages, robots.txt, sitemap.xml and the
 * branded public 404. The authenticated SPA remains a separate noindex shell.
 */

import fs from 'node:fs';
import path from 'node:path';

import { config } from '../config';

const PUBLIC_DIR = path.resolve(process.cwd(), 'server/public');
const STARTED_ON = new Date().toISOString().slice(0, 10);
const GA_ID_PATTERN = /^G-[A-Z0-9]{4,16}$/;

export const PUBLIC_INFO_PATHS = ['/about', '/contact', '/security', '/privacy', '/terms'] as const;
export type PublicInfoPath = (typeof PUBLIC_INFO_PATHS)[number];

const PUBLIC_INDEXABLE_PATHS = ['/', ...PUBLIC_INFO_PATHS] as const;

interface PublicPage {
  title: string;
  description: string;
  eyebrow: string;
  heading: string;
  intro: string;
  body: string;
}

const PUBLIC_PAGES: Record<PublicInfoPath, PublicPage> = {
  '/about': {
    title: 'About GrantConsole — Post-Award Grant Operations',
    description:
      'GrantConsole is post-award grant management software for nonprofit teams managing deadlines, restricted budgets, evidence, risk and funder reports.',
    eyebrow: 'About GrantConsole',
    heading: 'Built for the work after the award letter.',
    intro:
      'GrantConsole is post-award grant management software for nonprofit grant recipients. It gives grants, finance and leadership teams one place to understand what is due, what is at risk and what evidence supports the work.',
    body: `
      <section>
        <h2>What GrantConsole helps teams manage</h2>
        <ul>
          <li>Deadlines, deliverables, renewals and grant-period dates.</li>
          <li>Restricted budgets, with burn measured against each grant period.</li>
          <li>Evidence attached to the deliverable that requires it.</li>
          <li>Eleven explainable risk rules that state why a grant needs attention.</li>
          <li>Reporting packets, exports, role-based access and activity history.</li>
        </ul>
      </section>
      <section>
        <h2>Explainable by design</h2>
        <p>GrantConsole does not hide grant health behind an opaque score. A warning names the rule that fired and shows the underlying dates, records or budget numbers so a person can check it.</p>
      </section>
      <section>
        <h2>What it is not</h2>
        <p>GrantConsole is not a fundraising CRM and does not find grant opportunities. It begins after an award is won, when the organization must deliver the work, steward restricted funds and report back to the funder.</p>
      </section>
      <aside class="callout">
        <strong>See the actual product.</strong>
        <span>The public demo opens a seeded nonprofit workspace—no sales call required.</span>
        <a class="button" href="/signin">Open the live demo</a>
      </aside>`,
  },
  '/contact': {
    title: 'Contact GrantConsole',
    description: 'Contact GrantConsole about the live demo, product feedback, access or security questions.',
    eyebrow: 'Contact',
    heading: 'Talk to the GrantConsole team.',
    intro:
      'Questions about the seeded demo, your post-award workflow or whether GrantConsole fits your nonprofit? Email is the fastest way to reach us.',
    body: `
      <section>
        <h2>General and product questions</h2>
        <p><a class="contact-link" href="mailto:support@grantconsole.com">support@grantconsole.com</a></p>
        <p>Include the organization type, approximate number of active grants and the workflow you want to improve. Do not send passwords, confidential grant records or regulated personal information by email.</p>
      </section>
      <section>
        <h2>Security reports</h2>
        <p>Email <a href="mailto:support@grantconsole.com?subject=Security%20report">support@grantconsole.com</a> with “Security report” in the subject. Please describe the affected page or feature and the steps needed to reproduce the issue. Do not include real nonprofit data.</p>
      </section>
      <section>
        <h2>Before contacting us</h2>
        <div class="link-grid">
          <a href="/security"><strong>Security</strong><span>Controls we can verify today</span></a>
          <a href="/privacy"><strong>Privacy</strong><span>Website, analytics and demo data</span></a>
          <a href="/terms"><strong>Demo terms</strong><span>Rules for using the public workspace</span></a>
        </div>
      </section>`,
  },
  '/security': {
    title: 'GrantConsole Security',
    description:
      'Verified GrantConsole application security controls, including password hashing, protected sessions, CSRF checks, server-enforced roles and upload validation.',
    eyebrow: 'Security · Last updated 15 August 2026',
    heading: 'Security facts, stated plainly.',
    intro:
      'This page describes controls visible in the current GrantConsole application and source. It does not claim a certification or independent audit that has not occurred.',
    body: `
      <section>
        <h2>Authentication and sessions</h2>
        <ul>
          <li>Passwords are hashed with bcrypt before storage.</li>
          <li>Repeated sign-in attempts are throttled.</li>
          <li>Session cookies are signed, HTTP-only and SameSite=Lax; production cookies are marked Secure.</li>
          <li>Production refuses weak or missing session-signing secrets.</li>
          <li>Unknown-account sign-in attempts perform a real password-hash comparison to reduce account-enumeration timing differences.</li>
        </ul>
      </section>
      <section>
        <h2>Requests, roles and organization boundaries</h2>
        <ul>
          <li>Authenticated state-changing requests use origin checks and a session-bound CSRF token; sign-in is protected by origin checks.</li>
          <li>Owner, manager, member and viewer capabilities are enforced by the server, not only hidden in the interface.</li>
          <li>The active organization comes from the authenticated session rather than request input.</li>
          <li>Changes are recorded in the product activity history.</li>
        </ul>
      </section>
      <section>
        <h2>Uploads and browser protections</h2>
        <ul>
          <li>Evidence uploads are limited to an approved set of document and image formats, checked against filename, declared type and file contents.</li>
          <li>Stored filenames use generated keys and path traversal is rejected.</li>
          <li>Security headers restrict framing, scripts, content sources and cross-origin behavior.</li>
        </ul>
      </section>
      <aside class="notice">
        <strong>No certification claim.</strong>
        <span>GrantConsole does not currently publish a SOC 2, ISO 27001 or similar independent certification on this site. Contact us before relying on the product for a requirement that needs formal attestation.</span>
      </aside>
      <section>
        <h2>Report a concern</h2>
        <p>Email <a href="mailto:support@grantconsole.com?subject=Security%20report">support@grantconsole.com</a> with “Security report” in the subject. Do not place sensitive records in the public demo or in an initial report.</p>
      </section>`,
  },
  '/privacy': {
    title: 'GrantConsole Privacy Notice',
    description:
      'A plain-language notice covering GrantConsole website analytics, sign-in cookies, email correspondence and the shared public demo.',
    eyebrow: 'Privacy · Last updated 15 August 2026',
    heading: 'Privacy on the public site and demo.',
    intro:
      'This notice covers grantconsole.com and its shared, seeded demo. The demo is an evaluation environment and is not intended for real nonprofit, beneficiary, employee or funder data.',
    body: `
      <section>
        <h2>Information handled by the public site</h2>
        <ul>
          <li><strong>Website analytics.</strong> The public site uses Google Analytics 4 to understand visits and page use. Google may set analytics cookies and process browser, device, referral, page and approximate location information under its own terms.</li>
          <li><strong>Sign-in session.</strong> When you sign in, GrantConsole sets a signed, HTTP-only session cookie so the application can recognize the session. The default session lifetime is 72 hours.</li>
          <li><strong>Email.</strong> If you contact support, we receive the address, message and any information you choose to include.</li>
          <li><strong>Demo activity.</strong> Actions taken in the shared demo may be stored in the demo workspace and activity history.</li>
        </ul>
      </section>
      <aside class="notice notice--amber">
        <strong>Treat the public demo as public.</strong>
        <span>Use only the seeded example records. Do not enter names, contact details, grant documents, financial records or other information belonging to a real person or organization.</span>
      </aside>
      <section>
        <h2>Your choices</h2>
        <p>You can block or clear cookies through your browser. Browser privacy tools and content blockers may also limit analytics. If you do not want to create a demo session, you can review the public product pages without signing in.</p>
      </section>
      <section>
        <h2>Questions and requests</h2>
        <p>Email <a href="mailto:support@grantconsole.com?subject=Privacy%20request">support@grantconsole.com</a> with “Privacy request” in the subject. Do not send identity documents or sensitive grant data in the first message.</p>
      </section>`,
  },
  '/terms': {
    title: 'GrantConsole Public Demo Terms',
    description: 'Rules and limitations for using the shared GrantConsole public demo and website.',
    eyebrow: 'Public demo terms · Last updated 15 August 2026',
    heading: 'Use the demo to evaluate the workflow.',
    intro:
      'These terms cover the public website and shared seeded demo. A separate written agreement, if one exists for another GrantConsole environment, controls that environment.',
    body: `
      <section>
        <h2>Permitted use</h2>
        <p>You may use the public demo to evaluate GrantConsole, explore the seeded records and test the available roles and workflows.</p>
      </section>
      <section>
        <h2>Shared sample environment</h2>
        <ul>
          <li>The people, organizations, grants and documents in the seeded demo are examples.</li>
          <li>The demo is shared. Other visitors may see changes made inside it.</li>
          <li>Do not enter real personal, confidential, financial, beneficiary, employee, funder or regulated information.</li>
        </ul>
      </section>
      <section>
        <h2>Responsible use</h2>
        <p>Do not attempt to disrupt the service, bypass access controls, probe other systems, introduce malicious content, scrape at a harmful rate or use the demo for unlawful activity.</p>
      </section>
      <section>
        <h2>Evaluation limits</h2>
        <p>The demo may change, reset or be unavailable. Example outputs are for product evaluation and are not legal, accounting, audit or grant-compliance advice. Verify obligations against the applicable award, funder guidance and professional advice.</p>
      </section>
      <section>
        <h2>Contact</h2>
        <p>Questions about these public demo terms may be sent to <a href="mailto:support@grantconsole.com?subject=Demo%20terms">support@grantconsole.com</a>.</p>
      </section>`,
  },
};

export function publicDir(): string {
  return PUBLIC_DIR;
}

let cachedLanding: string | null = null;
const cachedPages = new Map<PublicInfoPath, string>();

export function landingHtml(): string {
  if (cachedLanding === null) {
    cachedLanding = injectAnalytics(fs.readFileSync(path.join(PUBLIC_DIR, 'landing.html'), 'utf8'));
  }
  return cachedLanding;
}

export function publicInfoHtml(pagePath: PublicInfoPath): string {
  const cached = cachedPages.get(pagePath);
  if (cached) return cached;
  const rendered = injectAnalytics(renderPublicPage(pagePath, PUBLIC_PAGES[pagePath]));
  cachedPages.set(pagePath, rendered);
  return rendered;
}

export function publicNotFoundHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>Page not found — GrantConsole</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <style>${publicPageStyles()}</style>
</head>
<body>
  ${publicHeader()}
  <main class="page-shell error-page">
    <p class="eyebrow">404 · Page not found</p>
    <h1>That page does not exist.</h1>
    <p class="intro">The address may be outdated or mistyped. Return to GrantConsole or open the seeded demo.</p>
    <div class="actions"><a class="button" href="/">Return home</a><a class="text-link" href="/signin">Open the live demo</a></div>
  </main>
  ${publicFooter()}
</body>
</html>`;
}

/** Public pages share one strict CSP. Analytics is admitted only for a valid GA4 id. */
export function landingCsp(): string {
  const gaOn = Boolean(config.gaMeasurementId && GA_ID_PATTERN.test(config.gaMeasurementId));
  const scriptSrc = gaOn ? "'unsafe-inline' https://www.googletagmanager.com" : "'none'";
  const connectSrc = gaOn
    ? "'self' https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com"
    : "'self'";
  return [
    "default-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "style-src 'unsafe-inline'",
    `script-src ${scriptSrc}`,
    `connect-src ${connectSrc}`,
  ].join('; ');
}

export function robotsTxt(): string {
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    '',
    `Sitemap: ${config.siteUrl}/sitemap.xml`,
    '',
  ].join('\n');
}

export function sitemapXml(): string {
  const urls = PUBLIC_INDEXABLE_PATHS.flatMap((pagePath) => [
    '  <url>',
    `    <loc>${config.siteUrl}${pagePath}</loc>`,
    `    <lastmod>${STARTED_ON}</lastmod>`,
    '  </url>',
  ]);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');
}

function injectAnalytics(html: string): string {
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

function renderPublicPage(pagePath: PublicInfoPath, page: PublicPage): string {
  const canonical = `${config.siteUrl}${pagePath}`;
  const structuredData = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
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
      {
        '@type': 'WebPage',
        '@id': `${canonical}#webpage`,
        name: page.title,
        description: page.description,
        url: canonical,
        isPartOf: { '@id': `${config.siteUrl}/#website` },
        about: { '@id': `${config.siteUrl}/#organization` },
        inLanguage: 'en-US',
      },
    ],
  });
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="color-scheme" content="light" />
  <title>${escapeHtml(page.title)}</title>
  <meta name="description" content="${escapeHtml(page.description)}" />
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />
  <link rel="canonical" href="${canonical}" />
  <meta property="og:type" content="website" />
  <meta property="og:locale" content="en_US" />
  <meta property="og:site_name" content="GrantConsole" />
  <meta property="og:title" content="${escapeHtml(page.title)}" />
  <meta property="og:description" content="${escapeHtml(page.description)}" />
  <meta property="og:url" content="${canonical}" />
  <meta property="og:image" content="${config.siteUrl}/og-image-liquid-v3.png" />
  <meta property="og:image:width" content="1730" />
  <meta property="og:image:height" content="909" />
  <meta property="og:image:alt" content="GrantConsole post-award grant operations dashboard" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:url" content="${canonical}" />
  <meta name="twitter:title" content="${escapeHtml(page.title)}" />
  <meta name="twitter:description" content="${escapeHtml(page.description)}" />
  <meta name="twitter:image" content="${config.siteUrl}/og-image-liquid-v3.png" />
  <meta name="twitter:image:alt" content="GrantConsole post-award grant operations dashboard" />
  <meta name="theme-color" content="#07141a" />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <script type="application/ld+json">${structuredData}</script>
  <!--ANALYTICS-->
  <style>${publicPageStyles()}</style>
</head>
<body>
  ${publicHeader()}
  <main class="page-shell">
    <header class="page-hero">
      <p class="eyebrow">${escapeHtml(page.eyebrow)}</p>
      <h1>${escapeHtml(page.heading)}</h1>
      <p class="intro">${escapeHtml(page.intro)}</p>
    </header>
    <article class="content">${page.body}</article>
  </main>
  ${publicFooter()}
</body>
</html>`;
}

function publicHeader(): string {
  return `<header class="site-header-wrap">
    <div class="site-header">
      <a class="brand" href="/" aria-label="GrantConsole home"><img src="/favicon.svg" width="34" height="34" alt="" /><span><strong>GrantConsole</strong><small>Grant operations</small></span></a>
      <nav aria-label="Primary"><a href="/about">About</a><a href="/security">Security</a><a href="/contact">Contact</a><a class="nav-demo" href="/signin">Open live demo</a></nav>
    </div>
  </header>`;
}

function publicFooter(): string {
  return `<footer class="site-footer-wrap">
    <div class="site-footer">
      <span>© GrantConsole · post-award grant management for nonprofits</span>
      <nav aria-label="Footer"><a href="/about">About</a><a href="/contact">Contact</a><a href="/security">Security</a><a href="/privacy">Privacy</a><a href="/terms">Demo terms</a></nav>
    </div>
  </footer>`;
}

function publicPageStyles(): string {
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

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
