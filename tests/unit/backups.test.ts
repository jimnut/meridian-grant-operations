import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BACKUP_FREE_SPACE_RESERVE_BYTES, createBackup, pruneBackups, restoreBackup, runBackupFromEnvironment, verifyBackup } from '../../server/lib/backups';
import { openDatabase } from '../../server/db/connection';
import { seedDemoData } from '../../server/db/seed';

let root: string;
let db: Database.Database;
let uploads: string;
let destination: string;
let key: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-backup-test-'));
  uploads = path.join(root, 'uploads');
  destination = path.join(root, 'backups');
  fs.mkdirSync(path.join(uploads, 'tenant_a'), { recursive: true });
  fs.writeFileSync(path.join(uploads, 'tenant_a/evidence.pdf'), 'synthetic evidence');
  db = new Database(path.join(root, 'live.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE organizations (id TEXT PRIMARY KEY);
    CREATE TABLE grants (id TEXT PRIMARY KEY, org_id TEXT REFERENCES organizations(id));
    CREATE TABLE documents (id TEXT PRIMARY KEY, org_id TEXT REFERENCES organizations(id), grant_id TEXT REFERENCES grants(id), storage_key TEXT UNIQUE, size_bytes INTEGER);
    INSERT INTO organizations VALUES ('tenant_a'),('tenant_b');
    INSERT INTO grants VALUES ('grant_a','tenant_a'),('grant_b','tenant_b');
    INSERT INTO documents VALUES ('document_a','tenant_a','grant_a','tenant_a/evidence.pdf',18);`);
  key = crypto.randomBytes(32).toString('hex');
});
afterEach(() => { vi.restoreAllMocks(); db.close(); fs.rmSync(root, { recursive: true, force: true }); });
const create = (now?: Date) => createBackup({ db, uploadsDir: uploads, destinationDir: destination, encryptionKey: key, now });
const restore = (bundleDir: string, encryptionKey = key) => restoreBackup({ bundleDir, restoreDir: path.join(root, 'restored'), encryptionKey });

describe('encrypted SQLite and tenant evidence recovery', () => {
  it.each(['destination', 'temporary', 'shared filesystem'])('refuses insufficient %s capacity before snapshotting, preserving live data and published backups', async (location) => {
    const existing = await create();
    const before = db.prepare('SELECT * FROM documents').all();
    const snapshot = vi.spyOn(db, 'backup');
    const plentiful: fs.BigIntStatsFs = { type: 0n, bsize: 1n, blocks: 10_000_000_000n, bfree: 10_000_000_000n, bavail: 10_000_000_000n, files: 10_000n, ffree: 10_000n };
    const plaintext = BigInt(Number(db.pragma('page_count', { simple: true }))) * BigInt(Number(db.pragma('page_size', { simple: true }))) + 18n;
    const encrypted = plaintext + 3n * 32n + 16n * 1024n * 1024n;
    const destinationFree = location === 'destination' ? BACKUP_FREE_SPACE_RESERVE_BYTES - 1n
      : location === 'shared filesystem' ? BACKUP_FREE_SPACE_RESERVE_BYTES + encrypted : plentiful.bavail;
    const temporaryFree = location === 'temporary' ? BACKUP_FREE_SPACE_RESERVE_BYTES - 1n : plentiful.bavail;
    vi.spyOn(fsp, 'statfs').mockResolvedValueOnce({ ...plentiful, bavail: destinationFree }).mockResolvedValueOnce({ ...plentiful, bavail: temporaryFree });
    await expect(create()).rejects.toThrow('Insufficient free capacity');
    expect(snapshot).not.toHaveBeenCalled();
    expect(db.prepare('SELECT * FROM documents').all()).toEqual(before);
    expect(fs.readFileSync(path.join(uploads, 'tenant_a/evidence.pdf'), 'utf8')).toBe('synthetic evidence');
    expect(fs.readdirSync(destination)).toEqual([existing.backupId]);
  });

  it('backs up and restores the real migrated application schema with synthetic multi-tenant seed evidence', async () => {
    db.close();
    db = openDatabase(path.join(root, 'full-schema.db'));
    await seedDemoData(db, { force: true, uploadsDir: uploads });
    const expected = (db.prepare('SELECT COUNT(*) AS count FROM documents').get() as { count: number }).count;
    expect(expected).toBeGreaterThan(0);
    const receipt = await create();
    expect(receipt.documents).toBe(expected);
    await restore(receipt.path);
    const recovered = new Database(path.join(root, 'restored/meridian.db'), { readonly: true });
    try {
      expect(recovered.prepare('SELECT COUNT(*) AS count FROM documents').get()).toEqual({ count: expected });
      expect(recovered.pragma('foreign_key_check')).toEqual([]);
    } finally { recovered.close(); }
  });

  it('restores committed WAL rows and exact referenced files without exposing plaintext in the bundle', async () => {
    db.prepare('INSERT INTO organizations VALUES (?)').run('wal_only_tenant');
    fs.writeFileSync(path.join(uploads, 'unreferenced.txt'), 'do not copy');
    const receipt = await create();
    expect(receipt).toMatchObject({ documents: 1, storage: 'local', offsiteActive: false });
    expect(fs.readdirSync(receipt.path).sort()).toEqual(['manifest.enc', 'object-000000.enc', 'object-000001.enc']);
    for (const name of fs.readdirSync(receipt.path)) {
      const file = path.join(receipt.path, name);
      expect(fs.statSync(file).mode & 0o077).toBe(0);
      const bytes = fs.readFileSync(file);
      expect(bytes.includes(Buffer.from('synthetic evidence'))).toBe(false);
      expect(bytes.includes(Buffer.from('tenant_a'))).toBe(false);
    }
    await restore(receipt.path);
    const recovered = new Database(path.join(root, 'restored/meridian.db'), { readonly: true });
    try { expect(recovered.prepare('SELECT id FROM organizations WHERE id=?').get('wal_only_tenant')).toEqual({ id: 'wal_only_tenant' }); }
    finally { recovered.close(); }
    expect(fs.readFileSync(path.join(root, 'restored/uploads/tenant_a/evidence.pdf'), 'utf8')).toBe('synthetic evidence');
    expect(fs.existsSync(path.join(root, 'restored/uploads/unreferenced.txt'))).toBe(false);
  });

  it('supports zero-byte documents and no-document workspaces', async () => {
    fs.writeFileSync(path.join(uploads, 'tenant_a/evidence.pdf'), '');
    db.exec('UPDATE documents SET size_bytes=0');
    const receipt = await create();
    await restore(receipt.path);
    expect(fs.statSync(path.join(root, 'restored/uploads/tenant_a/evidence.pdf')).size).toBe(0);
    db.exec('DELETE FROM documents');
    const empty = await create();
    expect((await verifyBackup({ bundleDir: empty.path, encryptionKey: key })).documents).toBe(0);
  });

  it.each(['wrong key', 'tampered manifest', 'tampered upload', 'missing upload', 'swapped objects'])('rejects %s and leaves no partial restore', async (fault) => {
    const receipt = await create();
    let restoreKey = key;
    if (fault === 'wrong key') restoreKey = crypto.randomBytes(32).toString('hex');
    else if (fault === 'missing upload') fs.unlinkSync(path.join(receipt.path, 'object-000001.enc'));
    else if (fault === 'swapped objects') fs.copyFileSync(path.join(receipt.path, 'object-000000.enc'), path.join(receipt.path, 'object-000001.enc'));
    else {
      const file = path.join(receipt.path, fault === 'tampered manifest' ? 'manifest.enc' : 'object-000001.enc');
      const bytes = fs.readFileSync(file); bytes[18] = bytes[18]! ^ 1; fs.writeFileSync(file, bytes);
    }
    await expect(restore(receipt.path, restoreKey)).rejects.toThrow();
    expect(fs.existsSync(path.join(root, 'restored'))).toBe(false);
    expect(fs.readdirSync(root).filter((name) => name.startsWith('.restoring-'))).toEqual([]);
  });

  it.each(['traversal', 'tenant mismatch', 'grant mismatch', 'missing file', 'size mismatch', 'symlink file', 'symlink parent'])('aborts %s before publishing any bundle', async (fault) => {
    if (fault === 'traversal') db.exec("UPDATE documents SET storage_key='../outside'");
    else if (fault === 'tenant mismatch') db.exec("UPDATE documents SET storage_key='tenant_b/evidence.pdf'");
    else if (fault === 'grant mismatch') db.exec("UPDATE documents SET grant_id='grant_b'");
    else if (fault === 'missing file') fs.unlinkSync(path.join(uploads, 'tenant_a/evidence.pdf'));
    else if (fault === 'size mismatch') db.exec('UPDATE documents SET size_bytes=19');
    else if (fault === 'symlink file') {
      fs.renameSync(path.join(uploads, 'tenant_a/evidence.pdf'), path.join(root, 'outside.pdf'));
      fs.symlinkSync(path.join(root, 'outside.pdf'), path.join(uploads, 'tenant_a/evidence.pdf'));
    } else {
      fs.renameSync(path.join(uploads, 'tenant_a'), path.join(root, 'outside'));
      fs.symlinkSync(path.join(root, 'outside'), path.join(uploads, 'tenant_a'));
    }
    await expect(create()).rejects.toThrow();
    expect(fs.readdirSync(destination)).toEqual([]);
  });

  it('never overwrites an existing restore directory or follows a symlink destination', async () => {
    const receipt = await create();
    fs.mkdirSync(path.join(root, 'restored'));
    fs.writeFileSync(path.join(root, 'restored/keep.txt'), 'keep');
    await expect(restore(receipt.path)).rejects.toThrow('must not already exist');
    expect(fs.readFileSync(path.join(root, 'restored/keep.txt'), 'utf8')).toBe('keep');
    fs.symlinkSync(destination, path.join(root, 'linked-backups'));
    await expect(createBackup({ db, uploadsDir: uploads, destinationDir: path.join(root, 'linked-backups'), encryptionKey: key })).rejects.toThrow('symlinks');
  });

  it('authenticates object identity even when encrypted upload objects have equal sizes', async () => {
    fs.writeFileSync(path.join(uploads, 'tenant_a/evidence2.pdf'), 'synthetic evidence');
    db.exec("INSERT INTO documents VALUES ('document_b','tenant_a','grant_a','tenant_a/evidence2.pdf',18)");
    const receipt = await create();
    const a = path.join(receipt.path, 'object-000001.enc');
    const b = path.join(receipt.path, 'object-000002.enc');
    const aBytes = fs.readFileSync(a); const bBytes = fs.readFileSync(b);
    fs.writeFileSync(a, bBytes); fs.writeFileSync(b, aBytes);
    await expect(restore(receipt.path)).rejects.toThrow();
    expect(fs.existsSync(path.join(root, 'restored'))).toBe(false);
  });

  it('rejects a foreign-key-invalid database before publishing a bundle', async () => {
    db.pragma('foreign_keys = OFF');
    db.exec("UPDATE documents SET org_id='nonexistent'");
    await expect(create()).rejects.toThrow('foreign-key');
    expect(fs.readdirSync(destination)).toEqual([]);
  });

  it('fails closed for absent keys, weak keys, public directories and unapproved implicit paths', async () => {
    expect(await runBackupFromEnvironment(db, uploads, {})).toBeNull();
    await expect(runBackupFromEnvironment(db, uploads, { BACKUP_ENABLED: 'true' })).rejects.toThrow('BACKUP_DIR');
    await expect(createBackup({ db, uploadsDir: uploads, destinationDir: destination, encryptionKey: 'a'.repeat(64) })).rejects.toThrow('32-byte');
    fs.mkdirSync(destination, { mode: 0o755 });
    await expect(create()).rejects.toThrow('0700');
    await expect(createBackup({ db, uploadsDir: uploads, destinationDir: path.join(uploads, 'backups'), encryptionKey: key })).rejects.toThrow('inside uploads');
  });

  it('prunes only authenticated old bundles after a complete current restore drill', async () => {
    const old = await create(new Date('2026-09-01T00:00:00.000Z'));
    const current = await create(new Date('2026-10-25T00:00:00.000Z'));
    const unrelated = path.join(destination, 'keep-me'); fs.mkdirSync(unrelated);
    const invalid = path.join(destination, old.backupId.replace('2026-09-01', '2026-08-01')); fs.mkdirSync(invalid);
    const options = { destinationDir: destination, encryptionKey: key, retainDays: 14, keepBackupId: current.backupId, now: new Date('2026-10-25') };
    const object = path.join(current.path, 'object-000001.enc');
    const bytes = fs.readFileSync(object); fs.unlinkSync(object);
    await expect(pruneBackups(options)).rejects.toThrow();
    expect(fs.existsSync(old.path)).toBe(true);
    fs.writeFileSync(object, bytes);
    expect(await pruneBackups(options)).toBe(1);
    expect(fs.existsSync(old.path)).toBe(false);
    expect(fs.existsSync(current.path)).toBe(true);
    expect(fs.existsSync(unrelated)).toBe(true);
    expect(fs.existsSync(invalid)).toBe(true);
  });

  it('performs an explicit local backup, restore verification and bounded retention from environment', async () => {
    const receipt = await runBackupFromEnvironment(db, uploads, { BACKUP_ENABLED: 'true', BACKUP_DIR: destination, BACKUP_ENCRYPTION_KEY: key, BACKUP_RETAIN_DAYS: '14' });
    expect(receipt?.offsiteActive).toBe(false);
    await expect(runBackupFromEnvironment(db, uploads, { BACKUP_ENABLED: 'true', BACKUP_DIR: destination, BACKUP_ENCRYPTION_KEY: key, BACKUP_RETAIN_DAYS: '0' })).rejects.toThrow('retention');
  });
});
