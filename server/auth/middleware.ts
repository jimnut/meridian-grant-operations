import type { NextFunction, Request, Response } from 'express';

import { config } from '../config';
import { getDb, type Db } from '../db/connection';
import { forbidden, unauthenticated, ApiError } from '../lib/errors';
import { timingSafeEqual } from '../lib/ids';
import { can, type Capability } from '../../shared/permissions';
import { decodeCookie, resolveSession, type ResolvedSession } from './session';

declare module 'express-serve-static-core' {
  interface Request {
    db: Db;
    /** Root for evidence storage. Injected so tests never touch the real data dir. */
    uploadsDir: string;
    session?: ResolvedSession;
  }
}

export function attachContext(options: { db?: Db; uploadsDir?: string } = {}) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    req.db = options.db ?? getDb();
    req.uploadsDir = options.uploadsDir ?? config.uploadsDir;
    next();
  };
}

/** Populates `req.session` when a valid cookie is present. Never throws. */
export function loadSession(req: Request, _res: Response, next: NextFunction): void {
  const raw = req.cookies?.[config.sessionCookieName] as string | undefined;
  const sessionId = decodeCookie(raw);
  if (sessionId) {
    const resolved = resolveSession(req.db, sessionId);
    if (resolved) req.session = resolved;
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.session) {
    next(unauthenticated());
    return;
  }
  next();
}

/**
 * Authoritative permission gate. Routes call this after `requireAuth`; the role
 * comes from the membership row resolved from the session, never from input.
 */
export function requireCapability(capability: Capability) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.session) {
      next(unauthenticated());
      return;
    }
    if (!can(req.session.role, capability)) {
      next(forbidden(readOnlyMessage(req.session.role)));
      return;
    }
    next();
  };
}

function readOnlyMessage(role: string): string {
  if (role === 'VIEWER') {
    return 'Viewers have read-only access. Ask an owner or manager to make this change.';
  }
  return 'Your role does not allow this action.';
}

/** The org id for the current request. Always from the session. */
export function orgId(req: Request): string {
  if (!req.session) throw unauthenticated();
  return req.session.orgId;
}

export function currentSession(req: Request): ResolvedSession {
  if (!req.session) throw unauthenticated();
  return req.session;
}

/**
 * Origin/CSRF protection for state-changing requests.
 *
 * Two independent checks:
 *  - the `Origin`/`Referer` header must match an allowed origin (blocks classic
 *    cross-site form posts, which cannot set custom headers);
 *  - a double-submitted `x-csrf-token` header must equal the token bound to the
 *    session row in the database.
 */
export function csrfProtection(req: Request, _res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }

  const origin = req.get('origin');
  const referer = req.get('referer');
  const source = origin ?? (referer ? safeOrigin(referer) : null);

  if (source) {
    const allowed = new Set(config.allowedOrigins);
    const host = req.get('host');
    if (host) {
      allowed.add(`${req.protocol}://${host}`);
      allowed.add(`http://${host}`);
      allowed.add(`https://${host}`);
    }
    if (!allowed.has(source)) {
      next(new ApiError('FORBIDDEN', 'Request blocked: unrecognised origin.'));
      return;
    }
  } else if (config.isProduction) {
    // Browsers always send Origin on cross-origin state changes; requiring it in
    // production closes the "no header at all" hole.
    next(new ApiError('FORBIDDEN', 'Request blocked: missing origin.'));
    return;
  }

  // Unauthenticated mutations (sign-in) have no session token to double-submit;
  // the origin check above is their protection. Authenticated mutations must
  // present the token bound to their session row.
  if (!req.session) {
    next();
    return;
  }

  const token = req.get('x-csrf-token');
  if (!token || !timingSafeEqual(token, req.session.csrfToken)) {
    next(new ApiError('FORBIDDEN', 'Your session expired. Reload the page and try again.'));
    return;
  }
  next();
}

function safeOrigin(url: string): string | null {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}
