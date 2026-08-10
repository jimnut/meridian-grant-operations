import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CircleAlert, Landmark, LockKeyhole, ShieldCheck, Wallet } from 'lucide-react';

import { BRAND } from '../../shared/brand';
import { ROLE_LABELS, type Role } from '../../shared/constants';
import { api, ApiRequestError, setCsrfToken } from '../lib/api';
import { useSession } from '../lib/session';
import { Field, Input } from '../components/ui';
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

  useEffect(() => {
    document.title = `Sign in · ${BRAND.titleSuffix}`;
  }, []);

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
    <div className="signin">
      <section className="signin__brandside">
        <div className="signin__brand">
          <span className="brandmark" aria-hidden="true">
            {BRAND.monogram}
          </span>
          <span className="sidebar__wordmark">
            <span className="sidebar__name">{BRAND.name}</span>
            <span className="sidebar__descriptor">{BRAND.descriptor}</span>
          </span>
        </div>

        <div>
          <h1 className="signin__headline">Every grant obligation, accounted for.</h1>
          <p className="signin__lede">{BRAND.tagline}</p>

          <ul className="signin__points">
            <li className="signin__point">
              <ShieldCheck size={18} aria-hidden="true" />
              <span>Explainable risk signals — every flag states the reason and the evidence behind it.</span>
            </li>
            <li className="signin__point">
              <Wallet size={18} aria-hidden="true" />
              <span>Restricted budgets tracked to the cent, with burn measured against the grant period.</span>
            </li>
            <li className="signin__point">
              <Landmark size={18} aria-hidden="true" />
              <span>Audit-ready reporting packets assembled from the records your team already keeps.</span>
            </li>
          </ul>
        </div>

        <p className="signin__footnote small" style={{ color: 'var(--nav-text-dim)' }}>
          Local demonstration workspace. Data lives in a SQLite file on this machine.
        </p>
      </section>

      <section className="signin__formside">
        <div className="signin__card">
          <h2 style={{ fontSize: 'var(--text-2xl)', letterSpacing: '-0.02em' }}>Sign in</h2>
          <p className="muted" style={{ marginTop: 'var(--space-2)', marginBottom: 'var(--space-6)' }}>
            Use a demo account below, or enter credentials directly.
          </p>

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
            </button>
          </form>

          {demo && demo.accounts.length > 0 && (
            <div className="signin__demo">
              <h3 style={{ fontSize: 'var(--text-sm)', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--ink-500)' }}>
                Demo accounts
              </h3>
              <p className="muted small" style={{ margin: 'var(--space-2) 0 var(--space-3)' }}>
                One click signs you in. Each role sees a different level of access.
              </p>
              <div className="stack stack-2">
                {demo.accounts.map((account) => (
                  <button
                    key={`${account.email}-${account.organizationSlug}`}
                    type="button"
                    className="demo-account"
                    onClick={() => signInAsDemoAccount(account)}
                    disabled={busy}
                  >
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="demo-account__name truncate">
                        {account.name} · {ROLE_LABELS[account.role]}
                      </span>
                      <span className="demo-account__meta truncate">
                        {account.title ? `${account.title} — ` : ''}
                        {account.organizationName}
                      </span>
                    </span>
                    <span className="badge badge--plain">
                      {pendingEmail === account.email && busy ? 'Signing in…' : 'Use'}
                    </span>
                  </button>
                ))}
              </div>
              <p className="muted small" style={{ marginTop: 'var(--space-3)' }}>
                Shared demo password: <code>{demo.password}</code>
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
