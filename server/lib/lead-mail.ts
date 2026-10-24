import crypto from 'node:crypto';

import { config } from '../config';
import type { Db } from '../db/connection';
import { mailerConfigured, renderHtml, sendMail, type MailMessage, type MailResult } from './mailer';

const MINUTE = 60_000;
export const LEAD_MAIL_LEASE_MS = MINUTE;
// Resend retains idempotency keys for 24h. Stop ambiguous retries early for clock skew.
export const LEAD_MAIL_SAFE_RETRY_MS = 23 * 60 * MINUTE;

interface Lead {
  id: string; email: string; name?: string | null; organization?: string | null;
  message?: string | null; source: string;
}
interface Job {
  id: string; lead_id: string; kind: string; recipient: string; envelope: string; status: string;
  attempts: number; attempt_started_at: number | null; ambiguous_since: number | null;
  lease_token: string | null; lease_until: number | null;
}

/** Configured holds are persisted before any job can be claimed; removing env never releases a hold. */
export function seedLeadReplyHolds(db: Db, now = Date.now()): void {
  const insert = db.prepare('INSERT OR IGNORE INTO lead_reply_holds (email, reason, created_at) VALUES (?, ?, ?)');
  for (const email of config.leadReplyHoldEmails) insert.run(email, 'explicit_operator_hold', now);
}

