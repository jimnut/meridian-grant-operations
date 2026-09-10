/**
 * Public marketing surface: indexable pages, robots.txt, sitemap.xml and the
 * branded public 404. The authenticated SPA remains a separate noindex shell.
 */

import fs from 'node:fs';
import path from 'node:path';

import { config } from '../config';
import { articleSitemapEntries } from './articles';
import {
  entityGraphNodes,
  escapeHtml,
  GA_ID_PATTERN,
  injectAnalytics,
  publicFooter,
  publicHeader,
  publicPageStyles,
} from './public-chrome';

export { pricingHtml } from './pricing-page';

const PUBLIC_DIR = path.resolve(process.cwd(), 'server/public');
const STARTED_ON = new Date().toISOString().slice(0, 10);

export const PUBLIC_INFO_PATHS = ['/about', '/contact', '/security', '/privacy', '/terms'] as const;
export type PublicInfoPath = (typeof PUBLIC_INFO_PATHS)[number];

const PUBLIC_INDEXABLE_PATHS = ['/', '/pricing', ...PUBLIC_INFO_PATHS] as const;

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
    description: 'Contact GrantConsole about a free trial, pricing, invoicing, importing your grant spreadsheet, product feedback or security.',
    eyebrow: 'Contact',
    heading: 'Talk to the people who build GrantConsole.',
    intro:
      'Questions about a trial, a plan, importing your spreadsheet, or whether GrantConsole fits your portfolio? Send a note and a real person replies within one business day.',
    body: `
      <section>
        <h2>Send a message</h2>
        <form class="contact-form" method="post" action="/api/public/leads">
          <input type="hidden" name="source" value="contact" />
          <label class="hp" aria-hidden="true">Website<input type="text" name="website" tabindex="-1" autocomplete="off" /></label>
          <label>Work email<input type="email" name="email" required autocomplete="email" /></label>
          <label>Your name<input type="text" name="name" autocomplete="name" /></label>
          <label>Organization<input type="text" name="organization" autocomplete="organization" /></label>
          <label>How can we help?<textarea name="message" placeholder="Tell us roughly how many grants you manage and what you want to improve."></textarea></label>
          <button type="submit">Send message</button>
        </form>
        <p style="margin-top:18px">Prefer email? <a class="contact-link" href="mailto:support@grantconsole.com">support@grantconsole.com</a></p>
        <p>Do not send passwords, confidential grant records or regulated personal information by email or through this form.</p>
      </section>
      <section>
        <h2>Security reports</h2>
        <p>Email <a href="mailto:support@grantconsole.com?subject=Security%20report">support@grantconsole.com</a> with “Security report” in the subject. Describe the affected page or feature and the steps to reproduce it. Do not include real nonprofit data.</p>
      </section>
      <section>
        <h2>Before contacting us</h2>
        <div class="link-grid">
          <a href="/pricing"><strong>Pricing</strong><span>Plans, trial and invoicing</span></a>
          <a href="/security"><strong>Security</strong><span>Controls we can verify today</span></a>
          <a href="/privacy"><strong>Privacy</strong><span>What we collect and why</span></a>
        </div>
      </section>`,
  },
  '/security': {
    title: 'GrantConsole Security',
    description:
      'How GrantConsole protects nonprofit grant data: password hashing, protected sessions, CSRF checks, server-enforced roles, tenant isolation, upload validation, encryption in transit and data export.',
    eyebrow: 'Security · Last updated 6 September 2026',
    heading: 'Security facts, stated plainly.',
    intro:
      'This page describes controls visible in the current GrantConsole application and source. It does not claim a certification or independent audit that has not occurred, and it says what we do not yet have.',
    body: `
      <section>
        <h2>Authentication and sessions</h2>
        <ul>
          <li>Passwords are hashed with bcrypt before storage and never logged or emailed.</li>
          <li>Repeated sign-in, sign-up and reset attempts are throttled per address.</li>
          <li>Session cookies are signed, HTTP-only and SameSite=Lax; production cookies are marked Secure.</li>
          <li>Password-reset and invitation links are single-use, expire (one hour and fourteen days), and are stored only as hashes.</li>
          <li>Changing a password signs out every other device.</li>
        </ul>
      </section>
      <section>
        <h2>Organization boundaries and roles</h2>
        <ul>
          <li>Every record carries its organization, and the organization always comes from the authenticated session, never from the request.</li>
          <li>Owner, manager, member and viewer capabilities are enforced by the server on every request; the interface only reflects them.</li>
          <li>A record that belongs to another organization is indistinguishable from one that does not exist.</li>
          <li>Changes are recorded in the activity history with who, what and when.</li>
        </ul>
      </section>
      <section>
        <h2>Uploads, transport and browser protections</h2>
        <ul>
          <li>Evidence uploads are limited to PDF, Word, Excel, CSV, PNG and JPEG, and the file contents are checked against the declared type before anything is stored.</li>
          <li>Files are stored under generated keys in a per-organization folder outside the web root and served only through an authorised download.</li>
          <li>All traffic is served over HTTPS (TLS) with HSTS, a strict Content-Security-Policy, and framing disabled.</li>
          <li>State-changing requests require an origin check and a session-bound CSRF token.</li>
        </ul>
      </section>
      <section>
        <h2>Billing</h2>
        <p>Card details go directly to Stripe over their hosted checkout; GrantConsole never sees or stores card numbers. Stripe events that change a plan are verified by signature before they are applied.</p>
      </section>
      <section>
        <h2>Your data, your way out</h2>
        <ul>
          <li>Every grant, deliverable, task, budget line and report schedule exports to CSV at any time; every uploaded file can be downloaded.</li>
          <li>An owner can delete the organization from Settings, which removes its records, uploads and invitations.</li>
          <li>Support staff do not open customer workspaces without written permission.</li>
        </ul>
      </section>
      <aside class="notice">
        <strong>What we do not have yet.</strong>
        <span>GrantConsole does not currently publish a SOC 2, ISO 27001 or similar independent certification, and does not yet offer single sign-on or two-factor authentication. Contact us before relying on the product for a requirement that needs formal attestation; we will tell you exactly where we stand.</span>
      </aside>
      <section>
        <h2>Report a concern</h2>
        <p>Email <a href="mailto:support@grantconsole.com?subject=Security%20report">support@grantconsole.com</a> with “Security report” in the subject. Do not place sensitive records in the public demo or in an initial report.</p>
      </section>`,
  },
  '/privacy': {
    title: 'GrantConsole Privacy Notice',
    description:
      'What GrantConsole collects on the website, in customer workspaces and in the shared public demo, why, who processes it, how long it is kept and how to ask for changes.',
    eyebrow: 'Privacy · Last updated 6 September 2026',
    heading: 'What we collect, and why.',
    intro:
      'This notice covers grantconsole.com, customer workspaces and the shared public demo. It is written to be read, not skimmed; if anything is unclear, ask and we will answer plainly.',
    body: `
      <section>
        <h2>Customer workspaces</h2>
        <ul>
          <li><strong>Account details.</strong> Your name, work email, organization name and password hash, so you can sign in and so teammates can find you.</li>
          <li><strong>Grant records.</strong> The funders, grants, deadlines, budgets, notes and evidence files your organization enters. This is your organization's data; we process it only to run the service and never sell, share or use it to train models.</li>
          <li><strong>Activity history.</strong> Who changed what and when, kept inside your workspace for your own audit trail.</li>
          <li><strong>Billing.</strong> Plan, invoices and the Stripe customer reference. Card details are held by Stripe, not by us.</li>
          <li><strong>Email.</strong> Welcome, invitation, password-reset, trial and weekly deadline emails are sent through our email provider. They contain no tracking pixels.</li>
        </ul>
      </section>
      <section>
        <h2>The website and the public demo</h2>
        <ul>
          <li><strong>Analytics.</strong> The public site and the application use Google Analytics 4 to understand visits, sign-ups and which features are used. Google may set analytics cookies and process browser, device, referral, page and approximate location information under its own terms. Content blockers stop it entirely and nothing breaks.</li>
          <li><strong>Contact forms.</strong> What you type, your email and the page you sent it from, so we can reply.</li>
          <li><strong>The public demo</strong> is a shared evaluation workspace that is reset daily. Use only the seeded example records; never enter real names, documents, financial records or other information belonging to a real person or organization.</li>
        </ul>
      </section>
      <section>
        <h2>Who processes data on our behalf</h2>
        <p>Render (application hosting and storage), Stripe (payments), Google (analytics) and a transactional email provider (Resend). Each is bound by its own data-processing terms. We do not use advertising networks.</p>
      </section>
      <section>
        <h2>Retention and deletion</h2>
        <p>Workspace data is kept while your organization has an account, including a read-only period after a trial or subscription ends so nothing is lost by accident. An owner can delete the organization at any time from Settings, which removes its records, uploads and invitations. Backups age out on a rolling basis. Contact-form messages are kept for up to two years.</p>
      </section>
      <section>
        <h2>Your rights and choices</h2>
        <p>You can export your organization's records at any time, correct your own account details in Settings, and ask us to delete or hand over personal information by emailing <a href="mailto:support@grantconsole.com?subject=Privacy%20request">support@grantconsole.com</a> with “Privacy request” in the subject. Residents of the EEA, UK and California have specific statutory rights; we honour them regardless of where you live. You can block or clear cookies through your browser.</p>
      </section>
      <section>
        <h2>Changes</h2>
        <p>If this notice changes in a way that matters, we email workspace owners before the change takes effect and keep the date at the top of this page current.</p>
      </section>`,
  },
  '/terms': {
    title: 'GrantConsole Terms of Service',
    description:
      'Terms for GrantConsole subscriptions and the public demo: trials, plans and billing, renewal and cancellation, your data, acceptable use, availability and liability.',
    eyebrow: 'Terms of service · Last updated 6 September 2026',
    heading: 'The agreement, in plain language.',
    intro:
      'These terms cover the GrantConsole website, the shared public demo and customer workspaces. Creating a workspace or continuing to use one after a change means you accept them on behalf of your organization.',
    body: `
      <section>
        <h2>1. The service</h2>
        <p>GrantConsole is post-award grant management software for nonprofit organizations. It helps you track obligations, budgets, evidence and reports; it does not provide legal, accounting, audit or grant-compliance advice. Verify obligations against the applicable award, funder guidance and your own advisers.</p>
      </section>
      <section>
        <h2>2. Trials, plans and billing</h2>
        <ul>
          <li>New workspaces receive a free trial of every feature. No payment details are collected for the trial. When it ends the workspace becomes read-only until a plan is chosen; nothing is deleted.</li>
          <li>Plans are described on the <a href="/pricing">pricing page</a>. Monthly plans renew every month and annual plans renew every year, automatically, until cancelled. You will be charged the then-current price for your plan at each renewal; we give at least 30 days' notice by email before any price increase takes effect.</li>
          <li>Card payments are processed by Stripe. Annual plans may instead be invoiced and paid by ACH or check, due within 30 days.</li>
          <li>Each plan has limits on active grants, seats and storage. When a limit is reached the product tells you and offers an upgrade; nothing is silently blocked or deleted.</li>
        </ul>
      </section>
      <section>
        <h2>3. Cancellation and refunds</h2>
        <ul>
          <li>An owner can cancel at any time from Settings → Billing or by emailing support. Cancellation takes effect at the end of the current billing period; the workspace stays fully usable until then and read-only afterwards.</li>
          <li>Monthly fees are not refunded for partial months. If you cancel an annual plan within 30 days of its first payment we refund it in full; after that, annual fees are not refunded for the unused portion, except where the law requires otherwise.</li>
          <li>If we materially reduce the service and cannot fix it within a reasonable time after you tell us, you may cancel and receive a pro-rated refund of any prepaid, unused fees.</li>
        </ul>
      </section>
      <section>
        <h2>4. Your data</h2>
        <ul>
          <li>Your organization owns everything it enters. We process it only to provide, secure and improve the service, as described in the <a href="/privacy">privacy notice</a>, and never sell it or use it to train models.</li>
          <li>You can export your records at any time and delete the organization from Settings.</li>
          <li>You are responsible for the accuracy of what you enter and for having the right to upload the documents you attach.</li>
        </ul>
      </section>
      <section>
        <h2>5. Accounts and acceptable use</h2>
        <ul>
          <li>Keep your password confidential and tell us promptly about any unauthorised use. You are responsible for activity under your organization's seats.</li>
          <li>Do not use the service to store information you are not permitted to store, to send unsolicited messages, to probe or disrupt the service or other systems, or for anything unlawful.</li>
          <li>The public demo is shared and reset daily. Use only the seeded example records and never enter real personal, financial or funder information.</li>
        </ul>
      </section>
      <section>
        <h2>6. Availability and support</h2>
        <p>We aim to keep the service available at all times and to fix problems quickly, but it is provided “as is” without a guaranteed uptime level during this launch period. Support is by email at <a href="mailto:support@grantconsole.com">support@grantconsole.com</a>; we answer within one business day.</p>
      </section>
      <section>
        <h2>7. Liability</h2>
        <p>To the fullest extent permitted by law, GrantConsole's total liability for any claim arising out of the service is limited to the fees you paid in the twelve months before the claim, and neither party is liable for indirect, incidental or consequential loss. Nothing in these terms limits liability that cannot be limited by law.</p>
      </section>
      <section>
        <h2>8. Changes and contact</h2>
        <p>We may update these terms; material changes are emailed to workspace owners at least 14 days before they take effect. Questions about these terms may be sent to <a href="mailto:support@grantconsole.com?subject=Terms">support@grantconsole.com</a>.</p>
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

export function contactThanksHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>Message received — GrantConsole</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <!--ANALYTICS-->
  <style>${publicPageStyles()}</style>
</head>
<body>
  ${publicHeader()}
  <main class="page-shell error-page">
    <p class="eyebrow">Message received</p>
    <h1>Thanks — a real person will reply within one business day.</h1>
    <p class="intro">In the meantime you can open the live demo with seeded nonprofit data, or start your own free trial. No card, no sales call.</p>
    <div class="actions"><a class="button" href="/signup">Start a free trial</a><a class="text-link" href="/signin">Open the live demo</a></div>
  </main>
  ${publicFooter()}
  <script>if (typeof gtag === 'function') { gtag('event', 'generate_lead', { method: 'form' }); }</script>
</body>
</html>`;
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
  const entries: Array<{ loc: string; lastmod: string }> = PUBLIC_INDEXABLE_PATHS.map((pagePath) => ({
    loc: `${config.siteUrl}${pagePath}`,
    lastmod: STARTED_ON,
  }));
  entries.push(...articleSitemapEntries());
  const urls = entries.flatMap((entry) => [
    '  <url>',
    `    <loc>${entry.loc}</loc>`,
    `    <lastmod>${entry.lastmod}</lastmod>`,
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

function renderPublicPage(pagePath: PublicInfoPath, page: PublicPage): string {
  const canonical = `${config.siteUrl}${pagePath}`;
  const structuredData = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      ...entityGraphNodes(),
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
  <meta property="og:image" content="${config.siteUrl}/og-image-daylight.png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="GrantConsole post-award grant operations dashboard" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:url" content="${canonical}" />
  <meta name="twitter:title" content="${escapeHtml(page.title)}" />
  <meta name="twitter:description" content="${escapeHtml(page.description)}" />
  <meta name="twitter:image" content="${config.siteUrl}/og-image-daylight.png" />
  <meta name="twitter:image:alt" content="GrantConsole post-award grant operations dashboard" />
  <meta name="theme-color" content="#f7f8f5" />
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
