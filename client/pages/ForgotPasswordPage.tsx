import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { CircleAlert, MailCheck } from 'lucide-react';

import { api, ApiRequestError } from '../lib/api';
import { AuthLayout } from '../components/AuthLayout';
import { Field, Input } from '../components/ui';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const request = useMutation({
    mutationFn: (payload: { email: string }) => api.post<{ ok: boolean; emailConfigured: boolean }>('/auth/forgot-password', payload),
    onError: (error: unknown) => {
      setFormError(error instanceof ApiRequestError ? error.message : 'We could not send a reset link. Please try again.');
    },
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    if (!email.trim()) {
      setFormError('Enter the email address you sign in with.');
      return;
    }
    request.mutate({ email: email.trim() });
  };

  return (
    <AuthLayout
      title="Reset your password"
      headline="Locked out? It happens."
      lede="Enter the email you sign in with and we will send a link that lets you choose a new password. The link works for one hour."
    >
      <h2 style={{ fontSize: 'var(--text-2xl)', letterSpacing: '-0.02em' }}>Reset your password</h2>

      {request.data ? (
        <div className="stack stack-4" style={{ marginTop: 'var(--space-4)' }}>
          <div className="banner banner--info" role="status">
            <MailCheck size={17} className="banner__icon" aria-hidden="true" />
            <div>
              If an account exists for <strong>{email.trim()}</strong>, a reset link is on its way. Check your spam folder if it
              has not arrived in a few minutes.
            </div>
          </div>
          {!request.data.emailConfigured && (
            <div className="banner banner--amber">
              <CircleAlert size={17} className="banner__icon" aria-hidden="true" />
              <div>
                Email delivery is not switched on for this server yet. Ask an owner or manager of your organization to issue a
                reset link from the Team page, or email <a href="mailto:support@grantconsole.com">support@grantconsole.com</a>.
              </div>
            </div>
          )}
          <p className="auth-links">
            <Link to="/signin">Back to sign in</Link>
          </p>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="stack stack-4" style={{ marginTop: 'var(--space-4)' }}>
          {formError && (
            <div className="banner banner--risk" role="alert">
              <CircleAlert size={17} className="banner__icon" aria-hidden="true" />
              <div>{formError}</div>
            </div>
          )}
          <Field label="Work email" htmlFor="forgot-email">
            <Input
              id="forgot-email"
              type="email"
              autoComplete="username"
              required
              value={email}
              invalid={Boolean(formError)}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@organization.org"
            />
          </Field>
          <button type="submit" className="btn btn--primary btn--lg btn--block" disabled={request.isPending}>
            {request.isPending ? 'Sending…' : 'Send reset link'}
          </button>
          <p className="auth-links">
            <Link to="/signin">Back to sign in</Link>
          </p>
        </form>
      )}
    </AuthLayout>
  );
}
