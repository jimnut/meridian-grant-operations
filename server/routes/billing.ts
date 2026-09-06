/**
 * Billing: plan status and usage for every member, Stripe Checkout and the
 * customer portal for owners, and the webhook that keeps the organization row
 * in step with Stripe. The webhook handler is exported so tests can drive it
 * with signed payloads and no network.
 */

import { Router, type Request, type Response } from 'express';

import { currentSession, requireCapability } from '../auth/middleware';
import { config } from '../config';
import type { Db } from '../db/connection';
import { logActivity } from '../lib/activity';
import { conflict, notFound } from '../lib/errors';
import { handler, parseBody } from '../lib/http';
import { newId } from '../lib/ids';
import { loadOrganizationBilling, usageFor } from '../lib/plans';
import {
  createCheckoutSession,
  createPortalSession,
  planForPriceId,
  priceIdFor,
  StripeError,
  stripeConfigured,
  verifyWebhookSignature,
  webhookConfigured,
} from '../lib/stripe';
import { billingEmailSchema, checkoutSchema } from '../lib/validation';
import { computeWorkspaceStatus, PLAN_IDS, PLANS, type PlanId } from '../../shared/plans';
import type { BillingSummary } from '../../shared/types';

const router = Router();

/* ----------------------------------------------------------------- summary */

router.get(
  '/',
  handler((req, res) => {
    const session = currentSession(req);
    const org = loadOrganizationBilling(req.db, session.orgId);
    if (!org) throw notFound('Organization');
    const workspace = computeWorkspaceStatus(org);
    const summary: BillingSummary = {
      workspace,
      usage: usageFor(req.db, session.orgId),
      plans: PLAN_IDS.map((id) => PLANS[id]),
      checkoutAvailable: stripeConfigured() && !workspace.isDemo,
      portalAvailable: Boolean(config.stripeSecretKey && org.stripe_customer_id) && !workspace.isDemo,
      billingEmail: org.billing_email,
      supportEmail: config.supportEmail,
      currentPlan: workspace.plan,
    };
    res.json(summary);
  }),
);

router.put(
  '/email',
  requireCapability('org:manage'),
  handler((req, res) => {
    const session = currentSession(req);
    const { billingEmail } = parseBody(billingEmailSchema, req.body);
    req.db.prepare('UPDATE organizations SET billing_email = ?, updated_at = ? WHERE id = ?').run(billingEmail, new Date().toISOString(), session.orgId);
    res.json({ billingEmail });
  }),
);

/* ---------------------------------------------------------------- checkout */

router.post(
  '/checkout',
  requireCapability('org:manage'),
  handler(async (req, res) => {
    const session = currentSession(req);
    const { plan, interval } = parseBody(checkoutSchema, req.body);
    if (session.workspace.isDemo) throw conflict('The public demo workspace cannot subscribe.');
    if (!stripeConfigured() || !priceIdFor(plan, interval)) {
      throw conflict(
        `Online checkout for the ${PLANS[plan].name} plan is not switched on yet. Email ${config.supportEmail} and we will activate it the same day, or invoice you.`,
      );
    }
    const org = loadOrganizationBilling(req.db, session.orgId);
    if (!org) throw notFound('Organization');

    try {
      const checkout = await createCheckoutSession({
        orgId: session.orgId,
        plan,
        interval,
        customerId: org.stripe_customer_id,
        customerEmail: org.billing_email ?? session.userEmail,
        successUrl: `${config.appUrl}/settings/billing?checkout=success`,
        cancelUrl: `${config.appUrl}/settings/billing?checkout=canceled`,
      });
      logActivity(req.db, {
        orgId: session.orgId,
        actorUserId: session.userId,
        entityType: 'ORGANIZATION',
        entityId: session.orgId,
        action: 'CHECKOUT_STARTED',
        summary: `${session.userName} started checkout for the ${PLANS[plan].name} plan (${interval})`,
      });
      res.json({ url: checkout.url });
    } catch (error) {
      if (error instanceof StripeError) {
        console.error('[billing] checkout failed:', error.message);
        throw conflict(`Checkout could not be started (${error.message}). Email ${config.supportEmail} and we will sort it out.`);
      }
      throw error;
    }
  }),
);

