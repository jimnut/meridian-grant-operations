import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { CURRENCIES, GRANT_STATUSES, GRANT_STATUS_LABELS, PIPELINE_STATUSES } from '../../shared/constants';
import { centsToPlainString } from '../../shared/money';
import type { GrantDetail } from '../../shared/types';
import { api, ApiRequestError } from '../lib/api';
import { useCurrentSession } from '../lib/session';
import { useToast } from '../lib/toast';
import { Dialog } from './Dialog';
import { Field, Input, MoneyInput, Select, Textarea, useFocusFirstInvalid } from './ui';

export interface LookupData {
  members: Array<{ id: string; name: string; role: string }>;
  funders: Array<{ id: string; name: string }>;
  grants: Array<{ id: string; title: string }>;
}

export function useLookups() {
  return useQuery({
    queryKey: ['lookups'],
    queryFn: () => api.get<LookupData>('/lookups'),
    staleTime: 120_000,
  });
}

interface FormState {
  title: string;
  program: string;
  funderId: string;
  ownerUserId: string;
  status: string;
  requested: string;
  awarded: string;
  currency: string;
  probability: string;
  applicationDate: string;
  decisionDate: string;
  startDate: string;
  endDate: string;
  renewalDate: string;
  closeoutDate: string;
  purpose: string;
  requirements: string;
  nextAction: string;
  notes: string;
}

function emptyForm(currency: string): FormState {
  return {
    title: '',
    program: '',
    funderId: '',
    ownerUserId: '',
    status: 'PROSPECT',
    requested: '',
    awarded: '',
    currency,
    probability: '',
    applicationDate: '',
    decisionDate: '',
    startDate: '',
    endDate: '',
    renewalDate: '',
    closeoutDate: '',
    purpose: '',
    requirements: '',
    nextAction: '',
    notes: '',
  };
}

function fromGrant(grant: GrantDetail): FormState {
  return {
    title: grant.title,
    program: grant.program ?? '',
    funderId: grant.funderId,
    ownerUserId: grant.ownerUserId ?? '',
    status: grant.status,
    requested: grant.requestedCents ? centsToPlainString(grant.requestedCents) : '',
    awarded: grant.awardedCents ? centsToPlainString(grant.awardedCents) : '',
    currency: grant.currency,
    probability: grant.probability === null ? '' : String(grant.probability),
    applicationDate: grant.applicationDate ?? '',
    decisionDate: grant.decisionDate ?? '',
    startDate: grant.startDate ?? '',
    endDate: grant.endDate ?? '',
    renewalDate: grant.renewalDate ?? '',
    closeoutDate: grant.closeoutDate ?? '',
    purpose: grant.purpose ?? '',
    requirements: grant.requirements ?? '',
    nextAction: grant.nextAction ?? '',
    notes: grant.notes ?? '',
  };
}

