import Database from 'better-sqlite3';
import { config } from '../config';
import { restoreBackup, runBackupFromEnvironment, verifyBackup } from '../lib/backups';

async function main(): Promise<void> {
  const [command, bundleDir, restoreDir] = process.argv.slice(2);
  const encryptionKey = process.env.BACKUP_ENCRYPTION_KEY;
  if (!encryptionKey) throw new Error('BACKUP_ENCRYPTION_KEY is required. Supply secrets through the environment, never CLI arguments.');
  if (command === 'create') {
    // Open the existing database without migrations or creating a missing database.
    const db = new Database(config.databaseFile, { readonly: true, fileMustExist: true });
    try {
      const receipt = await runBackupFromEnvironment(db, config.uploadsDir);
      if (!receipt) throw new Error('Set BACKUP_ENABLED=true to explicitly opt in.');
      console.info(JSON.stringify({ ...receipt, restoreVerified: true }));
    } finally { db.close(); }
  } else if (command === 'verify' && bundleDir && !restoreDir) {
    console.info(JSON.stringify({ ...await verifyBackup({ bundleDir, encryptionKey }), restoreVerified: true }));
  } else if (command === 'restore' && bundleDir && restoreDir) {
    console.info(JSON.stringify(await restoreBackup({ bundleDir, restoreDir, encryptionKey })));
  } else {
    throw new Error('Usage: cli-backup create | verify BUNDLE_DIR | restore BUNDLE_DIR NEW_ISOLATED_DIRECTORY');
  }
}

void main().catch(() => {
  // Do not print paths, document identifiers, or secrets from nested filesystem errors.
  console.error('[backup] Operation failed. Check configuration, private directory permissions, key, bundle integrity and operator runbook.');
  process.exitCode = 1;
});
