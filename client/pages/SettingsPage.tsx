import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, Copy, CreditCard, ExternalLink, KeyRound, ShieldAlert, Trash2 } from 'lucide-react';

import { BRAND } from '../../shared/brand';
import { CURRENCIES, MONTH_NAMES, ROLE_LABELS } from '../../shared/constants';
import { COMMON_TIMEZONES, fiscalYearFor, formatIsoDate } from '../../shared/dates';
import { annualSavingsPercent, formatUsd, FOUNDING_OFFER, PLAN_IDS, PLANS, type PlanDefinition, type PlanId } from '../../shared/plans';
import type { BillingSummary, SessionOrganization, SessionPayload } from '../../shared/types';
import { trackEvent } from '../lib/analytics';
import { api, ApiRequestError } from '../lib/api';
import { formatBytes } from '../lib/format';
import { useCurrentSession, useSession } from '../lib/session';
import { useToast } from '../lib/toast';
import { Dialog } from '../components/Dialog';
import { Badge, Card, DefinitionList, Field, Input, LoadingState, Select, TabPanel, Tabs, useFocusFirstInvalid } from '../components/ui';

type SettingsTab = 'organization' | 'billing' | 'calendar' | 'account' | 'danger';
const TAB_IDS: SettingsTab[] = ['organization', 'billing', 'calendar', 'account', 'danger'];

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function SettingsPage() {
  const session = useCurrentSession();
  const { can } = useSession();
  const navigate = useNavigate();
  const { tab } = useParams();
  const active: SettingsTab = TAB_IDS.includes(tab as SettingsTab) ? (tab as SettingsTab) : 'organization';
  const canManage = can('org:manage');

  useEffect(() => {
    document.title = `Settings · ${BRAND.titleSuffix}`;
  }, []);

  const tabs: Array<{ id: SettingsTab; label: string }> = [
    { id: 'organization', label: 'Organization' },
    { id: 'billing', label: 'Plan & billing' },
    { id: 'calendar', label: 'Calendar feed' },
    { id: 'account', label: 'Your account' },
    ...(canManage && !session.workspace.isDemo ? [{ id: 'danger' as const, label: 'Danger zone' }] : []),
  ];

  return (
    <>
      <header className="page-header">
        <div className="page-header__text">
          <p className="page-header__eyebrow">{session.organization.name}</p>
          <h1 className="page-header__title">Settings</h1>
          <p className="page-header__lede">
            Organization details, your plan, the calendar feed your team can subscribe to, and your own account.
          </p>
        </div>
      </header>

      <div className="stack stack-5">
        <Tabs tabs={tabs} value={active} onChange={(id) => navigate(`/settings/${id}`)} idPrefix="settings" />
        <TabPanel id="organization" idPrefix="settings" active={active === 'organization'}>
          <OrganizationPanel />
        </TabPanel>
        <TabPanel id="billing" idPrefix="settings" active={active === 'billing'}>
          <BillingPanel />
        </TabPanel>
        <TabPanel id="calendar" idPrefix="settings" active={active === 'calendar'}>
          <CalendarPanel />
        </TabPanel>
        <TabPanel id="account" idPrefix="settings" active={active === 'account'}>
          <AccountPanel />
        </TabPanel>
        <TabPanel id="danger" idPrefix="settings" active={active === 'danger'}>
          <DangerPanel />
        </TabPanel>
      </div>
    </>
  );
}

/* --------------------------------------------------------- organization */

