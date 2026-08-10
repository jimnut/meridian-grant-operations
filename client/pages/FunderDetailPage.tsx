import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react';

import { BRAND } from '../../shared/brand';
import { FUNDER_TYPE_LABELS, GRANT_STATUS_LABELS, HEALTH_LABELS } from '../../shared/constants';
import type { FunderContact, FunderSummary, GrantListItem } from '../../shared/types';
import { api, ApiRequestError } from '../lib/api';
import { useSession } from '../lib/session';
import { useToast } from '../lib/toast';
import { formatCents, formatIsoDate, healthTone, statusTone } from '../lib/format';
import { ConfirmDialog, Dialog } from '../components/Dialog';
import { FunderDialog } from './FundersPage';
import {
  Badge,
  Card,
  DefinitionList,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  StatusPill,
  Textarea,
  useFocusFirstInvalid,
} from '../components/ui';

interface FunderDetailResponse {
  funder: FunderSummary;
  grants: GrantListItem[];
}

export function FunderDetailPage() {
  const { funderId = '' } = useParams();
  const { can } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<FunderContact | null>(null);
  const [deletingContact, setDeletingContact] = useState<FunderContact | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['funder', funderId],
    queryFn: () => api.get<FunderDetailResponse>(`/funders/${funderId}`),
    retry: false,
  });

  useEffect(() => {
    document.title = data ? `${data.funder.name} · ${BRAND.titleSuffix}` : `Funder · ${BRAND.titleSuffix}`;
  }, [data]);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['funder', funderId] });
    await queryClient.invalidateQueries({ queryKey: ['funders'] });
  };

  const removeContact = useMutation({
    mutationFn: (contact: FunderContact) => api.delete(`/funders/${funderId}/contacts/${contact.id}`),
    onSuccess: async () => {
      setDeletingContact(null);
      await invalidate();
      toast.success('Contact removed.');
    },
    onError: () => toast.error('That contact could not be removed.'),
  });

  const archive = useMutation({
    mutationFn: (archived: boolean) => api.patch(`/funders/${funderId}/archive`, { archived }),
    onSuccess: async () => {
      setArchiveOpen(false);
      await invalidate();
      toast.success('Funder updated.');
    },
    onError: (err: unknown) =>
      toast.error(err instanceof ApiRequestError ? err.message : 'That change could not be saved.'),
  });

  if (isLoading) {
    return (
      <div className="card">
        <LoadingState label="Loading funder…" />
      </div>
    );
  }

  if (isError || !data) {
    const notFound = error instanceof ApiRequestError && error.status === 404;
    return (
      <div className="card">
        <ErrorState
          title={notFound ? 'Funder not found' : 'We could not load this funder'}
          description={
            notFound
              ? 'This funder does not exist, or it belongs to another organization.'
              : 'Something went wrong reading this record.'
          }
          onRetry={notFound ? undefined : () => void refetch()}
        />
      </div>
    );
  }

  const { funder, grants } = data;
  const writable = can('funders:write');

  return (
    <>
      <header className="page-header">
        <div className="page-header__text">
          <p className="page-header__eyebrow">
            <Link to="/funders">Funders</Link>
          </p>
          <h1 className="page-header__title">{funder.name}</h1>
          <div className="row row-wrap" style={{ marginTop: 'var(--space-3)' }}>
            <Badge tone="accent">{FUNDER_TYPE_LABELS[funder.type]}</Badge>
            {funder.archived && <Badge tone="neutral">Archived</Badge>}
            {funder.focusAreas.map((area) => (
              <Badge key={area} tone="plain">
                {area}
              </Badge>
            ))}
          </div>
        </div>
        {writable && (
          <div className="page-header__actions">
            <button type="button" className="btn" onClick={() => setEditOpen(true)}>
              <Pencil size={16} aria-hidden="true" />
              Edit funder
            </button>
            <button type="button" className="btn" onClick={() => setArchiveOpen(true)}>
              {funder.archived ? <ArchiveRestore size={16} aria-hidden="true" /> : <Archive size={16} aria-hidden="true" />}
              {funder.archived ? 'Restore' : 'Archive'}
            </button>
          </div>
        )}
      </header>

      <div className="grid grid--main-side">
        <div className="stack stack-5">
          <Card title="Grants from this funder" subtitle={`${grants.length} records, active and historical`} flush>
            {grants.length === 0 ? (
              <EmptyState title="No grants recorded" description="Grants linked to this funder will appear here." compact />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <caption className="visually-hidden">Grants from {funder.name}</caption>
                  <thead>
                    <tr>
                      <th scope="col">Grant</th>
                      <th scope="col">Status</th>
                      <th scope="col" className="table__num">
                        Awarded
                      </th>
                      <th scope="col">Period</th>
                      <th scope="col">Health</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grants.map((grant) => (
                      <tr key={grant.id}>
                        <td>
                          <Link to={`/grants/${grant.id}`} className="table__primary link-plain">
                            {grant.title}
                          </Link>
                          <div className="table__meta">{grant.ownerName ?? 'Unassigned'}</div>
                        </td>
                        <td>
                          <StatusPill tone={statusTone[grant.status]} label={GRANT_STATUS_LABELS[grant.status]} />
                        </td>
                        <td className="table__num">{formatCents(grant.awardedCents, grant.currency)}</td>
                        <td className="small">
                          {grant.startDate ? formatIsoDate(grant.startDate) : '—'}
                          {' – '}
                          {grant.endDate ? formatIsoDate(grant.endDate) : '—'}
                        </td>
                        <td>
                          <StatusPill tone={healthTone[grant.health.level]} label={HEALTH_LABELS[grant.health.level]} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card
            title="Contacts"
            subtitle="The people who answer questions about reports and payments."
            flush
            actions={
              writable && (
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  onClick={() => {
                    setEditingContact(null);
                    setContactOpen(true);
                  }}
                >
                  <Plus size={15} aria-hidden="true" />
                  Add contact
                </button>
              )
            }
          >
            {funder.contacts.length === 0 ? (
              <EmptyState title="No contacts yet" description="Add the program officer and grants manager." compact />
            ) : (
              <div className="divider-y">
                {funder.contacts.map((contact) => (
                  <div className="list-row" key={contact.id}>
                    <div className="list-row__body">
                      <div className="list-row__title">{contact.name}</div>
                      <p className="list-row__meta">{contact.title ?? 'Contact'}</p>
                      <p className="list-row__meta">
                        {contact.email && <a href={`mailto:${contact.email}`}>{contact.email}</a>}
                        {contact.email && contact.phone && ' · '}
                        {contact.phone}
                      </p>
                      {contact.notes && <p className="list-row__meta">{contact.notes}</p>}
                    </div>
                    {writable && (
                      <div className="list-row__actions">
                        <button
                          type="button"
                          className="btn btn--ghost btn--icon btn--sm"
                          onClick={() => {
                            setEditingContact(contact);
                            setContactOpen(true);
                          }}
                          aria-label={`Edit contact ${contact.name}`}
                        >
                          <Pencil size={15} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="btn btn--ghost btn--icon btn--sm"
                          onClick={() => setDeletingContact(contact)}
                          aria-label={`Remove contact ${contact.name}`}
                        >
                          <Trash2 size={15} aria-hidden="true" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="stack stack-5">
          <Card title="Relationship">
            <DefinitionList
              items={[
                { term: 'Active grants', value: `${funder.activeGrantCount} of ${funder.totalGrantCount}` },
                { term: 'Awarded to date', value: formatCents(funder.awardedCents) },
                {
                  term: 'Renewal exposure',
                  value:
                    funder.renewalExposureCents > 0
                      ? `${formatCents(funder.renewalExposureCents)} in 12 months`
                      : 'None in the next 12 months',
                },
                {
                  term: 'Next deadline',
                  value: funder.nextDeadline
                    ? `${formatIsoDate(funder.nextDeadline.date)} — ${funder.nextDeadline.title}`
                    : 'None scheduled',
                },
                {
                  term: 'Website',
                  value: funder.website ? (
                    <a href={funder.website} target="_blank" rel="noreferrer noopener">
                      Visit site <ExternalLink size={12} style={{ display: 'inline' }} aria-hidden="true" />
                    </a>
                  ) : (
                    '—'
                  ),
                },
              ]}
            />
          </Card>

          <Card title="Notes">
            <p className="prose">{funder.notes ?? 'No notes recorded.'}</p>
          </Card>
        </div>
      </div>

      <FunderDialog open={editOpen} onClose={() => setEditOpen(false)} funder={funder} />

      <ContactDialog
        open={contactOpen}
        onClose={() => setContactOpen(false)}
        funderId={funderId}
        contact={editingContact}
        onSaved={invalidate}
      />

      <ConfirmDialog
        open={Boolean(deletingContact)}
        title="Remove this contact?"
        description={`${deletingContact?.name ?? ''} will be removed from this funder.`}
        confirmLabel="Remove contact"
        tone="danger"
        busy={removeContact.isPending}
        onConfirm={() => deletingContact && removeContact.mutate(deletingContact)}
        onCancel={() => setDeletingContact(null)}
      />

      <ConfirmDialog
        open={archiveOpen}
        title={funder.archived ? 'Restore this funder?' : 'Archive this funder?'}
        description={
          funder.archived
            ? 'The funder becomes selectable again when creating grants.'
            : 'Archiving hides the funder from new grant forms. Existing grants and history are untouched. Funders with active grants cannot be archived.'
        }
        confirmLabel={funder.archived ? 'Restore funder' : 'Archive funder'}
        tone={funder.archived ? 'primary' : 'danger'}
        busy={archive.isPending}
        onConfirm={() => archive.mutate(!funder.archived)}
        onCancel={() => setArchiveOpen(false)}
      />
    </>
  );
}

function ContactDialog({
  open,
  onClose,
  funderId,
  contact,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  funderId: string;
  contact: FunderContact | null;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', title: '', email: '', phone: '', notes: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  useFocusFirstInvalid(errors);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setForm({
      name: contact?.name ?? '',
      title: contact?.title ?? '',
      email: contact?.email ?? '',
      phone: contact?.phone ?? '',
      notes: contact?.notes ?? '',
    });
  }, [open, contact]);

  const save = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      contact
        ? api.put(`/funders/${funderId}/contacts/${contact.id}`, payload)
        : api.post(`/funders/${funderId}/contacts`, payload),
    onSuccess: async () => {
      await onSaved();
      toast.success(contact ? 'Contact updated.' : 'Contact added.');
      onClose();
    },
    onError: (error: unknown) => {
      if (error instanceof ApiRequestError) setErrors(error.fields);
      toast.error(error instanceof ApiRequestError ? error.message : 'That contact could not be saved.');
    },
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.name.trim()) {
      setErrors({ name: 'Contact name is required.' });
      return;
    }
    save.mutate(form);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={contact ? 'Edit contact' : 'Add contact'}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={save.isPending}>
            Cancel
          </button>
          <button type="submit" form="contact-form" className="btn btn--primary" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : contact ? 'Save contact' : 'Add contact'}
          </button>
        </>
      }
    >
      <form id="contact-form" onSubmit={submit} noValidate className="form-grid">
        <Field label="Name" htmlFor="contact-name" error={errors.name} span>
          <Input
            id="contact-name"
            value={form.name}
            invalid={Boolean(errors.name)}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </Field>
        <Field label="Title" htmlFor="contact-title" optional>
          <Input id="contact-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <Field label="Email" htmlFor="contact-email" optional error={errors.email}>
          <Input
            id="contact-email"
            type="email"
            value={form.email}
            invalid={Boolean(errors.email)}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </Field>
        <Field label="Phone" htmlFor="contact-phone" optional>
          <Input id="contact-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </Field>
        <Field label="Notes" htmlFor="contact-notes" optional span>
          <Textarea id="contact-notes" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
      </form>
    </Dialog>
  );
}
