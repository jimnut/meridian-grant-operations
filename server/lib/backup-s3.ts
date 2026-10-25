/** Optional private Frankfurt S3 copy of already-encrypted recovery bundles. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { GetObjectCommand, PutObjectCommand, S3Client, type GetObjectCommandOutput, type PutObjectCommandOutput } from '@aws-sdk/client-s3';
import { z } from 'zod';
import { authenticatedBackupObjectNames, BACKUP_FREE_SPACE_RESERVE_BYTES, prepareBackupDestination, verifyBackup } from './backups';

const bundleName = /^gc-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f-]{36}\.gcb$/;
const objectName = /^(manifest\.enc|object-\d{6}\.enc)$/;
const configuration = z.object({
  bucket: z.string().min(3).max(63).regex(/^[a-z0-9][a-z0-9-]+[a-z0-9]$/),
  region: z.literal('eu-central-1'),
  prefix: z.string().min(3).max(200).regex(/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\/?$/).transform((value) => `${value.replace(/\/$/, '')}/`),
  expectedBucketOwner: z.string().regex(/^\d{12}$/).optional(),
}).strict();
export type BackupS3Configuration = z.infer<typeof configuration>;
const credentialsSpec = z.object({ accessKeyId: z.string().min(16).max(128).regex(/^[A-Z0-9]+$/),
  secretAccessKey: z.string().min(32).max(128).regex(/^[A-Za-z0-9/+=]+$/), sessionToken: z.string().min(16).max(4096).regex(/^[^\r\n]+$/).optional() }).strict();
export type BackupS3Credentials = z.infer<typeof credentialsSpec>;
export interface BackupS3Client {
  send(command: PutObjectCommand, options?: { abortSignal: AbortSignal }): Promise<PutObjectCommandOutput>;
  send(command: GetObjectCommand, options?: { abortSignal: AbortSignal }): Promise<GetObjectCommandOutput>;
}
export const MAX_S3_BACKUP_ATTEMPT_MS = 10 * 60 * 1000;
export interface OffsiteBackupReceipt {
  backupId: string;
  provider: 'aws-s3';
  region: 'eu-central-1';
  independentOffsite: true;
  remoteReadbackVerified: true;
  verifiedAt: string;
  /** Remote retention must be configured and independently checked by the operator. */
  remoteRetentionManaged: false;
}
type ObjectEntry = { name: string; bytes: number; sha256: string };
const offsiteReceiptSpec = configuration.extend({ format: z.literal(1), backupId: z.string().regex(bundleName),
  keyId: z.string().regex(/^[a-f0-9]{64}$/), verifiedAt: z.string().datetime(), independentOffsite: z.literal(true), remoteReadbackVerified: z.literal(true) });
const receiptName = '.last-verified-offsite.json';
const keyFingerprint = (key: string) => crypto.createHash('sha256').update(Buffer.from(key, 'hex')).digest('hex');

/** Trusted private operator state. A config or key change requires a fresh remote proof. */
export async function hasVerifiedS3Receipt(options: { directory: string; backupId: string; encryptionKey: string; destination: BackupS3Configuration }): Promise<boolean> {
  const settings = configuration.parse(options.destination);
  const directory = await prepareBackupDestination(options.directory);
  let handle: Awaited<ReturnType<typeof fsp.open>>;
  try { handle = await fsp.open(path.join(directory, receiptName), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 4096 || stat.mode & 0o077) throw new Error('Invalid offsite success receipt.');
    const receipt = offsiteReceiptSpec.parse(JSON.parse(await handle.readFile('utf8')));
    return receipt.backupId === options.backupId && receipt.keyId === keyFingerprint(options.encryptionKey) &&
      receipt.bucket === settings.bucket && receipt.region === settings.region && receipt.prefix === settings.prefix &&
      receipt.expectedBucketOwner === settings.expectedBucketOwner && new Date(receipt.verifiedAt).getTime() <= Date.now();
  } finally { await handle.close(); }
}

async function persistOffsiteReceipt(directory: string, payload: z.infer<typeof offsiteReceiptSpec>): Promise<void> {
  const temporary = path.join(directory, `.offsite-success-${crypto.randomUUID()}.tmp`);
  try {
    const handle = await fsp.open(temporary, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(payload)); await handle.sync(); } finally { await handle.close(); }
    await fsp.rename(temporary, path.join(directory, receiptName));
    const parent = await fsp.open(directory, 'r'); try { await parent.sync(); } finally { await parent.close(); }
  } finally { await fsp.rm(temporary, { force: true }); }
}

export function resolveBackupS3Environment(env: NodeJS.ProcessEnv = process.env): BackupS3Configuration | null {
  if (env.BACKUP_S3_ENABLED !== 'true') return null;
  return configuration.parse({ bucket: env.BACKUP_S3_BUCKET, region: env.BACKUP_S3_REGION, prefix: env.BACKUP_S3_PREFIX,
    expectedBucketOwner: env.BACKUP_S3_EXPECTED_BUCKET_OWNER || undefined });
}

