import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubEnv('RESEND_API_KEY', '');
  vi.stubEnv('LEAD_REPLY_HOLD_EMAILS', '');
  vi.stubEnv('LEAD_NOTIFICATION_EMAIL', 'team@example.org');
});

import { config } from '../../server/config';
import { migrate, openDatabase, type Db } from '../../server/db/connection';
import { dispatchLeadMail, enqueueLeadMail, LEAD_MAIL_LEASE_MS, LEAD_MAIL_SAFE_RETRY_MS, startLeadMailWorker } from '../../server/lib/lead-mail';
import { setMailTransport, type MailMessage } from '../../server/lib/mailer';
import { createTestContext } from '../helpers/context';
import { loadLeadForm } from '../helpers/lead-form';

const now = Date.parse('2026-10-25T09:00:00Z');
let root: string;
let file: string;
let db: Db;
const handles: Db[] = [];
const stops: Array<() => void> = [];
let messages: MailMessage[];

function connect() { const handle = openDatabase(file); handles.push(handle); return handle; }
function addLead(id = 'lead-synthetic', email = 'visitor@example.org', enqueue = true) {
  const lead = { id, email, name: 'Synthetic Visitor', organization: 'Example Nonprofit', message: 'Can you explain reporting?', source: 'contact' };
  db.transaction(() => {
    db.prepare('INSERT INTO leads (id, email, name, organization, message, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, email, lead.name, lead.organization, lead.message, lead.source, new Date(now).toISOString());
    if (enqueue) enqueueLeadMail(db, lead, now);
  }).immediate();
  return lead;
}
function jobs() {
  return db.prepare('SELECT kind, status, attempts, next_attempt_at, last_error, ambiguous_since FROM lead_mail_outbox ORDER BY kind').all();
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-lead-mail-'));
  file = path.join(root, 'test.sqlite'); db = connect(); messages = [];
  setMailTransport(async (message) => { messages.push(message); return { sent: true, transport: 'custom', id: `synthetic-${messages.length}` }; });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  setMailTransport(null); vi.useRealTimers(); vi.restoreAllMocks();
  handles.splice(0).forEach((handle) => { if (handle.open) handle.close(); });
  fs.rmSync(root, { recursive: true, force: true });
});