router.post(
  '/portal',
  requireCapability('org:manage'),
  handler(async (req, res) => {
    const session = currentSession(req);
    const org = loadOrganizationBilling(req.db, session.orgId);
    if (!org?.stripe_customer_id || !config.stripeSecretKey) {
      throw conflict(`There is no online subscription to manage yet. Email ${config.supportEmail} for invoices or changes.`);
    }
    try {
      const portal = await createPortalSession(org.stripe_customer_id, `${config.appUrl}/settings/billing`);
      res.json({ url: portal.url });
    } catch (error) {
      if (error instanceof StripeError) {
        console.error('[billing] portal failed:', error.message);
        throw conflict(`The billing portal could not be opened (${error.message}).`);
      }
      throw error;
    }
  }),
);

/* ----------------------------------------------------------------- webhook */

interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

interface OrgRef {
  id: string;
  name: string;
}

function findOrg(db: Db, by: { orgId?: unknown; customerId?: unknown; subscriptionId?: unknown }): OrgRef | null {
  const attempts: Array<[string, unknown]> = [
    ['id', by.orgId],
    ['stripe_subscription_id', by.subscriptionId],
    ['stripe_customer_id', by.customerId],
  ];
  for (const [column, value] of attempts) {
    if (typeof value !== 'string' || value === '') continue;
    const row = db.prepare(`SELECT id, name FROM organizations WHERE ${column} = ?`).get(value) as OrgRef | undefined;
    if (row) return row;
  }
  return null;
}

function mapSubscriptionStatus(stripeStatus: unknown): 'active' | 'past_due' | 'canceled' {
  switch (stripeStatus) {
    case 'active':
    case 'trialing':
      return 'active';
    case 'past_due':
    case 'unpaid':
    case 'incomplete':
      return 'past_due';
    default:
      return 'canceled';
  }
}

function planFromSubscription(object: Record<string, unknown>): PlanId | null {
  const metadata = object.metadata as Record<string, string> | undefined;
  const fromMeta = metadata?.plan;
  if (fromMeta && (PLAN_IDS as readonly string[]).includes(fromMeta)) return fromMeta as PlanId;
  const items = object.items as { data?: Array<{ price?: { id?: string } }> } | undefined;
  const priceId = items?.data?.[0]?.price?.id;
  return priceId ? (planForPriceId(priceId)?.plan ?? null) : null;
}