export function GrantFormDialog({
  open,
  onClose,
  grant,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  grant?: GrantDetail;
  onSaved?: (grant: GrantDetail) => void;
}) {
  const session = useCurrentSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: lookups } = useLookups();

  const [form, setForm] = useState<FormState>(() =>
    grant ? fromGrant(grant) : emptyForm(session.organization.currency),
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  useFocusFirstInvalid(fieldErrors);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(grant ? fromGrant(grant) : emptyForm(session.organization.currency));
    setFieldErrors({});
    setFormError(null);
  }, [open, grant, session.organization.currency]);

  const isPipeline = useMemo(
    () => PIPELINE_STATUSES.includes(form.status as (typeof PIPELINE_STATUSES)[number]),
    [form.status],
  );

  const save = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      grant ? api.put<GrantDetail>(`/grants/${grant.id}`, payload) : api.post<GrantDetail>('/grants', payload),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ['grants'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      await queryClient.invalidateQueries({ queryKey: ['lookups'] });
      if (grant) await queryClient.invalidateQueries({ queryKey: ['grant', grant.id] });
      toast.success(grant ? 'Grant updated.' : `“${saved.title}” created.`);
      onSaved?.(saved);
      onClose();
    },
    onError: (error: unknown) => {
      if (error instanceof ApiRequestError) {
        setFieldErrors(error.fields);
        setFormError(Object.keys(error.fields).length > 0 ? 'Check the highlighted fields.' : error.message);
      } else {
        setFormError('We could not save this grant. Please try again.');
      }
    },
  });

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});

    const localErrors: Record<string, string> = {};
    if (!form.title.trim()) localErrors.title = 'Grant title is required.';
    if (!form.funderId) localErrors.funderId = 'Choose a funder.';
    if (Object.keys(localErrors).length > 0) {
      setFieldErrors(localErrors);
      setFormError('Check the highlighted fields.');
      return;
    }

    save.mutate({
      title: form.title,
      program: form.program,
      funderId: form.funderId,
      ownerUserId: form.ownerUserId || null,
      status: form.status,
      requestedCents: form.requested || '0',
      awardedCents: form.awarded || '0',
      currency: form.currency,
      probability: form.probability === '' ? null : form.probability,
      applicationDate: form.applicationDate,
      decisionDate: form.decisionDate,
      startDate: form.startDate,
      endDate: form.endDate,
      renewalDate: form.renewalDate,
      closeoutDate: form.closeoutDate,
      purpose: form.purpose,
      requirements: form.requirements,
      nextAction: form.nextAction,
      notes: form.notes,
    });
  };

  const formId = 'grant-form';

  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      title={grant ? 'Edit grant' : 'New grant'}
      description={
        grant
          ? 'Update the record. Changes are written to the activity trail.'
          : 'Record a prospect, application or award. You can fill in the rest as the grant progresses.'
      }
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={save.isPending}>
            Cancel
          </button>
          <button type="submit" form={formId} className="btn btn--primary" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : grant ? 'Save changes' : 'Create grant'}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="stack stack-5">
        {formError && (
          <div className="banner banner--risk" role="alert">
            <div>{formError}</div>
          </div>
        )}

        <div className="form-grid">
          <Field label="Grant title" htmlFor="grant-title" error={fieldErrors.title} span>
            <Input
              id="grant-title"
              value={form.title}
              invalid={Boolean(fieldErrors.title)}
              onChange={(e) => set('title', e.target.value)}
              placeholder="e.g. Family Stability Navigators"
              maxLength={180}
              required
            />
          </Field>

          <Field label="Program" htmlFor="grant-program" optional error={fieldErrors.program}>
            <Input
              id="grant-program"
              value={form.program}
              onChange={(e) => set('program', e.target.value)}
              placeholder="Housing & Economic Mobility"
            />
          </Field>

          <Field label="Funder" htmlFor="grant-funder" error={fieldErrors.funderId}>
            <Select
              id="grant-funder"
              value={form.funderId}
              invalid={Boolean(fieldErrors.funderId)}
              onChange={(e) => set('funderId', e.target.value)}
              required
            >
              <option value="">Select a funder…</option>
              {(lookups?.funders ?? []).map((funder) => (
                <option key={funder.id} value={funder.id}>
                  {funder.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Internal owner" htmlFor="grant-owner" optional error={fieldErrors.ownerUserId}>
            <Select id="grant-owner" value={form.ownerUserId} onChange={(e) => set('ownerUserId', e.target.value)}>
              <option value="">Unassigned</option>
              {(lookups?.members ?? []).map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Status" htmlFor="grant-status" error={fieldErrors.status}>
            <Select id="grant-status" value={form.status} onChange={(e) => set('status', e.target.value)}>
              {GRANT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {GRANT_STATUS_LABELS[status]}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Requested amount"
            htmlFor="grant-requested"
            optional
            error={fieldErrors.requestedCents}
            hint="Amounts are stored to the cent."
          >
            <MoneyInput
              id="grant-requested"
              value={form.requested}
              onChange={(value) => set('requested', value)}
              invalid={Boolean(fieldErrors.requestedCents)}
              placeholder="0.00"
            />
          </Field>

          <Field
            label="Awarded amount"
            htmlFor="grant-awarded"
            optional
            error={fieldErrors.awardedCents}
            hint="Required once a grant reaches Awarded or later."
          >
            <MoneyInput
              id="grant-awarded"
              value={form.awarded}
              onChange={(value) => set('awarded', value)}
              invalid={Boolean(fieldErrors.awardedCents)}
              placeholder="0.00"
            />
          </Field>

          <Field label="Currency" htmlFor="grant-currency">
            <Select id="grant-currency" value={form.currency} onChange={(e) => set('currency', e.target.value)}>
              {CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </Select>
          </Field>

          {isPipeline && (
            <Field
              label="Probability"
              htmlFor="grant-probability"
              optional
              error={fieldErrors.probability}
              hint="0–100. Drives weighted pipeline value."
            >
              <Input
                id="grant-probability"
                type="number"
                min={0}
                max={100}
                step={5}
                value={form.probability}
                invalid={Boolean(fieldErrors.probability)}
                onChange={(e) => set('probability', e.target.value)}
              />
            </Field>
          )}
        </div>

        <fieldset className="fieldset">
          <legend className="fieldset__legend">Key dates</legend>
          <div className="form-grid">
            <Field label="Application due / submitted" htmlFor="grant-application" optional error={fieldErrors.applicationDate}>
              <Input
                id="grant-application"
                type="date"
                value={form.applicationDate}
                onChange={(e) => set('applicationDate', e.target.value)}
              />
            </Field>
            <Field label="Decision date" htmlFor="grant-decision" optional error={fieldErrors.decisionDate}>
              <Input id="grant-decision" type="date" value={form.decisionDate} onChange={(e) => set('decisionDate', e.target.value)} />
            </Field>
            <Field label="Period start" htmlFor="grant-start" optional error={fieldErrors.startDate}>
              <Input id="grant-start" type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} />
            </Field>
            <Field label="Period end" htmlFor="grant-end" optional error={fieldErrors.endDate}>
              <Input
                id="grant-end"
                type="date"
                value={form.endDate}
                invalid={Boolean(fieldErrors.endDate)}
                onChange={(e) => set('endDate', e.target.value)}
              />
            </Field>
            <Field label="Renewal decision" htmlFor="grant-renewal" optional error={fieldErrors.renewalDate}>
              <Input id="grant-renewal" type="date" value={form.renewalDate} onChange={(e) => set('renewalDate', e.target.value)} />
            </Field>
            <Field label="Closeout due" htmlFor="grant-closeout" optional error={fieldErrors.closeoutDate}>
              <Input id="grant-closeout" type="date" value={form.closeoutDate} onChange={(e) => set('closeoutDate', e.target.value)} />
            </Field>
          </div>
        </fieldset>

        <div className="form-grid form-grid--full">
          <Field label="Purpose" htmlFor="grant-purpose" optional error={fieldErrors.purpose} span>
            <Textarea
              id="grant-purpose"
              value={form.purpose}
              onChange={(e) => set('purpose', e.target.value)}
              placeholder="What this funding pays for, and who it reaches."
              rows={3}
            />
          </Field>
          <Field
            label="Funder requirements"
            htmlFor="grant-requirements"
            optional
            error={fieldErrors.requirements}
            hint="Reporting cadence, approvals, retention rules — anything the team must not miss."
            span
          >
            <Textarea
              id="grant-requirements"
              value={form.requirements}
              onChange={(e) => set('requirements', e.target.value)}
              rows={4}
            />
          </Field>
          <Field label="Next action" htmlFor="grant-next-action" optional error={fieldErrors.nextAction} span>
            <Input id="grant-next-action" value={form.nextAction} onChange={(e) => set('nextAction', e.target.value)} />
          </Field>
          <Field label="Internal notes" htmlFor="grant-notes" optional error={fieldErrors.notes} span>
            <Textarea id="grant-notes" value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={3} />
          </Field>
        </div>
      </form>
    </Dialog>
  );
}