describe('durable lead mail', () => {
  it('commits retryable mail with a new public enquiry despite a provider outage', async () => {
    const context = await createTestContext();
    setMailTransport(async () => ({ sent: false, transport: 'custom', errorCode: 'synthetic_outage', retryable: true }));
    try {
      const { token, cookie } = await loadLeadForm(context.app);
      const response = await request(context.app).post('/api/public/leads').set('Cookie', cookie)
        .send({ email: 'synthetic@example.org', message: 'Please explain reporting.', source: 'contact', formToken: token });
      expect(response.status).toBe(201);
      await dispatchLeadMail(context.db);
      expect(context.db.prepare('SELECT COUNT(*) AS n FROM leads').get()).toEqual({ n: 1 });
      expect(context.db.prepare('SELECT kind, status FROM lead_mail_outbox ORDER BY kind').all()).toEqual([
        { kind: 'acknowledgement', status: 'pending' }, { kind: 'owner_notification', status: 'pending' },
      ]);
      expect((await request(context.app).post('/api/public/leads').set('Cookie', cookie)
        .send({ email: 'synthetic@example.org', message: 'Please explain reporting.', source: 'contact', formToken: token })).status).toBe(202);
      expect(context.db.prepare('SELECT COUNT(*) AS n FROM lead_mail_outbox').get()).toEqual({ n: 2 });
    } finally { await context.cleanup(); }
  });

  it('does not backfill historical enquiries when migrating or starting delivery', async () => {
    addLead('historical', 'old@example.org', false);
    migrate(db); migrate(db);
    expect(await dispatchLeadMail(db, now)).toBe(0);
    expect(messages).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM lead_mail_outbox').get()).toEqual({ n: 0 });
  });

  it('retries only the failed envelope with its immutable payload and stable idempotency key', async () => {
    const lead = addLead();
    setMailTransport(async (message) => {
      messages.push(message);
      return message.to === lead.email && messages.filter((item) => item.to === lead.email).length === 1
        ? { sent: false, transport: 'custom', errorCode: 'temporary_error', retryable: true }
        : { sent: true, transport: 'custom', id: 'accepted-synthetic' };
    });
    expect(await dispatchLeadMail(db, now)).toBe(1);
    expect(await dispatchLeadMail(db, now + 59_999)).toBe(0);
    const originalFrom = config.emailFrom;
    try {
      Object.defineProperty(config, 'emailFrom', { value: 'Changed Sender <changed@example.org>' });
      enqueueLeadMail(db, { ...lead, name: 'Changed name', message: 'Changed message' }, now + 60_000);
      expect(await dispatchLeadMail(db, now + 60_000)).toBe(1);
    } finally { Object.defineProperty(config, 'emailFrom', { value: originalFrom }); }
    const acknowledgementAttempts = messages.filter((message) => message.to === lead.email);
    expect(acknowledgementAttempts).toHaveLength(2);
    expect(acknowledgementAttempts[1]).toEqual(acknowledgementAttempts[0]);
    expect(acknowledgementAttempts[0]!.idempotencyKey).toBeTruthy();
    expect(acknowledgementAttempts[0]!.text).toContain('automatic acknowledgement');
    expect(messages.filter((message) => message.to === 'team@example.org')).toHaveLength(1);
    expect(jobs()).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'acknowledgement', status: 'sent', attempts: 2 }),
      expect.objectContaining({ kind: 'owner_notification', status: 'sent', attempts: 1 }),
    ]));
  });

  it('persists a provider quota pause across database restart and resumes after reset', async () => {
    addLead();
    setMailTransport(async (message) => { messages.push(message); return { sent: false, transport: 'custom', statusCode: 429, errorCode: 'daily_quota_exceeded', retryable: true }; });
    expect(await dispatchLeadMail(db, now)).toBe(0);
    expect(messages).toHaveLength(1);
    const pause = db.prepare('SELECT blocked_until FROM lead_mail_provider_state').get() as { blocked_until: number };
    expect(pause.blocked_until).toBe(Date.parse('2026-10-26T00:01:00Z'));
    db.close(); db = connect();
    expect(await dispatchLeadMail(db, pause.blocked_until - 1)).toBe(0);
    expect(messages).toHaveLength(1);
    setMailTransport(async (message) => { messages.push(message); return { sent: true, transport: 'custom', id: 'after-reset' }; });
    expect(await dispatchLeadMail(db, pause.blocked_until)).toBe(2);
    expect(messages).toHaveLength(3);
  });

  it('lets separate database handles work concurrently without claiming the same envelope', async () => {
    addLead();
    const second = connect();
    let release: () => void = () => undefined;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    setMailTransport(async (message) => {
      messages.push(message);
      if (message.to === 'visitor@example.org') await blocked;
      return { sent: true, transport: 'custom', id: 'concurrent-synthetic' };
    });
    const first = dispatchLeadMail(db, now);
    try {
      expect(await dispatchLeadMail(second, now)).toBe(1);
      expect(messages).toHaveLength(2);
      expect(new Set(messages.map((message) => message.idempotencyKey)).size).toBe(2);
    } finally { release(); }
    expect(await first).toBe(1);
    expect(jobs().every((job) => (job as { status: string }).status === 'sent')).toBe(true);
  });

  it('recovers an expired claim after restart using the stored request identity', async () => {
    addLead();
    db.prepare("UPDATE lead_mail_outbox SET status = 'sending', attempts = 1, attempt_started_at = ?, lease_until = ?, lease_token = 'dead-process' WHERE kind = 'acknowledgement'")
      .run(now, now + LEAD_MAIL_LEASE_MS);
    db.close(); db = connect();
    expect(await dispatchLeadMail(db, now + LEAD_MAIL_LEASE_MS - 1)).toBe(1);
    expect(messages.map((message) => message.to)).toEqual(['team@example.org']);
    expect(await dispatchLeadMail(db, now + LEAD_MAIL_LEASE_MS)).toBe(1);
    expect(messages[1]!.idempotencyKey).toBe('lead-mail/lead-synthetic/acknowledgement');
    expect(jobs()[0]).toMatchObject({ status: 'sent', attempts: 2 });
  });

  it('does not let a stale worker overwrite a replacement lease receipt', async () => {
    addLead();
    const second = connect();
    let release: () => void = () => undefined;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let acknowledgementCalls = 0;
    setMailTransport(async (message) => {
      messages.push(message);
      if (message.to === 'visitor@example.org') {
        acknowledgementCalls += 1;
        if (acknowledgementCalls === 1) { await blocked; return { sent: true, transport: 'custom', id: 'stale-receipt' }; }
      }
      return { sent: true, transport: 'custom', id: 'replacement-receipt' };
    });
    const first = dispatchLeadMail(db, now);
    try { expect(await dispatchLeadMail(second, now + LEAD_MAIL_LEASE_MS)).toBe(2); }
    finally { release(); }
    expect(await first).toBe(0);
    expect(db.prepare("SELECT status, provider_id FROM lead_mail_outbox WHERE kind = 'acknowledgement'").get())
      .toEqual({ status: 'sent', provider_id: 'replacement-receipt' });
    const acknowledgements = messages.filter((message) => message.to === 'visitor@example.org');
    expect(acknowledgements).toHaveLength(2);
    expect(acknowledgements[0]).toEqual(acknowledgements[1]);
  });

  it('stops ambiguous retries before the provider deduplication window expires', async () => {
    addLead();
    setMailTransport(async (message) => {
      messages.push(message);
      return message.to === 'visitor@example.org'
        ? { sent: false, transport: 'custom', errorCode: 'transport_error', retryable: true, ambiguous: true }
        : { sent: true, transport: 'custom', id: 'synthetic-owner' };
    });
    expect(await dispatchLeadMail(db, now)).toBe(1);
    expect(jobs()[0]).toMatchObject({ status: 'pending', ambiguous_since: now });
    db.close(); db = connect();
    expect(await dispatchLeadMail(db, now + LEAD_MAIL_SAFE_RETRY_MS)).toBe(0);
    expect(jobs()[0]).toMatchObject({ status: 'uncertain', last_error: 'idempotency_window_expired' });
    expect(messages).toHaveLength(2);
  });

  it('also quarantines an abandoned sending claim past the safe retry window', async () => {
    addLead();
    db.prepare("UPDATE lead_mail_outbox SET status = 'sending', attempts = 1, attempt_started_at = ?, lease_until = ?, lease_token = 'dead-process' WHERE kind = 'acknowledgement'")
      .run(now, now + LEAD_MAIL_LEASE_MS);
    expect(await dispatchLeadMail(db, now + LEAD_MAIL_SAFE_RETRY_MS)).toBe(1);
    expect(jobs()[0]).toMatchObject({ status: 'uncertain' });
    expect(messages.map((message) => message.to)).toEqual(['team@example.org']);
  });

  it('honours a case-insensitive explicit recipient hold added after enqueue', async () => {
    addLead();
    db.prepare('INSERT INTO lead_reply_holds (email, reason, created_at) VALUES (?, ?, ?)').run('VISITOR@EXAMPLE.ORG', 'operator_hold', now);
    expect(await dispatchLeadMail(db, now)).toBe(1);
    expect(messages.map((message) => message.to)).toEqual(['team@example.org']);
    expect(jobs()[0]).toMatchObject({ status: 'held', attempts: 0, last_error: 'recipient_hold' });
    db.close(); db = connect();
    expect(await dispatchLeadMail(db, now + 86_400_000)).toBe(0);
    expect(messages).toHaveLength(1);
  });

  it.each(['flagged', 'spam', 'internal_test'])('cancels mail when the lead becomes %s before dispatch', async (status) => {
    addLead(); db.prepare('UPDATE leads SET quality_status = ?').run(status);
    expect(await dispatchLeadMail(db, now)).toBe(0);
    expect(messages).toEqual([]);
    expect(jobs().every((job) => (job as { status: string }).status === 'cancelled')).toBe(true);
  });

  it('marks a permanent rejection failed without retrying it', async () => {
    addLead();
    setMailTransport(async (message) => {
      messages.push(message);
      return { sent: false, transport: 'custom', statusCode: 422, errorCode: 'validation_error', retryable: false };
    });
    await dispatchLeadMail(db, now); await dispatchLeadMail(db, now + 86_400_000);
    expect(messages).toHaveLength(2);
    expect(jobs().every((job) => (job as { status: string }).status === 'failed')).toBe(true);
  });

  it('automatically retries from the hosted ticker and stops future ticks cleanly', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now); addLead();
    setMailTransport(async (message) => {
      messages.push(message);
      return { sent: false, transport: 'custom', retryable: true, errorCode: 'synthetic_outage' };
    });
    const stop = startLeadMailWorker(db, 30_000); stops.push(stop);
    await vi.advanceTimersByTimeAsync(1000);
    expect(messages).toHaveLength(2);
    setMailTransport(async (message) => { messages.push(message); return { sent: true, transport: 'custom', id: 'automatic-synthetic' }; });
    await vi.advanceTimersByTimeAsync(89_000);
    expect(messages).toHaveLength(4);
    expect(jobs().every((job) => (job as { status: string }).status === 'sent')).toBe(true);
    stop();
    addLead('later', 'later@example.org');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(messages).toHaveLength(4);
    expect(vi.getTimerCount()).toBe(0);
  });
});
