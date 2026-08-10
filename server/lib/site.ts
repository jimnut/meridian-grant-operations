/**
 * Public marketing surface: the landing page, robots.txt and sitemap.xml.
 *
 * The landing page is the indexable face of the product; the SPA shell carries
 * `noindex` and stays behind sign-in. Files live in server/public/ as plain
 * assets — no build step, so what ships is exactly what was written.
 */

import fs from 'node:fs';
import path from 'node:path';

import { config } from '../config';

const PUBLIC_DIR = path.resolve(process.cwd(), 'server/public');

/** Date stamp for the sitemap — the day this process started serving. */
const STARTED_ON = new Date().toISOString().slice(0, 10);

/** GA4 ids look like G-ABC123XYZ; anything else is refused rather than injected. */
const GA_ID_PATTERN = /^G-[A-Z0-9]{4,16}$/;

export function publicDir(): string {
  return PUBLIC_DIR;
}

let cachedLanding: string | null = null;

export function landingHtml(): string {
  if (cachedLanding === null) {
    let html = fs.readFileSync(path.join(PUBLIC_DIR, 'landing.html'), 'utf8');
    const gaId = config.gaMeasurementId;
    if (gaId && GA_ID_PATTERN.test(gaId)) {
      html = html.replace(
        '<!--ANALYTICS-->',
        [
          `<script async src="https://www.googletagmanager.com/gtag/js?id=${gaId}"></script>`,
          `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${gaId}');</script>`,
        ].join('\n  '),
      );
    }
    cachedLanding = html;
  }
  return cachedLanding;
}

/**
 * CSP for the landing page. Stricter than the app shell — no scripts at all
 * unless analytics is enabled, in which case exactly Google's tag hosts are
 * admitted. JSON-LD is inert and unaffected by script-src.
 */
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
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    '  <url>',
    `    <loc>${config.siteUrl}/</loc>`,
    `    <lastmod>${STARTED_ON}</lastmod>`,
    '    <changefreq>weekly</changefreq>',
    '  </url>',
    '</urlset>',
    '',
  ].join('\n');
}
