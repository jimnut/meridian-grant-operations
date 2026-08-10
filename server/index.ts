import { BRAND } from '../shared/brand';
import { createApp } from './app';
import { config } from './config';
import { ensureDataDirs, getDb } from './db/connection';

function main(): void {
  ensureDataDirs();
  const db = getDb();

  const hasOrgs = (db.prepare('SELECT COUNT(*) AS count FROM organizations').get() as { count: number }).count;
  if (hasOrgs === 0) {
    console.warn('[startup] No organizations found. Run `npm run demo:setup` to create the demo workspace.');
  }

  const app = createApp({ db, serveStatic: true });

  // Bind to loopback unless HOST is set explicitly; see server/config.ts.
  const server = app.listen(config.port, config.host, () => {
    const displayHost = config.host === '0.0.0.0' || config.host === '::' ? 'localhost' : config.host;
    console.info(`\n  ${BRAND.fullName}`);
    console.info(`  API + app ready on http://${displayHost}:${config.port}`);
    console.info(`  Bound to: ${config.host}${config.host === '127.0.0.1' ? ' (loopback only)' : ''}`);
    console.info(`  Environment: ${config.nodeEnv}${config.demoMode ? ' · DEMO MODE' : ''}`);
    console.info(`  Data directory: ${config.dataDir}\n`);

    if (config.host !== '127.0.0.1' && config.host !== 'localhost') {
      console.warn(
        `[startup] Listening on ${config.host}: this workspace is reachable from other machines on the network.`,
      );
    }
    if (config.demoMode) {
      console.warn('[startup] DEMO_MODE is on: seeded accounts and the shared demo password are exposed at sign-in.');
    }
  });

  const shutdown = (signal: string) => {
    console.info(`\n[${signal}] shutting down…`);
    server.close(() => {
      db.close();
      process.exit(0);
    });
    // Do not hang forever if a socket refuses to close.
    setTimeout(() => process.exit(0), 5000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
