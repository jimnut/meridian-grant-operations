# Backup and recovery runbook

## Current scope and activation gate

The application has an opt-in, database-aware encrypted **local** backup tool and daily scheduler wired in `server/index.ts`. Scheduling remains disabled unless the operator explicitly configures `BACKUP_ENABLED=true`, an approved private destination and a separate encryption key. Activating same-disk encrypted copies does not enable an offsite destination, external monitoring, or a production recovery guarantee. Every success receipt says `storage: "local"` and `offsiteActive: false`. An encrypted bundle on the same Render disk shares its failure domain; it does not protect against loss of that disk or provider account.

Before production activation, the operator must choose and approve a private offsite destination and its location, provider DPA, access permissions, international-transfer position, retention and deletion policy, budget, key custody and monitoring. No provider account or storage has been provisioned by this implementation. Do not send backups to a public bucket, consumer mailbox, source repository or analytics provider. Approve the destination before exporting real customer data. Keep the encryption key in a separate operator-controlled secret manager and recovery location, separate from both the backup and the application disk. Losing the key makes bundles unrecoverable. Restrict recovery access to approved operators; access is a customer-data disclosure.

Render's infrastructure snapshots and their current account-specific settings remain separate from this tool. Confirm their actual retention, location and recovery procedure in the provider account before making customer commitments. A successful synthetic restore is evidence that the code works on that fixture, not evidence of a successful production recovery or offsite protection.

## Configuration

Use the installed Node 20–24 runtime and the application's existing deployment environment. The built CLI is `dist/server/db/cli-backup.js`; locally use `node node_modules/tsx/dist/cli.mjs server/db/cli-backup.ts`.

- `DATA_DIR`: the existing application data directory (Render deployment currently uses `/var/data`). The tool reads its `meridian.db` and `uploads` directory.
- `BACKUP_ENABLED=true`: explicit opt-in for creation. Disabled unless exactly `true`.
- `BACKUP_DIR`: explicit absolute path to an approved private local destination, outside uploads. Directory must have owner-only permissions (`0700`). Files are `0600`.
- `BACKUP_ENCRYPTION_KEY`: a separate random 32-byte key encoded as 64 hexadecimal characters. Generate with `openssl rand -hex 32` directly into the approved secret-management process. Do not reuse `SESSION_SECRET`, MFA encryption keys or passwords. Never pass the key as a CLI argument, paste it into tickets, or print it to logs.
- `BACKUP_RETAIN_DAYS`: integer 1–90, default 14. Approve the chosen window in the customer DPA and retention policy; the code's default is not a contractual promise. No retention deletion occurs until a current complete bundle has passed a full isolated restore drill. Bundles encrypted under an older key are skipped and need a separate approved rotation/retention process.

No automatic export, cloud credentials, remote storage adapter or network request is part of this tool. `startBackupScheduler(db, uploadsDir, env)` is called from `server/index.ts`: it validates complete opt-in configuration synchronously, checks 20 seconds after startup and hourly thereafter when enabled, and makes at most one successfully verified local copy per UTC calendar day. Its in-process busy guard prevents the hourly ticker from overlapping an unfinished backup. Failure records no success and retries at the next hourly check; generic logs omit nested filesystem errors and secrets. Stopping cancels future ticks but lets any already-running backup finish its cleanup.

The private atomic `.last-verified-backup.json` receipt in `BACKUP_DIR` prevents repeated daily full copies after application restarts. It records the verified backup identifier, completion timestamp, a SHA-256 fingerprint of the random backup key (never the key), and explicit local/offsite-inactive status. A different key or missing bundle causes a new backup. This receipt is trusted local operator state in the private directory; it is not a signed customer assurance or independent offsite evidence. Corrupt or overly permissive receipts fail closed and need operator review. No distributed lock is implemented. Run only one scheduler process on the disk; the deployment must stop the old disk-attached instance before starting its replacement. Multiple application replicas, manual overlapping operators or shared filesystems require a separate approved coordination mechanism.

Operating the opt-in production schedule still requires storage-capacity monitoring and delivery of failure alerts to a monitored operator channel. Alert messages should include a job identifier and coarse status, never paths with tenant identifiers, secrets or customer content. Operators must verify a completed receipt rather than infer success from a scheduler invocation. Validate the end-to-end offsite process and restore its downloaded copy before calling offsite backup active.

## Create and verify

With secrets supplied by the environment and configuration approved:

