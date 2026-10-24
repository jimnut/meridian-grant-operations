import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import Database from 'better-sqlite3';
import { GetObjectCommand, PutObjectCommand, type GetObjectCommandOutput, type PutObjectCommandOutput } from '@aws-sdk/client-s3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBackup } from '../../server/lib/backups';
import { hasVerifiedS3Receipt, MAX_S3_BACKUP_ATTEMPT_MS, resolveBackupS3Credentials, resolveBackupS3Environment, uploadAndVerifyS3Backup, type BackupS3Client, type BackupS3Configuration } from '../../server/lib/backup-s3';

class MemoryS3 implements BackupS3Client {
  objects = new Map<string, Buffer>();
  requests: Array<PutObjectCommand | GetObjectCommand> = [];
  failPut = '';
  corruptRead = '';
  stallPut = false;
  stallGetBody = false;
  onStallStarted?: (signal?: AbortSignal) => void;
  stalledBody?: Readable;
  send(command: PutObjectCommand, options?: { abortSignal: AbortSignal }): Promise<PutObjectCommandOutput>;
  send(command: GetObjectCommand, options?: { abortSignal: AbortSignal }): Promise<GetObjectCommandOutput>;
  async send(command: PutObjectCommand | GetObjectCommand, options?: { abortSignal: AbortSignal }): Promise<PutObjectCommandOutput & GetObjectCommandOutput> {
    this.requests.push(command);
    const key = command.input.Key!;
    if (command instanceof PutObjectCommand) {
      if (this.stallPut) { this.onStallStarted?.(options?.abortSignal); return new Promise(() => undefined); }
      if (this.failPut && key.endsWith(this.failPut)) throw new Error('Synthetic credential/path detail that must stay out of public errors');
      if (this.objects.has(key)) throw Object.assign(new Error('Already exists'), { $metadata: { httpStatusCode: 412 } });
      const input = command.input.Body;
      let body: Buffer;
      if (Buffer.isBuffer(input)) body = input;
      else {
        const chunks: Buffer[] = [];
        for await (const chunk of input as Readable) chunks.push(Buffer.from(chunk));
        body = Buffer.concat(chunks);
      }
      this.objects.set(key, body);
      return { $metadata: { httpStatusCode: 200 } };
    }
    const stored = this.objects.get(key);
    if (!stored) throw new Error('Missing remote object');
    const body = Buffer.from(stored);
    if (this.corruptRead && key.endsWith(this.corruptRead)) body[body.length - 1] = body[body.length - 1]! ^ 1;
    let responseBody = Readable.from([body]);
    if (this.stallGetBody) {
      let emitted = false; const started = this.onStallStarted;
      responseBody = new Readable({ read() { if (!emitted) { emitted = true; this.push(body); started?.(options?.abortSignal); } } });
      this.stalledBody = responseBody;
    }
    return { Body: responseBody as GetObjectCommandOutput['Body'], ContentLength: body.length,
      ServerSideEncryption: 'AES256', $metadata: { httpStatusCode: 200 } };
  }
}

let root: string;
let db: Database.Database;
let bundle: string;
let encryptionKey: string;
let client: MemoryS3;
const destination: BackupS3Configuration = { bucket: 'synthetic-private-backups', region: 'eu-central-1', prefix: 'grantconsole/backups/', expectedBucketOwner: '123456789012' };
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-s3-test-'));
  const uploads = path.join(root, 'uploads'); fs.mkdirSync(path.join(uploads, 'tenant_a'), { recursive: true });
  fs.writeFileSync(path.join(uploads, 'tenant_a/evidence.pdf'), 'synthetic evidence');
  db = new Database(':memory:');
  db.exec(`CREATE TABLE organizations (id TEXT PRIMARY KEY); CREATE TABLE grants (id TEXT PRIMARY KEY, org_id TEXT REFERENCES organizations(id));
    CREATE TABLE documents (id TEXT PRIMARY KEY, org_id TEXT REFERENCES organizations(id), grant_id TEXT REFERENCES grants(id), storage_key TEXT UNIQUE, size_bytes INTEGER);
    INSERT INTO organizations VALUES ('tenant_a'); INSERT INTO grants VALUES ('grant_a','tenant_a');
    INSERT INTO documents VALUES ('document_a','tenant_a','grant_a','tenant_a/evidence.pdf',18);`);
  encryptionKey = crypto.randomBytes(32).toString('hex');
  bundle = (await createBackup({ db, uploadsDir: uploads, destinationDir: path.join(root, 'backups'), encryptionKey })).path;
  client = new MemoryS3();
});
afterEach(() => { vi.useRealTimers(); db.close(); fs.rmSync(root, { recursive: true, force: true }); });
const run = () => uploadAndVerifyS3Backup({ bundleDir: bundle, encryptionKey, destination, client });

