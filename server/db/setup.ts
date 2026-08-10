import fs from 'node:fs';
import path from 'node:path';

import { config } from '../config';
import { closeDb, ensureDataDirs, getDb } from './connection';
import { seedDemoData, type SeedResult } from './seed';
import { DEMO_PASSWORD, DEMO_USERS } from './demo-accounts';
import { BRAND } from '../../shared/brand';

/** Create data directories + schema, then seed only when the workspace is empty. */
export async function setupDemo(options: { force?: boolean } = {}): Promise<SeedResult> {
  ensureDataDirs();
  const db = getDb();
  return seedDemoData(db, { force: options.force ?? false });
}

/**
 * Safe reset. Only ever removes the known demo database files and the uploads
 * directory inside DATA_DIR — never an arbitrary path.
 */
export async function resetDemo(): Promise<SeedResult> {
  closeDb();

  const dataDir = path.resolve(config.dataDir);
  const dbFile = path.resolve(config.databaseFile);
  const uploadsDir = path.resolve(config.uploadsDir);

  assertInside(dataDir, dbFile);
  assertInside(dataDir, uploadsDir);

  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${dbFile}${suffix}`;
    if (fs.existsSync(file)) fs.rmSync(file);
  }
  if (fs.existsSync(uploadsDir)) {
    fs.rmSync(uploadsDir, { recursive: true, force: true });
  }

  ensureDataDirs();
  const db = getDb();
  return seedDemoData(db, { force: true });
}

function assertInside(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to touch ${target}: it is outside the data directory ${root}.`);
  }
}

export function printSummary(result: SeedResult): void {
  console.info(`\n  ${BRAND.fullName} — demo workspace`);
  if (!result.seeded) {
    console.info('  Existing data found. Nothing was changed.');
    console.info('  Run `npm run demo:reset` to wipe and reseed the local demo data.\n');
  } else {
    console.info('  Seeded successfully.\n');
  }
  console.info(`  Organizations : ${result.organizations}`);
  console.info(`  Users         : ${result.users}`);
  console.info(`  Funders       : ${result.funders}`);
  console.info(`  Grants        : ${result.grants}`);
  console.info(`  Deliverables  : ${result.milestones}`);
  console.info(`  Tasks         : ${result.tasks}`);
  console.info(`  Budget lines  : ${result.budgetLines}`);
  console.info(`  Evidence files: ${result.documents}`);
  console.info(`  Notes         : ${result.comments}`);
  console.info(`  Activity      : ${result.activities}`);
  console.info(`\n  Data directory: ${config.dataDir}`);
  console.info(`\n  Demo sign-in (password for every account): ${DEMO_PASSWORD}`);
  for (const user of DEMO_USERS) {
    const roles = user.memberships.map((m) => m.role).join(', ');
    console.info(`    ${user.email.padEnd(32)} ${roles}`);
  }
  console.info('');
}
