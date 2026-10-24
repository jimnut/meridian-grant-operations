import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError, setCsrfToken } from '../lib/api';
import { useCurrentSession, useSession } from '../lib/session';
import { Card, Field, Input } from './ui';
import type { SessionPayload } from '../../shared/types';

interface Status { available: boolean; enabled: boolean; recoveryCodesRemaining: number }
interface Setup { secret: string; account: string; issuer: string }
type Result = SessionPayload & { recoveryCodes?: string[] };

export function MfaPanel() {
  const session = useCurrentSession();
  const { refresh } = useSession();
  const queryClient = useQueryClient();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [setup, setSetup] = useState<Setup | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const status = useQuery({ queryKey: ['mfa', session.user.id], queryFn: () => api.get<Status>('/auth/mfa') });
  const action = useMutation({
    mutationFn: async (operation: 'setup' | 'enable' | 'disable' | 'recovery-codes') => {
      const result = await api.post<Setup | Result>(`/auth/mfa/${operation}`, { password, code });
      if (operation === 'setup') { setSetup(result as Setup); setMessage('Enter the setup key in your authenticator, then verify its current code.'); }
      else {
        const payload = result as Result;
        setCsrfToken(payload.csrfToken); setSetup(null); setCodes(payload.recoveryCodes ?? []);
        setMessage(operation === 'disable' ? 'Two-factor authentication is disabled. Other sessions were signed out.' : 'Save your recovery codes somewhere private. Each code can be used once. Other sessions were signed out.');
        await refresh(); await queryClient.invalidateQueries({ queryKey: ['mfa', session.user.id] });
      }
      setPassword(''); setCode('');
    },
    onError: (reason: unknown) => setError(reason instanceof ApiRequestError ? reason.message : 'Could not update two-factor authentication.'),
  });
  const run = (operation: 'setup' | 'enable' | 'disable' | 'recovery-codes') => { setError(''); setMessage(''); action.mutate(operation); };

  return <Card title="Two-factor authentication" subtitle="Add an authenticator app to protect your account after entering your password.">
    {session.workspace.isDemo ? <p className="muted">Security settings cannot be changed on shared demo accounts.</p> : <div className="stack stack-4">
      {error && <p className="banner banner--risk" role="alert">{error}</p>}
      {message && <p className="banner banner--info" role="status">{message}</p>}
      {status.isError && <p role="alert">Could not load your security settings. Reload and try again.</p>}
      {codes.length > 0 ? <div className="stack stack-3">
        <p>These codes are shown once. Keep them separate from your password and authenticator.</p>
        <ul>{codes.map((value) => <li key={value}><code style={{ overflowWrap: 'anywhere' }}>{value}</code></li>)}</ul>
        <button className="btn" type="button" onClick={() => setCodes([])}>I have saved my recovery codes</button>
      </div> : !status.data?.available ? <p className="muted">{status.isLoading ? 'Loading security settings…' : 'Authenticator setup is temporarily unavailable. Contact support.'}</p> : <>
        <p><strong>{status.data.enabled ? 'Enabled' : 'Not enabled'}</strong>{status.data.enabled && ` · ${status.data.recoveryCodesRemaining} recovery codes remaining`}</p>
        {setup ? <form className="stack stack-4" onSubmit={(event) => { event.preventDefault(); run('enable'); }}>
          <p>In an authenticator such as Google Authenticator, Microsoft Authenticator or 1Password, add a time-based account named <strong>GrantConsole: {setup.account}</strong> using this setup key:</p>
          <Field label="Authenticator setup key" htmlFor="mfa-secret"><Input id="mfa-secret" value={setup.secret} readOnly autoComplete="off" /></Field>
          <Field label="Six-digit authenticator code" htmlFor="mfa-enable-code"><Input id="mfa-enable-code" value={code} onChange={(event) => setCode(event.target.value)} autoComplete="one-time-code" inputMode="numeric" maxLength={6} required /></Field>
          <button className="btn btn--primary" disabled={action.isPending}>Verify and enable two-factor authentication</button>
          <button className="btn" type="button" onClick={() => { setSetup(null); setCode(''); setMessage(''); }}>Cancel setup</button>
        </form> : <form className="stack stack-4" onSubmit={(event) => { event.preventDefault(); run(status.data.enabled ? 'recovery-codes' : 'setup'); }}>
          <Field label="Current password" htmlFor="mfa-password"><Input id="mfa-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></Field>
          {status.data.enabled && <Field label="Authenticator or unused recovery code" htmlFor="mfa-management-code"><Input id="mfa-management-code" value={code} onChange={(event) => setCode(event.target.value)} autoComplete="one-time-code" maxLength={80} required /></Field>}
          <button className="btn btn--primary" disabled={action.isPending}>{status.data.enabled ? 'Replace recovery codes' : 'Set up authenticator app'}</button>
          {status.data.enabled && <button className="btn" type="button" disabled={action.isPending || !password || !code} onClick={() => { if (window.confirm('Disable two-factor authentication? Future sign-ins will only require your password.')) run('disable'); }}>Disable two-factor authentication</button>}
        </form>}
      </>}
    </div>}
  </Card>;
}
