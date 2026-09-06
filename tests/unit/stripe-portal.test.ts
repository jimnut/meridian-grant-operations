import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { config } from '../../server/config';
import { createCheckoutSession, createPortalSession, resetFoundingCouponCache, resetPortalConfigurationCache } from '../../server/lib/stripe';

interface StripeCall {
  method: string;
  path: string;
  body: URLSearchParams;
  version: string | undefined;
}

/** Fakes api.stripe.com: `respond` returns a JSON payload or an Error for a 400. */
function stubStripe(respond: (call: StripeCall) => unknown): StripeCall[] {
  const calls: StripeCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const call: StripeCall = {
        method: init?.method ?? 'GET',
        path: url.replace('https://api.stripe.com/v1', ''),
        body: new URLSearchParams(typeof init?.body === 'string' ? init.body : ''),
        version: (init?.headers as Record<string, string> | undefined)?.['Stripe-Version'],
      };
      calls.push(call);
      const payload = respond(call);
      if (payload instanceof Error) {
        return new Response(JSON.stringify({ error: { message: payload.message } }), { status: 400 });
      }
      return new Response(JSON.stringify(payload), { status: 200 });
    }),
  );
  return calls;
}

const originalPriceIds = { ...config.stripePriceIds };

beforeEach(() => {
  resetPortalConfigurationCache();
  resetFoundingCouponCache();
  for (const key of Object.keys(config.stripePriceIds)) config.stripePriceIds[key] = '';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Object.assign(config.stripePriceIds, originalPriceIds);
});

describe('customer portal configuration', () => {
  it('reuses the GrantConsole configuration when the account already has one', async () => {
    const calls = stubStripe((call) => {
      if (call.path.startsWith('/billing_portal/configurations')) {
        return { data: [{ id: 'bpc_lensable', metadata: {} }, { id: 'bpc_grantconsole', metadata: { app: 'grantconsole', revision: '1' } }] };
      }
      if (call.path === '/billing_portal/sessions') return { url: 'https://billing.stripe.com/session/abc' };
      return new Error(`unexpected ${call.method} ${call.path}`);
    });

    const portal = await createPortalSession('cus_123', 'https://grantconsole.com/settings/billing');

    expect(portal.url).toBe('https://billing.stripe.com/session/abc');
    const session = calls.find((call) => call.path === '/billing_portal/sessions');
    expect(session?.body.get('customer')).toBe('cus_123');
    expect(session?.body.get('configuration')).toBe('bpc_grantconsole');
    expect(calls.some((call) => call.method === 'POST' && call.path === '/billing_portal/configurations')).toBe(false);
  });

  it('creates a branded configuration on first use and offers every configured plan', async () => {
    Object.assign(config.stripePriceIds, {
      starter_monthly: 'price_starter_m',
      growth_monthly: 'price_growth_m',
      growth_annual: 'price_growth_y',
    });
    const productFor: Record<string, string> = { price_starter_m: 'prod_starter', price_growth_m: 'prod_growth', price_growth_y: 'prod_growth' };
    const calls = stubStripe((call) => {
      if (call.method === 'GET' && call.path.startsWith('/billing_portal/configurations')) return { data: [] };
      if (call.method === 'GET' && call.path.startsWith('/prices/')) return { product: productFor[call.path.slice('/prices/'.length)] };
      if (call.method === 'POST' && call.path === '/billing_portal/configurations') return { id: 'bpc_new' };
      if (call.path === '/billing_portal/sessions') return { url: 'https://billing.stripe.com/session/new' };
      return new Error(`unexpected ${call.method} ${call.path}`);
    });

    await createPortalSession('cus_456', 'https://grantconsole.com/settings/billing');

    const created = calls.find((call) => call.method === 'POST' && call.path === '/billing_portal/configurations');
    expect(created).toBeDefined();
    const body = created!.body;
    expect(body.get('business_profile[headline]')).toBe('Manage your GrantConsole subscription');
    expect(body.get('business_profile[privacy_policy_url]')).toBe('https://grantconsole.com/privacy');
    expect(body.get('business_profile[terms_of_service_url]')).toBe('https://grantconsole.com/terms');
    expect(body.get('default_return_url')).toBe('https://grantconsole.com/settings/billing');
    expect(body.get('metadata[app]')).toBe('grantconsole');
    expect(body.get('features[subscription_cancel][mode]')).toBe('at_period_end');
    expect(body.get('features[subscription_update][enabled]')).toBe('true');
    expect(body.get('features[subscription_update][products][0][product]')).toBe('prod_starter');
    expect(body.get('features[subscription_update][products][0][prices][0]')).toBe('price_starter_m');
    expect(body.get('features[subscription_update][products][1][product]')).toBe('prod_growth');
    expect(body.getAll('features[subscription_update][products][1][prices][0]')).toEqual(['price_growth_m']);
    expect(body.get('features[subscription_update][products][1][prices][1]')).toBe('price_growth_y');
    expect(calls.find((call) => call.path === '/billing_portal/sessions')?.body.get('configuration')).toBe('bpc_new');

    // A second portal opening reuses the cached id without another lookup.
    const before = calls.length;
    await createPortalSession('cus_789', 'https://grantconsole.com/settings/billing');
    expect(calls.slice(before).map((call) => call.path)).toEqual(['/billing_portal/sessions']);
  });

  it('falls back to the account default when Stripe refuses the configuration', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const calls = stubStripe((call) => {
      if (call.path.startsWith('/billing_portal/configurations')) return new Error('restricted key');
      if (call.path === '/billing_portal/sessions') return { url: 'https://billing.stripe.com/session/default' };
      return new Error(`unexpected ${call.method} ${call.path}`);
    });

    const portal = await createPortalSession('cus_123', 'https://grantconsole.com/settings/billing');

    expect(portal.url).toBe('https://billing.stripe.com/session/default');
    expect(calls.find((call) => call.path === '/billing_portal/sessions')?.body.has('configuration')).toBe(false);
    expect(error).toHaveBeenCalledOnce();
  });
});