/** Called inside the same transaction that accepts the lead. Never backfill historical rows. */
export function enqueueLeadMail(db: Db, lead: Lead, now = Date.now()): void {
  seedLeadReplyHolds(db, now);
  const greeting = `Thanks for reaching out${lead.name ? `, ${lead.name}` : ''}.`;
  const paragraphs = [greeting,
    'This automatic acknowledgement confirms that we received your enquiry. It does not mean your questions have already been answered.',
    'GrantConsole helps nonprofit teams manage awarded grants, deadlines, restricted budgets, evidence and reports. You can explore the demo using example records while your enquiry is reviewed.',
    'If you have not already included them, reply with the number of grants you manage, your main workflow question and any required security or data-location requirements. Please do not email sensitive grant records.',
  ];
  const messages: Array<{ kind: string; message: MailMessage }> = [
    { kind: 'acknowledgement', message: {
      to: lead.email, subject: 'We received your message — GrantConsole',
      text: `${paragraphs.join('\n\n')}\n\nExplore the demo: ${config.siteUrl}/signin`,
      html: renderHtml('We received your message', paragraphs, { label: 'Explore the demo', url: `${config.siteUrl}/signin` }),
    } },
    { kind: 'owner_notification', message: {
      to: config.leadNotificationEmail,
      subject: `New ${lead.source} lead: ${lead.organization ?? lead.email}`,
      text: [`Email: ${lead.email}`, `Name: ${lead.name ?? '—'}`, `Organization: ${lead.organization ?? '—'}`,
        `Source: ${lead.source}`, `Lead ID: ${lead.id}`, '', lead.message ?? '(no message)', '',
        'The visitor acknowledgement is automatic. Review the enquiry and provide a substantive reply; do not treat an acknowledgement as an answered question.'].join('\n'),
    } },
  ];
  const insert = db.prepare(`INSERT OR IGNORE INTO lead_mail_outbox
    (id, lead_id, kind, recipient, envelope, next_attempt_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  for (const { kind, message } of messages) {
    const id = `lead-mail/${lead.id}/${kind}`;
    const envelope: MailMessage = { ...message, from: config.emailFrom, replyTo: config.emailReplyTo, idempotencyKey: id };
    insert.run(id, lead.id, kind, message.to.toLowerCase(), JSON.stringify(envelope), now, now);
  }
}

function claim(db: Db, now: number): Job | null {
  return db.transaction(() => {
    db.prepare(`UPDATE lead_mail_outbox SET status = 'cancelled', lease_token = NULL, lease_until = NULL,
      last_error = 'lead_not_eligible' WHERE (status IN ('pending','held') OR (status = 'sending' AND lease_until <= ?)) AND lead_id IN
      (SELECT id FROM leads WHERE quality_status IN ('flagged','spam','internal_test'))`).run(now);
    db.prepare(`UPDATE lead_mail_outbox SET status = 'held', lease_token = NULL, lease_until = NULL,
      last_error = 'recipient_hold' WHERE (status = 'pending' OR (status = 'sending' AND lease_until <= ?))
      AND recipient COLLATE NOCASE IN (SELECT email FROM lead_reply_holds)`).run(now);
    const pause = db.prepare('SELECT blocked_until FROM lead_mail_provider_state WHERE id = 1').get() as { blocked_until: number } | undefined;
    if (pause && pause.blocked_until > now) return null;
    // A crashed process might have sent its last request. Never retry beyond provider deduplication retention.
    db.prepare(`UPDATE lead_mail_outbox SET status = 'uncertain', last_error = 'idempotency_window_expired',
      lease_token = NULL, lease_until = NULL WHERE
      (status = 'pending' AND ambiguous_since IS NOT NULL AND ambiguous_since <= @cutoff)
      OR (status = 'sending' AND lease_until <= @now AND COALESCE(ambiguous_since, attempt_started_at) <= @cutoff)`)
      .run({ cutoff: now - LEAD_MAIL_SAFE_RETRY_MS, now });
    const job = db.prepare(`SELECT * FROM lead_mail_outbox WHERE
      (status = 'pending' AND next_attempt_at <= @now) OR (status = 'sending' AND lease_until <= @now)
      ORDER BY CASE kind WHEN 'acknowledgement' THEN 0 ELSE 1 END, created_at, id LIMIT 1`).get({ now }) as Job | undefined;
    if (!job) return null;
    const token = crypto.randomUUID();
    const ambiguous = job.ambiguous_since ?? (job.status === 'sending' ? job.attempt_started_at : null);
    db.prepare(`UPDATE lead_mail_outbox SET status = 'sending', attempts = attempts + 1,
      attempt_started_at = ?, ambiguous_since = ?, lease_token = ?, lease_until = ? WHERE id = ?`)
      .run(now, ambiguous, token, now + LEAD_MAIL_LEASE_MS, job.id);
    return { ...job, attempts: job.attempts + 1, attempt_started_at: now, ambiguous_since: ambiguous, lease_token: token };
  }).immediate();
}

export function leadMailRetryDelay(result: MailResult, attempts: number, now: number): number {
  const backoff = Math.min(6 * 60 * MINUTE, MINUTE * 2 ** Math.min(attempts - 1, 9));
  if (result.errorCode === 'daily_quota_exceeded') {
    const date = new Date(now);
    return Math.max(MINUTE, Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1) + MINUTE - now,
      result.retryAfterMs ?? 0);
  }
  if (result.errorCode === 'monthly_quota_exceeded') return Math.max(24 * 60 * MINUTE, result.retryAfterMs ?? 0);
  if (result.statusCode === 401 || result.statusCode === 403) return Math.max(60 * MINUTE, result.retryAfterMs ?? 0);
  return Math.max(backoff, result.retryAfterMs ?? 0);
}

const running = new WeakMap<Db, Promise<number>>();

/** Claims are shared through SQLite, so independent handles/processes cannot claim the same job. */
export function dispatchLeadMail(db: Db, at?: number): Promise<number> {
  const existing = running.get(db);
  if (existing) return existing;
  const clock = () => at ?? Date.now();
  const pass = (async () => {
    if (!mailerConfigured()) return 0;
    seedLeadReplyHolds(db, clock());
    let accepted = 0;
    for (let i = 0; i < 10; i += 1) {
      const job = claim(db, clock());
      if (!job) break;
      const result = await sendMail(JSON.parse(job.envelope) as MailMessage);
      const now = clock();
      db.transaction(() => {
        // A stale worker must not overwrite a newer lease or a newly applied hold.
        const owned = db.prepare("SELECT 1 FROM lead_mail_outbox WHERE id = ? AND lease_token = ? AND status = 'sending'")
          .get(job.id, job.lease_token);
        if (!owned) return;
        if (result.sent) {
          db.prepare(`UPDATE lead_mail_outbox SET status = 'sent', provider_id = ?, sent_at = ?, last_error = NULL,
            lease_token = NULL, lease_until = NULL WHERE id = ? AND lease_token = ?`)
            .run(result.id ?? null, now, job.id, job.lease_token);
          accepted += 1;
          return;
        }
        const retryable = result.retryable !== false;
        const delay = leadMailRetryDelay(result, job.attempts, now);
        const reason = result.errorCode ?? 'transport_unavailable';
        db.prepare(`UPDATE lead_mail_outbox SET status = ?, next_attempt_at = ?, last_error = ?,
          ambiguous_since = ?, lease_token = NULL, lease_until = NULL WHERE id = ? AND lease_token = ?`)
          .run(retryable ? 'pending' : 'failed', now + delay, reason,
            job.ambiguous_since ?? (result.ambiguous ? job.attempt_started_at : null), job.id, job.lease_token);
        if (result.statusCode === 429 || result.statusCode === 401 || result.statusCode === 403) {
          db.prepare(`INSERT INTO lead_mail_provider_state (id, blocked_until, reason) VALUES (1, ?, ?)
            ON CONFLICT(id) DO UPDATE SET blocked_until = MAX(blocked_until, excluded.blocked_until), reason = excluded.reason`)
            .run(now + delay, reason);
        }
        console.warn('[lead-mail] queued delivery not accepted', { id: job.id, code: reason, retryable });
      }).immediate();
    }
    return accepted;
  })().catch(() => { console.error('[lead-mail] worker pass failed; durable jobs retained'); return 0; });
  running.set(db, pass);
  void pass.finally(() => { if (running.get(db) === pass) running.delete(db); });
  return pass;
}

/** Runs in the hosted Node process; no desktop app or external AI service is required. */
export function startLeadMailWorker(db: Db, intervalMs = 30_000): () => void {
  seedLeadReplyHolds(db);
  const tick = () => { void dispatchLeadMail(db); };
  const timer = setInterval(tick, intervalMs);
  const kickoff = setTimeout(tick, 1000);
  timer.unref(); kickoff.unref();
  return () => { clearInterval(timer); clearTimeout(kickoff); };
}