export function resolveBackupS3Credentials(env: NodeJS.ProcessEnv = process.env): BackupS3Credentials | null {
  if (env.BACKUP_S3_ENABLED !== 'true') return null;
  const parsed = credentialsSpec.safeParse({ accessKeyId: env.BACKUP_S3_ACCESS_KEY_ID, secretAccessKey: env.BACKUP_S3_SECRET_ACCESS_KEY,
    sessionToken: env.BACKUP_S3_SESSION_TOKEN || undefined });
  if (!parsed.success) throw new Error('Explicit dedicated S3 backup credentials are required.');
  return parsed.data;
}

async function inspectEncryptedFile(bundle: string, name: string): Promise<ObjectEntry> {
  const input = await fsp.open(path.join(bundle, name), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = await input.stat();
    if (!stat.isFile() || stat.size < 32 || stat.size > 5 * 1024 ** 3) throw new Error('Invalid encrypted S3 source.');
    const header = Buffer.alloc(4); await input.read(header, 0, 4, 0);
    if (!header.equals(Buffer.from('GCB1'))) throw new Error('Only encrypted backup objects may be uploaded.');
    const hash = crypto.createHash('sha256');
    for await (const chunk of input.createReadStream({ start: 0, autoClose: false })) hash.update(chunk);
    return { name, bytes: stat.size, sha256: hash.digest('hex') };
  } finally { await input.close(); }
}

/** Also rejects when a transport ignores abortSignal; late read bodies are destroyed. */
async function withAbort<T>(operation: () => Promise<T>, signal: AbortSignal, disposeLate?: (value: T) => void): Promise<T> {
  signal.throwIfAborted();
  let abort: () => void = () => undefined;
  try {
    return await new Promise<T>((resolve, reject) => {
      abort = () => reject(new Error('S3 backup attempt deadline exceeded.'));
      signal.addEventListener('abort', abort, { once: true });
      Promise.resolve().then(operation).then((value) => {
        if (signal.aborted) { disposeLate?.(value); reject(new Error('S3 backup attempt deadline exceeded.')); }
        else resolve(value);
      }, reject);
    });
  } finally { signal.removeEventListener('abort', abort); }
}

async function put(client: BackupS3Client, settings: BackupS3Configuration, key: string, body: Buffer | Readable, bytes: number, signal: AbortSignal): Promise<void> {
  try {
    await withAbort(() => client.send(new PutObjectCommand({ Bucket: settings.bucket, Key: key, Body: body, ContentLength: bytes,
      ContentType: 'application/octet-stream', ServerSideEncryption: 'AES256', IfNoneMatch: '*', ExpectedBucketOwner: settings.expectedBucketOwner }), { abortSignal: signal }), signal);
  } catch (error) {
    // A retry may encounter an existing partial upload. Never overwrite it; full readback below must validate its bytes.
    if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 412) throw error;
  }
}

async function download(client: BackupS3Client, settings: BackupS3Configuration, key: string, target: string, expected: ObjectEntry, signal: AbortSignal): Promise<void> {
  const result = await withAbort(() => client.send(new GetObjectCommand({ Bucket: settings.bucket, Key: key, ExpectedBucketOwner: settings.expectedBucketOwner }),
    { abortSignal: signal }), signal, (late) => { if (late.Body instanceof Readable) late.Body.destroy(); });
  if (!(result.Body instanceof Readable) || result.ContentLength !== expected.bytes) {
    if (result.Body instanceof Readable) result.Body.destroy();
    throw new Error('S3 readback size or stream mismatch.');
  }
  const hash = crypto.createHash('sha256'); let bytes = 0;
  const inspect = new Transform({ transform(chunk: Buffer, _encoding, done) {
    bytes += chunk.length;
    if (bytes > expected.bytes) { done(new Error('S3 readback exceeded declared size.')); return; }
    hash.update(chunk); done(null, chunk);
  } });
  await pipeline(result.Body, inspect, fs.createWriteStream(target, { flags: 'wx', mode: 0o600 }), { signal });
  if (bytes !== expected.bytes || hash.digest('hex') !== expected.sha256) throw new Error('S3 readback checksum mismatch.');
}

/**
 * Network capability is explicit: callers must first approve the bucket/prefix and credentials.
 * No listing, public ACL, custom endpoint, bucket mutation or remote deletion is performed.
 */