function OrganizationPanel() {
  const session = useCurrentSession();
  const { can, refresh } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    name: session.organization.name,
    timezone: session.organization.timezone,
    currency: session.organization.currency as string,
    fiscalYearStartMonth: String(session.organization.fiscalYearStartMonth),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  useFocusFirstInvalid(errors);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    setForm({
      name: session.organization.name,
      timezone: session.organization.timezone,
      currency: session.organization.currency,
      fiscalYearStartMonth: String(session.organization.fiscalYearStartMonth),
    });
  }, [session.organization]);

  const canManage = can('org:manage');

  const save = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.put<SessionOrganization>('/organization', payload),
    onSuccess: async () => {
      setErrors({});
      setFormError(null);
      await refresh();
      await queryClient.invalidateQueries();
      toast.success('Organization settings saved.');
    },
    onError: (error: unknown) => {
      if (error instanceof ApiRequestError) {
        setErrors(error.fields);
        setFormError(error.message);
      } else {
        setFormError('Those settings could not be saved.');
      }
    },
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    if (!form.name.trim()) {
      setErrors({ name: 'Organization name is required.' });
      return;
    }
    save.mutate({ name: form.name, timezone: form.timezone, currency: form.currency, fiscalYearStartMonth: Number(form.fiscalYearStartMonth) });
  };

  const fiscal = fiscalYearFor(session.today, session.organization.fiscalYearStartMonth);
  const timezones = COMMON_TIMEZONES.includes(session.organization.timezone as (typeof COMMON_TIMEZONES)[number])
    ? COMMON_TIMEZONES
    : ([session.organization.timezone, ...COMMON_TIMEZONES] as readonly string[]);

  return (
    <div className="grid grid--main-side">
      <Card title="Organization" subtitle={canManage ? 'Only owners can change these settings.' : 'Read-only for your role.'}>
        <form onSubmit={submit} noValidate className="stack stack-4">
          {formError && (
            <div className="banner banner--risk" role="alert">
              <div className="small">{formError}</div>
            </div>
          )}
          <div className="form-grid">
            <Field label="Organization name" htmlFor="org-name" error={errors.name} span>
              <Input id="org-name" value={form.name} disabled={!canManage} invalid={Boolean(errors.name)} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={160} required />
            </Field>
            <Field label="Timezone" htmlFor="org-timezone" error={errors.timezone} hint="Deadlines and “today” resolve in this zone.">
              <Select id="org-timezone" value={form.timezone} disabled={!canManage} onChange={(e) => setForm({ ...form, timezone: e.target.value })}>
                {timezones.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone.replace('_', ' ')}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Default currency" htmlFor="org-currency" error={errors.currency}>
              <Select id="org-currency" value={form.currency} disabled={!canManage} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                {CURRENCIES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Fiscal year starts" htmlFor="org-fiscal" error={errors.fiscalYearStartMonth} hint="Drives year-to-date awarded totals.">
              <Select id="org-fiscal" value={form.fiscalYearStartMonth} disabled={!canManage} onChange={(e) => setForm({ ...form, fiscalYearStartMonth: e.target.value })}>
                {MONTH_NAMES.map((month, index) => (
                  <option key={month} value={String(index + 1)}>
                    {month}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {canManage && (
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="submit" className="btn btn--primary" disabled={save.isPending}>
                {save.isPending ? 'Saving…' : 'Save settings'}
              </button>
            </div>
          )}
        </form>
      </Card>

      <div className="stack stack-5">
        <Card title="Current period">
          <DefinitionList
            items={[
              { term: 'Today', value: formatIsoDate(session.today, 'long') },
              { term: 'Fiscal year', value: fiscal.label },
              { term: 'FY period', value: `${formatIsoDate(fiscal.start)} – ${formatIsoDate(fiscal.end)}` },
              { term: 'Timezone', value: session.organization.timezone.replace('_', ' ') },
              { term: 'Currency', value: session.organization.currency },
              { term: 'Workspace slug', value: session.organization.slug },
            ]}
          />
        </Card>
        <Card title="Your access">
          <DefinitionList
            items={[
              { term: 'Signed in as', value: session.user.name },
              { term: 'Email', value: session.user.email },
              { term: 'Role', value: ROLE_LABELS[session.role] },
              { term: 'Organizations', value: String(session.memberships.length) },
            ]}
          />
          <p className="muted small" style={{ marginTop: 'var(--space-4)' }}>
            Records are scoped to the organization you are signed into. Switching organizations issues a new session and never
            carries data across.
          </p>
        </Card>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- billing */

function UsageBar({ label, used, limit, format }: { label: string; used: number; limit: number | null; format?: (n: number) => string }) {
  const fmt = format ?? ((n: number) => String(n));
  const percent = limit === null ? 0 : Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
  const tone = percent >= 100 ? 'var(--risk)' : percent >= 80 ? 'var(--amber)' : 'var(--accent)';
  return (
    <div className="usage-list__row">
      <div className="usage-list__label">
        <span>{label}</span>
        <span className="muted">
          {fmt(used)} {limit === null ? '· unlimited' : `of ${fmt(limit)}`}
        </span>
      </div>
      <div style={{ height: 8, borderRadius: 999, background: 'var(--canvas-deep)', overflow: 'hidden' }} aria-hidden="true">
        <div style={{ width: `${limit === null ? 4 : percent}%`, height: '100%', background: tone, transition: 'width 200ms' }} />
      </div>
    </div>
  );
}

function BillingPanel() {
  const session = useCurrentSession();
  const { can, refresh } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [interval, setInterval] = useState<'monthly' | 'annual'>('annual');
  const canManage = can('org:manage');

  const { data, isLoading, isError } = useQuery({ queryKey: ['billing'], queryFn: () => api.get<BillingSummary>('/billing') });

  useEffect(() => {
    const outcome = params.get('checkout');
    if (!outcome) return;
    if (outcome === 'success') {
      toast.success('Thank you — your subscription is active. It can take a few seconds to show here.');
      trackEvent('subscription_activated');
      void refresh();
      void queryClient.invalidateQueries({ queryKey: ['billing'] });
    } else if (outcome === 'canceled') {
      toast.push('Checkout was cancelled. Your trial continues.', 'info');
    }
    params.delete('checkout');
    setParams(params, { replace: true });
  }, [params, setParams, toast, refresh, queryClient]);

  const checkout = useMutation({
    mutationFn: (payload: { plan: PlanId; interval: 'monthly' | 'annual' }) => api.post<{ url: string }>('/billing/checkout', payload),
    onSuccess: (result, variables) => {
      trackEvent('begin_checkout', { plan: variables.plan, interval: variables.interval });
      window.location.assign(result.url);
    },
    onError: (error: unknown) => toast.error(error instanceof ApiRequestError ? error.message : 'Checkout could not be started.'),
  });

  const portal = useMutation({
    mutationFn: () => api.post<{ url: string }>('/billing/portal'),
    onSuccess: (result) => window.location.assign(result.url),
    onError: (error: unknown) => toast.error(error instanceof ApiRequestError ? error.message : 'The billing portal could not be opened.'),
  });

  const [billingEmail, setBillingEmail] = useState('');
  useEffect(() => {
    if (data) setBillingEmail(data.billingEmail ?? '');
  }, [data]);
  const saveEmail = useMutation({
    mutationFn: (email: string) => api.put('/billing/email', { billingEmail: email }),
    onSuccess: async () => {
      toast.success('Billing email saved.');
      await queryClient.invalidateQueries({ queryKey: ['billing'] });
    },
    onError: (error: unknown) => toast.error(error instanceof ApiRequestError ? error.message : 'Could not save the billing email.'),
  });

  if (isLoading) {
    return (
      <div className="card">
        <LoadingState label="Loading your plan…" />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="card">
        <p className="muted">Billing details could not be loaded. Reload the page to try again.</p>
      </div>
    );
  }

  const ws = data.workspace;
  const mailto = (plan: PlanDefinition) =>
    `mailto:${data.supportEmail}?subject=${encodeURIComponent(`Activate the ${plan.name} plan for ${session.organization.name}`)}&body=${encodeURIComponent(
      `Organization: ${session.organization.name} (${session.organization.slug})\nPlan: ${plan.name}, billed ${interval}\nBilling contact: ${data.billingEmail ?? session.user.email}\n\nPlease send an invoice / activate this plan.`,
    )}`;

  return (
    <div className="stack stack-5">
      <div className="grid grid--main-side">
        <Card
          title="Your plan"
          subtitle={
            ws.isDemo
              ? 'The public demo has no plan; create your own workspace to subscribe.'
              : ws.status === 'trialing'
                ? `Free trial · ${ws.trialDaysLeft} day${ws.trialDaysLeft === 1 ? '' : 's'} left`
                : ws.statusLabel
          }
          actions={
            <Badge tone={ws.readOnly ? 'risk' : ws.status === 'active' || ws.status === 'complimentary' ? 'positive' : ws.status === 'past_due' ? 'amber' : 'accent'}>
              {ws.planName}
            </Badge>
          }
        >
          <div className="stack stack-4">
            {ws.readOnly && (
              <div className="banner banner--risk" role="alert">
                <ShieldAlert size={17} className="banner__icon" aria-hidden="true" />
                <div>{ws.readOnlyReason}</div>
              </div>
            )}
            {ws.status === 'past_due' && (
              <div className="banner banner--amber" role="alert">
                <CreditCard size={17} className="banner__icon" aria-hidden="true" />
                <div>The last payment did not go through. Update the card in the billing portal to keep the workspace active.</div>
              </div>
            )}
            <div className="usage-list">
              <UsageBar label="Active grants" used={data.usage.activeGrants} limit={ws.limits.activeGrants} />
              <UsageBar label="Editor seats (viewers are free)" used={data.usage.members + data.usage.pendingInvites} limit={ws.limits.members} />
              <UsageBar label="Evidence storage" used={data.usage.storageBytes} limit={ws.limits.storageMb * 1024 * 1024} format={formatBytes} />
            </div>
            {ws.validUntil && (
              <p className="muted small">
                Access continues until {formatIsoDate(ws.validUntil.slice(0, 10), 'long')}.
              </p>
            )}
            {data.portalAvailable && canManage && (
              <button type="button" className="btn" onClick={() => portal.mutate()} disabled={portal.isPending}>
                <ExternalLink size={16} aria-hidden="true" />
                {portal.isPending ? 'Opening…' : 'Manage subscription, invoices and card'}
              </button>
            )}
          </div>
        </Card>

        <Card title="Billing contact" subtitle="Receipts and renewal notices go here.">
          <form
            className="stack stack-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (billingEmail.trim()) saveEmail.mutate(billingEmail.trim());
            }}
          >
            <Field label="Billing email" htmlFor="billing-email">
              <Input id="billing-email" type="email" value={billingEmail} disabled={!canManage || ws.isDemo} onChange={(e) => setBillingEmail(e.target.value)} />
            </Field>
            {canManage && !ws.isDemo && (
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button type="submit" className="btn" disabled={saveEmail.isPending}>
                  Save
                </button>
              </div>
            )}
            <p className="muted small">
              Prefer an invoice paid by ACH or check? Email <a href={`mailto:${data.supportEmail}`}>{data.supportEmail}</a> and we will
              send a W-9 and an annual invoice the same business day.
            </p>
          </form>
        </Card>
      </div>

      <Card
        title={ws.status === 'active' ? 'Change plan' : 'Choose a plan'}
        subtitle="Every plan includes the whole product; they differ in active grants, editor seats and storage. Viewers are always free."
        actions={
          <div className="segmented" role="group" aria-label="Billing interval">
            <button type="button" aria-pressed={interval === 'annual'} onClick={() => setInterval('annual')}>
              Annual · 2 months free
            </button>
            <button type="button" aria-pressed={interval === 'monthly'} onClick={() => setInterval('monthly')}>
              Monthly
            </button>
          </div>
        }
      >
        <div className="plan-grid">
          {PLAN_IDS.map((id) => {
            const plan = PLANS[id];
            const current = data.currentPlan === id && (ws.status === 'active' || ws.status === 'past_due' || ws.status === 'complimentary');
            const price = interval === 'annual' ? plan.priceAnnualUsdPerMonth : plan.priceMonthlyUsd;
            return (
              <div key={id} className={`plan-card${plan.recommended ? ' plan-card--recommended' : ''}${current ? ' plan-card--current' : ''}`}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="plan-card__name">{plan.name}</span>
                  {current ? <Badge tone="positive">Current</Badge> : plan.recommended ? <Badge tone="accent">Most popular</Badge> : null}
                </div>
                <p className="muted small" style={{ margin: 0 }}>
                  {plan.tagline}
                </p>
                <p className="plan-card__price" style={{ margin: 0 }}>
                  {formatUsd(price)}
                  <small> /month{interval === 'annual' ? `, billed ${formatUsd(price * 12)} a year (save ${annualSavingsPercent(plan)}%)` : ''}</small>
                </p>
                <ul className="plan-card__features">
                  {plan.features.slice(0, 4).map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
                {!ws.isDemo && canManage && !current && (
                  data.checkoutAvailable ? (
                    <button type="button" className={`btn ${plan.recommended ? 'btn--primary' : ''}`} disabled={checkout.isPending} onClick={() => checkout.mutate({ plan: id, interval })}>
                      <CreditCard size={16} aria-hidden="true" />
                      {checkout.isPending ? 'Opening checkout…' : `Choose ${plan.name}`}
                    </button>
                  ) : (
                    <a className={`btn ${plan.recommended ? 'btn--primary' : ''}`} href={mailto(plan)} onClick={() => trackEvent('request_invoice', { plan: id, interval })}>
                      Email us to activate {plan.name}
                    </a>
                  )
                )}
                {!canManage && !ws.isDemo && (
                  <p className="muted small" style={{ margin: 0 }}>
                    An owner can choose this plan.
                  </p>
                )}
              </div>
            );
          })}
        </div>
        <p className="muted small" style={{ marginTop: 'var(--space-4)' }}>
          {data.foundingOffer.remaining > 0 && (
            <>
              Founding-customer offer: the first {FOUNDING_OFFER.organizations} organizations lock in {data.foundingOffer.percentOff}% off their first
              year, applied automatically at checkout ({data.foundingOffer.remaining} {data.foundingOffer.remaining === 1 ? 'place' : 'places'} left).{' '}
            </>
          )}
          Cancel any time; your records stay exportable. <a href="/pricing" target="_blank" rel="noreferrer">Full pricing details ↗</a>
        </p>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------- calendar */

function CalendarPanel() {
  const { can } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canManage = can('team:manage');
  const { data, isLoading } = useQuery({ queryKey: ['calendar-feed'], queryFn: () => api.get<{ url: string | null }>('/calendar/feed') });

  const create = useMutation({
    mutationFn: () => api.post<{ url: string }>('/calendar/feed'),
    onSuccess: async () => {
      trackEvent('calendar_feed_created');
      await queryClient.invalidateQueries({ queryKey: ['calendar-feed'] });
      await queryClient.invalidateQueries({ queryKey: ['onboarding'] });
      toast.success('Calendar link ready.');
    },
    onError: (error: unknown) => toast.error(error instanceof ApiRequestError ? error.message : 'Could not create the feed.'),
  });
  const disable = useMutation({
    mutationFn: () => api.delete('/calendar/feed'),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['calendar-feed'] });
      toast.success('Calendar feed disabled.');
    },
    onError: (error: unknown) => toast.error(error instanceof ApiRequestError ? error.message : 'Could not disable the feed.'),
  });

  const url = data?.url ?? null;

  return (
    <div className="grid grid--main-side">
      <Card title="Subscribe your calendar" subtitle="Every task, deliverable, period end, renewal and closeout appears in Google Calendar, Outlook or Apple Calendar and updates itself.">
        {isLoading ? (
          <LoadingState label="Loading…" />
        ) : url ? (
          <div className="stack stack-4">
            <div className="copy-row">
              <Input readOnly value={url} aria-label="Calendar feed address" onFocus={(e) => e.currentTarget.select()} />
              <button
                type="button"
                className="btn"
                onClick={async () => {
                  toast.push((await copyText(url)) ? 'Copied the calendar link.' : 'Select the link and copy it.', 'info');
                }}
              >
                <Copy size={16} aria-hidden="true" />
                Copy
              </button>
            </div>
            <div className="banner banner--amber">
              <ShieldAlert size={17} className="banner__icon" aria-hidden="true" />
              <div>Anyone with this link can read your deadlines. Share it only with your team; rotate it if it leaks.</div>
            </div>
            {canManage && (
              <div className="row">
                <button type="button" className="btn" onClick={() => create.mutate()} disabled={create.isPending}>
                  Rotate link
                </button>
                <button type="button" className="btn btn--danger" onClick={() => disable.mutate()} disabled={disable.isPending}>
                  Disable feed
                </button>
              </div>
            )}
          </div>
        ) : canManage ? (
          <div className="stack stack-4">
            <p className="muted">No feed yet. Create a secret link, then subscribe to it from your calendar app.</p>
            <button type="button" className="btn btn--primary" style={{ alignSelf: 'flex-start' }} onClick={() => create.mutate()} disabled={create.isPending}>
              <CalendarPlus size={16} aria-hidden="true" />
              {create.isPending ? 'Creating…' : 'Create calendar link'}
            </button>
          </div>
        ) : (
          <p className="muted">An owner or manager can create the calendar link from this page.</p>
        )}
      </Card>
      <Card title="How to subscribe">
        <ol className="stack stack-2" style={{ paddingLeft: 18, margin: 0, fontSize: 'var(--text-sm)' }}>
          <li>
            <strong>Google Calendar:</strong> Other calendars → + → From URL → paste the link.
          </li>
          <li>
            <strong>Outlook:</strong> Add calendar → Subscribe from web → paste the link.
          </li>
          <li>
            <strong>Apple Calendar:</strong> File → New Calendar Subscription → paste the link.
          </li>
        </ol>
        <p className="muted small" style={{ marginTop: 'var(--space-4)' }}>
          Calendars refresh on their own schedule, usually within a few hours. Completed items stay listed with a check mark.
        </p>
      </Card>
    </div>
  );
}

/* --------------------------------------------------------------- account */

function AccountPanel() {
  const session = useCurrentSession();
  const { refresh } = useSession();
  const toast = useToast();
  const [profile, setProfile] = useState({ name: session.user.name, title: '' });
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const saveProfile = useMutation({
    mutationFn: (payload: { name: string; title: string }) => api.put<SessionPayload>('/auth/profile', payload),
    onSuccess: async () => {
      await refresh();
      toast.success('Profile saved.');
    },
    onError: (error: unknown) => toast.error(error instanceof ApiRequestError ? error.message : 'Could not save your profile.'),
  });

  const changePassword = useMutation({
    mutationFn: (payload: { currentPassword: string; newPassword: string }) => api.put('/auth/password', payload),
    onSuccess: () => {
      setPasswords({ currentPassword: '', newPassword: '', confirm: '' });
      setErrors({});
      toast.success('Password changed. Other devices were signed out.');
    },
    onError: (error: unknown) => {
      if (error instanceof ApiRequestError) {
        setErrors(error.fields);
        toast.error(error.message);
      } else {
        toast.error('Could not change your password.');
      }
    },
  });

  return (
    <div className="grid grid--halves">
      <Card title="Profile" subtitle="How your name appears to teammates and in the activity trail.">
        <form
          className="stack stack-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (profile.name.trim()) saveProfile.mutate({ name: profile.name.trim(), title: profile.title.trim() });
          }}
        >
          <Field label="Your name" htmlFor="account-name">
            <Input id="account-name" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} maxLength={120} required />
          </Field>
          <Field label="Title" htmlFor="account-title" optional hint="e.g. Grants Manager">
            <Input id="account-title" value={profile.title} onChange={(e) => setProfile({ ...profile, title: e.target.value })} maxLength={120} />
          </Field>
          <Field label="Email" htmlFor="account-email" hint="Email changes are handled by support for now.">
            <Input id="account-email" value={session.user.email} readOnly />
          </Field>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="submit" className="btn btn--primary" disabled={saveProfile.isPending}>
              Save profile
            </button>
          </div>
        </form>
      </Card>
      <Card title="Password" subtitle="At least 10 characters. Changing it signs out every other device.">
        {session.workspace.isDemo ? (
          <p className="muted">Demo accounts share a published password that cannot be changed.</p>
        ) : (
          <form
            className="stack stack-4"
            onSubmit={(event) => {
              event.preventDefault();
              const next: Record<string, string> = {};
              if (!passwords.currentPassword) next.currentPassword = 'Enter your current password.';
              if (passwords.newPassword.length < 10) next.newPassword = 'Use at least 10 characters.';
              if (passwords.newPassword !== passwords.confirm) next.confirm = 'Passwords do not match.';
              setErrors(next);
              if (Object.keys(next).length === 0) changePassword.mutate({ currentPassword: passwords.currentPassword, newPassword: passwords.newPassword });
            }}
          >
            <Field label="Current password" htmlFor="pw-current" error={errors.currentPassword}>
              <Input id="pw-current" type="password" autoComplete="current-password" value={passwords.currentPassword} invalid={Boolean(errors.currentPassword)} onChange={(e) => setPasswords({ ...passwords, currentPassword: e.target.value })} />
            </Field>
            <Field label="New password" htmlFor="pw-new" error={errors.newPassword}>
              <Input id="pw-new" type="password" autoComplete="new-password" value={passwords.newPassword} invalid={Boolean(errors.newPassword)} onChange={(e) => setPasswords({ ...passwords, newPassword: e.target.value })} />
            </Field>
            <Field label="Confirm new password" htmlFor="pw-confirm" error={errors.confirm}>
              <Input id="pw-confirm" type="password" autoComplete="new-password" value={passwords.confirm} invalid={Boolean(errors.confirm)} onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })} />
            </Field>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="submit" className="btn" disabled={changePassword.isPending}>
                <KeyRound size={16} aria-hidden="true" />
                Change password
              </button>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------- danger */

function DangerPanel() {
  const session = useCurrentSession();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const remove = useMutation({
    mutationFn: () => api.delete('/organization', { password, confirmName }),
    onSuccess: () => {
      window.location.assign('/');
    },
    onError: (error: unknown) => {
      if (error instanceof ApiRequestError) {
        setErrors(error.fields);
        toast.error(error.message);
      } else {
        toast.error('The organization could not be deleted.');
      }
    },
  });

  return (
    <Card title="Delete this organization" subtitle="Permanent. Export what you need first.">
      <div className="stack stack-4">
        <p className="muted">
          Deleting <strong>{session.organization.name}</strong> removes every grant, deliverable, budget line, note, uploaded file,
          invitation and billing link. People who belong only to this organization lose their sign-in. This cannot be undone.
        </p>
        <button type="button" className="btn btn--danger" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(true)}>
          <Trash2 size={16} aria-hidden="true" />
          Delete organization…
        </button>
      </div>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Delete the organization?"
        description="Type the organization name and your password to confirm. Everything is removed immediately."
        footer={
          <>
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn--danger" disabled={remove.isPending || !confirmName || !password} onClick={() => remove.mutate()}>
              {remove.isPending ? 'Deleting…' : 'Delete everything'}
            </button>
          </>
        }
      >
        <div className="stack stack-4">
          <Field label={`Type “${session.organization.name}”`} htmlFor="delete-name" error={errors.confirmName}>
            <Input id="delete-name" value={confirmName} invalid={Boolean(errors.confirmName)} onChange={(e) => setConfirmName(e.target.value)} autoComplete="off" />
          </Field>
          <Field label="Your password" htmlFor="delete-password" error={errors.password}>
            <Input id="delete-password" type="password" autoComplete="current-password" value={password} invalid={Boolean(errors.password)} onChange={(e) => setPassword(e.target.value)} />
          </Field>
        </div>
      </Dialog>
    </Card>
  );
}
