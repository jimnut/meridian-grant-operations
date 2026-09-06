/**
 * Stripe integration without the SDK: three REST calls and a webhook
 * signature check, all over the built-in fetch. Everything is gated on
 * configuration so the product runs (trial, complimentary, invoiced plans)
 * with no Stripe account at all.
 */

import crypto from 'node:crypto';

import { config } from '../config';
import { PLAN_IDS, type PlanId } from '../../shared/plans';
import { timingSafeEqual } from './ids';

export type BillingInterval = 'monthly' | 'annual';

export function stripeConfigured(): boolean {
  return Boolean(config.stripeSecretKey) && PLAN_IDS.some((plan) => priceIdFor(plan, 'monthly') || priceIdFor(plan, 'annual'));
}

export function webhookConfigured(): boolean {
  return Boolean(config.stripeSecretKey) && Boolean(config.stripeWebhookSecret);
}

export function priceIdFor(plan: PlanId, interval: BillingInterval): string | null {
  const value = config.stripePriceIds[`${plan}_${interval}`];
  return value && value.trim() !== '' ? value : null;
}

/** Reverse lookup used by webhooks: which plan/interval does a Stripe price belong to? */
export function planForPriceId(priceId: string): { plan: PlanId; interval: BillingInterval } | null {
  for (const plan of PLAN_IDS) {
    for (const interval of ['monthly', 'annual'] as const) {
      if (priceIdFor(plan, interval) === priceId) return { plan, interval };
    }
  }
  return null;
}

/** Stripe accepts form-encoded bodies with bracketed nested keys. */
export function encodeForm(value: unknown, prefix = ''): string {
  const pairs: string[] = [];
  const walk = (node: unknown, key: string): void => {
    if (node === undefined || node === null) return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${key}[${index}]`));
      return;
    }
    if (typeof node === 'object') {
      for (const [child, childValue] of Object.entries(node as Record<string, unknown>)) {
        walk(childValue, key ? `${key}[${child}]` : child);
      }
      return;
    }
    pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(node))}`);
  };
  walk(value, prefix);
  return pairs.join('&');
}

export class StripeError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'StripeError';
    this.status = status;
  }
}

async function stripeRequest<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.stripeSecretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': '2024-06-20',
    },
    body: method === 'POST' ? encodeForm(body ?? {}) : undefined,
  });
  const data = (await response.json().catch(() => ({}))) as { error?: { message?: string } } & T;
  if (!response.ok) {
    throw new StripeError(response.status, data.error?.message ?? `Stripe responded ${response.status}`);
  }
  return data;
}

export interface CheckoutSessionInput {
  orgId: string;
  plan: PlanId;
  interval: BillingInterval;
  customerId: string | null;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
}

export async function createCheckoutSession(input: CheckoutSessionInput): Promise<{ id: string; url: string }> {
  const priceId = priceIdFor(input.plan, input.interval);
  if (!priceId) throw new StripeError(400, 'That plan is not available for online checkout yet.');
  const session = await stripeRequest<{ id: string; url: string }>('POST', '/checkout/sessions', {
    mode: 'subscription',
    client_reference_id: input.orgId,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    allow_promotion_codes: 'true',
    billing_address_collection: 'auto',
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: { orgId: input.orgId, plan: input.plan, interval: input.interval },
    subscription_data: { metadata: { orgId: input.orgId, plan: input.plan, interval: input.interval } },
    ...(input.customerId ? { customer: input.customerId } : { customer_email: input.customerEmail }),
  });
  return { id: session.id, url: session.url };
}

/* ------------------------------------------------ customer portal branding */

/**
 * The customer portal takes its headline, legal links and plan-switching
 * options from a "configuration". The Stripe account may be shared with other
 * products, so GrantConsole keeps a configuration of its own (found by
 * metadata, created on first use) instead of leaning on the dashboard default.
 */
const PORTAL_CONFIGURATION_MARKER = { app: 'grantconsole', revision: '1' } as const;

let portalConfigurationLookup: Promise<string | null> | null = null;

/** Tests reset this so each case starts without a cached configuration id. */
export function resetPortalConfigurationCache(): void {
  portalConfigurationLookup = null;
}

interface PortalConfiguration {
  id: string;
  metadata?: Record<string, string>;
}

function configuredPriceIds(): string[] {
  return PLAN_IDS.flatMap((plan) =>
    (['monthly', 'annual'] as const).map((interval) => priceIdFor(plan, interval)).filter((id): id is string => id !== null),
  );
}

