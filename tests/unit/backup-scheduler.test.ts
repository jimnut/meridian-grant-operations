import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { Db } from '../../server/db/connection';
import * as backups from '../../server/lib/backups';
import * as s3 from '../../server/lib/backup-s3';
import { startBackupScheduler, type BackupSchedulerStop } from '../../server/lib/backup-scheduler';

let root: string;
let env: NodeJS.ProcessEnv;
let stops: BackupSchedulerStop[];
let calls: MockInstance<typeof backups.runBackupFromEnvironment>;
let offsiteUpload: MockInstance<typeof s3.uploadAndVerifyS3Backup>;
let remoteProofs: Set<string>;
const proofKey = (backupId: string, key: string, destination: s3.BackupS3Configuration) => JSON.stringify([backupId, key, destination]);
const db = {} as Db;
const receiptFile = () => path.join(root, 'backups/.last-verified-backup.json');

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-backup-scheduler-'));
  env = { BACKUP_ENABLED: 'true', BACKUP_DIR: path.join(root, 'backups'), BACKUP_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex') };
  stops = [];
  vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-10-25T01:00:00Z'));
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  calls = vi.spyOn(backups, 'runBackupFromEnvironment').mockImplementation(async () => {
    const createdAt = new Date().toISOString();
    const backupId = `gc-${createdAt.replace(/[:.]/g, '-')}-${crypto.randomUUID()}.gcb`;
    const bundle = path.join(env.BACKUP_DIR!, backupId);
    await fsp.mkdir(bundle);
    return { backupId, path: bundle, documents: 1, createdAt, storage: 'local', offsiteActive: false };
  });
  remoteProofs = new Set();
  vi.spyOn(s3, 'hasVerifiedS3Receipt').mockImplementation(async (options) => remoteProofs.has(proofKey(options.backupId, options.encryptionKey, options.destination)));
  offsiteUpload = vi.spyOn(s3, 'uploadAndVerifyS3Backup').mockImplementation(async (options) => {
    const backupId = path.basename(options.bundleDir);
    remoteProofs.add(proofKey(backupId, options.encryptionKey, options.destination));
    return { backupId, provider: 'aws-s3', region: 'eu-central-1', independentOffsite: true, remoteReadbackVerified: true,
      verifiedAt: new Date().toISOString(), remoteRetentionManaged: false };
  });
});
afterEach(async () => {
  stops.forEach((stop) => stop());
  await Promise.all(stops.map((stop) => stop.whenIdle()));
  vi.useRealTimers(); vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});
function start() { const stop = startBackupScheduler(db, path.join(root, 'uploads'), env); stops.push(stop); return stop; }
async function advance(stop: BackupSchedulerStop, milliseconds: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(milliseconds); await stop.whenIdle();
}