function recordEvent(db: Db, event: StripeEvent, orgId: string | null, summary: string): boolean {
  try {
    db.prepare(
      `INSERT INTO billing_events (id, org_id, stripe_event_id, type, summary, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(newId('bev'), orgId, event.id, event.type, summary.slice(0, 500), JSON.stringify(event.data.object).slice(0, 8000), new Date().toISOString());
    return true;
  } catch {
    // UNIQUE(stripe_event_id): Stripe retried an event we already applied.
    return false;
  }
}

/** Applies one verified Stripe event. Idempotent per event id. Returns what changed. */
export function applyStripeEvent(db: Db, event: StripeEvent): { applied: boolean; summary: string } {
  const object = event.data.object;
  const now = new Date().toISOString();

  switch (event.type) {
    case 'checkout.session.completed': {
      const metadata = (object.metadata as Record<string, string> | undefined) ?? {};
      const org = findOrg(db, { orgId: object.client_reference_id ?? metadata.orgId, customerId: object.customer });
      if (!org) return { applied: false, summary: 'checkout completed for unknown organization' };
      const plan = metadata.plan && (PLAN_IDS as readonly string[]).includes(metadata.plan) ? (metadata.plan as PlanId) : null;
      const summary = `Subscription started${plan ? ` on the ${PLANS[plan].name} plan` : ''}`;
      if (!recordEvent(db, event, org.id, summary)) return { applied: false, summary: 'duplicate' };
      const details = object.customer_details as { email?: string } | undefined;
      db.prepare(
        `UPDATE organizations SET stripe_customer_id = COALESCE(?, stripe_customer_id),
            stripe_subscription_id = COALESCE(?, stripe_subscription_id),
            plan = COALESCE(?, plan), subscription_status = 'active', plan_valid_until = NULL,
            billing_email = COALESCE(?, billing_email), updated_at = ?
          WHERE id = ?`,
      ).run(
        typeof object.customer === 'string' ? object.customer : null,
        typeof object.subscription === 'string' ? object.subscription : null,
        plan,
        details?.email ?? null,
        now,
        org.id,
      );
      logActivity(db, { orgId: org.id, actorUserId: null, entityType: 'ORGANIZATION', entityId: org.id, action: 'SUBSCRIBED', summary });
      return { applied: true, summary };
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const metadata = (object.metadata as Record<string, string> | undefined) ?? {};
      const org = findOrg(db, { orgId: metadata.orgId, subscriptionId: object.id, customerId: object.customer });
      if (!org) return { applied: false, summary: 'subscription event for unknown organization' };
      const status = event.type === 'customer.subscription.deleted' ? 'canceled' : mapSubscriptionStatus(object.status);
      const plan = planFromSubscription(object);
      const periodEnd = typeof object.current_period_end === 'number' ? new Date(object.current_period_end * 1000).toISOString() : null;
      const cancelAtPeriodEnd = object.cancel_at_period_end === true;
      const validUntil = status === 'canceled' || cancelAtPeriodEnd ? periodEnd : null;
      const summary =
        status === 'canceled'
          ? `Subscription ended${validUntil ? `; access continues until ${validUntil.slice(0, 10)}` : ''}`
          : status === 'past_due'
            ? 'Payment is past due'
            : `Subscription ${event.type === 'customer.subscription.created' ? 'created' : 'updated'}${plan ? ` — ${PLANS[plan].name} plan` : ''}${cancelAtPeriodEnd && periodEnd ? `, cancels ${periodEnd.slice(0, 10)}` : ''}`;
      if (!recordEvent(db, event, org.id, summary)) return { applied: false, summary: 'duplicate' };
      db.prepare(
        `UPDATE organizations SET stripe_subscription_id = COALESCE(?, stripe_subscription_id),
            stripe_customer_id = COALESCE(?, stripe_customer_id),
            plan = COALESCE(?, plan), subscription_status = ?, plan_valid_until = ?, updated_at = ?
          WHERE id = ?`,
      ).run(
        typeof object.id === 'string' ? object.id : null,
        typeof object.customer === 'string' ? object.customer : null,
        plan,
        status,
        validUntil,
        now,
        org.id,
      );
      logActivity(db, { orgId: org.id, actorUserId: null, entityType: 'ORGANIZATION', entityId: org.id, action: 'SUBSCRIPTION_UPDATED', summary });
      return { applied: true, summary };
    }
    case 'invoice.payment_failed':
    case 'invoice.paid': {
      const org = findOrg(db, { subscriptionId: object.subscription, customerId: object.customer });
      if (!org) return { applied: false, summary: 'invoice event for unknown organization' };
      const failed = event.type === 'invoice.payment_failed';
      const summary = failed ? 'An invoice payment failed' : 'Invoice paid';
      if (!recordEvent(db, event, org.id, summary)) return { applied: false, summary: 'duplicate' };
      if (failed) {
        db.prepare(`UPDATE organizations SET subscription_status = 'past_due', updated_at = ? WHERE id = ?`).run(now, org.id);
      } else {
        db.prepare(
          `UPDATE organizations SET subscription_status = 'active', plan_valid_until = NULL, updated_at = ?
            WHERE id = ? AND subscription_status IN ('past_due', 'trialing', 'canceled')`,
        ).run(now, org.id);
      }
      logActivity(db, { orgId: org.id, actorUserId: null, entityType: 'ORGANIZATION', entityId: org.id, action: failed ? 'PAYMENT_FAILED' : 'INVOICE_PAID', summary });
      return { applied: true, summary };
    }
    default:
      recordEvent(db, event, null, `ignored ${event.type}`);
      return { applied: false, summary: `ignored ${event.type}` };
  }
}

/** Raw-body handler mounted before the JSON parser and outside CSRF. */
export function stripeWebhookHandler(req: Request, res: Response): void {
  if (!webhookConfigured()) {
    res.status(503).json({ error: { message: 'Webhook not configured.', code: 'CONFLICT' } });
    return;
  }
  const raw = req.body as Buffer | undefined;
  if (!raw || !Buffer.isBuffer(raw)) {
    res.status(400).json({ error: { message: 'Raw body required.', code: 'BAD_REQUEST' } });
    return;
  }
  if (!verifyWebhookSignature(raw, req.get('stripe-signature'), config.stripeWebhookSecret)) {
    res.status(400).json({ error: { message: 'Invalid signature.', code: 'FORBIDDEN' } });
    return;
  }
  let event: StripeEvent;
  try {
    event = JSON.parse(raw.toString('utf8')) as StripeEvent;
  } catch {
    res.status(400).json({ error: { message: 'Malformed event.', code: 'BAD_REQUEST' } });
    return;
  }
  try {
    const result = applyStripeEvent(req.db, event);
    res.json({ received: true, ...result });
  } catch (error) {
    console.error('[billing] webhook failed:', error);
    res.status(500).json({ received: false });
  }
}

export default router;
