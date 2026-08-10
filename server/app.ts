import path from 'node:path';
import fs from 'node:fs';

import cookieParser from 'cookie-parser';
import express, { type Express } from 'express';
import helmet from 'helmet';

import { config } from './config';
import { attachContext, csrfProtection, loadSession, requireAuth } from './auth/middleware';
import type { Db } from './db/connection';
import { errorMiddleware, notFoundMiddleware } from './lib/http';
import authRoutes from './routes/auth';
import funderRoutes from './routes/funders';
import grantChildRoutes from './routes/grant-children';
import grantRoutes from './routes/grants';
import workspaceRoutes from './routes/workspace';

export interface AppOptions {
  db?: Db;
  /** Serve the built client from dist/client. Enabled for the production server. */
  serveStatic?: boolean;
  /** Evidence storage root. Tests pass a temporary directory. */
  uploadsDir?: string;
}

export function createApp(options: AppOptions = {}): Express {
  const app = express();

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
          scriptSrc: config.isProduction ? ["'self'"] : ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
          connectSrc: config.isProduction ? ["'self'"] : ["'self'", 'ws:', 'http://localhost:5173'],
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
    const clientDir = path.resolve(process.cwd(), 'dist/client');
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
      // SPA fallback: any non-API GET renders the client shell.
      app.get('*', (_req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.sendFile(path.join(clientDir, 'index.html'));
      });
    } else {
      app.get('*', (_req, res) => {
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