describe('daily local backup scheduler', () => {
  it('creates no timers unless enabled and rejects incomplete configuration synchronously', () => {
    const stop = startBackupScheduler(db, root, {}); stop();
    expect(vi.getTimerCount()).toBe(0);
    expect(() => startBackupScheduler(db, root, { BACKUP_ENABLED: 'true' })).toThrow('BACKUP_DIR');
    expect(() => startBackupScheduler(db, root, { ...env, BACKUP_ENCRYPTION_KEY: 'weak' })).toThrow('32-byte');
    expect(() => startBackupScheduler(db, root, { ...env, BACKUP_RETAIN_DAYS: '0' })).toThrow('retention');
    expect(() => startBackupScheduler(db, root, { ...env, BACKUP_S3_ENABLED: 'true' })).toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves local success and retries failed offsite transfer hourly without duplicate daily copies, including restart', async () => {
    Object.assign(env, { BACKUP_S3_ENABLED: 'true', BACKUP_S3_BUCKET: 'synthetic-private-backups', BACKUP_S3_REGION: 'eu-central-1', BACKUP_S3_PREFIX: 'grantconsole/backups/',
      BACKUP_S3_ACCESS_KEY_ID: 'AKIA0000000000000000', BACKUP_S3_SECRET_ACCESS_KEY: 'SyntheticSecret0123456789'.repeat(2) });
    offsiteUpload.mockRejectedValueOnce(new Error('S3 backup attempt deadline exceeded; private service credential or object path'));
    const stop = start(); await advance(stop, 20_000);
    expect(fs.existsSync(receiptFile())).toBe(true);
    expect(calls).toHaveBeenCalledTimes(1); expect(offsiteUpload).toHaveBeenCalledTimes(1);
    const log = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(log).toContain('Local backup is verified'); expect(log).toContain('offsite backup is pending');
    expect(log).not.toContain('private service credential');
    await advance(stop, 60 * 60 * 1000);
    expect(calls).toHaveBeenCalledTimes(1); expect(offsiteUpload).toHaveBeenCalledTimes(2);
    stop(); await stop.whenIdle(); const restarted = start(); await advance(restarted, 20_000);
    await advance(restarted, 60 * 60 * 1000);
    expect(calls).toHaveBeenCalledTimes(1); expect(offsiteUpload).toHaveBeenCalledTimes(2);
    vi.setSystemTime(new Date('2026-10-26T01:00:00Z'));
    await advance(restarted, 60 * 60 * 1000);
    expect(calls).toHaveBeenCalledTimes(2); expect(offsiteUpload).toHaveBeenCalledTimes(3);
  });

  it('requires a new offsite proof for a changed destination while retaining the current verified local copy', async () => {
    Object.assign(env, { BACKUP_S3_ENABLED: 'true', BACKUP_S3_BUCKET: 'synthetic-private-backups', BACKUP_S3_REGION: 'eu-central-1', BACKUP_S3_PREFIX: 'grantconsole/backups/',
      BACKUP_S3_ACCESS_KEY_ID: 'AKIA0000000000000000', BACKUP_S3_SECRET_ACCESS_KEY: 'SyntheticSecret0123456789'.repeat(2) });
    const stop = start(); await advance(stop, 20_000); stop(); await stop.whenIdle();
    env.BACKUP_S3_PREFIX = 'grantconsole/new-prefix/';
    const restarted = start(); await advance(restarted, 20_000);
    expect(calls).toHaveBeenCalledTimes(1); expect(offsiteUpload).toHaveBeenCalledTimes(2);
    expect(offsiteUpload.mock.calls[1]?.[0].destination.prefix).toBe('grantconsole/new-prefix/');
  });

  it('backs up once per UTC day and persists a private atomic receipt that survives restart', async () => {
    const stop = start();
    await advance(stop, 20_000);
    expect(calls).toHaveBeenCalledTimes(1);
    expect(fs.statSync(receiptFile()).mode & 0o077).toBe(0);
    const saved = JSON.parse(fs.readFileSync(receiptFile(), 'utf8'));
    expect(saved).toMatchObject({ storage: 'local', offsiteActive: false });
    expect(fs.readFileSync(receiptFile(), 'utf8')).not.toContain(env.BACKUP_ENCRYPTION_KEY!);
    expect(fs.readdirSync(env.BACKUP_DIR!).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    stop(); await stop.whenIdle(); const restarted = start();
    await advance(restarted, 20_000);
    await advance(restarted, 60 * 60 * 1000);
    expect(calls).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date('2026-10-26T01:00:00Z'));
    await advance(restarted, 60 * 60 * 1000);
    expect(calls).toHaveBeenCalledTimes(2);
  });

  it('prevents in-process overlap while a backup is still running', async () => {
    let release: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const implementation = calls.getMockImplementation()!;
    let entered: () => void = () => undefined;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    calls.mockImplementation(async (...args) => { entered(); await pending; return implementation(...args); });
    const stop = start();
    try {
      await vi.advanceTimersByTimeAsync(20_000); await started;
      await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000);
      expect(calls).toHaveBeenCalledTimes(1);
    } finally { release(); await stop.whenIdle(); }
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it('does not record a failed backup and retries next hour without logging error secrets', async () => {
    calls.mockRejectedValueOnce(new Error(`secret=${env.BACKUP_ENCRYPTION_KEY}; tenant/private.pdf`));
    const stop = start(); await advance(stop, 20_000);
    expect(fs.existsSync(receiptFile())).toBe(false);
    const logs = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logs).not.toContain(env.BACKUP_ENCRYPTION_KEY!); expect(logs).not.toContain('tenant/private');
    await advance(stop, 60 * 60 * 1000);
    expect(calls).toHaveBeenCalledTimes(2);
  });

  it('stops future scheduled work without leaving timers running', async () => {
    const stop = start(); stop();
    await vi.advanceTimersByTimeAsync(48 * 60 * 60 * 1000);
    expect(calls).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });

  it('creates a fresh verified copy after key rotation or loss of the previously recorded bundle', async () => {
    let stop = start(); await advance(stop, 20_000); stop(); await stop.whenIdle();
    env.BACKUP_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
    stop = start(); await advance(stop, 20_000); stop(); await stop.whenIdle();
    const saved = JSON.parse(fs.readFileSync(receiptFile(), 'utf8')) as { backupId: string };
    fs.rmSync(path.join(env.BACKUP_DIR!, saved.backupId), { recursive: true });
    stop = start(); await advance(stop, 20_000);
    expect(calls).toHaveBeenCalledTimes(3);
  });
});
