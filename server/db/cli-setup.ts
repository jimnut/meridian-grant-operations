import { closeDb } from './connection';
import { printSummary, setupDemo } from './setup';

async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  const result = await setupDemo({ force });
  printSummary(result);
  closeDb();
}

main().catch((error: unknown) => {
  console.error('[demo:setup] failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
