import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { Db } from '../../server/db/connection';
import * as backups from '../../server/lib/backups';
import { startBackupScheduler } from '../../server/lib/backup-scheduler';

let root: string;
let env: NodeJS.ProcessEnv;
let stops: Array<() => void>;
let calls: MockInstance<typeof backups.runBackupFromEnvironment>;
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
});
afterEach(() => {
  stops.forEach((stop) => stop());
  vi.useRealTimers(); vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});
function start() { const stop = startBackupScheduler(db, path.join(root, 'uploads'), env); stops.push(stop); return stop; }
// Allow real filesystem I/O to complete while scheduler time remains deterministic.
async function waitFor(check: () => boolean): Promise<void> {
  for (let count = 0; count < 1000; count += 1) {
    if (check()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error('Scheduled filesystem work did not complete.');
}
async function success() { await waitFor(() => fs.existsSync(receiptFile()) && vi.mocked(console.info).mock.calls.length > 0); }

describe('daily local backup scheduler', () => {
  it('creates no timers unless enabled and rejects incomplete configuration synchronously', () => {
    const stop = startBackupScheduler(db, root, {}); stop();
    expect(vi.getTimerCount()).toBe(0);
    expect(() => startBackupScheduler(db, root, { BACKUP_ENABLED: 'true' })).toThrow('BACKUP_DIR');
    expect(() => startBackupScheduler(db, root, { ...env, BACKUP_ENCRYPTION_KEY: 'weak' })).toThrow('32-byte');
    expect(() => startBackupScheduler(db, root, { ...env, BACKUP_RETAIN_DAYS: '0' })).toThrow('retention');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('backs up once per UTC day and persists a private atomic receipt that survives restart', async () => {
    const stop = start();
    await vi.advanceTimersByTimeAsync(20_000); await success();
    expect(calls).toHaveBeenCalledTimes(1);
    expect(fs.statSync(receiptFile()).mode & 0o077).toBe(0);
    const saved = JSON.parse(fs.readFileSync(receiptFile(), 'utf8'));
    expect(saved).toMatchObject({ storage: 'local', offsiteActive: false });
    expect(fs.readFileSync(receiptFile(), 'utf8')).not.toContain(env.BACKUP_ENCRYPTION_KEY!);
    expect(fs.readdirSync(env.BACKUP_DIR!).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    stop(); start();
    await vi.advanceTimersByTimeAsync(20_000);
    await new Promise<void>((resolve) => setImmediate(resolve));
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(calls).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date('2026-10-26T01:00:00Z'));
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    await waitFor(() => vi.mocked(console.info).mock.calls.length === 2);
    expect(calls).toHaveBeenCalledTimes(2);
  });

  it('prevents in-process overlap while a backup is still running', async () => {
    let release: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const implementation = calls.getMockImplementation()!;
    calls.mockImplementation(async (...args) => { await pending; return implementation(...args); });
    start(); await vi.advanceTimersByTimeAsync(20_000);
    await waitFor(() => calls.mock.calls.length === 1);
    await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000);
    expect(calls).toHaveBeenCalledTimes(1);
    release(); await success();
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it('does not record a failed backup and retries next hour without logging error secrets', async () => {
    calls.mockRejectedValueOnce(new Error(`secret=${env.BACKUP_ENCRYPTION_KEY}; tenant/private.pdf`));
    start(); await vi.advanceTimersByTimeAsync(20_000);
    await waitFor(() => vi.mocked(console.error).mock.calls.length > 0);
    expect(fs.existsSync(receiptFile())).toBe(false);
    const logs = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logs).not.toContain(env.BACKUP_ENCRYPTION_KEY!); expect(logs).not.toContain('tenant/private');
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000); await success();
    expect(calls).toHaveBeenCalledTimes(2);
  });

  it('stops future scheduled work without leaving timers running', async () => {
    const stop = start(); stop();
    await vi.advanceTimersByTimeAsync(48 * 60 * 60 * 1000);
    expect(calls).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });

  it('creates a fresh verified copy after key rotation or loss of the previously recorded bundle', async () => {
    let stop = start(); await vi.advanceTimersByTimeAsync(20_000); await success(); stop();
    env.BACKUP_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
    stop = start(); await vi.advanceTimersByTimeAsync(20_000);
    await waitFor(() => vi.mocked(console.info).mock.calls.length === 2); stop();
    const saved = JSON.parse(fs.readFileSync(receiptFile(), 'utf8')) as { backupId: string };
    fs.rmSync(path.join(env.BACKUP_DIR!, saved.backupId), { recursive: true });
    start(); await vi.advanceTimersByTimeAsync(20_000);
    await waitFor(() => vi.mocked(console.info).mock.calls.length === 3);
    expect(calls).toHaveBeenCalledTimes(3);
  });
});
