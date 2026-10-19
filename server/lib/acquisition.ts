import crypto from 'node:crypto';
import type { Request, Response } from 'express';

import { config } from '../config';
import { findArticle } from './articles';
import { timingSafeEqual } from './ids';
import { secureMeasurementCookie } from './measurement-cookie';

const COOKIE = 'grantconsole_acquisition';
const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const STATIC_PATHS = new Set(['/', '/pricing', '/about', '/contact', '/security', '/privacy', '/terms', '/resources']);
const GOOGLE_HOSTS = new Set(['google.com', 'www.google.com', 'www.google.co.uk', 'www.google.ca', 'www.google.com.au']);
type Acquisition = { channel: 'google_organic' | 'other' | 'unknown'; landingRoute: string | null };
const UNKNOWN: Acquisition = { channel: 'unknown', landingRoute: null };

export function publicAcquisitionRoute(path: unknown): path is string {
  return typeof path === 'string' && (STATIC_PATHS.has(path) || Boolean(findArticle(path)));
}
function signature(value: string): string {
  return crypto.createHmac('sha256', config.sessionSecret).update(value).digest('hex');
}
function optedOut(req: Request): boolean {
  return req.get('sec-gpc') === '1' || req.get('dnt') === '1';
}

export function readAcquisition(req: Request, now = Date.now()): Acquisition {
  if (optedOut(req)) return UNKNOWN;
  const cookie = req.cookies?.[COOKIE];
  if (typeof cookie !== 'string' || cookie.length > 1500) return UNKNOWN;
  const [encoded, mac, extra] = cookie.split('.');
  if (!encoded || !mac || extra || !timingSafeEqual(signature(encoded), mac)) return UNKNOWN;
  try {
    const value = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!['google_organic', 'other'].includes(value.channel) || !publicAcquisitionRoute(value.landingRoute)
      || typeof value.at !== 'number' || value.at > now || now - value.at > WINDOW_MS) return UNKNOWN;
    return { channel: value.channel, landingRoute: value.landingRoute };
  } catch { return UNKNOWN; }
}

/** Coarse first observed external source; no visitor ID, search terms or raw URLs. */
export function captureAcquisition(req: Request, res: Response): void {
  if (req.method !== 'GET' || req.session || !publicAcquisitionRoute(req.path)) return;
  if (optedOut(req)) { clearAcquisition(res); res.setHeader('Cache-Control', 'private, no-store'); return; }
  if (readAcquisition(req).channel !== 'unknown') return;
  let ref: URL;
  try { ref = new URL(req.get('referer') ?? ''); } catch { return; }
  if (!['http:', 'https:'].includes(ref.protocol) || ref.origin === config.siteUrl) return;
  const paid = ['gclid', 'gbraid', 'wbraid'].some((key) => key in req.query)
    || /^(cpc|ppc|paid.*)$/i.test(String(req.query.utm_medium ?? ''));
  const channel = GOOGLE_HOSTS.has(ref.hostname) && !paid ? 'google_organic' : 'other';
  const encoded = Buffer.from(JSON.stringify({ channel, landingRoute: req.path, at: Date.now() })).toString('base64url');
  res.cookie(COOKIE, `${encoded}.${signature(encoded)}`, {
    httpOnly: true, secure: secureMeasurementCookie(req), sameSite: 'lax', path: '/', maxAge: WINDOW_MS,
  });
  // A first-touch Set-Cookie must never be shared by a CDN/public page cache.
  res.setHeader('Cache-Control', 'private, no-store');
}

export function clearAcquisition(res: Response): void {
  res.clearCookie(COOKIE, { httpOnly: true, secure: secureMeasurementCookie(res.req), sameSite: 'lax', path: '/' });
}