export async function uploadAndVerifyS3Backup(options: {
  bundleDir: string; encryptionKey: string; destination: BackupS3Configuration; credentials?: BackupS3Credentials; client?: BackupS3Client;
  /** Lower bounded deadline for tests/operators; attempts can never exceed the ten-minute maximum. */
  attemptTimeoutMs?: number;
}): Promise<OffsiteBackupReceipt> {
  const attemptTimeoutMs = options.attemptTimeoutMs ?? MAX_S3_BACKUP_ATTEMPT_MS;
  if (!Number.isInteger(attemptTimeoutMs) || attemptTimeoutMs < 1 || attemptTimeoutMs > MAX_S3_BACKUP_ATTEMPT_MS) throw new Error('Invalid S3 backup attempt deadline.');
  const settings = configuration.parse(options.destination);
  const credentials = options.client ? null : credentialsSpec.safeParse(options.credentials);
  if (credentials && !credentials.success) throw new Error('Explicit dedicated S3 backup credentials are required.');
  const backupId = path.basename(options.bundleDir);
  if (!bundleName.test(backupId)) throw new Error('Invalid S3 backup identity.');
  const receiptDirectory = await prepareBackupDestination(path.dirname(options.bundleDir));
  // Do not transmit unverified bundles, unrelated files, or plaintext.
  await verifyBackup({ bundleDir: options.bundleDir, encryptionKey: options.encryptionKey });
  const names = (await fsp.readdir(options.bundleDir)).sort();
  const authenticatedNames = (await authenticatedBackupObjectNames({ bundleDir: options.bundleDir, encryptionKey: options.encryptionKey })).sort();
  if (names.length > 100_002 || names.some((name) => !objectName.test(name)) ||
      JSON.stringify(names) !== JSON.stringify(authenticatedNames)) {
    throw new Error('S3 backup contains unexpected files.');
  }
  const objects: ObjectEntry[] = [];
  for (const name of names) objects.push(await inspectEncryptedFile(options.bundleDir, name));
  // The marker exposes only opaque names, encrypted lengths and encrypted-object hashes.
  const marker = Buffer.from(JSON.stringify({ format: 1, backupId, state: 'uploaded', objects }));
  if (marker.length > 16 * 1024 * 1024) throw new Error('S3 completion marker exceeded limit.');
  const space = await fsp.statfs(os.tmpdir(), { bigint: true });
  const encryptedBytes = objects.reduce((sum, object) => sum + BigInt(object.bytes), 0n);
  if (space.bavail * space.bsize < encryptedBytes * 2n + BigInt(marker.length) + BACKUP_FREE_SPACE_RESERVE_BYTES) {
    throw new Error('Insufficient temporary capacity for S3 readback and restore verification.');
  }
  // Pin the official Frankfurt endpoint so environment endpoint overrides cannot redirect encrypted backups.
  const ownedClient = options.client ? null : new S3Client({ region: settings.region,
    endpoint: 'https://s3.eu-central-1.amazonaws.com', forcePathStyle: false, followRegionRedirects: false,
    credentials: credentials?.success ? credentials.data : undefined,
    requestHandler: { connectionTimeout: 10_000, requestTimeout: 60_000, throwOnRequestTimeout: true } });
  const client = options.client ?? ownedClient!;
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), attemptTimeoutMs); deadline.unref();
  let scratch: string | undefined;
  try {
    scratch = await fsp.mkdtemp(path.join(os.tmpdir(), 'grantconsole-s3-check-'));
    const remoteBase = `${settings.prefix}${backupId}/`;
    // Upload numbered objects before manifest and the completion marker last.
    for (const object of [...objects].sort((a, b) => Number(a.name === 'manifest.enc') - Number(b.name === 'manifest.enc'))) {
      const handle = await fsp.open(path.join(options.bundleDir, object.name), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      const body = handle.createReadStream({ autoClose: false });
      try { await put(client, settings, `${remoteBase}${object.name}`, body, object.bytes, controller.signal); }
      finally { body.destroy(); await handle.close(); }
    }
    await put(client, settings, `${remoteBase}complete.json`, marker, marker.length, controller.signal);
    const markerEntry = { name: 'complete.json', bytes: marker.length, sha256: crypto.createHash('sha256').update(marker).digest('hex') };
    await download(client, settings, `${remoteBase}complete.json`, path.join(scratch, 'complete.json'), markerEntry, controller.signal);
    const downloaded = path.join(scratch, backupId); await fsp.mkdir(downloaded, { mode: 0o700 });
    for (const object of objects) await download(client, settings, `${remoteBase}${object.name}`, path.join(downloaded, object.name), object, controller.signal);
    await verifyBackup({ bundleDir: downloaded, encryptionKey: options.encryptionKey });
    controller.signal.throwIfAborted();
    const verifiedAt = new Date().toISOString();
    await persistOffsiteReceipt(receiptDirectory, offsiteReceiptSpec.parse({ ...settings, format: 1, backupId,
      keyId: keyFingerprint(options.encryptionKey), verifiedAt, independentOffsite: true, remoteReadbackVerified: true }));
    return { backupId, provider: 'aws-s3', region: settings.region, independentOffsite: true, remoteReadbackVerified: true,
      verifiedAt, remoteRetentionManaged: false };
  } catch {
    throw new Error('S3 backup upload or remote readback verification failed.');
  } finally {
    clearTimeout(deadline); controller.abort();
    ownedClient?.destroy();
    if (scratch) await fsp.rm(scratch, { recursive: true, force: true });
  }
}
