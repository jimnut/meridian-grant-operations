import { config } from '../config';
import { closeDb } from './connection';
import { printSummary, resetDemo } from './setup';

async function main(): Promise<void> {
  console.info(`\n  Resetting demo data in ${config.dataDir}`);
  console.info('  This removes only the local demo database and uploads directory.');
  const result = await resetDemo();
  printSummary(result);
  closeDb();
}

main().catch((error: unknown) => {
  console.error('[demo:reset] failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
