/** Daily local backup caller for one application process, never an offsite guarantee. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Db } from '../db/connection';
import { prepareBackupDestination, resolveBackupEnvironment, runBackupFromEnvironment } from './backups';

const RECEIPT_FILE = '.last-verified-backup.json';
const receiptSpec = z.object({
  format: z.literal(1),
  backupId: z.string().regex(/^gc-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f-]{36}\.gcb$/),
  verifiedAt: z.string().datetime(),
  keyId: z.string().regex(/^[a-f0-9]{64}$/),
  storage: z.literal('local'), offsiteActive: z.literal(false),
}).strict();
type SuccessReceipt = z.infer<typeof receiptSpec>;

async function readReceipt(destination: string): Promise<SuccessReceipt | null> {
  let handle: Awaited<ReturnType<typeof fsp.open>>;
  try { handle = await fsp.open(path.join(destination, RECEIPT_FILE), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 2048 || stat.mode & 0o077) throw new Error('Invalid backup success receipt.');
    const receipt = receiptSpec.parse(JSON.parse(await handle.readFile('utf8')));
    let bundle: fs.Stats;
    try { bundle = await fsp.lstat(path.join(destination, receipt.backupId)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    if (!bundle.isDirectory() || bundle.isSymbolicLink()) return null;
    return receipt;
  } finally { await handle.close(); }
}

async function writeReceipt(destination: string, receipt: SuccessReceipt): Promise<void> {
  const temporary = path.join(destination, `.success-${crypto.randomUUID()}.tmp`);
  try {
    const handle = await fsp.open(temporary, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(receipt)); await handle.sync(); } finally { await handle.close(); }
    await fsp.rename(temporary, path.join(destination, RECEIPT_FILE));
    const directory = await fsp.open(destination, 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } finally { await fsp.rm(temporary, { force: true }); }
}

/**
 * Starts only with explicit complete configuration. Runs at startup, then hourly,
 * at most once per UTC calendar day after a successful verified backup. A failure
 * leaves no success receipt and retries at the next tick. The busy flag protects
 * this process only; run one instance with this disk, not overlapping replicas.
 */
export function startBackupScheduler(db: Db, uploadsDir: string, env: NodeJS.ProcessEnv = process.env): () => void {
  // Snapshot settings so mutation of process.env cannot switch destinations or keys mid-run.
  const frozenEnv = { ...env };
  const settings = resolveBackupEnvironment(frozenEnv);
  if (!settings) return () => undefined;
  // A key rotation must trigger a fresh backup even when today's old-key receipt exists.
  const keyId = crypto.createHash('sha256').update(Buffer.from(settings.encryptionKey, 'hex')).digest('hex');
  let busy = false;
  let stopped = false;
  const tick = async (): Promise<void> => {
    if (stopped || busy) return;
    busy = true;
    try {
      const destination = await prepareBackupDestination(settings.destinationDir);
      const now = new Date();
      const receipt = await readReceipt(destination);
      if (receipt && receipt.keyId === keyId && receipt.verifiedAt.slice(0, 10) === now.toISOString().slice(0, 10) && new Date(receipt.verifiedAt).getTime() <= now.getTime()) return;
      const result = await runBackupFromEnvironment(db, uploadsDir, frozenEnv);
      if (!result || result.storage !== 'local' || result.offsiteActive !== false) throw new Error('Unexpected backup result.');
      await writeReceipt(destination, receiptSpec.parse({ format: 1, backupId: result.backupId, verifiedAt: new Date().toISOString(), keyId, storage: 'local', offsiteActive: false }));
      console.info('[backup] Daily local backup and restore verification completed; offsite protection is not active.');
    } catch {
      // Never log nested errors: they may contain keys, document paths or tenant identifiers.
      console.error('[backup] Daily local backup failed. No success recorded; next hourly check will retry. Operator review required.');
    } finally { busy = false; }
  };
  const kickoff = setTimeout(() => void tick(), 20_000);
  const interval = setInterval(() => void tick(), 60 * 60 * 1000);
  kickoff.unref(); interval.unref();
  return () => { stopped = true; clearTimeout(kickoff); clearInterval(interval); };
}
