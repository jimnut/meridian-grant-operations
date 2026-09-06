import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, UserPlus } from 'lucide-react';

import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '../../shared/constants';
import type { InvitePreview, SessionPayload } from '../../shared/types';
import { trackEvent } from '../lib/analytics';
import { api, ApiRequestError, setCsrfToken } from '../lib/api';
import { useSession } from '../lib/session';
import { AuthLayout } from '../components/AuthLayout';
import { Field, Input, LoadingState } from '../components/ui';

export function InvitePage() {
  const { token = '' } = useParams();
  const { session, refresh } = useSession();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [formError, setFormError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const preview = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api.get<InvitePreview>(`/auth/invites/${encodeURIComponent(token)}`),
    retry: false,
  });

  const accept = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api.post<SessionPayload>(`/auth/invites/${encodeURIComponent(token)}/accept`, payload),
    onSuccess: async (payload) => {
      setCsrfToken(payload.csrfToken);
      trackEvent('join_organization', { role: payload.role });
      queryClient.clear();
      await refresh();
      window.location.assign('/');
    },
    onError: (error: unknown) => {
      if (error instanceof ApiRequestError) {
        setErrors(error.fields);
        setFormError(error.message);
      } else {
        setFormError('We could not accept the invitation. Please try again.');
      }
    },
  });

  const data = preview.data;
  const invitedEmail = data?.email ?? null;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    if (session) {
      accept.mutate({});
      return;
    }
    const next: Record<string, string> = {};
    if (!invitedEmail && !form.email.trim()) next.email = 'Enter your email address.';
    if (!form.password) next.password = 'Enter a password.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    accept.mutate({ name: form.name.trim() || undefined, email: invitedEmail ?? form.email.trim(), password: form.password });
  };

  return (
    <AuthLayout
      title="Join your organization"
      headline="You have been invited."
      lede="Accept the invitation to join your organization's grant workspace. Roles decide what you can change; everything you do is recorded in the activity trail."
    >
      {preview.isLoading && <LoadingState label="Checking your invitation…" />}

      {preview.isError && (
        <div className="stack stack-4">
          <h2 style={{ fontSize: 'var(--text-2xl)', letterSpacing: '-0.02em' }}>Invitation not valid</h2>
          <div className="banner banner--amber" role="alert">
            <CircleAlert size={17} className="banner__icon" aria-hidden="true" />
            <div>
              {preview.error instanceof ApiRequestError
                ? preview.error.message
                : 'That invitation is no longer valid. Ask your organization to send a new one.'}
            </div>
          </div>
          <p className="auth-links">
            <Link to="/signin">Sign in</Link> · <Link to="/signup">Create a new workspace</Link>
          </p>
        </div>
      )}

      {data && (
        <form onSubmit={submit} noValidate className="stack stack-4">
          <div>
            <h2 style={{ fontSize: 'var(--text-2xl)', letterSpacing: '-0.02em' }}>Join {data.organizationName}</h2>
            <p className="muted" style={{ marginTop: 'var(--space-2)' }}>
              {data.invitedBy ? `${data.invitedBy} invited you` : 'You were invited'} as <strong>{ROLE_LABELS[data.role]}</strong>.{' '}
              {ROLE_DESCRIPTIONS[data.role]}
            </p>
          </div>

          {formError && (
            <div className="banner banner--risk" role="alert">
              <CircleAlert size={17} className="banner__icon" aria-hidden="true" />
              <div>{formError}</div>
            </div>
          )}

          {session ? (
            <div className="banner banner--info">
              <UserPlus size={17} className="banner__icon" aria-hidden="true" />
              <div>
                You are signed in as <strong>{session.user.email}</strong>. Accepting adds {data.organizationName} to your account;
                you can switch between organizations from the sidebar.
              </div>
            </div>
          ) : (
            <>
              <Field label="Your name" htmlFor="invite-name" error={errors.name} hint="Leave blank if you already have a GrantConsole account.">
                <Input id="invite-name" autoComplete="name" value={form.name} invalid={Boolean(errors.name)} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={120} />
              </Field>
              {invitedEmail ? (
                <Field label="Email" htmlFor="invite-email">
                  <Input id="invite-email" type="email" value={invitedEmail} readOnly />
                </Field>
              ) : (
                <Field label="Work email" htmlFor="invite-email" error={errors.email}>
                  <Input id="invite-email" type="email" autoComplete="email" required value={form.email} invalid={Boolean(errors.email)} onChange={(e) => setForm({ ...form, email: e.target.value })} maxLength={200} />
                </Field>
              )}
              <Field
                label="Password"
                htmlFor="invite-password"
                error={errors.password}
                hint="New here? Choose a password of at least 10 characters. Already have an account with this email? Enter its password."
              >
                <Input id="invite-password" type="password" autoComplete="new-password" required value={form.password} invalid={Boolean(errors.password)} onChange={(e) => setForm({ ...form, password: e.target.value })} maxLength={200} />
              </Field>
            </>
          )}

          <button type="submit" className="btn btn--primary btn--lg btn--block" disabled={accept.isPending}>
            <UserPlus size={16} aria-hidden="true" />
            {accept.isPending ? 'Joining…' : `Join ${data.organizationName}`}
          </button>
          {!session && (
            <p className="auth-links">
              Wrong account? <Link to="/signin">Sign in first</Link>
            </p>
          )}
        </form>
      )}
    </AuthLayout>
  );
}
