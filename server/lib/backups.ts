/** Database-aware, encrypted local recovery bundles. No remote storage is enabled here. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import Database from 'better-sqlite3';
import { z } from 'zod';
import type { Db } from '../db/connection';

const MAGIC = Buffer.from('GCB1');
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
export const BACKUP_FREE_SPACE_RESERVE_BYTES = 128n * 1024n * 1024n;
const BACKUP_NAME = /^gc-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f-]{36}\.gcb$/;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const fileSpec = z.object({ object: z.string().regex(/^object-\d{6}\.enc$/), bytes: z.number().int().nonnegative().safe(), sha256: digest });
const documentSpec = fileSpec.extend({ id: z.string().min(1), orgId: z.string().regex(/^[A-Za-z0-9_-]+$/), storageKey: z.string().min(1).max(500) });
const manifestSpec = z.object({
  format: z.literal(1), backupId: z.string().regex(BACKUP_NAME), createdAt: z.string().datetime(),
  database: fileSpec, documents: z.array(documentSpec).max(100_000),
}).strict();
type Manifest = z.infer<typeof manifestSpec>;
type DocumentRow = { id: string; orgId: string; storageKey: string; bytes: number };

export interface BackupOptions {
  db: Db;
  uploadsDir: string;
  destinationDir: string;
  /** Separate random 32-byte AES key, encoded as 64 hex characters. Never SESSION_SECRET. */
  encryptionKey: string;
  now?: Date;
}
export interface BackupReceipt {
  backupId: string;
  path: string;
  documents: number;
  createdAt: string;
  storage: 'local';
  offsiteActive: false;
}

export interface BackupEnvironment {
  destinationDir: string;
  encryptionKey: string;
  retainDays: number;
}

/** Shared synchronous validation so a scheduler cannot start with incomplete configuration. */
export function resolveBackupEnvironment(env: NodeJS.ProcessEnv = process.env): BackupEnvironment | null {
  if (env.BACKUP_ENABLED !== 'true') return null;
  if (!env.BACKUP_DIR || !path.isAbsolute(env.BACKUP_DIR)) throw new Error('BACKUP_DIR must be an explicit absolute private directory.');
  if (!env.BACKUP_ENCRYPTION_KEY) throw new Error('BACKUP_ENCRYPTION_KEY is required.');
  decodeKey(env.BACKUP_ENCRYPTION_KEY).fill(0);
  const retainDays = Number(env.BACKUP_RETAIN_DAYS ?? '14');
  if (!Number.isInteger(retainDays) || retainDays < 1 || retainDays > 90) throw new Error('Backup retention must be 1–90 days.');
  return { destinationDir: env.BACKUP_DIR, encryptionKey: env.BACKUP_ENCRYPTION_KEY, retainDays };
}

function decodeKey(value: string): Buffer {
  if (!/^[a-fA-F0-9]{64}$/.test(value) || new Set(value.toLowerCase()).size < 8) {
    throw new Error('BACKUP_ENCRYPTION_KEY must be a separately generated random 32-byte key encoded as 64 hex characters.');
  }
  return Buffer.from(value, 'hex');
}