/** Groups the configured prices by product so the portal can offer plan switches. */
async function portalProducts(): Promise<Array<{ product: string; prices: string[] }>> {
  const byProduct = new Map<string, string[]>();
  for (const priceId of configuredPriceIds()) {
    const price = await stripeRequest<{ product: string | { id: string } }>('GET', `/prices/${encodeURIComponent(priceId)}`);
    const productId = typeof price.product === 'string' ? price.product : price.product.id;
    byProduct.set(productId, [...(byProduct.get(productId) ?? []), priceId]);
  }
  return [...byProduct.entries()].map(([product, prices]) => ({ product, prices }));
}

async function findPortalConfiguration(): Promise<string | null> {
  const list = await stripeRequest<{ data: PortalConfiguration[] }>('GET', '/billing_portal/configurations?active=true&limit=100');
  const match = list.data.find(
    (item) => item.metadata?.app === PORTAL_CONFIGURATION_MARKER.app && item.metadata?.revision === PORTAL_CONFIGURATION_MARKER.revision,
  );
  return match?.id ?? null;
}

async function createPortalConfiguration(): Promise<string> {
  const products = await portalProducts();
  const created = await stripeRequest<{ id: string }>('POST', '/billing_portal/configurations', {
    business_profile: {
      headline: 'Manage your GrantConsole subscription',
      privacy_policy_url: `${config.appUrl}/privacy`,
      terms_of_service_url: `${config.appUrl}/terms`,
    },
    default_return_url: `${config.appUrl}/settings/billing`,
    features: {
      customer_update: { enabled: 'true', allowed_updates: ['email', 'name', 'address', 'tax_id'] },
      invoice_history: { enabled: 'true' },
      payment_method_update: { enabled: 'true' },
      subscription_cancel: {
        enabled: 'true',
        mode: 'at_period_end',
        cancellation_reason: { enabled: 'true', options: ['too_expensive', 'missing_features', 'switched_service', 'unused', 'other'] },
      },
      subscription_update:
        products.length > 0
          ? { enabled: 'true', default_allowed_updates: ['price'], proration_behavior: 'create_prorations', products }
          : { enabled: 'false' },
    },
    metadata: PORTAL_CONFIGURATION_MARKER,
  });
  return created.id;
}

/**
 * Resolves the GrantConsole portal configuration id, creating it the first
 * time. Returns null (and logs) when Stripe refuses, so the portal still opens
 * with the account default rather than failing the customer.
 */
export async function portalConfigurationId(): Promise<string | null> {
  if (!portalConfigurationLookup) {
    portalConfigurationLookup = (async () => {
      try {
        return (await findPortalConfiguration()) ?? (await createPortalConfiguration());
      } catch (error) {
        console.error('[billing] portal configuration unavailable, using the account default:', error instanceof Error ? error.message : error);
        portalConfigurationLookup = null;
        return null;
      }
    })();
  }
  return portalConfigurationLookup;
}

export async function createPortalSession(customerId: string, returnUrl: string): Promise<{ url: string }> {
  const configuration = await portalConfigurationId();
  const session = await stripeRequest<{ url: string }>('POST', '/billing_portal/sessions', {
    customer: customerId,
    return_url: returnUrl,
    ...(configuration ? { configuration } : {}),
  });
  return { url: session.url };
}

export interface StripeSubscription {
  id: string;
  status: string;
  customer: string;
  current_period_end: number;
  cancel_at_period_end: boolean;
  items: { data: Array<{ price: { id: string } }> };
  metadata?: Record<string, string>;
}

export async function retrieveSubscription(id: string): Promise<StripeSubscription> {
  return stripeRequest<StripeSubscription>('GET', `/subscriptions/${encodeURIComponent(id)}`);
}

/**
 * Verifies `Stripe-Signature` (t=…,v1=…) against the raw request body.
 * Rejects stale timestamps so a captured webhook cannot be replayed later.
 */
export function verifyWebhookSignature(
  rawBody: Buffer | string,
  header: string | undefined,
  secret: string,
  now: number = Math.floor(Date.now() / 1000),
  toleranceSeconds = 300,
): boolean {
  if (!header) return false;
  const parts = header.split(',').map((part) => part.trim());
  const timestamp = parts.find((part) => part.startsWith('t='))?.slice(2);
  const signatures = parts.filter((part) => part.startsWith('v1=')).map((part) => part.slice(3));
  if (!timestamp || signatures.length === 0) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > toleranceSeconds) return false;
  const payload = `${timestamp}.${typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8')}`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return signatures.some((signature) => timingSafeEqual(signature, expected));
}

/** Builds a `Stripe-Signature` header; used by tests to exercise the webhook. */
export function signWebhookPayload(rawBody: string, secret: string, timestamp: number): string {
  const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return `t=${timestamp},v1=${signature}`;
}