```sh
node dist/server/db/cli-backup.js create
```

Creation opens an existing database without migrations, uses SQLite's online backup API (including committed WAL records), verifies database integrity and foreign keys, validates each document's organization/grant relationship and tenant storage prefix, and encrypts the SQLite snapshot plus exactly the evidence files referenced by that snapshot. Unreferenced uploads are excluded. Uploads are immutable in the application; concurrent removal or a size mismatch fails the entire attempt so the job can retry. No inconsistent partial bundle is published. Current application data is not changed.

Output is an atomically renamed `gc-<UTC-time>-<random-UUID>.gcb` directory. Its manifest and opaque numbered objects are encrypted with AES-256-GCM, distinct random nonces and authenticated object identities. Authenticated manifest entries include original file size, SHA-256 digest, document identifier, tenant and storage key. No tar/zip extraction runs and no customer-controlled path is accepted without strict tenant validation. Symlink components and non-regular source objects are refused. The private temporary SQLite snapshot and isolated restore plaintext are deleted after success or failure; the host's encrypted temporary storage and operator access controls remain part of the deployment threat model.

The `create` CLI performs a complete isolated restore drill before retention pruning and reporting `restoreVerified: true`. Check its exit status and JSON receipt. A failed invocation produces a generic error and nonzero exit status. A bundle might still exist if a later verification or retention step fails; treat that run as failed until independently verified.

To verify a particular bundle without retaining its plaintext restoration:

```sh
node dist/server/db/cli-backup.js verify /approved/private/path/gc-TIMESTAMP-UUID.gcb
```

Verification authenticates every encrypted object, compares plaintext hashes and sizes, runs SQLite integrity and foreign-key checks, and compares database evidence references with the authenticated manifest. A wrong key, truncated or tampered object, missing evidence, cross-tenant path, duplicate object or inconsistent manifest fails closed. The bundle directory name is authenticated and must not be changed.

## Isolated recovery drill

Choose a **new, nonexistent** directory away from the live application's `DATA_DIR`. Never overwrite the running application or restore directly onto its mounted production directory.

```sh
node dist/server/db/cli-backup.js restore /approved/private/path/gc-TIMESTAMP-UUID.gcb /approved/private/recovery-drill
```

The CLI reserves the destination, decrypts only into private staging, verifies the whole bundle and database, and publishes `meridian.db` plus `uploads/` only on success. Existing destinations and symlinks are refused. A failed restore removes its partial plaintext. The restored database includes all tenants and authentication records, so restrict access even for a drill. Full-disk capacity must cover the live data, encrypted backup and temporary restored copy simultaneously; this streaming implementation does not load upload files into RAM but SQLite integrity checks and disk space still need capacity planning.

Before creating a snapshot or encrypted bundle, creation checks available filesystem capacity from SQLite page accounting and the current referenced upload sizes. It budgets encrypted output (including a conservative manifest allowance), the temporary full restored copy needed for verification, and a fixed 128 MiB free-space reserve. When destination and temporary storage share a filesystem their requirements are combined. Insufficient capacity fails before snapshotting and leaves existing published backups intact. This is a conservative preflight, not a disk reservation: concurrent writes and retained old bundles still require monitoring. Retention deliberately runs only after the new copy verifies; the tool does not delete good old backups to force a failing new backup to fit.

After restoration, use an isolated instance with outbound email, payments, analytics, scheduled jobs and public ingress disabled. Check representative tenant-owned grants and evidence downloads under each expected role. Review any schema migration against the restored database on the isolated instance. Record the backup timestamp, verification time, runtime version, result, operator and elapsed recovery time in the approved operational log without copying customer content. Remove drill plaintext under the approved retention process afterwards.

## Live incident recovery

The code does not automatically replace production data. The operator must first stop application writes, preserve the failed state, select the latest fully verified bundle, restore to isolation, and account for deletions or withdrawals received since the backup. Reapply approved deletions before returning restored records to service; a historical backup can otherwise resurrect deleted personal data. Rotate/revoke sessions and security tokens as appropriate after a rollback, verify the active MFA encryption key can decrypt restored MFA secrets, then approve the cutover and rollback plan. The infrastructure access, key and offsite copy must be available independently of the failed application account.

Only establish recovery-point and recovery-time commitments after a monitored production schedule, independent offsite copy, documented key recovery and timed restore exercise all succeed. Describe remaining gaps candidly in customer security replies.
