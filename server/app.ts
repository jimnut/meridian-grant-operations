import path from 'node:path';
import fs from 'node:fs';

import cookieParser from 'cookie-parser';
import express, { type Express, type Response } from 'express';
import helmet from 'helmet';

import { config } from './config';
import { attachContext, csrfProtection, loadSession, requireAuth } from './auth/middleware';
import type { Db } from './db/connection';
import { errorMiddleware, notFoundMiddleware } from './lib/http';
import {
  landingCsp,
  landingHtml,
  PUBLIC_INFO_PATHS,
  publicDir,
  publicInfoHtml,
  publicNotFoundHtml,
  robotsTxt,
  sitemapXml,
} from './lib/site';
import authRoutes from './routes/auth';
import funderRoutes from './routes/funders';
import grantChildRoutes from './routes/grant-children';
import grantRoutes from './routes/grants';
import workspaceRoutes from './routes/workspace';

export interface AppOptions {
  db?: Db;
  /** Serve the built client from dist/client. Enabled for the production server. */
  serveStatic?: boolean;
  /** Override the built client directory in tests. */
  clientDir?: string;
  /** Evidence storage root. Tests pass a temporary directory. */
  uploadsDir?: string;
}

const SPA_PATHS = [
  /^\/$/,
  /^\/signin\/?$/,
  /^\/grants\/?$/,
  /^\/grants\/[^/]+\/?$/,
  /^\/grants\/[^/]+\/packet\/?$/,
  /^\/funders\/?$/,
  /^\/funders\/[^/]+\/?$/,
  /^\/(?:calendar|reports|team|settings)\/?$/,
];

export function isSpaPath(pathname: string): boolean {
  return SPA_PATHS.some((pattern) => pattern.test(pathname));
}

function sendPublicNotFound(res: Response): void {
  res.setHeader('Content-Security-Policy', landingCsp());
  res.setHeader('Cache-Control', 'no-store');
  res.status(404).type('html').send(publicNotFoundHtml());
}

export function createApp(options: AppOptions = {}): Express {
  const app = express();
  // A built SPA never needs Vite's eval/websocket allowances. Treat any server
  // serving that bundle as hardened, even when a demo host omits NODE_ENV.
  const servesBuiltClient = options.serveStatic === true;

  app.set('trust proxy', 'loopback');
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          formAction: ["'self'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          // The client is a bundled SPA; styles are emitted by Vite as a stylesheet,
          // with a small inline style block for the initial paint.
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc:
            config.isProduction || servesBuiltClient
              ? ["'self'"]
              : ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
          connectSrc:
            config.isProduction || servesBuiltClient ? ["'self'"] : ["'self'", 'ws:', 'http://localhost:5173'],
          fontSrc: ["'self'", 'data:'],
        },
      },
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'same-origin' },
    }),
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(cookieParser());
  app.use(attachContext({ db: options.db, uploadsDir: options.uploadsDir }));
  app.use(loadSession);

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', version: 1 });
  });

  // Public marketing surface. The landing page is the indexable face of the
  // product; the SPA shell is noindex. Only a resolved, active session falls
  // through to the app. A stale or invalid cookie must still see the landing
  // page instead of being stranded on the sign-in screen.
  app.get('/', (req, res, next) => {
    if (req.session) return next();
    res.setHeader('Content-Security-Policy', landingCsp());
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.type('html').send(landingHtml());
  });
  for (const pagePath of PUBLIC_INFO_PATHS) {
    app.get(pagePath, (_req, res) => {
      res.setHeader('Content-Security-Policy', landingCsp());
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.type('html').send(publicInfoHtml(pagePath));
    });
  }
  app.get('/robots.txt', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.type('text/plain').send(robotsTxt());
  });
  app.get('/sitemap.xml', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.type('application/xml').send(sitemapXml());
  });
  // Favicon, OG image and other public assets ship straight from the source tree.
  app.use(express.static(publicDir(), { index: false, maxAge: '1d' }));

  // CSRF + origin checks apply to every state-changing API request.
  app.use('/api', csrfProtection);

  app.use('/api/auth', authRoutes);

  // Everything below requires a session.
  app.use('/api/grants/:grantId', requireAuth, grantChildRoutes);
  app.use('/api/grants', requireAuth, grantRoutes);
  app.use('/api/funders', requireAuth, funderRoutes);
  app.use('/api', requireAuth, workspaceRoutes);

  app.use('/api', notFoundMiddleware);

  if (options.serveStatic) {
    const clientDir = options.clientDir ?? path.resolve(process.cwd(), 'dist/client');
    if (fs.existsSync(clientDir)) {
      app.use(
        express.static(clientDir, {
          index: false,
          maxAge: '1h',
          setHeaders: (res, filePath) => {
            if (filePath.endsWith('index.html')) {
              res.setHeader('Cache-Control', 'no-store');
            }
          },
        }),
      );
      // Only real client routes receive the SPA shell. Unknown public paths
      // return an honest 404 instead of a soft-404 app page.
      app.get('*', (req, res) => {
        if (!isSpaPath(req.path)) {
          sendPublicNotFound(res);
          return;
        }
        res.setHeader('Cache-Control', 'no-store');
        res.sendFile(path.join(clientDir, 'index.html'));
      });
    } else {
      app.get('*', (req, res) => {
        if (!isSpaPath(req.path)) {
          sendPublicNotFound(res);
          return;
        }
        res
          .status(503)
          .type('text/plain')
          .send('Client bundle not found. Run `npm run build` first, or use `npm run demo` for development.');
      });
    }
  }

  app.use(errorMiddleware);

  return app;
}
