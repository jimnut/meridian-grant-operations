import crypto from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubEnv('RESEND_API_KEY', '');
  vi.stubEnv('LEAD_REPLY_HOLD_EMAILS', '');
  vi.stubEnv('RESEND_WEBHOOK_SECRET', `whsec_${Buffer.alloc(32, 7).toString('base64')}`);
});
import { createApp } from '../../server/app';
import { config } from '../../server/config';
import { migrate, openDatabase, type Db } from '../../server/db/connection';
import { dispatchLeadMail, enqueueLeadMail } from '../../server/lib/lead-mail';
import { recordLeadMailDeliveryEvent, type LeadMailDeliveryEvent } from '../../server/lib/lead-mail-events';
import { setMailTransport, type MailMessage } from '../../server/lib/mailer';
import { verifyResendWebhook } from '../../server/routes/mail-webhook';

const now = Date.parse('2026-10-25T09:00:00Z');
const reset = Date.parse('2026-10-26T00:01:00Z');
let db: Db;
let messages: MailMessage[];
function addLead(id = 'event-test', email = 'visitor@example.org') {
  db.prepare('INSERT INTO leads (id,email,source,created_at) VALUES (?,?,?,?)')
    .run(id, email, 'contact', new Date(now).toISOString());
  enqueueLeadMail(db, { id, email, source: 'contact' }, now);
}
function job() { return db.prepare("SELECT * FROM lead_mail_outbox WHERE kind='acknowledgement' ORDER BY created_at LIMIT 1").get() as Record<string, unknown>; }
function event(type: LeadMailDeliveryEvent['type'] = 'email.failed', extra: Partial<LeadMailDeliveryEvent> = {}): LeadMailDeliveryEvent {
  return { id: 'event-1', providerId: 'provider-1', recipient: 'visitor@example.org', type,
    occurredAt: now + 1000, reason: 'reached_daily_quota', ...extra };
}
function sign(body: string, id = 'webhook-1', timestamp = String(Math.floor(Date.now() / 1000))) {
  const signature = crypto.createHmac('sha256', Buffer.from(config.resendWebhookSecret.slice(6), 'base64'))
    .update(`${id}.${timestamp}.${body}`).digest('base64');
  return { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': `v1,${signature}` };
}
beforeEach(() => {
  db = openDatabase(':memory:'); messages = [];
  setMailTransport(async (message) => { messages.push(message); return { sent: true, transport: 'custom', id: `provider-${messages.length}` }; });
});
afterEach(() => { setMailTransport(null); db.close(); vi.restoreAllMocks(); });

describe('provider delivery recovery', () => {
  it('requeues a definitively failed acceptance after UTC reset with a new key and unchanged payload', async () => {
    addLead(); await dispatchLeadMail(db, now);
    const envelope = job().envelope;
    recordLeadMailDeliveryEvent(db, event(), 'webhook', now + 2000);
    expect(job()).toMatchObject({ status: 'pending', retry_generation: 1, delivery_status: 'quota_failed', next_attempt_at: reset, provider_id: null });
    expect(await dispatchLeadMail(db, reset - 1)).toBe(0);
    expect(await dispatchLeadMail(db, reset)).toBe(1);
    expect(messages).toHaveLength(3);
    expect(messages[2]).toEqual({ ...messages[0], idempotencyKey: `${messages[0]!.idempotencyKey}/retry/1` });
    expect(job().envelope).toBe(envelope);
    expect(db.prepare('SELECT COUNT(*) n FROM lead_mail_receipts').get()).toEqual({ n: 3 });
    recordLeadMailDeliveryEvent(db, event('email.delivered', { id: 'delivered-new', providerId: 'provider-3', occurredAt: reset + 1000 }), 'webhook', reset + 1000);
    expect(job()).toMatchObject({ status: 'sent', delivery_status: 'delivered', provider_id: 'provider-3' });
    recordLeadMailDeliveryEvent(db, event('email.failed', { id: 'late-old-failure' }), 'webhook', reset + 2000);
    expect(job()).toMatchObject({ status: 'sent', delivery_status: 'delivered', retry_generation: 1 });
  });

  it('ignores duplicate failure IDs and duplicate failures with different event IDs', async () => {
    addLead(); await dispatchLeadMail(db, now);
    recordLeadMailDeliveryEvent(db, event(), 'webhook', now + 2000);
    recordLeadMailDeliveryEvent(db, event(), 'webhook', now + 3000);
    recordLeadMailDeliveryEvent(db, event('email.failed', { id: 'same-failure-another-event' }), 'webhook', now + 3000);
    expect(job().retry_generation).toBe(1);
  });

  it('retains callback-before-response and applies it atomically after acceptance', async () => {
    addLead();
    setMailTransport(async (message) => {
      messages.push(message);
      recordLeadMailDeliveryEvent(db, event(), 'webhook', now + 2000);
      return { sent: true, transport: 'custom', id: 'provider-1' };
    });
    await dispatchLeadMail(db, now + 2000);
    expect(messages).toHaveLength(1); // Provider pause also prevents the second envelope.
    expect(job()).toMatchObject({ status: 'pending', retry_generation: 1, delivery_status: 'quota_failed' });
  });

  it('keeps an ambiguous request key until its acceptance receipt reconciles the stored callback', async () => {
    addLead(); let calls = 0;
    setMailTransport(async (message) => {
      messages.push(message); calls++;
      if (calls === 1) {
        recordLeadMailDeliveryEvent(db, event(), 'webhook', now + 1000);
        return { sent: false, transport: 'custom', retryable: true, ambiguous: true, errorCode: 'transport_error' };
      }
      return { sent: true, transport: 'custom', id: calls === 2 ? 'owner-receipt' : 'provider-1' };
    });
    await dispatchLeadMail(db, now);
    expect(job()).toMatchObject({ status: 'pending', retry_generation: 0 });
    await dispatchLeadMail(db, now + 60_000);
    expect(messages[2]!.idempotencyKey).toBe(messages[0]!.idempotencyKey);
    expect(job()).toMatchObject({ status: 'pending', retry_generation: 1, delivery_status: 'quota_failed' });
  });

  it('persists monthly quota backoff instead of immediately resubmitting', async () => {
    addLead(); await dispatchLeadMail(db, now);
    recordLeadMailDeliveryEvent(db, event('email.failed', { reason: 'reached_monthly_quota' }), 'webhook', now + 2000);
    expect(job()).toMatchObject({ status: 'pending', retry_generation: 1, next_attempt_at: now + 1000 + 86_400_000 });
    expect(await dispatchLeadMail(db, now + 86_400_000)).toBe(0);
  });

  it('preserves suppression on a late bounce even when delivery has the newer display timestamp', async () => {
    addLead(); await dispatchLeadMail(db, now);
    recordLeadMailDeliveryEvent(db, event('email.delivered', { occurredAt: now + 5000 }), 'webhook', now + 5000);
    recordLeadMailDeliveryEvent(db, event('email.bounced', { id: 'late-bounce', occurredAt: now + 1000 }), 'webhook', now + 6000);
    expect(job().delivery_status).toBe('delivered');
    expect(db.prepare('SELECT email FROM lead_reply_holds').all()).toContainEqual({ email: 'visitor@example.org' });
    recordLeadMailDeliveryEvent(db, event('email.failed', { id: 'contradictory-quota', occurredAt: now + 7000 }), 'webhook', now + 8000);
    expect(job().retry_generation).toBe(0);
  });

  it('does not requeue delivered mail after late failure or send callbacks', async () => {
    addLead(); await dispatchLeadMail(db, now);
    recordLeadMailDeliveryEvent(db, event('email.delivered'), 'webhook', now + 2000);
    recordLeadMailDeliveryEvent(db, event('email.failed', { id: 'failure-later', occurredAt: now + 3000 }), 'webhook', now + 4000);
    recordLeadMailDeliveryEvent(db, event('email.sent', { id: 'sent-later', occurredAt: now + 5000 }), 'webhook', now + 6000);
    expect(job()).toMatchObject({ status: 'sent', retry_generation: 0, delivery_status: 'delivered' });
    expect(await dispatchLeadMail(db, reset)).toBe(0);
  });

  it('cancels an unsent quota retry on a contradictory late delivery', async () => {
    addLead(); await dispatchLeadMail(db, now);
    recordLeadMailDeliveryEvent(db, event(), 'webhook', now + 2000);
    recordLeadMailDeliveryEvent(db, event('email.delivered', { id: 'late-delivered', occurredAt: now + 500 }), 'webhook', now + 4000);
    expect(job()).toMatchObject({ status: 'sent', delivery_status: 'delivered' });
    expect(await dispatchLeadMail(db, reset)).toBe(0);
  });

  it.each(['email.bounced', 'email.complained', 'email.suppressed'] as const)('does not retry %s and holds future messages to that address', async (type) => {
    addLead(); await dispatchLeadMail(db, now);
    recordLeadMailDeliveryEvent(db, event(type), 'webhook', now + 2000);
    expect(job()).toMatchObject({ status: 'failed', delivery_status: type.slice(6) });
    addLead('second-enquiry'); await dispatchLeadMail(db, reset);
    expect(messages.filter((message) => message.to === 'visitor@example.org')).toHaveLength(1);
    expect(db.prepare('SELECT email FROM lead_reply_holds').all()).toContainEqual({ email: 'visitor@example.org' });
  });

  it('keeps an explicit hold while recovering quota and does not send to the held recipient', async () => {
    addLead(); await dispatchLeadMail(db, now);
    recordLeadMailDeliveryEvent(db, event(), 'webhook', now + 2000);
    db.prepare('INSERT INTO lead_reply_holds (email,reason,created_at) VALUES (?,?,?)').run('VISITOR@example.org', 'explicit_operator_hold', now);
    expect(await dispatchLeadMail(db, reset)).toBe(0);
    expect(job().status).toBe('held');
  });

  it('records unknown failures for review instead of retrying and validates recipient binding', async () => {
    addLead(); await dispatchLeadMail(db, now);
    recordLeadMailDeliveryEvent(db, event('email.failed', { recipient: 'other@example.org' }), 'webhook', now + 2000);
    expect(job().status).toBe('sent');
    recordLeadMailDeliveryEvent(db, event('email.failed', { id: 'other-failure', reason: 'unrecognized_private_error_text' }), 'webhook', now + 2000);
    expect(job()).toMatchObject({ status: 'failed', retry_generation: 0 });
    expect(db.prepare("SELECT reason FROM lead_mail_delivery_events WHERE id='other-failure'").get()).toEqual({ reason: null });
  });

  it('recovers existing acceptance receipts on migration without backfilling leads', async () => {
    addLead(); await dispatchLeadMail(db, now); db.exec('DELETE FROM lead_mail_receipts');
    migrate(db); migrate(db);
    expect(db.prepare('SELECT COUNT(*) n FROM lead_mail_receipts').get()).toEqual({ n: 2 });
    recordLeadMailDeliveryEvent(db, event(), 'operator_verified_dashboard', now + 2000);
    expect(job()).toMatchObject({ status: 'pending', retry_generation: 1 });
  });
});

describe('signed Resend endpoint', () => {
  it('matches the published Svix verification vector and supports key rotation signatures', () => {
    const body = Buffer.from('{"event_type":"ping","data":{"success":true}}');
    expect(verifyResendWebhook(body, 'msg_loFOjxBNrRLzqYUf', '1731705121',
      'v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=', 'whsec_plJ3nmyCDGBKInavdOK15jsl', 1731705121000)).toBe(true);
    const text = '{}'; const headers = sign(text);
    expect(verifyResendWebhook(Buffer.from(text), headers['svix-id'], headers['svix-timestamp'],
      `v2,invalid v1,invalid ${headers['svix-signature']}`, config.resendWebhookSecret)).toBe(true);
  });

  it('rejects bad signatures, stale/future timestamps and changed bytes without mutation', async () => {
    const app = createApp({ db }); const body = JSON.stringify({ type: 'email.failed' });
    for (const headers of [sign(body + ' '), sign(body, 'old', String(Math.floor(Date.now() / 1000) - 301)),
      sign(body, 'future', String(Math.floor(Date.now() / 1000) + 301)), { 'svix-id': 'x' }]) {
      expect((await request(app).post('/api/mail/webhook').set('Content-Type', 'application/json').set(headers).send(body)).status).toBe(400);
    }
    expect(db.prepare('SELECT COUNT(*) n FROM lead_mail_delivery_events').get()).toEqual({ n: 0 });
  });

  it('verifies raw bytes before JSON parsing, deduplicates and stores no body or credentials', async () => {
    addLead(); await dispatchLeadMail(db, now);
    const app = createApp({ db });
    const body = JSON.stringify({ type: 'email.failed', created_at: new Date().toISOString(),
      data: { email_id: 'provider-1', to: ['visitor@example.org'], failed: { reason: 'reached_daily_quota' },
        subject: 'Private synthetic subject', text: 'Private synthetic content' } });
    const headers = sign(body);
    for (let i = 0; i < 2; i++) expect((await request(app).post('/api/mail/webhook').set('Content-Type', 'application/json').set(headers).send(body)).status).toBe(200);
    expect(job().retry_generation).toBe(1);
    const rows = JSON.stringify(db.prepare('SELECT * FROM lead_mail_delivery_events').all());
    expect(rows).not.toContain('Private synthetic'); expect(rows).not.toContain(config.resendWebhookSecret);
  });
});
