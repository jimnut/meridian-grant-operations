import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowRight, CircleAlert, LockKeyhole } from 'lucide-react';

import { ROLE_LABELS, type Role } from '../../shared/constants';
import { api, ApiRequestError, setCsrfToken } from '../lib/api';
import { useSession } from '../lib/session';
import { Avatar, Field, Input } from '../components/ui';
import { AuthLayout } from '../components/AuthLayout';
import type { SessionPayload } from '../../shared/types';

interface DemoAccount {
  name: string;
  email: string;
  title: string | null;
  role: Role;
  organizationName: string;
  organizationSlug: string;
}

export function SignInPage() {
  const { refresh } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  const { data: demo } = useQuery({
    queryKey: ['demo-accounts'],
    queryFn: async () => {
      try {
        return await api.get<{ password: string; accounts: DemoAccount[] }>('/auth/demo-accounts');
      } catch {
        // Demo shortcuts are development-only; absence is not an error.
        return null;
      }
    },
    retry: false,
    staleTime: Infinity,
  });

  const signIn = useMutation({
    mutationFn: (credentials: { email: string; password: string }) =>
      api.post<SessionPayload>('/auth/sign-in', credentials),
    onSuccess: async (payload) => {
      setCsrfToken(payload.csrfToken);
      setFormError(null);
      await refresh();
    },
    onError: (error: unknown) => {
      setPendingEmail(null);
      setFormError(
        error instanceof ApiRequestError ? error.message : 'We could not sign you in. Please try again.',
      );
    },
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    if (!email.trim() || !password) {
      setFormError('Enter your email address and password.');
      return;
    }
    signIn.mutate({ email: email.trim(), password });
  };

  const signInAsDemoAccount = (account: DemoAccount) => {
    if (!demo) return;
    setEmail(account.email);
    setPassword(demo.password);
    setPendingEmail(account.email);
    setFormError(null);
    signIn.mutate({ email: account.email, password: demo.password });
  };

  const busy = signIn.isPending;

  return (
    <AuthLayout
      title="Sign in"
      headline="Every grant obligation, accounted for."
      lede="A little less chasing. A lot more clarity. Bring your deadlines, budgets, and evidence into one shared workspace."
      footnote={
        demo && demo.accounts.length > 0
          ? 'Demonstration workspace with seeded nonprofit data. Changes are for evaluation only.'
          : "Your team's post-award work, all in one place."
      }
    >
      <p className="signin__form-eyebrow">Welcome back</p>
      <h2 className="signin__form-title">Sign in</h2>
      <p className="signin__form-intro">Enter your details and pick up where your team left off.</p>

      <form onSubmit={submit} noValidate className="stack stack-4">
        {formError && (
          <div className="banner banner--risk" role="alert">
            <CircleAlert size={17} className="banner__icon" aria-hidden="true" />
            <div>{formError}</div>
          </div>
        )}

        <Field label="Work email" htmlFor="signin-email">
          <Input
            id="signin-email"
            type="email"
            name="email"
            autoComplete="username"
            required
            value={email}
            invalid={Boolean(formError)}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@organization.org"
          />
        </Field>

        <Field label="Password" htmlFor="signin-password">
          <Input
            id="signin-password"
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            invalid={Boolean(formError)}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>

        <button type="submit" className="btn btn--primary btn--lg btn--block" disabled={busy}>
          <LockKeyhole size={16} aria-hidden="true" />
          {busy && !pendingEmail ? 'Signing in…' : 'Sign in'}
          <ArrowRight size={17} aria-hidden="true" />
        </button>
        <p className="signin__forgot">
          <Link to="/forgot-password">Forgot your password?</Link>
        </p>
      </form>

      <p className="signin__signup-link">
        New to GrantConsole? <Link to="/signup">Start a free trial <ArrowRight size={13} aria-hidden="true" /></Link>
      </p>

      {demo && demo.accounts.length > 0 && (
        <div className="signin__demo">
          <div className="signin__demo-heading"><h3>Take a look around</h3><span>Demo workspace</span></div>
          <p className="signin__demo-intro">Choose a role to explore with sample data.</p>
          <div className="signin__demo-grid">
            {demo.accounts.map((account) => (
              <button
                key={`${account.email}-${account.organizationSlug}`}
                type="button"
                className="demo-account"
                onClick={() => signInAsDemoAccount(account)}
                disabled={busy}
                aria-label={`${account.name} · ${ROLE_LABELS[account.role]} — ${account.organizationName}${pendingEmail === account.email && busy ? ', signing in' : ''}`}
                title={`${account.title ? `${account.title} — ` : ''}${account.organizationName}`}
              >
                <Avatar name={account.name} />
                <span className="demo-account__info">
                  <span className="demo-account__name">{account.name}</span>
                  <span className="demo-account__meta">
                    {pendingEmail === account.email && busy ? 'Signing in…' : ROLE_LABELS[account.role]}
                  </span>
                </span>
                <ArrowRight className="demo-account__arrow" size={14} aria-hidden="true" />
              </button>
            ))}
          </div>
          <p className="signin__demo-password">Demo password <code>{demo.password}</code></p>
        </div>
      )}
    </AuthLayout>
  );
}