/** Refuse symlinks in every existing path component, including the root. */
async function checkedPath(value: string): Promise<string> {
  const absolute = path.resolve(value);
  let cursor = path.parse(absolute).root;
  // macOS /var and /tmp are system symlinks. Canonicalise only that system root.
  const parts = absolute.slice(cursor.length).split(path.sep).filter(Boolean);
  if (process.platform === 'darwin' && (parts[0] === 'var' || parts[0] === 'tmp')) {
    cursor = await fsp.realpath(path.join(cursor, parts.shift()!));
  }
  for (const part of parts) {
    cursor = path.join(cursor, part);
    try {
      if ((await fsp.lstat(cursor)).isSymbolicLink()) throw new Error('Backup paths must not contain symlinks.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return cursor;
}

/** Prepare an explicitly chosen local directory without following symlinks or broadening its access. */
export async function prepareBackupDestination(destinationDir: string): Promise<string> {
  const destination = await checkedPath(destinationDir);
  await fsp.mkdir(destination, { recursive: true, mode: 0o700 });
  const stat = await fsp.stat(destination);
  if (!stat.isDirectory() || stat.mode & 0o077) throw new Error('Backup destination must have owner-only permissions (0700).');
  return destination;
}

function safeStorageKey(row: DocumentRow): void {
  const parts = row.storageKey.split('/');
  if (!/^[A-Za-z0-9_-]+$/.test(row.orgId) || parts.length !== 2 || parts[0] !== row.orgId ||
      !/^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(parts[1] ?? '') ||
      !Number.isSafeInteger(row.bytes) || row.bytes < 0) {
    throw new Error('Invalid tenant upload reference in database.');
  }
}

function checkDatabase(db: Db): DocumentRow[] {
  const integrity = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
  const foreignKeys = db.pragma('foreign_key_check') as unknown[];
  if (integrity.length !== 1 || integrity[0]?.integrity_check !== 'ok' || foreignKeys.length > 0) {
    throw new Error('Database integrity or foreign-key verification failed.');
  }
  const invalid = db.prepare(`SELECT d.id FROM documents d
    LEFT JOIN organizations o ON o.id=d.org_id LEFT JOIN grants g ON g.id=d.grant_id
    WHERE o.id IS NULL OR g.id IS NULL OR g.org_id <> d.org_id LIMIT 1`).get();
  if (invalid) throw new Error('Document tenant relationship verification failed.');
  const rows = db.prepare('SELECT id, org_id AS orgId, storage_key AS storageKey, size_bytes AS bytes FROM documents ORDER BY id').all() as DocumentRow[];
  if (rows.length > 100_000) throw new Error('Backup document limit exceeded.');
  rows.forEach(safeStorageKey);
  return rows;
}

async function encryptFile(source: string, target: string, key: Buffer, aad: string): Promise<z.infer<typeof fileSpec>> {
  const safe = await checkedPath(source);
  const input = await fsp.open(safe, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    if (!(await input.stat()).isFile()) throw new Error('Backup sources must be regular files.');
    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(Buffer.from(aad));
    await fsp.writeFile(target, Buffer.concat([MAGIC, nonce]), { flag: 'wx', mode: 0o600 });
    const hash = crypto.createHash('sha256');
    let bytes = 0;
    const inspect = new Transform({ transform(chunk: Buffer, _encoding, done) { bytes += chunk.length; hash.update(chunk); done(null, chunk); } });
    await pipeline(input.createReadStream({ autoClose: false }), inspect, cipher, fs.createWriteStream(target, { flags: 'a', mode: 0o600 }));
    await fsp.appendFile(target, cipher.getAuthTag());
    await syncFile(target);
    return { object: path.basename(target), bytes, sha256: hash.digest('hex') };
  } finally { await input.close(); }
}

function encryptManifest(manifest: Manifest, key: Buffer): Buffer {
  const plain = Buffer.from(JSON.stringify(manifest));
  if (plain.length > MAX_MANIFEST_BYTES) throw new Error('Backup manifest limit exceeded.');
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(`${manifest.backupId}/manifest`));
  return Buffer.concat([MAGIC, nonce, cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
}

async function readManifest(bundle: string, key: Buffer): Promise<Manifest> {
  const manifestPath = await checkedPath(path.join(bundle, 'manifest.enc'));
  const handle = await fsp.open(manifestPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 32 || stat.size > MAX_MANIFEST_BYTES + 32) throw new Error('Invalid backup manifest size.');
    const data = await handle.readFile();
    if (!data.subarray(0, 4).equals(MAGIC)) throw new Error('Unsupported backup format.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, data.subarray(4, 16));
    decipher.setAAD(Buffer.from(`${path.basename(bundle)}/manifest`));
    decipher.setAuthTag(data.subarray(-16));
    const manifest = manifestSpec.parse(JSON.parse(Buffer.concat([decipher.update(data.subarray(16, -16)), decipher.final()]).toString('utf8')));
    if (manifest.backupId !== path.basename(bundle)) throw new Error('Backup identity mismatch.');
    if (manifest.database.object !== 'object-000000.enc') throw new Error('Invalid database object.');
    const objects = new Set([manifest.database.object]);
    const storageKeys = new Set<string>();
    const ids = new Set<string>();
    for (const row of manifest.documents) {
      safeStorageKey(row);
      if (objects.has(row.object) || storageKeys.has(row.storageKey) || ids.has(row.id)) throw new Error('Duplicate backup object.');
      objects.add(row.object); storageKeys.add(row.storageKey); ids.add(row.id);
    }
    return manifest;
  } finally { await handle.close(); }
}

async function syncFile(file: string): Promise<void> {
  const handle = await fsp.open(file, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}
async function syncDirectory(dir: string): Promise<void> {
  const handle = await fsp.open(dir, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

/** Best-effort capacity check, including the later full isolated restore drill. */
async function assertBackupCapacity(db: Db, destination: string): Promise<void> {
  const pageCount = Number(db.pragma('page_count', { simple: true }));
  const pageSize = Number(db.pragma('page_size', { simple: true }));
  if (!Number.isSafeInteger(pageCount) || pageCount < 0 || !Number.isSafeInteger(pageSize) || pageSize <= 0) {
    throw new Error('Backup capacity could not be verified.');
  }
  const rows = db.prepare('SELECT size_bytes AS bytes FROM documents').all() as Array<{ bytes: number }>;
  if (rows.length > 100_000 || rows.some(({ bytes }) => !Number.isSafeInteger(bytes) || bytes < 0)) {
    throw new Error('Backup capacity could not be verified.');
  }
  // SQLite page accounting includes committed WAL-backed pages without copying WAL files.
  const databaseBytes = BigInt(pageCount) * BigInt(pageSize);
  const uploadsBytes = rows.reduce((sum, row) => sum + BigInt(row.bytes), 0n);
  const plaintextBytes = databaseBytes + uploadsBytes;
  const encryptedBytes = plaintextBytes + BigInt(rows.length + 2) * 32n + BigInt(MAX_MANIFEST_BYTES);
  const temporary = await checkedPath(os.tmpdir());
  const [destinationSpace, temporarySpace, destinationStat, temporaryStat] = await Promise.all([
    fsp.statfs(destination, { bigint: true }), fsp.statfs(temporary, { bigint: true }),
    fsp.stat(destination), fsp.stat(temporary),
  ]);
  const destinationFree = destinationSpace.bavail * destinationSpace.bsize;
  const temporaryFree = temporarySpace.bavail * temporarySpace.bsize;
  const sameFilesystem = destinationStat.dev === temporaryStat.dev;
  const destinationRequired = encryptedBytes + (sameFilesystem ? plaintextBytes : 0n) + BACKUP_FREE_SPACE_RESERVE_BYTES;
  const temporaryRequired = plaintextBytes + BACKUP_FREE_SPACE_RESERVE_BYTES;
  if (destinationFree < destinationRequired || temporaryFree < temporaryRequired) {
    throw new Error('Insufficient free capacity for an encrypted backup and isolated restore verification.');
  }
}

/** Snapshot the online database; include only the immutable uploads it references. Missing files abort publication. */
export async function createBackup(options: BackupOptions): Promise<BackupReceipt> {
  const key = decodeKey(options.encryptionKey);
  const destination = await prepareBackupDestination(options.destinationDir);
  const uploads = await checkedPath(options.uploadsDir);
  // A misplaced destination inside uploads must never enter an application backup.
  if (destination === uploads || destination.startsWith(`${uploads}${path.sep}`)) throw new Error('Backup destination cannot be inside uploads.');
  await assertBackupCapacity(options.db, destination);
  const now = options.now ?? new Date();
  const createdAt = now.toISOString();
  const backupId = `gc-${createdAt.replace(/[:.]/g, '-')}-${crypto.randomUUID()}.gcb`;
  const staging = await fsp.mkdtemp(path.join(destination, '.creating-'));
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), 'grantconsole-backup-'));
  const finalPath = path.join(destination, backupId);
  try {
    const databasePath = path.join(scratch, 'meridian.db');
    await options.db.backup(databasePath);
    await fsp.chmod(databasePath, 0o600);
    const snapshot = new Database(databasePath, { readonly: true, fileMustExist: true });
    let rows: DocumentRow[];
    try { rows = checkDatabase(snapshot); } finally { snapshot.close(); }
    const database = await encryptFile(databasePath, path.join(staging, 'object-000000.enc'), key, `${backupId}/object-000000.enc`);
    const documents: Manifest['documents'] = [];
    for (const [index, row] of rows.entries()) {
      const object = `object-${String(index + 1).padStart(6, '0')}.enc`;
      const encrypted = await encryptFile(path.join(uploads, row.storageKey), path.join(staging, object), key, `${backupId}/${object}`);
      if (encrypted.bytes !== row.bytes) throw new Error('Upload size differs from the database snapshot; retry backup.');
      documents.push({ ...row, ...encrypted });
    }
    const manifest: Manifest = { format: 1, backupId, createdAt, database, documents };
    await fsp.writeFile(path.join(staging, 'manifest.enc'), encryptManifest(manifest, key), { mode: 0o600, flag: 'wx' });
    await syncFile(path.join(staging, 'manifest.enc'));
    await syncDirectory(staging);
    await fsp.rename(staging, finalPath);
    await syncDirectory(destination);
    return { backupId, path: finalPath, documents: documents.length, createdAt, storage: 'local', offsiteActive: false };
  } finally {
    key.fill(0);
    await fsp.rm(staging, { recursive: true, force: true });
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function decryptFile(bundle: string, spec: z.infer<typeof fileSpec>, target: string, key: Buffer): Promise<void> {
  const source = await checkedPath(path.join(bundle, spec.object));
  const input = await fsp.open(source, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = await input.stat();
    if (!stat.isFile() || stat.size !== spec.bytes + 32) throw new Error('Encrypted object size mismatch.');
    const header = Buffer.alloc(16);
    const tag = Buffer.alloc(16);
    await input.read(header, 0, 16, 0);
    await input.read(tag, 0, 16, stat.size - 16);
    if (!header.subarray(0, 4).equals(MAGIC)) throw new Error('Unsupported backup object.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, header.subarray(4));
    decipher.setAuthTag(tag);
    decipher.setAAD(Buffer.from(`${path.basename(bundle)}/${spec.object}`));
    const hash = crypto.createHash('sha256');
    let bytes = 0;
    const inspect = new Transform({ transform(chunk: Buffer, _encoding, done) {
      bytes += chunk.length;
      if (bytes > spec.bytes) { done(new Error('Decrypted object exceeded declared size.')); return; }
      hash.update(chunk); done(null, chunk);
    } });
    await fsp.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    // Empty payloads have no ciphertext; still force GCM authentication in final().
    if (spec.bytes === 0) {
      decipher.final();
      await fsp.writeFile(target, Buffer.alloc(0), { mode: 0o600, flag: 'wx' });
    } else {
      await pipeline(input.createReadStream({ start: 16, end: stat.size - 17, autoClose: false }), decipher, inspect,
        fs.createWriteStream(target, { flags: 'wx', mode: 0o600 }));
    }
    if (bytes !== spec.bytes || hash.digest('hex') !== spec.sha256) throw new Error('Restored file integrity mismatch.');
    await syncFile(target);
  } finally { await input.close(); }
}

/** Restore only into a brand-new isolated directory, never over the running app. */
export async function restoreBackup(options: { bundleDir: string; restoreDir: string; encryptionKey: string }): Promise<BackupReceipt> {
  const key = decodeKey(options.encryptionKey);
  const bundle = await checkedPath(options.bundleDir);
  const target = await checkedPath(options.restoreDir);
  if (!BACKUP_NAME.test(path.basename(bundle))) throw new Error('Invalid backup directory name.');
  const parent = path.dirname(target);
  await fsp.mkdir(parent, { recursive: true, mode: 0o700 });
  try { await fsp.lstat(target); throw new Error('Restore directory must not already exist.'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  // Exclusive reservation protects against overwriting a concurrently created destination.
  await fsp.mkdir(target, { mode: 0o700 });
  const staging = await fsp.mkdtemp(path.join(parent, '.restoring-'));
  let published = false;
  try {
    const manifest = await readManifest(bundle, key);
    await decryptFile(bundle, manifest.database, path.join(staging, 'meridian.db'), key);
    const db = new Database(path.join(staging, 'meridian.db'), { readonly: true, fileMustExist: true });
    let rows: DocumentRow[];
    try { rows = checkDatabase(db); } finally { db.close(); }
    const expected = manifest.documents.map(({ id, orgId, storageKey, bytes }) => ({ id, orgId, storageKey, bytes }));
    if (JSON.stringify(rows) !== JSON.stringify(expected)) throw new Error('Restored database and upload manifest differ.');
    await fsp.mkdir(path.join(staging, 'uploads'), { mode: 0o700 });
    for (const document of manifest.documents) {
      await decryptFile(bundle, document, path.join(staging, 'uploads', document.storageKey), key);
    }
    await syncDirectory(staging);
    await fsp.rename(staging, target);
    published = true;
    await syncDirectory(parent);
    return { backupId: manifest.backupId, path: target, documents: expected.length, createdAt: manifest.createdAt, storage: 'local', offsiteActive: false };
  } finally {
    key.fill(0);
    await fsp.rm(staging, { recursive: true, force: true });
    if (!published) await fsp.rmdir(target);
  }
}

/** Full decryption and isolated restore drill, with all temporary plaintext removed afterwards. */
export async function verifyBackup(options: { bundleDir: string; encryptionKey: string }): Promise<BackupReceipt> {
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), 'grantconsole-restore-check-'));
  try {
    const receipt = await restoreBackup({ ...options, restoreDir: path.join(scratch, 'restored') });
    return { ...receipt, path: path.resolve(options.bundleDir) };
  } finally { await fsp.rm(scratch, { recursive: true, force: true }); }
}

/** Exact object allowlist from the authenticated manifest; names alone do not prove encryption. */
export async function authenticatedBackupObjectNames(options: { bundleDir: string; encryptionKey: string }): Promise<string[]> {
  const key = decodeKey(options.encryptionKey);
  try {
    const bundle = await checkedPath(options.bundleDir);
    const manifest = await readManifest(bundle, key);
    return ['manifest.enc', manifest.database.object, ...manifest.documents.map((document) => document.object)];
  } finally { key.fill(0); }
}

/** Remove only authenticated bundles older than the retention window, after a successful new backup. */
export async function pruneBackups(options: { destinationDir: string; encryptionKey: string; retainDays: number; keepBackupId: string; now?: Date }): Promise<number> {
  if (!Number.isInteger(options.retainDays) || options.retainDays < 1 || options.retainDays > 90) throw new Error('Backup retention must be 1–90 days.');
  const key = decodeKey(options.encryptionKey);
  let removed = 0;
  try {
    const destination = await checkedPath(options.destinationDir);
    // Authenticate the new backup before any deletion, including when a caller passes an arbitrary id.
    if (!BACKUP_NAME.test(options.keepBackupId)) throw new Error('Invalid retained backup id.');
    await verifyBackup({ bundleDir: await checkedPath(path.join(destination, options.keepBackupId)), encryptionKey: options.encryptionKey });
    const cutoff = (options.now ?? new Date()).getTime() - options.retainDays * 86_400_000;
    for (const entry of await fsp.readdir(destination, { withFileTypes: true })) {
      if (!entry.isDirectory() || !BACKUP_NAME.test(entry.name) || entry.name === options.keepBackupId) continue;
      const candidate = await checkedPath(path.join(destination, entry.name));
      let manifest: Manifest;
      try { manifest = await readManifest(candidate, key); } catch { continue; }
      if (new Date(manifest.createdAt).getTime() >= cutoff) continue;
      await fsp.rm(candidate, { recursive: true }); removed += 1;
    }
    return removed;
  } finally { key.fill(0); }
}

/** Explicit opt-in. Misconfiguration fails; success never claims offsite protection. */
export async function runBackupFromEnvironment(db: Db, uploadsDir: string, env: NodeJS.ProcessEnv = process.env): Promise<BackupReceipt | null> {
  const settings = resolveBackupEnvironment(env);
  if (!settings) return null;
  const receipt = await createBackup({ db, uploadsDir, destinationDir: settings.destinationDir, encryptionKey: settings.encryptionKey });
  await pruneBackups({ ...settings, keepBackupId: receipt.backupId });
  return receipt;
}
