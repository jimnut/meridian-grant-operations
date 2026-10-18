/** Internal, versioned milestones. These records are never sent to analytics vendors. */
import type { Db } from '../db/connection';

type Conversion = 'trial_started' | 'trial_activated' | 'paid_started';

function record(db: Db, orgId: string, kind: Conversion, occurredAt: string, recordedAt = occurredAt): boolean {
  return db.prepare(`INSERT INTO conversion_events (org_id, event_type, occurred_at, recorded_at)
    SELECT id, ?, ?, ? FROM organizations WHERE id = ? AND is_demo = 0
    ON CONFLICT(org_id, event_type) DO NOTHING`).run(kind, occurredAt, recordedAt, orgId).changes > 0;
}

/** Called inside the successful workspace-creation transaction, never on a page visit. */
export function recordTrialStarted(db: Db, orgId: string, now = new Date()): boolean {
  return record(db, orgId, 'trial_started', now.toISOString());
}

/**
 * Definition v1: a real awarded grant, active responsible team member and an
 * entered reporting deadline. Samples/demo data and waived obligations do not
 * qualify. This measures saved workflow setup, not the authenticity of its data.
 */
export function recordTrialActivation(db: Db, orgId: string, now = new Date()): boolean {
  const eligible = db.prepare(`SELECT m.due_date AS dueDate
    FROM grants g JOIN organizations o ON o.id = g.org_id
    JOIN memberships owner ON owner.org_id = g.org_id AND owner.user_id = g.owner_user_id
    JOIN users u ON u.id = owner.user_id AND u.is_active = 1
    JOIN milestones m ON m.org_id = g.org_id AND m.grant_id = g.id
    WHERE g.org_id = ? AND o.is_demo = 0 AND g.is_sample = 0 AND g.archived = 0
      AND g.awarded_cents > 0 AND g.status IN ('AWARDED','REPORTING','RENEWAL','CLOSEOUT')
      AND owner.role <> 'VIEWER' AND m.type IN ('REPORT','FINANCIAL_REPORT')
      AND m.status <> 'WAIVED' AND m.due_date IS NOT NULL
      AND EXISTS (SELECT 1 FROM conversion_events c WHERE c.org_id = o.id AND c.event_type = 'trial_started')`
  ).all(orgId) as Array<{ dueDate: string }>;
  const valid = eligible.some(({ dueDate }) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return false;
    const parsed = new Date(`${dueDate}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === dueDate;
  });
  return valid && record(db, orgId, 'trial_activated', now.toISOString());
}

export interface VerifiedBillingEvent {
  id: string;
  type: string;
  created?: number;
  livemode?: boolean;
  data: { object: Record<string, unknown> };
}

const ref = (value: unknown): string | null => {
  const id = typeof value === 'string' ? value : value && typeof value === 'object' && 'id' in value ? value.id : null;
  return typeof id === 'string' && /^[A-Za-z0-9_]{1,200}$/.test(id) ? id : null;
};
const minor = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
function time(seconds: unknown, fallback: string): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return fallback;
  const date = new Date(seconds * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}

/** Call only after verifying the webhook signature. Retries are immutable facts. */
export function recordVerifiedPaymentFact(db: Db, event: VerifiedBillingEvent, now = new Date()): void {
  const object = event.data.object;
  const resourceId = ref(object.id);
  if (!resourceId) return;
  const recordedAt = now.toISOString();
  let kind: string;
  let status: string;
  let amount: number | null;
  let occurredAt = time(event.created, recordedAt);
  if (event.type === 'invoice.paid' || event.type === 'invoice.payment_succeeded') {
    // A zero invoice, checkout return, complimentary plan or unpaid invoice is
    // not a payment conversion. Out-of-band recorded payments stay separate.
    amount = minor(object.amount_paid);
    if (object.status !== 'paid' || !amount || object.paid === false) return;
    // Basil removed paid/paid_out_of_band; amount_paid also includes external
    // payments. invoice.paid alone is therefore insufficient on modern payloads.
    // The successful-attempt event provides processor evidence without needing
    // removed fields. Legacy invoice.paid must explicitly rule out out-of-band.
    const external = object.paid_out_of_band === true || (minor(object.amount_paid_off_stripe) ?? 0) > 0;
    const verified = !external && (event.type === 'invoice.payment_succeeded'
      || (object.paid === true && object.paid_out_of_band === false));
    kind = verified ? 'invoice_paid' : 'invoice_unverified';
    status = verified ? 'paid' : external ? 'out_of_band' : 'payment_mechanism_unknown';
    const transitions = object.status_transitions as { paid_at?: unknown } | undefined;
    occurredAt = time(transitions?.paid_at, occurredAt);
  } else if (['refund.created', 'refund.updated', 'refund.failed'].includes(event.type)) {
    kind = 'refund';
    status = ['pending', 'requires_action', 'succeeded', 'failed', 'canceled'].includes(String(object.status))
      ? String(object.status) : event.type === 'refund.failed' ? 'failed' : 'unknown';
    amount = minor(object.amount);
  } else if (event.type === 'charge.refunded') {
    // Cumulative charge total is preserved separately, never added to refund rows.
    kind = 'charge_refund';
    status = object.refunded === true ? 'fully_refunded' : 'partially_refunded';
    amount = minor(object.amount_refunded);
  } else if (event.type.startsWith('charge.dispute.')) {
    kind = 'dispute';
    status = ['warning_needs_response', 'warning_under_review', 'warning_closed', 'needs_response', 'under_review', 'won', 'lost'].includes(String(object.status))
      ? String(object.status) : 'unknown';
    amount = minor(object.amount);
  } else return;
  const parent = object.parent as { subscription_details?: { subscription?: unknown } } | undefined;
  const payments = object.payments as { data?: Array<{ payment?: { type?: unknown; payment_intent?: unknown } }> } | undefined;
  const intents = Array.isArray(payments?.data)
    ? [...new Set(payments.data.filter((p) => p.payment?.type === 'payment_intent').map((p) => ref(p.payment?.payment_intent)).filter((id): id is string => id !== null))]
    : [];
  // Only a single unambiguous pointer fits this fact schema. Multiple intents
  // remain unlinked for refund correlation until separately reconciled.
  const paymentIntent = ref(object.payment_intent) ?? (intents.length === 1 ? intents[0]! : null);
  db.prepare(`INSERT INTO payment_facts
    (event_id, event_type, billing_mode, kind, resource_id, customer_ref, subscription_ref, charge_ref, payment_intent_ref,
     amount_minor, currency, status, occurred_at, recorded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(event_id) DO NOTHING`).run(
    event.id, event.type, event.livemode === true ? 'live' : event.livemode === false ? 'test' : 'unknown', kind, resourceId,
    ref(object.customer), ref(object.subscription) ?? ref(parent?.subscription_details?.subscription),
    kind === 'charge_refund' ? resourceId : ref(object.charge), paymentIntent, amount,
    typeof object.currency === 'string' && /^[a-z]{3}$/.test(object.currency) ? object.currency : null,
    status, occurredAt, recordedAt,
  );
}

/** Link facts that arrived before Checkout/subscription metadata; no network lookup. */
export function reconcilePaymentConversions(db: Db, now = new Date()): void {
  const recordedAt = now.toISOString();
  // Require an unambiguous organization match. Never guess from emails or names.
  db.prepare(`UPDATE payment_facts AS f SET org_id = (
    SELECT MIN(o.id) FROM organizations o WHERE o.is_demo = 0 AND
      ((f.customer_ref IS NOT NULL AND o.stripe_customer_id = f.customer_ref) OR
       (f.subscription_ref IS NOT NULL AND o.stripe_subscription_id = f.subscription_ref))
    HAVING COUNT(DISTINCT o.id) = 1) WHERE f.org_id IS NULL`).run();
  db.prepare(`UPDATE payment_facts AS f SET org_id = (
    SELECT MIN(p.org_id) FROM payment_facts p WHERE p.org_id IS NOT NULL AND p.billing_mode = f.billing_mode AND
      ((f.charge_ref IS NOT NULL AND p.charge_ref = f.charge_ref) OR
       (f.payment_intent_ref IS NOT NULL AND p.payment_intent_ref = f.payment_intent_ref))
    HAVING COUNT(DISTINCT p.org_id) = 1) WHERE f.org_id IS NULL`).run();
  db.prepare(`INSERT INTO conversion_events (org_id, event_type, occurred_at, recorded_at)
    SELECT p.org_id, 'paid_started', MIN(p.occurred_at), ? FROM payment_facts p
    JOIN organizations o ON o.id = p.org_id AND o.is_demo = 0
    WHERE p.kind = 'invoice_paid' AND p.billing_mode = 'live' AND p.amount_minor > 0 GROUP BY p.org_id
    ON CONFLICT(org_id, event_type) DO UPDATE SET occurred_at = MIN(conversion_events.occurred_at, excluded.occurred_at)`
  ).run(recordedAt);
}

/** Aggregate only: no person, workspace, Stripe or grant identifiers leave this endpoint. */
export function conversionSummary(db: Db, now = new Date()) {
  const asOf = now.toISOString();
  const cohorts = db.prepare(`SELECT substr(t.occurred_at, 1, 10) AS day, o.acquisition_channel AS acquisitionChannel,
    o.acquisition_landing AS landingRoute, o.conversion_quality AS quality, COUNT(*) AS trials,
    SUM(CASE WHEN julianday(?) - julianday(t.occurred_at) >= 7 THEN 1 ELSE 0 END) AS maturedSevenDayTrials,
    SUM(CASE WHEN julianday(?) - julianday(t.occurred_at) >= 7 AND a.occurred_at >= t.occurred_at AND julianday(a.occurred_at) - julianday(t.occurred_at) <= 7 THEN 1 ELSE 0 END) AS activatedWithinSevenDays,
    SUM(CASE WHEN julianday(?) - julianday(t.occurred_at) >= 30 THEN 1 ELSE 0 END) AS maturedThirtyDayTrials,
    SUM(CASE WHEN julianday(?) - julianday(t.occurred_at) >= 30 AND p.occurred_at >= t.occurred_at AND julianday(p.occurred_at) - julianday(t.occurred_at) <= 30 THEN 1 ELSE 0 END) AS paidWithinThirtyDays
    FROM conversion_events t JOIN organizations o ON o.id = t.org_id AND o.is_demo = 0
    LEFT JOIN conversion_events a ON a.org_id = t.org_id AND a.event_type = 'trial_activated'
    LEFT JOIN conversion_events p ON p.org_id = t.org_id AND p.event_type = 'paid_started'
    WHERE t.event_type = 'trial_started' AND t.occurred_at <= ?
      AND o.conversion_quality IN ('unreviewed','qualified')
    GROUP BY day, acquisitionChannel, landingRoute, quality ORDER BY day DESC`
  ).all(asOf, asOf, asOf, asOf, asOf);
  const totals = db.prepare(`SELECT event_type AS event, o.conversion_quality AS quality, COUNT(*) AS organizations FROM conversion_events c
    JOIN organizations o ON o.id = c.org_id AND o.is_demo = 0 WHERE c.occurred_at <= ? AND o.conversion_quality IN ('unreviewed','qualified') GROUP BY event_type, quality`).all(asOf);
  // Latest state per resource, not sum of webhook delivery amounts. Ties favor
  // terminal outcomes over an earlier in-progress snapshot delivered later.
  const paymentOutcomes = db.prepare(`WITH latest AS (SELECT f.*, ROW_NUMBER() OVER (
    PARTITION BY kind, resource_id ORDER BY occurred_at DESC,
      CASE WHEN status IN ('succeeded','failed','canceled','won','lost') THEN 1 ELSE 0 END DESC, event_id DESC) AS rn
    FROM payment_facts f LEFT JOIN organizations o ON o.id = f.org_id
    WHERE f.billing_mode = 'live' AND (f.org_id IS NULL OR (o.is_demo = 0 AND o.conversion_quality IN ('unreviewed','qualified'))) AND f.occurred_at <= ?
      AND (f.kind <> 'invoice_unverified' OR NOT EXISTS (SELECT 1 FROM payment_facts verified
        WHERE verified.kind = 'invoice_paid' AND verified.resource_id = f.resource_id AND verified.billing_mode = f.billing_mode
          AND verified.occurred_at <= ?)))
    SELECT kind, status, COUNT(*) AS resources, SUM(CASE WHEN org_id IS NULL THEN 1 ELSE 0 END) AS unlinked
    FROM latest WHERE rn = 1 GROUP BY kind, status`).all(asOf, asOf);
  const excluded = db.prepare(`SELECT conversion_quality AS quality, COUNT(*) AS organizations FROM organizations
    WHERE is_demo = 0 AND conversion_quality IN ('spam','internal_test') GROUP BY conversion_quality`).all();
  const excludedPaymentFacts = db.prepare(`SELECT billing_mode AS mode, COUNT(*) AS facts FROM payment_facts
    WHERE billing_mode <> 'live' AND occurred_at <= ? GROUP BY billing_mode`).all(asOf);
  return { asOf, excluded, excludedPaymentFacts, definitionVersion: 1, coverage: 'Recorded since instrumentation; no historical signup or activation backfill. Cohort conversion numerators include only fully matured windows. Unreviewed is not qualified. Spam/internal tests and demos are excluded. Paid conversion needs a live positive paid invoice with processor evidence; unknown/test mode or unverified payment mechanism is excluded. Payment outcomes are lifecycle counts, not net revenue; some refund/dispute links remain unresolved.', totals, cohorts, paymentOutcomes };
}
