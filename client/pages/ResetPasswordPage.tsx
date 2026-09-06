import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { CircleAlert, KeyRound } from 'lucide-react';

import type { SessionPayload } from '../../shared/types';
import { api, ApiRequestError, setCsrfToken } from '../lib/api';
import { useSession } from '../lib/session';
import { AuthLayout } from '../components/AuthLayout';
import { Field, Input } from '../components/ui';

export function ResetPasswordPage() {
  const { refresh } = useSession();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const reset = useMutation({
    mutationFn: (payload: { token: string; password: string }) =>
      api.post<SessionPayload | { ok: boolean; signedIn: false }>('/auth/reset-password', payload),
    onSuccess: async (payload) => {
      if ('csrfToken' in payload) setCsrfToken(payload.csrfToken);
      await refresh();
    },
    onError: (error: unknown) => {
      setFormError(error instanceof ApiRequestError ? error.message : 'That reset link did not work. Request a new one.');
    },
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    if (password.length < 10) {
      setFormError('Use at least 10 characters.');
      return;
    }
    if (password !== confirm) {
      setFormError('The two passwords do not match.');
      return;
    }
    reset.mutate({ token, password });
  };

  return (
    <AuthLayout
      title="Choose a new password"
      headline="Choose a new password."
      lede="Every other device is signed out once you save, and you are signed in here straight away."
    >
      <h2 style={{ fontSize: 'var(--text-2xl)', letterSpacing: '-0.02em' }}>New password</h2>
      {!token ? (
        <div className="stack stack-4" style={{ marginTop: 'var(--space-4)' }}>
          <div className="banner banner--amber" role="alert">
            <CircleAlert size={17} className="banner__icon" aria-hidden="true" />
            <div>This page needs the link from your reset email.</div>
          </div>
          <p className="auth-links">
            <Link to="/forgot-password">Request a reset link</Link>
          </p>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="stack stack-4" style={{ marginTop: 'var(--space-4)' }}>
          {formError && (
            <div className="banner banner--risk" role="alert">
              <CircleAlert size={17} className="banner__icon" aria-hidden="true" />
              <div>
                {formError}{' '}
                {reset.error instanceof ApiRequestError && reset.error.status === 404 && (
                  <Link to="/forgot-password">Request a new link</Link>
                )}
              </div>
            </div>
          )}
          <Field label="New password" htmlFor="reset-password" hint="At least 10 characters.">
            <Input
              id="reset-password"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Field label="Confirm new password" htmlFor="reset-confirm">
            <Input
              id="reset-confirm"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>
          <button type="submit" className="btn btn--primary btn--lg btn--block" disabled={reset.isPending}>
            <KeyRound size={16} aria-hidden="true" />
            {reset.isPending ? 'Saving…' : 'Save password and sign in'}
          </button>
        </form>
      )}
    </AuthLayout>
  );
}