describe('checkout session', () => {
  const input = {
    orgId: 'org_1',
    plan: 'growth' as const,
    interval: 'monthly' as const,
    customerId: null,
    customerEmail: 'owner@example.org',
    successUrl: 'https://grantconsole.com/settings/billing?checkout=success',
    cancelUrl: 'https://grantconsole.com/settings/billing?checkout=canceled',
  };

  beforeEach(() => {
    Object.assign(config.stripePriceIds, { growth_monthly: 'price_growth_m', growth_annual: 'price_growth_y', scale_monthly: 'price_scale_m' });
  });

  it('brands the page as GrantConsole and applies the founding coupon, creating it on first use', async () => {
    const productFor: Record<string, string> = { price_growth_m: 'prod_growth', price_growth_y: 'prod_growth', price_scale_m: 'prod_scale' };
    const calls = stubStripe((call) => {
      if (call.method === 'GET' && call.path.startsWith('/coupons')) return { data: [{ id: 'cpn_old', valid: false, metadata: { app: 'grantconsole', offer: 'founding', revision: '1' } }] };
      if (call.method === 'GET' && call.path.startsWith('/prices/')) return { product: productFor[call.path.slice('/prices/'.length)] };
      if (call.method === 'POST' && call.path === '/coupons') return { id: 'cpn_founding' };
      if (call.method === 'POST' && call.path === '/checkout/sessions') return { id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' };
      return new Error(`unexpected ${call.method} ${call.path}`);
    });

    const result = await createCheckoutSession({ ...input, foundingOffer: true });

    expect(result).toEqual({ id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1', foundingOfferApplied: true });
    const coupon = calls.find((call) => call.method === 'POST' && call.path === '/coupons')!;
    expect(coupon.body.get('percent_off')).toBe('25');
    expect(coupon.body.get('duration')).toBe('repeating');
    expect(coupon.body.get('duration_in_months')).toBe('12');
    expect(coupon.body.get('max_redemptions')).toBe('25');
    expect(coupon.body.getAll('applies_to[products][0]')).toEqual(['prod_growth']);
    expect(coupon.body.get('applies_to[products][1]')).toBe('prod_scale');
    expect(coupon.body.get('metadata[offer]')).toBe('founding');

    const session = calls.find((call) => call.path === '/checkout/sessions')!;
    expect(session.version).toBe('2025-09-30.clover');
    expect(session.body.get('mode')).toBe('subscription');
    expect(session.body.get('line_items[0][price]')).toBe('price_growth_m');
    expect(session.body.get('branding_settings[display_name]')).toBe('GrantConsole');
    expect(session.body.get('discounts[0][coupon]')).toBe('cpn_founding');
    expect(session.body.has('allow_promotion_codes')).toBe(false);
    expect(session.body.get('subscription_data[description]')).toBe('GrantConsole Growth plan, billed monthly');
    expect(session.body.get('subscription_data[metadata][orgId]')).toBe('org_1');
    expect(session.body.get('customer_email')).toBe('owner@example.org');

    // The coupon id is cached for the next checkout.
    const before = calls.length;
    await createCheckoutSession({ ...input, foundingOffer: true });
    expect(calls.slice(before).map((call) => call.path)).toEqual(['/checkout/sessions']);
  });

  it('lets customers type promotion codes once the founding offer is used up', async () => {
    const calls = stubStripe((call) => {
      if (call.path === '/checkout/sessions') return { id: 'cs_2', url: 'https://checkout.stripe.com/c/pay/cs_2' };
      return new Error(`unexpected ${call.method} ${call.path}`);
    });

    const result = await createCheckoutSession({ ...input, customerId: 'cus_9', foundingOffer: false });

    expect(result.foundingOfferApplied).toBe(false);
    const session = calls.find((call) => call.path === '/checkout/sessions')!;
    expect(session.body.get('allow_promotion_codes')).toBe('true');
    expect(session.body.has('discounts[0][coupon]')).toBe(false);
    expect(session.body.get('customer')).toBe('cus_9');
    expect(calls.some((call) => call.path.startsWith('/coupons'))).toBe(false);
  });

  it('retries plainly when Stripe rejects the branding or the coupon', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let attempts = 0;
    const calls = stubStripe((call) => {
      if (call.method === 'GET' && call.path.startsWith('/coupons')) return { data: [{ id: 'cpn_founding', valid: true, metadata: { app: 'grantconsole', offer: 'founding', revision: '1' } }] };
      if (call.path === '/checkout/sessions') {
        attempts += 1;
        return attempts === 1 ? new Error('Received unknown parameter: branding_settings') : { id: 'cs_3', url: 'https://checkout.stripe.com/c/pay/cs_3' };
      }
      return new Error(`unexpected ${call.method} ${call.path}`);
    });

    const result = await createCheckoutSession({ ...input, foundingOffer: true });

    expect(result).toEqual({ id: 'cs_3', url: 'https://checkout.stripe.com/c/pay/cs_3', foundingOfferApplied: false });
    const retry = calls.filter((call) => call.path === '/checkout/sessions')[1]!;
    expect(retry.version).toBe('2024-06-20');
    expect(retry.body.has('branding_settings[display_name]')).toBe(false);
    expect(retry.body.get('allow_promotion_codes')).toBe('true');
    expect(error).toHaveBeenCalledOnce();
  });
});
