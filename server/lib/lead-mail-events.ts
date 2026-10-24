import type { Db } from '../db/connection';

export const RESEND_DELIVERY_TYPES = ['email.sent', 'email.delivered', 'email.failed',
  'email.bounced', 'email.complained', 'email.suppressed', 'email.delivery_delayed'] as const;
type EventType = typeof RESEND_DELIVERY_TYPES[number];
export interface LeadMailDeliveryEvent {
  id: string; providerId: string; recipient: string; type: EventType;
  occurredAt: number; reason?: string;
}
interface EventRow {
  id: string; provider_id: string; recipient: string; type: EventType;
  reason: string | null; occurred_at: number;
}
interface Receipt {
  job_id: string; generation: number; delivery_status: string; event_at: number;
  recipient: string; retry_generation: number; status: string; provider_id: string | null;
}
const MINUTE = 60_000;

/** Apply authenticated events, including callbacks which arrived before the HTTP receipt. */
export function applyLeadMailDeliveryEvents(db: Db, providerId: string, now = Date.now()): void {
  const events = db.prepare(`SELECT * FROM lead_mail_delivery_events WHERE provider_id = ?
    AND applied_at IS NULL ORDER BY occurred_at, id`).all(providerId) as EventRow[];
  for (const event of events) {
    const receipt = db.prepare(`SELECT r.job_id, r.generation, r.delivery_status, r.event_at,
      o.recipient, o.retry_generation, o.status, o.provider_id FROM lead_mail_receipts r
      JOIN lead_mail_outbox o ON o.id = r.job_id WHERE r.provider_id = ?`).get(providerId) as Receipt | undefined;
    if (!receipt) continue; // Persist first; the accepted HTTP response will attach its job.
    db.prepare('UPDATE lead_mail_delivery_events SET applied_at = ? WHERE id = ?').run(now, event.id);
    if (receipt.recipient.toLowerCase() !== event.recipient.toLowerCase()) continue;
    const state = event.type.slice('email.'.length);
    // A late bounce/complaint still suppresses future sends, even if a newer
    // delivery event won the display state. Never release explicit holds here.
    if (['bounced', 'complained', 'suppressed'].includes(state)) {
      db.prepare('INSERT OR IGNORE INTO lead_reply_holds (email, reason, created_at) VALUES (?, ?, ?)')
        .run(receipt.recipient, `provider_${state}`, now);
    }
    const terminal = ['delivered', 'failed', 'bounced', 'complained', 'suppressed'].includes(receipt.delivery_status);
    // Delivery cannot be undone by a late send/delay/failure callback. Bounces and
    // complaints can follow delivery but never cause another automatic send.
    if ((event.occurred_at < receipt.event_at && state !== 'delivered') || (terminal && ['sent', 'delivery_delayed'].includes(state))
      || (terminal && state === 'failed')) continue;
    db.prepare('UPDATE lead_mail_receipts SET delivery_status = ?, event_at = ? WHERE provider_id = ?')
      .run(state, event.occurred_at, providerId);
    const current = receipt.generation === receipt.retry_generation && receipt.provider_id === providerId;
    if (!current) {
      // A contradictory late delivery cancels a quota retry which has not started.
      if (state === 'delivered' && receipt.status === 'pending') {
        db.prepare(`UPDATE lead_mail_outbox SET status = 'sent', provider_id = ?, delivery_status = 'delivered',
          delivery_event_at = ?, last_error = NULL WHERE id = ? AND status = 'pending'
          AND last_error IN ('provider_daily_quota_failed','provider_monthly_quota_failed')`)
          .run(providerId, event.occurred_at, receipt.job_id);
      }
      continue; // An old attempt must never overwrite or requeue a newer attempt.
    }
    const quota = state === 'failed' && ['reached_daily_quota', 'reached_monthly_quota'].includes(event.reason ?? '');
    if (quota) {
      // If any attempt already reached a mail server, stop; never risk a duplicate.
      const delivered = db.prepare("SELECT 1 FROM lead_mail_receipts WHERE job_id = ? AND delivery_status = 'delivered'")
        .get(receipt.job_id);
      if (delivered) continue;
      const date = new Date(event.occurred_at);
      const daily = event.reason === 'reached_daily_quota';
      const retryAt = daily
        ? Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1) + MINUTE
        : event.occurred_at + 24 * 60 * MINUTE;
      const reason = daily ? 'provider_daily_quota_failed' : 'provider_monthly_quota_failed';
      db.prepare(`UPDATE lead_mail_outbox SET status = 'pending', retry_generation = retry_generation + 1,
        delivery_status = 'quota_failed', delivery_event_at = ?, next_attempt_at = ?, provider_id = NULL,
        sent_at = NULL, ambiguous_since = NULL, attempt_started_at = NULL, lease_token = NULL,
        lease_until = NULL, last_error = ? WHERE id = ? AND status = 'sent' AND retry_generation = ?`)
        .run(event.occurred_at, Math.max(now, retryAt), reason, receipt.job_id, receipt.generation);
      if (retryAt > now) {
        db.prepare(`INSERT INTO lead_mail_provider_state (id, blocked_until, reason) VALUES (1, ?, ?)
          ON CONFLICT(id) DO UPDATE SET blocked_until = MAX(blocked_until, excluded.blocked_until), reason = excluded.reason`)
          .run(retryAt, reason);
      }
      continue;
    }
    const failed = ['failed', 'bounced', 'complained', 'suppressed'].includes(state);
    db.prepare(`UPDATE lead_mail_outbox SET delivery_status = ?, delivery_event_at = ?,
      status = ?, last_error = ? WHERE id = ? AND provider_id = ?`)
      .run(state, event.occurred_at, failed ? 'failed' : 'sent', failed ? `provider_${state}` : null,
        receipt.job_id, providerId);
  }
}

/** Minimal event metadata only: no enquiry bodies, provider raw payload or credentials. */
export function recordLeadMailDeliveryEvent(db: Db, event: LeadMailDeliveryEvent,
  source: 'webhook' | 'operator_verified_dashboard' = 'webhook', now = Date.now()): void {
  db.transaction(() => {
    const reason = ['reached_daily_quota', 'reached_monthly_quota'].includes(event.reason ?? '') ? event.reason : null;
    db.prepare(`INSERT OR IGNORE INTO lead_mail_delivery_events
      (id, provider_id, recipient, type, reason, occurred_at, received_at, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(event.id, event.providerId, event.recipient.toLowerCase(), event.type, reason, event.occurredAt, now, source);
    applyLeadMailDeliveryEvents(db, event.providerId, now);
  }).immediate();
}
