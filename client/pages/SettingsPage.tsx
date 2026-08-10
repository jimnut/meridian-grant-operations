import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { BRAND } from '../../shared/brand';
import { CURRENCIES, MONTH_NAMES, ROLE_LABELS } from '../../shared/constants';
import { COMMON_TIMEZONES, fiscalYearFor, formatIsoDate } from '../../shared/dates';
import type { SessionOrganization } from '../../shared/types';
import { api, ApiRequestError } from '../lib/api';
import { useCurrentSession, useSession } from '../lib/session';
import { useToast } from '../lib/toast';
import { Card, DefinitionList, Field, Input, Select, useFocusFirstInvalid } from '../components/ui';

export function SettingsPage() {
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
    document.title = `Settings · ${BRAND.titleSuffix}`;
  }, []);

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
    save.mutate({
      name: form.name,
      timezone: form.timezone,
      currency: form.currency,
      fiscalYearStartMonth: Number(form.fiscalYearStartMonth),
    });
  };

  const fiscal = fiscalYearFor(session.today, session.organization.fiscalYearStartMonth);
  const timezones = COMMON_TIMEZONES.includes(session.organization.timezone as (typeof COMMON_TIMEZONES)[number])
    ? COMMON_TIMEZONES
    : ([session.organization.timezone, ...COMMON_TIMEZONES] as readonly string[]);

  return (
    <>
      <header className="page-header">
        <div className="page-header__text">
          <p className="page-header__eyebrow">{session.organization.name}</p>
          <h1 className="page-header__title">Settings</h1>
          <p className="page-header__lede">
            Organization details used across the workspace. Timezone decides when a deadline becomes “today”, and the
            fiscal year start drives year-to-date award figures.
          </p>
        </div>
      </header>

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
                <Input
                  id="org-name"
                  value={form.name}
                  disabled={!canManage}
                  invalid={Boolean(errors.name)}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  maxLength={160}
                  required
                />
              </Field>

              <Field label="Timezone" htmlFor="org-timezone" error={errors.timezone} hint="Deadlines and “today” resolve in this zone.">
                <Select
                  id="org-timezone"
                  value={form.timezone}
                  disabled={!canManage}
                  onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                >
                  {timezones.map((zone) => (
                    <option key={zone} value={zone}>
                      {zone.replace('_', ' ')}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Default currency" htmlFor="org-currency" error={errors.currency}>
                <Select
                  id="org-currency"
                  value={form.currency}
                  disabled={!canManage}
                  onChange={(e) => setForm({ ...form, currency: e.target.value })}
                >
                  {CURRENCIES.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field
                label="Fiscal year starts"
                htmlFor="org-fiscal"
                error={errors.fiscalYearStartMonth}
                hint="Drives year-to-date awarded totals."
              >
                <Select
                  id="org-fiscal"
                  value={form.fiscalYearStartMonth}
                  disabled={!canManage}
                  onChange={(e) => setForm({ ...form, fiscalYearStartMonth: e.target.value })}
                >
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
              Records are scoped to the organization you are signed into. Switching organizations issues a new session
              and never carries data across.
            </p>
          </Card>

          <Card title="About this workspace">
            <p className="muted small">
              {BRAND.fullName} · local demonstration build. Domain data is stored in a SQLite database and uploaded
              evidence is written to a private directory outside the web root, served only through authorised
              downloads.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