describe('optional private S3 backup readback', () => {
  it.each(['never-settling PUT', 'non-ending GET body'])('aborts %s at the shared deadline and cleans staging without offsite proof', async (stall) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    client.stallPut = stall === 'never-settling PUT'; client.stallGetBody = !client.stallPut;
    let entered: () => void = () => undefined;
    let signal: AbortSignal | undefined;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    client.onStallStarted = (received) => { signal = received; entered(); };
    const before = new Set(fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('grantconsole-s3-check-')));
    const pending = uploadAndVerifyS3Backup({ bundleDir: bundle, encryptionKey, destination, client, attemptTimeoutMs: 1_000 });
    const rejected = expect(pending).rejects.toThrow('S3 backup upload or remote readback verification failed');
    await started;
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000); await rejected;
    expect(signal?.aborted).toBe(true);
    if (client.stallGetBody) expect(client.stalledBody?.destroyed).toBe(true);
    expect(fs.existsSync(path.join(path.dirname(bundle), '.last-verified-offsite.json'))).toBe(false);
    expect(fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('grantconsole-s3-check-') && !before.has(name))).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never accepts an attempt deadline longer than ten minutes', async () => {
    await expect(uploadAndVerifyS3Backup({ bundleDir: bundle, encryptionKey, destination, client,
      attemptTimeoutMs: MAX_S3_BACKUP_ATTEMPT_MS + 1 })).rejects.toThrow('deadline');
    expect(client.requests).toEqual([]);
  });

  it('uploads encrypted objects and marker last, then downloads and fully restores before reporting independent offsite success', async () => {
    const receipt = await run();
    expect(receipt).toMatchObject({ independentOffsite: true, remoteReadbackVerified: true, remoteRetentionManaged: false, region: 'eu-central-1' });
    const puts = client.requests.filter((request) => request instanceof PutObjectCommand);
    expect(puts.map((request) => request.input.Key!.split('/').pop())).toEqual(['object-000000.enc', 'object-000001.enc', 'manifest.enc', 'complete.json']);
    expect(client.requests.filter((request) => request instanceof GetObjectCommand)).toHaveLength(4);
    for (const request of puts) {
      expect(request.input).toMatchObject({ Bucket: destination.bucket, ServerSideEncryption: 'AES256', IfNoneMatch: '*', ExpectedBucketOwner: destination.expectedBucketOwner });
      expect(request.input.ACL).toBeUndefined();
      expect(request.input.Key!.startsWith(`${destination.prefix}${path.basename(bundle)}/`)).toBe(true);
    }
    for (const [key, bytes] of client.objects) {
      if (!key.endsWith('/complete.json')) expect(bytes.subarray(0, 4).toString()).toBe('GCB1');
      expect(bytes.includes(Buffer.from('synthetic evidence'))).toBe(false);
      expect(bytes.includes(Buffer.from(encryptionKey))).toBe(false);
    }
    const persisted = path.join(path.dirname(bundle), '.last-verified-offsite.json');
    expect(fs.statSync(persisted).mode & 0o077).toBe(0);
    expect(fs.readFileSync(persisted, 'utf8')).not.toContain(encryptionKey);
    const lookup = { directory: path.dirname(bundle), backupId: path.basename(bundle), encryptionKey, destination };
    expect(await hasVerifiedS3Receipt(lookup)).toBe(true);
    expect(await hasVerifiedS3Receipt({ ...lookup, encryptionKey: crypto.randomBytes(32).toString('hex') })).toBe(false);
    expect(await hasVerifiedS3Receipt({ ...lookup, destination: { ...destination, prefix: 'grantconsole/changed/' } })).toBe(false);
  });

  it.each(['manifest.enc', 'object-000001.enc', 'complete.json'])('refuses corrupted remote %s without reporting offsite success', async (name) => {
    client.corruptRead = name;
    await expect(run()).rejects.toThrow('remote readback verification failed');
    expect(fs.existsSync(bundle)).toBe(true);
    expect(fs.existsSync(path.join(path.dirname(bundle), '.last-verified-offsite.json'))).toBe(false);
  });

  it('does not write the completion marker when object upload fails and keeps errors generic', async () => {
    client.failPut = 'object-000001.enc';
    await expect(run()).rejects.toThrow(/^S3 backup upload or remote readback verification failed\.$/);
    expect([...client.objects.keys()].some((key) => key.endsWith('/complete.json'))).toBe(false);
  });

  it('can retry a complete existing copy without overwriting it and still requires full readback', async () => {
    await run();
    const stored = new Map(client.objects); client.requests = [];
    await expect(run()).resolves.toMatchObject({ independentOffsite: true });
    expect(client.objects).toEqual(stored);
    expect(client.requests.filter((request) => request instanceof GetObjectCommand)).toHaveLength(4);
  });

  it('rejects unexpected local files before transmitting anything', async () => {
    fs.writeFileSync(path.join(bundle, 'private-note.txt'), 'must not be uploaded');
    await expect(run()).rejects.toThrow('unexpected files');
    expect(client.requests).toEqual([]);
  });

  it.each(['unencrypted payload', 'unreferenced ciphertext'])('rejects an enc-looking extra file containing %s before any upload', async (content) => {
    const bytes = content === 'unencrypted payload'
      ? Buffer.concat([Buffer.from('GCB1'), Buffer.from('PRIVATE UNENCRYPTED SYNTHETIC CONTENT'.repeat(3))])
      : fs.readFileSync(path.join(bundle, 'object-000001.enc'));
    fs.writeFileSync(path.join(bundle, 'object-999999.enc'), bytes);
    await expect(run()).rejects.toThrow('unexpected files');
    expect(client.requests).toEqual([]);
    expect(fs.existsSync(path.join(path.dirname(bundle), '.last-verified-offsite.json'))).toBe(false);
  });

  it('refuses a corrupted local encrypted object before transmitting anything', async () => {
    const file = path.join(bundle, 'object-000001.enc'); const bytes = fs.readFileSync(file);
    bytes[17] = bytes[17]! ^ 1; fs.writeFileSync(file, bytes);
    await expect(run()).rejects.toThrow();
    expect(client.requests).toEqual([]);
  });

  it('requires explicit complete Frankfurt configuration and rejects traversal, endpoints and public ACL options', async () => {
    expect(resolveBackupS3Environment({})).toBeNull();
    expect(() => resolveBackupS3Environment({ BACKUP_S3_ENABLED: 'true' })).toThrow();
    for (const prefix of ['../outside/', '/absolute/', 'one//two/', 'one/./two/', 'one\\two/']) {
      await expect(uploadAndVerifyS3Backup({ bundleDir: bundle, encryptionKey, destination: { ...destination, prefix }, client })).rejects.toThrow();
    }
    await expect(uploadAndVerifyS3Backup({ bundleDir: bundle, encryptionKey, destination: { ...destination, endpoint: 'https://example.org' } as BackupS3Configuration, client })).rejects.toThrow();
    await expect(uploadAndVerifyS3Backup({ bundleDir: bundle, encryptionKey, destination: { ...destination, ACL: 'public-read' } as BackupS3Configuration, client })).rejects.toThrow();
    expect(() => resolveBackupS3Environment({ BACKUP_S3_ENABLED: 'true', BACKUP_S3_BUCKET: destination.bucket, BACKUP_S3_REGION: 'us-east-1', BACKUP_S3_PREFIX: destination.prefix })).toThrow();
    expect(client.requests).toEqual([]);
  });

  it('never falls back to ambient AWS credentials when dedicated credentials are absent or incomplete', async () => {
    await expect(uploadAndVerifyS3Backup({ bundleDir: bundle, encryptionKey, destination })).rejects.toThrow('dedicated S3 backup credentials');
    expect(() => resolveBackupS3Credentials({ BACKUP_S3_ENABLED: 'true', BACKUP_S3_ACCESS_KEY_ID: 'AKIA0000000000000000',
      AWS_SECRET_ACCESS_KEY: 'UnrelatedAmbientSecret0123456789'.repeat(2) })).toThrow('dedicated S3 backup credentials');
    expect(resolveBackupS3Credentials({ AWS_ACCESS_KEY_ID: 'AKIA0000000000000000', AWS_SECRET_ACCESS_KEY: 'UnrelatedAmbientSecret0123456789'.repeat(2) })).toBeNull();
  });
});
