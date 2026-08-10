import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus, Search } from 'lucide-react';

import { BRAND } from '../../shared/brand';
import { FUNDER_TYPES, FUNDER_TYPE_LABELS, type FunderType } from '../../shared/constants';
import type { Funder, FunderSummary } from '../../shared/types';
import { api, ApiRequestError } from '../lib/api';
import { useSession } from '../lib/session';
import { useToast } from '../lib/toast';
import { formatCents, formatCentsCompact, formatIsoDate } from '../lib/format';
import { Dialog } from '../components/Dialog';
import { Badge, Card, EmptyState, ErrorState, Field, Input, LoadingState, Textarea, Select, useFocusFirstInvalid } from '../components/ui';

export function FundersPage() {
  const { can } = useSession();
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    document.title = `Funders · ${BRAND.titleSuffix}`;
  }, []);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['funders'],
    queryFn: () => api.get<FunderSummary[]>('/funders'),
  });

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return data ?? [];
    return (data ?? []).filter((funder) =>
      [funder.name, FUNDER_TYPE_LABELS[funder.type], ...funder.focusAreas].join(' ').toLowerCase().includes(needle),
    );
  }, [data, search]);

  const totals = useMemo(() => {
    const list = data ?? [];
    return {
      count: list.length,
      awarded: list.reduce((sum, f) => sum + f.awardedCents, 0),
      exposure: list.reduce((sum, f) => sum + f.renewalExposureCents, 0),
      active: list.reduce((sum, f) => sum + f.activeGrantCount, 0),
    };
  }, [data]);

  return (
    <>
      <header className="page-header">
        <div className="page-header__text">
          <p className="page-header__eyebrow">Relationships</p>
          <h1 className="page-header__title">Funders</h1>
          <p className="page-header__lede">
            {totals.count} funders, {totals.active} active grants, {formatCents(totals.awarded)} awarded to date, with{' '}
            {formatCents(totals.exposure)} up for renewal in the next twelve months.
          </p>
        </div>
        {can('funders:write') && (
          <div className="page-header__actions">
            <button type="button" className="btn btn--primary" onClick={() => setDialogOpen(true)}>
              <Plus size={16} aria-hidden="true" />
              New funder
            </button>
          </div>
        )}
      </header>

      <div className="stack stack-4">
        <div className="toolbar">
          <div className="toolbar__search">
            <Search size={16} className="toolbar__search-icon" aria-hidden="true" />
            <label className="visually-hidden" htmlFor="funder-search">
              Search funders
            </label>
            <input
              id="funder-search"
              className="input"
              type="search"
              placeholder="Search by name, type or focus area…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>

        {isLoading && (
          <div className="card">
            <LoadingState label="Loading funders…" />
          </div>
        )}
        {isError && (
          <div className="card">
            <ErrorState onRetry={() => void refetch()} />
          </div>
        )}

        {data && filtered.length === 0 && (
          <div className="card">
            <EmptyState
              icon={<Building2 size={20} />}
              title={search ? 'No funders match that search' : 'No funders yet'}
              description={
                search
                  ? 'Try a different name, type or focus area.'
                  : 'Add the foundations, agencies and corporate givers you work with.'
              }
            />
          </div>
        )}

        {filtered.length > 0 && (
          <div className="grid grid--thirds">
            {filtered.map((funder) => (
              <Card key={funder.id}>
                <div className="stack stack-3">
                  <div>
                    <Link to={`/funders/${funder.id}`} className="link-plain" style={{ fontWeight: 600, fontSize: 'var(--text-md)' }}>
                      {funder.name}
                    </Link>
                    <p className="muted small" style={{ marginTop: 2 }}>
                      {FUNDER_TYPE_LABELS[funder.type]}
                      {funder.archived && ' · Archived'}
                    </p>
                  </div>

                  {funder.focusAreas.length > 0 && (
                    <div className="row row-wrap">
                      {funder.focusAreas.map((area) => (
                        <Badge key={area} tone="plain">
                          {area}
                        </Badge>
                      ))}
                    </div>
                  )}

                  <dl className="definition-list">
                    <dt>Active grants</dt>
                    <dd>
                      {funder.activeGrantCount} of {funder.totalGrantCount}
                    </dd>
                    <dt>Awarded</dt>
                    <dd className="numeric">{formatCents(funder.awardedCents)}</dd>
                    <dt>Renewal exposure</dt>
                    <dd className="numeric">
                      {funder.renewalExposureCents > 0 ? formatCentsCompact(funder.renewalExposureCents) : '—'}
                    </dd>
                    <dt>Next deadline</dt>
                    <dd>{funder.nextDeadline ? formatIsoDate(funder.nextDeadline.date) : '—'}</dd>
                  </dl>

                  <p className="muted small">
                    {funder.contacts.length === 0
                      ? 'No contacts recorded'
                      : `${funder.contacts.length} contact${funder.contacts.length === 1 ? '' : 's'} · ${funder.contacts[0]!.name}`}
                  </p>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <FunderDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </>
  );
}

export function FunderDialog({
  open,
  onClose,
  funder,
}: {
  open: boolean;
  onClose: () => void;
  funder?: Funder;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: '', type: 'PRIVATE_FOUNDATION', focusAreas: '', website: '', notes: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  useFocusFirstInvalid(errors);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setFormError(null);
    setForm({
      name: funder?.name ?? '',
      type: funder?.type ?? 'PRIVATE_FOUNDATION',
      focusAreas: funder?.focusAreas.join(', ') ?? '',
      website: funder?.website ?? '',
      notes: funder?.notes ?? '',
    });
  }, [open, funder]);

  const save = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      funder ? api.put(`/funders/${funder.id}`, payload) : api.post('/funders', payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['funders'] });
      await queryClient.invalidateQueries({ queryKey: ['funder'] });
      await queryClient.invalidateQueries({ queryKey: ['lookups'] });
      toast.success(funder ? 'Funder updated.' : 'Funder added.');
      onClose();
    },
    onError: (error: unknown) => {
      if (error instanceof ApiRequestError) {
        setErrors(error.fields);
        setFormError(error.message);
      } else {
        setFormError('That funder could not be saved.');
      }
    },
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    if (!form.name.trim()) {
      setErrors({ name: 'Funder name is required.' });
      return;
    }
    save.mutate({
      name: form.name,
      type: form.type,
      focusAreas: form.focusAreas,
      website: form.website,
      notes: form.notes,
    });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={funder ? 'Edit funder' : 'New funder'}
      description="Funder records carry the reporting expectations that grants inherit."
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={save.isPending}>
            Cancel
          </button>
          <button type="submit" form="funder-form" className="btn btn--primary" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : funder ? 'Save funder' : 'Add funder'}
          </button>
        </>
      }
    >
      <form id="funder-form" onSubmit={submit} noValidate className="stack stack-4">
        {formError && (
          <div className="banner banner--risk" role="alert">
            <div className="small">{formError}</div>
          </div>
        )}
        <div className="form-grid">
          <Field label="Funder name" htmlFor="funder-name" error={errors.name} span>
            <Input
              id="funder-name"
              value={form.name}
              invalid={Boolean(errors.name)}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              maxLength={160}
            />
          </Field>
          <Field label="Type" htmlFor="funder-type">
            <Select id="funder-type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {FUNDER_TYPES.map((type) => (
                <option key={type} value={type}>
                  {FUNDER_TYPE_LABELS[type as FunderType]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Website" htmlFor="funder-website" optional error={errors.website}>
            <Input
              id="funder-website"
              type="url"
              placeholder="https://"
              value={form.website}
              invalid={Boolean(errors.website)}
              onChange={(e) => setForm({ ...form, website: e.target.value })}
            />
          </Field>
          <Field
            label="Focus areas"
            htmlFor="funder-focus"
            optional
            hint="Comma separated, e.g. Housing stability, Economic mobility"
            span
          >
            <Input id="funder-focus" value={form.focusAreas} onChange={(e) => setForm({ ...form, focusAreas: e.target.value })} />
          </Field>
          <Field
            label="Notes"
            htmlFor="funder-notes"
            optional
            hint="Reporting cadence, quirks, preferences — what the team needs to remember."
            span
          >
            <Textarea id="funder-notes" rows={4} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
        </div>
      </form>
    </Dialog>
  );
}
