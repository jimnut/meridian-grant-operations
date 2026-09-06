import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { CircleAlert, Sparkles } from 'lucide-react';

import { PLANS, TRIAL_DAYS, type PlanId } from '../../shared/plans';
import type { SessionPayload } from '../../shared/types';
import { trackEvent } from '../lib/analytics';
import { api, ApiRequestError, setCsrfToken } from '../lib/api';
import { useSession } from '../lib/session';
import { AuthLayout } from '../components/AuthLayout';
import { Field, Input, useFocusFirstInvalid } from '../components/ui';

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
  } catch {
    return 'America/New_York';
  }
}

export function SignUpPage() {
  const { refresh } = useSession();
  const [params] = useSearchParams();
  const requestedPlan = params.get('plan');
  const plan: PlanId | null = requestedPlan && requestedPlan in PLANS ? (requestedPlan as PlanId) : null;

  const [form, setForm] = useState({ name: '', email: '', password: '', organizationName: '', website: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  useFocusFirstInvalid(errors);

  const signUp = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post<SessionPayload>('/auth/sign-up', payload),
    onSuccess: async (payload) => {
      if (payload && 'csrfToken' in payload) setCsrfToken(payload.csrfToken);
      trackEvent('sign_up', { method: 'email', plan: plan ?? 'trial' });
      setErrors({});
      setFormError(null);
      await refresh();
    },
    onError: (error: unknown) => {
      if (error instanceof ApiRequestError) {
        setErrors(error.fields);
        setFormError(error.message);
      } else {
        setFormError('We could not create your workspace. Please try again.');
      }
    },
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!form.name.trim()) next.name = 'Enter your name.';
    if (!form.email.trim()) next.email = 'Enter your work email.';
    if (form.password.length < 10) next.password = 'Use at least 10 characters.';
    if (!form.organizationName.trim()) next.organizationName = 'Enter your organization name.';
    setErrors(next);
    if (Object.keys(next).length > 0) {
      setFormError('Check the highlighted fields.');
      return;
    }
    setFormError(null);
    signUp.mutate({ ...form, timezone: browserTimezone() });
  };

  const busy = signUp.isPending;

  return (
    <AuthLayout
      title="Start your free trial"
      headline="Your grants, accounted for — in an afternoon."
      lede={`Create a workspace, import your spreadsheet or add your first award, and see every deadline, restricted budget and risk signal in one place. ${TRIAL_DAYS} days free, every feature, no card.`}
    >
      <h2 style={{ fontSize: 'var(--text-2xl)', letterSpacing: '-0.02em' }}>Create your workspace</h2>
      <p className="muted" style={{ marginTop: 'var(--space-2)', marginBottom: 'var(--space-5)' }}>
        {plan
          ? `You picked the ${PLANS[plan].name} plan. Your ${TRIAL_DAYS}-day trial starts now; choose the plan in Settings whenever you are ready.`
          : `${TRIAL_DAYS}-day free trial of every feature. No card, no sales call.`}
      </p>

      <form onSubmit={submit} noValidate className="stack stack-4">
        {formError && (
          <div className="banner banner--risk" role="alert">
            <CircleAlert size={17} className="banner__icon" aria-hidden="true" />
            <div>
              {formError}
              {signUp.error instanceof ApiRequestError && signUp.error.status === 409 && (
                <>
                  {' '}
                  <Link to="/signin">Sign in</Link> or <Link to="/forgot-password">reset your password</Link>.
                </>
              )}
            </div>
          </div>
        )}

        <Field label="Your name" htmlFor="signup-name" error={errors.name}>
          <Input
            id="signup-name"
            autoComplete="name"
            required
            value={form.name}
            invalid={Boolean(errors.name)}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            maxLength={120}
          />
        </Field>

        <Field label="Work email" htmlFor="signup-email" error={errors.email}>
          <Input
            id="signup-email"
            type="email"
            autoComplete="email"
            required
            value={form.email}
            invalid={Boolean(errors.email)}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="you@organization.org"
            maxLength={200}
          />
        </Field>

        <Field label="Password" htmlFor="signup-password" error={errors.password} hint="At least 10 characters. A short sentence works well.">
          <Input
            id="signup-password"
            type="password"
            autoComplete="new-password"
            required
            value={form.password}
            invalid={Boolean(errors.password)}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            maxLength={200}
          />
        </Field>

        <Field label="Organization name" htmlFor="signup-org" error={errors.organizationName} hint="As it appears on your grant agreements.">
          <Input
            id="signup-org"
            autoComplete="organization"
            required
            value={form.organizationName}
            invalid={Boolean(errors.organizationName)}
            onChange={(e) => setForm({ ...form, organizationName: e.target.value })}
            maxLength={160}
          />
        </Field>

        {/* Honeypot: hidden from people, irresistible to bots. */}
        <div className="hp" aria-hidden="true">
          <label htmlFor="signup-website">Website</label>
          <input
            id="signup-website"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            value={form.website}
            onChange={(e) => setForm({ ...form, website: e.target.value })}
          />
        </div>

        <button type="submit" className="btn btn--primary btn--lg btn--block" disabled={busy}>
          <Sparkles size={16} aria-hidden="true" />
          {busy ? 'Creating your workspace…' : 'Create workspace'}
        </button>

        <p className="muted small" style={{ textAlign: 'center' }}>
          By creating a workspace you agree to the <a href="/terms">terms</a> and <a href="/privacy">privacy notice</a>.
        </p>
      </form>

      <p className="auth-links">
        Already have an account? <Link to="/signin">Sign in</Link>
      </p>
    </AuthLayout>
  );
}
