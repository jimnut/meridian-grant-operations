import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArchiveRestore,
  CircleCheck,
  Download,
  FileText,
  Paperclip,
  Pencil,
  Plus,
  Trash2,
  TriangleAlert,
  Upload,
} from 'lucide-react';

import { BRAND } from '../../shared/brand';
import {
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  GRANT_STATUSES,
  GRANT_STATUS_LABELS,
  type GrantStatus,
  HEALTH_LABELS,
  HORIZONS,
  MILESTONE_STATUSES,
  MILESTONE_STATUS_LABELS,
  MILESTONE_TYPES,
  MILESTONE_TYPE_LABELS,
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
} from '../../shared/constants';
import { formatTimestamp, relativeTimeLabel, type IsoDate } from '../../shared/dates';
import { archiveDenialReason } from '../../shared/lifecycle';
import { centsToPlainString } from '../../shared/money';
import type { BudgetLine, GrantDetail, GrantMilestone, GrantTask } from '../../shared/types';
import { api, ApiRequestError, downloadFile } from '../lib/api';
import { useCurrentSession, useSession } from '../lib/session';
import { useToast } from '../lib/toast';
import {
  dueTone,
  evidenceLabel,
  formatBytes,
  formatCents,
  formatDateRange,
  formatIsoDate,
  healthTone,
  milestoneStatusTone,
  priorityTone,
  relativeDueLabel,
  statusTone,
  taskStatusTone,
} from '../lib/format';
import { ConfirmDialog, Dialog } from '../components/Dialog';
import { GrantFormDialog, useLookups } from '../components/GrantFormDialog';
import {
  Badge,
  Card,
  DefinitionList,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  MoneyInput,
  Progress,
  Select,
  StatusPill,
  TabPanel,
  Tabs,
  Textarea,
  useFocusFirstInvalid,
} from '../components/ui';

type TabId = 'overview' | 'tasks' | 'deliverables' | 'budget' | 'evidence' | 'notes' | 'activity';

export function GrantDetailPage() {
  const { grantId = '' } = useParams();
  const session = useCurrentSession();
  const { can } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);

  const tab = (params.get('tab') as TabId) ?? 'overview';
  const setTab = (next: TabId) => {
    setParams(
      (current) => {
        const updated = new URLSearchParams(current);
        if (next === 'overview') updated.delete('tab');
        else updated.set('tab', next);
        return updated;
      },
      { replace: true },
    );
  };

  const { data: grant, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['grant', grantId],
    queryFn: () => api.get<GrantDetail>(`/grants/${grantId}`),
    retry: false,
  });

  useEffect(() => {
    document.title = grant ? `${grant.title} · ${BRAND.titleSuffix}` : `Grant · ${BRAND.titleSuffix}`;
  }, [grant]);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['grant', grantId] });
    await queryClient.invalidateQueries({ queryKey: ['grants'] });
    await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  // Status moves are consequential — they feed dashboards, lifecycle guards and
  // reports — so the select stages the change and a dialog asks for an explicit
  // confirmation instead of firing on the spot.
  const [pendingStatus, setPendingStatus] = useState<GrantStatus | null>(null);

  const changeStatus = useMutation({
    mutationFn: (status: string) => api.patch<GrantDetail>(`/grants/${grantId}/status`, { status }),
    onSuccess: async (updated) => {
      await invalidate();
      toast.success(`Status set to ${GRANT_STATUS_LABELS[updated.status]}.`);
    },
    onError: (err: unknown) =>
      toast.error(err instanceof ApiRequestError ? err.message : 'The status could not be changed.'),
  });

  const archive = useMutation({
    mutationFn: (archived: boolean) => api.patch<GrantDetail>(`/grants/${grantId}/archive`, { archived }),
    onSuccess: async (updated) => {
      setArchiveOpen(false);
      await invalidate();
      toast.success(updated.archived ? 'Grant archived.' : 'Grant restored.');
    },
    onError: (err: unknown) =>
      toast.error(err instanceof ApiRequestError ? err.message : 'That change could not be saved.'),
  });

  if (isLoading) {
    return (
      <div className="card">
        <LoadingState label="Loading grant…" />
      </div>
    );
  }

  if (isError || !grant) {
    const notFound = error instanceof ApiRequestError && error.status === 404;
    return (
      <div className="card">
        <ErrorState
          title={notFound ? 'Grant not found' : 'We could not load this grant'}
          description={
            notFound
              ? 'This grant does not exist, or it belongs to another organization.'
              : 'Something went wrong reading this record.'
          }
          onRetry={notFound ? undefined : () => void refetch()}
        />
        <div className="row" style={{ justifyContent: 'center', paddingBottom: 'var(--space-6)' }}>
          <Link to="/grants" className="btn">
            Back to portfolio
          </Link>
        </div>
      </div>
    );
  }

  const readOnly = !can('grants:write');
  const openTasks = grant.tasks.filter((t) => t.status !== 'DONE').length;
  const openMilestones = grant.milestones.filter((m) => m.status !== 'COMPLETE' && m.status !== 'WAIVED').length;

  // Why archiving is not allowed right now (null when it is). The server
  // enforces the same shared rule; computing it here lets the UI explain the
  // refusal up front instead of failing after the fact.
  const archiveDenial = grant.archived
    ? null
    : archiveDenialReason({
        status: grant.status,
        awardedCents: grant.awardedCents,
        openTaskCount: openTasks,
        openMilestoneCount: openMilestones,
      });

  const tabs: Array<{ id: TabId; label: string; count?: number }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'tasks', label: 'Tasks', count: openTasks },
    { id: 'deliverables', label: 'Deliverables', count: openMilestones },
    { id: 'budget', label: 'Budget', count: grant.budgetLines.length },
    { id: 'evidence', label: 'Evidence', count: grant.documents.length },
    { id: 'notes', label: 'Notes', count: grant.comments.length },
    { id: 'activity', label: 'Activity' },
  ];

  return (
    <>
      <header className="page-header">
        <div className="page-header__text">
          <p className="page-header__eyebrow">
            <Link to="/funders">{grant.funderName}</Link>
            {grant.program ? ` · ${grant.program}` : ''}
          </p>
          <h1 className="page-header__title">{grant.title}</h1>
          <div className="row row-wrap" style={{ marginTop: 'var(--space-3)', gap: 'var(--space-2)' }}>
            <StatusPill tone={statusTone[grant.status]} label={GRANT_STATUS_LABELS[grant.status]} size="lg" />
            <StatusPill tone={healthTone[grant.health.level]} label={HEALTH_LABELS[grant.health.level]} size="lg" />
            {grant.archived && <Badge tone="neutral">Archived</Badge>}
            <Badge tone="plain">{grant.ownerName ?? 'Unassigned'}</Badge>
            <Badge tone="plain">{formatDateRange(grant.startDate, grant.endDate)}</Badge>
          </div>
        </div>

        <div className="page-header__actions">
          <Link to={`/grants/${grant.id}/packet`} className="btn">
            <FileText size={16} aria-hidden="true" />
            Reporting packet
          </Link>
          {!readOnly && (
            <button type="button" className="btn" onClick={() => setEditOpen(true)}>
              <Pencil size={16} aria-hidden="true" />
              Edit
            </button>
          )}
          {can('grants:archive') && (
            <button type="button" className="btn" onClick={() => setArchiveOpen(true)}>
              {grant.archived ? <ArchiveRestore size={16} aria-hidden="true" /> : <Archive size={16} aria-hidden="true" />}
              {grant.archived ? 'Restore' : 'Archive'}
            </button>
          )}
        </div>
      </header>

      {readOnly && (
        <div className="banner banner--info" style={{ marginBottom: 'var(--space-4)' }}>
          <div>
            You have read-only access to this workspace. You can review everything here and export reports, but changes
            are disabled.
          </div>
        </div>
      )}

      <div className="grid grid--stats" style={{ marginBottom: 'var(--space-5)' }}>
        <SummaryTile label="Awarded" value={formatCents(grant.awardedCents, grant.currency)} helper={grant.awardedCents === 0 ? `Requested ${formatCents(grant.requestedCents, grant.currency)}` : `Requested ${formatCents(grant.requestedCents, grant.currency)}`} />
        <SummaryTile
          label="Restricted spend"
          value={formatCents(grant.budget.spentCents, grant.currency)}
          helper={`${grant.budget.spentPercent}% of ${formatCents(grant.budget.plannedCents, grant.currency)} planned`}
        />
        <SummaryTile
          label="Next deadline"
          value={grant.nextDeadline ? formatIsoDate(grant.nextDeadline.date) : 'None'}
          helper={grant.nextDeadline ? grant.nextDeadline.title : 'No open dated work'}
        />
        <SummaryTile
          label="Reporting readiness"
          value={`${grant.readiness.percent}%`}
          helper={grant.readiness.detail}
        />
      </div>

      {!readOnly && (
        <div className="toolbar" style={{ marginBottom: 'var(--space-5)' }}>
          <label className="field__label" htmlFor="grant-status-control" style={{ marginBottom: 0 }}>
            Lifecycle status
          </label>
          <Select
            id="grant-status-control"
            style={{ width: 'auto' }}
            value={grant.status}
            disabled={changeStatus.isPending}
            onChange={(event) => {
              const next = event.target.value as GrantStatus;
              if (next !== grant.status) setPendingStatus(next);
            }}
          >
            {GRANT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {GRANT_STATUS_LABELS[status]}
              </option>
            ))}
          </Select>
          <span className="muted small">
            {changeStatus.isPending ? 'Saving…' : 'Changes are recorded in the activity trail.'}
          </span>
          <div className="spacer" />
          {grant.nextAction && (
            <span className="small">
              <strong>Next action:</strong> {grant.nextAction}
            </span>
          )}
        </div>
      )}

      <Tabs tabs={tabs} value={tab} onChange={setTab} idPrefix="grant" />

      <div style={{ marginTop: 'var(--space-5)' }}>
        <TabPanel id="overview" idPrefix="grant" active={tab === 'overview'}>
          <OverviewTab grant={grant} />
        </TabPanel>
        <TabPanel id="tasks" idPrefix="grant" active={tab === 'tasks'}>
          <TasksTab grant={grant} onChanged={invalidate} readOnly={!can('tasks:write')} today={session.today} />
        </TabPanel>
        <TabPanel id="deliverables" idPrefix="grant" active={tab === 'deliverables'}>
          <DeliverablesTab grant={grant} onChanged={invalidate} readOnly={!can('milestones:write')} today={session.today} />
        </TabPanel>
        <TabPanel id="budget" idPrefix="grant" active={tab === 'budget'}>
          <BudgetTab grant={grant} onChanged={invalidate} readOnly={!can('budget:write')} />
        </TabPanel>
        <TabPanel id="evidence" idPrefix="grant" active={tab === 'evidence'}>
          <EvidenceTab grant={grant} onChanged={invalidate} />
        </TabPanel>
        <TabPanel id="notes" idPrefix="grant" active={tab === 'notes'}>
          <NotesTab grant={grant} onChanged={invalidate} readOnly={!can('comments:write')} />
        </TabPanel>
        <TabPanel id="activity" idPrefix="grant" active={tab === 'activity'}>
          <ActivityTab grant={grant} timezone={session.organization.timezone} />
        </TabPanel>
      </div>

      <GrantFormDialog open={editOpen} onClose={() => setEditOpen(false)} grant={grant} />

      {archiveDenial ? (
        <Dialog
          open={archiveOpen}
          onClose={() => setArchiveOpen(false)}
          title="This grant cannot be archived yet"
          footer={
            <button type="button" className="btn" onClick={() => setArchiveOpen(false)}>
              Close
            </button>
          }
        >
          <p className="muted">{archiveDenial}</p>
        </Dialog>
      ) : (
      <ConfirmDialog
        open={archiveOpen}
        title={grant.archived ? 'Restore this grant?' : 'Archive this grant?'}
        description={
          grant.archived
            ? 'The grant returns to the active portfolio and its deadlines count toward dashboard figures again.'
            : 'Archiving hides the grant from the default portfolio view and dashboard totals. Nothing is deleted — all tasks, budgets, evidence and history are kept, and you can restore it at any time.'
        }
        confirmLabel={grant.archived ? 'Restore grant' : 'Archive grant'}
        tone={grant.archived ? 'primary' : 'danger'}
        busy={archive.isPending}
        onConfirm={() => archive.mutate(!grant.archived)}
        onCancel={() => setArchiveOpen(false)}
      />
      )}

      <ConfirmDialog
        open={pendingStatus !== null}
        title="Change lifecycle status?"
        description={`Move “${grant.title}” from ${GRANT_STATUS_LABELS[grant.status]} to ${
          pendingStatus ? GRANT_STATUS_LABELS[pendingStatus] : GRANT_STATUS_LABELS[grant.status]
        }. The change takes effect immediately and is recorded in the activity trail.`}
        confirmLabel="Change status"
        busy={changeStatus.isPending}
        onConfirm={() => {
          if (pendingStatus) changeStatus.mutate(pendingStatus, { onSettled: () => setPendingStatus(null) });
        }}
        onCancel={() => setPendingStatus(null)}
      />
    </>
  );
}

function SummaryTile({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="stat">
      <div className="stat__label">{label}</div>
      <div className="stat__value stat__value--sm numeric">{value}</div>
      <div className="stat__helper">{helper}</div>
    </div>
  );
}

/* ---------------------------------------------------------------- overview */

function OverviewTab({ grant }: { grant: GrantDetail }) {
  return (
    <div className="grid grid--main-side">
      <div className="stack stack-5">
        <Card title="Why this health signal" subtitle="Each signal states the rule that produced it.">
          <ul className="stack stack-3" style={{ listStyle: 'none' }}>
            {grant.health.reasons.map((reason, index) => (
              // A grant can raise the same rule for two different deliverables.
              <li key={`${reason.code}-${index}`} className="row" style={{ alignItems: 'flex-start', gap: 'var(--space-3)' }}>
                <span style={{ marginTop: 2, flex: 'none' }}>
                  {reason.severity === 'GOOD' ? (
                    <CircleCheck size={17} color="var(--positive)" aria-hidden="true" />
                  ) : (
                    <TriangleAlert
                      size={17}
                      color={reason.severity === 'RISK' ? 'var(--risk)' : 'var(--amber)'}
                      aria-hidden="true"
                    />
                  )}
                </span>
                <span>
                  <strong>{reason.label}</strong>
                  <span className="badge badge--plain" style={{ marginLeft: 8 }}>
                    {reason.severity === 'RISK' ? 'Risk' : reason.severity === 'WATCH' ? 'Watch' : 'Good'}
                  </span>
                  <p className="muted small" style={{ marginTop: 2 }}>
                    {reason.detail}
                  </p>
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Purpose">
          <p className="prose">{grant.purpose ?? 'No purpose recorded yet.'}</p>
        </Card>

        <Card title="Funder requirements" subtitle="What this funder expects, in their words.">
          <p className="prose">{grant.requirements ?? 'No requirements recorded yet.'}</p>
        </Card>

        {grant.notes && (
          <Card title="Internal notes">
            <p className="prose">{grant.notes}</p>
          </Card>
        )}
      </div>

      <div className="stack stack-5">
        <Card title="Next action">
          <p className="prose">{grant.nextAction ?? 'No next action recorded.'}</p>
        </Card>

        <Card title="Key dates">
          <DefinitionList
            items={[
              { term: 'Application', value: formatIsoDate(grant.applicationDate) },
              { term: 'Decision', value: formatIsoDate(grant.decisionDate) },
              { term: 'Period start', value: formatIsoDate(grant.startDate) },
              { term: 'Period end', value: formatIsoDate(grant.endDate) },
              { term: 'Renewal', value: formatIsoDate(grant.renewalDate) },
              { term: 'Closeout', value: formatIsoDate(grant.closeoutDate) },
            ]}
          />
        </Card>

        <Card title="Reporting readiness" subtitle={`Reports due within ${HORIZONS.readinessHorizonDays} days`}>
          <div className="stack stack-3">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="numeric" style={{ fontSize: 'var(--text-2xl)', fontWeight: 600 }}>
                {grant.readiness.percent}%
              </span>
              <span className="muted small">{grant.readiness.openReportCount} open</span>
            </div>
            <Progress
              value={grant.readiness.percent}
              label="Reporting readiness"
              tone={grant.readiness.percent >= 70 ? 'accent' : grant.readiness.percent >= 40 ? 'amber' : 'risk'}
            />
            <p className="muted small">{grant.readiness.detail}</p>
          </div>
        </Card>

        <Card title={`Funder contacts`} subtitle={grant.funder.name}>
          {grant.contacts.length === 0 ? (
            <p className="muted small">No contacts recorded for this funder.</p>
          ) : (
            <ul className="stack stack-3" style={{ listStyle: 'none' }}>
              {grant.contacts.map((contact) => (
                <li key={contact.id}>
                  <div style={{ fontWeight: 600 }}>{contact.name}</div>
                  <div className="muted small">{contact.title ?? 'Contact'}</div>
                  {contact.email && (
                    <div className="small">
                      <a href={`mailto:${contact.email}`}>{contact.email}</a>
                    </div>
                  )}
                  {contact.phone && <div className="small muted">{contact.phone}</div>}
                </li>
              ))}
            </ul>
          )}
          <div style={{ marginTop: 'var(--space-4)' }}>
            <Link to={`/funders/${grant.funderId}`}>View funder profile →</Link>
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- tasks */

function TasksTab({
  grant,
  onChanged,
  readOnly,
  today,
}: {
  grant: GrantDetail;
  onChanged: () => Promise<void>;
  readOnly: boolean;
  today: IsoDate;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: lookups } = useLookups();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<GrantTask | null>(null);
  const [deleting, setDeleting] = useState<GrantTask | null>(null);

  // Ticking a task updates the list immediately and rolls back if the server
  // rejects it — a checkbox that waits for a round-trip feels broken.
  const toggle = useMutation({
    mutationFn: ({ task, done }: { task: GrantTask; done: boolean }) =>
      api.patch(`/grants/${grant.id}/tasks/${task.id}`, { status: done ? 'DONE' : 'TODO' }),
    onMutate: ({ task, done }) => {
      const key = ['grant', grant.id];
      // Update the cache in the same tick as the click so the control never
      // flickers back to its previous state while the request is in flight.
      void queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<GrantDetail>(key);
      queryClient.setQueryData<GrantDetail>(key, (current) =>
        current
          ? {
              ...current,
              tasks: current.tasks.map((t) =>
                t.id === task.id
                  ? { ...t, status: done ? 'DONE' : 'TODO', completedAt: done ? new Date().toISOString() : null }
                  : t,
              ),
            }
          : current,
      );
      return { previous };
    },
    onError: (_error, _variables, backup) => {
      if (backup?.previous) queryClient.setQueryData(['grant', grant.id], backup.previous);
      toast.error('That task could not be updated.');
    },
    onSettled: onChanged,
  });

  const remove = useMutation({
    mutationFn: (task: GrantTask) => api.delete(`/grants/${grant.id}/tasks/${task.id}`),
    onSuccess: async () => {
      setDeleting(null);
      await onChanged();
      toast.success('Task removed.');
    },
    onError: () => toast.error('That task could not be removed.'),
  });

  const open = grant.tasks.filter((t) => t.status !== 'DONE');
  const done = grant.tasks.filter((t) => t.status === 'DONE');

  return (
    <>
      <Card
        title="Tasks"
        subtitle={`${open.length} open · ${done.length} complete`}
        flush
        actions={
          !readOnly && (
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus size={15} aria-hidden="true" />
              Add task
            </button>
          )
        }
      >
        {grant.tasks.length === 0 ? (
          <EmptyState
            title="No tasks yet"
            description="Break the reporting and compliance work into tasks so nothing depends on one person's memory."
            compact
          />
        ) : (
          <div className="divider-y">
            {[...open, ...done].map((task) => (
              <div className="list-row" key={task.id}>
                {!readOnly && (
                  <label className="checkbox" style={{ marginTop: 2 }}>
                    <input
                      type="checkbox"
                      checked={task.status === 'DONE'}
                      onChange={(event) => toggle.mutate({ task, done: event.target.checked })}
                    />
                    <span className="visually-hidden">Mark “{task.title}” {task.status === 'DONE' ? 'not done' : 'done'}</span>
                  </label>
                )}
                <div className="list-row__body">
                  <div
                    className="list-row__title"
                    style={task.status === 'DONE' ? { textDecoration: 'line-through', color: 'var(--ink-400)' } : undefined}
                  >
                    {task.title}
                  </div>
                  {task.description && <p className="list-row__meta">{task.description}</p>}
                  <div className="row row-wrap" style={{ marginTop: 'var(--space-2)' }}>
                    <StatusPill tone={taskStatusTone[task.status]} label={TASK_STATUS_LABELS[task.status]} />
                    <Badge tone={priorityTone[task.priority]}>{TASK_PRIORITY_LABELS[task.priority]}</Badge>
                    {task.dueDate && (
                      <Badge tone={dueTone(task.dueDate, today, task.status === 'DONE')}>
                        {formatIsoDate(task.dueDate)}
                      </Badge>
                    )}
                    <span className="muted small">{task.assigneeName ?? 'Unassigned'}</span>
                  </div>
                </div>
                {!readOnly && (
                  <div className="list-row__actions">
                    <button
                      type="button"
                      className="btn btn--ghost btn--icon btn--sm"
                      onClick={() => {
                        setEditing(task);
                        setDialogOpen(true);
                      }}
                      aria-label={`Edit task ${task.title}`}
                    >
                      <Pencil size={15} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--icon btn--sm"
                      onClick={() => setDeleting(task)}
                      aria-label={`Remove task ${task.title}`}
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

      <TaskDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        grantId={grant.id}
        task={editing}
        members={lookups?.members ?? []}
        onSaved={onChanged}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Remove this task?"
        description={`“${deleting?.title ?? ''}” will be removed from this grant. This cannot be undone.`}
        confirmLabel="Remove task"
        tone="danger"
        busy={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}

function TaskDialog({
  open,
  onClose,
  grantId,
  task,
  members,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  grantId: string;
  task: GrantTask | null;
  members: Array<{ id: string; name: string }>;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    title: '',
    description: '',
    status: 'TODO',
    priority: 'MEDIUM',
    dueDate: '',
    assigneeUserId: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  useFocusFirstInvalid(errors);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setForm({
      title: task?.title ?? '',
      description: task?.description ?? '',
      status: task?.status ?? 'TODO',
      priority: task?.priority ?? 'MEDIUM',
      dueDate: task?.dueDate ?? '',
      assigneeUserId: task?.assigneeUserId ?? '',
    });
  }, [open, task]);

  const save = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      task ? api.patch(`/grants/${grantId}/tasks/${task.id}`, payload) : api.post(`/grants/${grantId}/tasks`, payload),
    onSuccess: async () => {
      await onSaved();
      toast.success(task ? 'Task updated.' : 'Task added.');
      onClose();
    },
    onError: (error: unknown) => {
      if (error instanceof ApiRequestError) setErrors(error.fields);
      toast.error(error instanceof ApiRequestError ? error.message : 'That task could not be saved.');
    },
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.title.trim()) {
      setErrors({ title: 'Task title is required.' });
      return;
    }
    save.mutate({ ...form, assigneeUserId: form.assigneeUserId || null });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={task ? 'Edit task' : 'Add task'}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={save.isPending}>
            Cancel
          </button>
          <button type="submit" form="task-form" className="btn btn--primary" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : task ? 'Save task' : 'Add task'}
          </button>
        </>
      }
    >
      <form id="task-form" onSubmit={submit} noValidate className="form-grid">
        <Field label="Task" htmlFor="task-title" error={errors.title} span>
          <Input
            id="task-title"
            value={form.title}
            invalid={Boolean(errors.title)}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            required
            maxLength={180}
          />
        </Field>
        <Field label="Description" htmlFor="task-description" optional span>
          <Textarea
            id="task-description"
            rows={3}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </Field>
        <Field label="Status" htmlFor="task-status">
          <Select id="task-status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            {TASK_STATUSES.map((status) => (
              <option key={status} value={status}>
                {TASK_STATUS_LABELS[status]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Priority" htmlFor="task-priority">
          <Select id="task-priority" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
            {TASK_PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {TASK_PRIORITY_LABELS[priority]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Due date" htmlFor="task-due" optional error={errors.dueDate}>
          <Input id="task-due" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
        </Field>
        <Field label="Assignee" htmlFor="task-assignee" optional>
          <Select
            id="task-assignee"
            value={form.assigneeUserId}
            onChange={(e) => setForm({ ...form, assigneeUserId: e.target.value })}
          >
            <option value="">Unassigned</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </Select>
        </Field>
      </form>
    </Dialog>
  );
}

/* ------------------------------------------------------------ deliverables */

function DeliverablesTab({
  grant,
  onChanged,
  readOnly,
  today,
}: {
  grant: GrantDetail;
  onChanged: () => Promise<void>;
  readOnly: boolean;
  today: string;
}) {
  const toast = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<GrantMilestone | null>(null);
  const [deleting, setDeleting] = useState<GrantMilestone | null>(null);

  const updateStatus = useMutation({
    mutationFn: ({ milestone, status }: { milestone: GrantMilestone; status: string }) =>
      api.patch(`/grants/${grant.id}/milestones/${milestone.id}`, { status }),
    onSuccess: onChanged,
    onError: () => toast.error('That deliverable could not be updated.'),
  });

  const remove = useMutation({
    mutationFn: (milestone: GrantMilestone) => api.delete(`/grants/${grant.id}/milestones/${milestone.id}`),
    onSuccess: async () => {
      setDeleting(null);
      await onChanged();
      toast.success('Deliverable removed.');
    },
    onError: () => toast.error('That deliverable could not be removed.'),
  });

  return (
    <>
      <Card
        title="Deliverables & reports"
        subtitle="Applications, reports, renewals, payments and site visits — with the evidence each one needs."
        flush
        actions={
          !readOnly && (
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus size={15} aria-hidden="true" />
              Add deliverable
            </button>
          )
        }
      >
        {grant.milestones.length === 0 ? (
          <EmptyState
            title="No deliverables yet"
            description="Add the funder's reporting schedule so deadlines and evidence requirements are tracked."
            compact
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <caption className="visually-hidden">Deliverables for {grant.title}</caption>
              <thead>
                <tr>
                  <th scope="col">Deliverable</th>
                  <th scope="col">Due</th>
                  <th scope="col">Evidence</th>
                  <th scope="col">Status</th>
                  {!readOnly && (
                    <th scope="col">
                      <span className="visually-hidden">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {grant.milestones.map((milestone) => {
                  const complete = milestone.status === 'COMPLETE' || milestone.status === 'WAIVED';
                  const missing = Math.max(0, milestone.requiredEvidenceCount - milestone.attachedEvidenceCount);
                  return (
                    <tr key={milestone.id}>
                      <td>
                        <div className="table__primary">{milestone.title}</div>
                        <div className="table__meta">{MILESTONE_TYPE_LABELS[milestone.type]}</div>
                        {milestone.notes && <div className="table__meta">{milestone.notes}</div>}
                      </td>
                      <td>
                        {milestone.dueDate ? (
                          <>
                            <div>{formatIsoDate(milestone.dueDate)}</div>
                            <div className="table__meta">
                              <Badge tone={dueTone(milestone.dueDate, today, complete)}>
                                {complete ? 'Closed' : relativeDueLabel(milestone.dueDate, today)}
                              </Badge>
                            </div>
                          </>
                        ) : (
                          <span className="muted">No date</span>
                        )}
                      </td>
                      <td>
                        <div>{evidenceLabel(milestone.attachedEvidenceCount, milestone.requiredEvidenceCount)}</div>
                        {missing > 0 && !complete && (
                          <div className="table__meta" style={{ color: 'var(--risk-ink)' }}>
                            {missing} still needed
                          </div>
                        )}
                      </td>
                      <td>
                        {readOnly ? (
                          <StatusPill
                            tone={milestoneStatusTone[milestone.status]}
                            label={MILESTONE_STATUS_LABELS[milestone.status]}
                          />
                        ) : (
                          <>
                            <label className="visually-hidden" htmlFor={`milestone-status-${milestone.id}`}>
                              Status for {milestone.title}
                            </label>
                            <Select
                              id={`milestone-status-${milestone.id}`}
                              value={milestone.status}
                              disabled={updateStatus.isPending}
                              onChange={(event) => updateStatus.mutate({ milestone, status: event.target.value })}
                              style={{ minWidth: 148 }}
                            >
                              {MILESTONE_STATUSES.map((status) => (
                                <option key={status} value={status}>
                                  {MILESTONE_STATUS_LABELS[status]}
                                </option>
                              ))}
                            </Select>
                          </>
                        )}
                      </td>
                      {!readOnly && (
                        <td>
                          <div className="row">
                            <button
                              type="button"
                              className="btn btn--ghost btn--icon btn--sm"
                              onClick={() => {
                                setEditing(milestone);
                                setDialogOpen(true);
                              }}
                              aria-label={`Edit ${milestone.title}`}
                            >
                              <Pencil size={15} aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              className="btn btn--ghost btn--icon btn--sm"
                              onClick={() => setDeleting(milestone)}
                              aria-label={`Remove ${milestone.title}`}
                            >
                              <Trash2 size={15} aria-hidden="true" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <MilestoneDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        grantId={grant.id}
        milestone={editing}
        onSaved={onChanged}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Remove this deliverable?"
        description={`“${deleting?.title ?? ''}” and its evidence requirement will be removed. Uploaded files stay in the evidence library.`}
        confirmLabel="Remove deliverable"
        tone="danger"
        busy={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}

function MilestoneDialog({
  open,
  onClose,
  grantId,
  milestone,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  grantId: string;
  milestone: GrantMilestone | null;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    type: 'REPORT',
    title: '',
    dueDate: '',
    status: 'NOT_STARTED',
    requiredEvidenceCount: '0',
    notes: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  useFocusFirstInvalid(errors);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setForm({
      type: milestone?.type ?? 'REPORT',
      title: milestone?.title ?? '',
      dueDate: milestone?.dueDate ?? '',
      status: milestone?.status ?? 'NOT_STARTED',
      requiredEvidenceCount: String(milestone?.requiredEvidenceCount ?? 0),
      notes: milestone?.notes ?? '',
    });
  }, [open, milestone]);

  const save = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      milestone
        ? api.patch(`/grants/${grantId}/milestones/${milestone.id}`, payload)
        : api.post(`/grants/${grantId}/milestones`, payload),
    onSuccess: async () => {
      await onSaved();
      toast.success(milestone ? 'Deliverable updated.' : 'Deliverable added.');
      onClose();
    },
    onError: (error: unknown) => {
      if (error instanceof ApiRequestError) setErrors(error.fields);
      toast.error(error instanceof ApiRequestError ? error.message : 'That deliverable could not be saved.');
    },
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.title.trim()) {
      setErrors({ title: 'Give the deliverable a title.' });
      return;
    }
    save.mutate(form);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={milestone ? 'Edit deliverable' : 'Add deliverable'}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={save.isPending}>
            Cancel
          </button>
          <button type="submit" form="milestone-form" className="btn btn--primary" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : milestone ? 'Save deliverable' : 'Add deliverable'}
          </button>
        </>
      }
    >
      <form id="milestone-form" onSubmit={submit} noValidate className="form-grid">
        <Field label="Title" htmlFor="milestone-title" error={errors.title} span>
          <Input
            id="milestone-title"
            value={form.title}
            invalid={Boolean(errors.title)}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            required
            maxLength={180}
          />
        </Field>
        <Field label="Type" htmlFor="milestone-type">
          <Select id="milestone-type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            {MILESTONE_TYPES.map((type) => (
              <option key={type} value={type}>
                {MILESTONE_TYPE_LABELS[type]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status" htmlFor="milestone-status-field">
          <Select
            id="milestone-status-field"
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value })}
          >
            {MILESTONE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {MILESTONE_STATUS_LABELS[status]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Due date" htmlFor="milestone-due" optional error={errors.dueDate}>
          <Input
            id="milestone-due"
            type="date"
            value={form.dueDate}
            onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
          />
        </Field>
        <Field
          label="Required evidence"
          htmlFor="milestone-evidence"
          hint="How many attachments this deliverable needs."
          error={errors.requiredEvidenceCount}
        >
          <Input
            id="milestone-evidence"
            type="number"
            min={0}
            max={50}
            value={form.requiredEvidenceCount}
            onChange={(e) => setForm({ ...form, requiredEvidenceCount: e.target.value })}
          />
        </Field>
        <Field label="Notes" htmlFor="milestone-notes" optional span>
          <Textarea id="milestone-notes" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
      </form>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ budget */

function BudgetTab({ grant, onChanged, readOnly }: { grant: GrantDetail; onChanged: () => Promise<void>; readOnly: boolean }) {
  const toast = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BudgetLine | null>(null);
  const [deleting, setDeleting] = useState<BudgetLine | null>(null);

  const remove = useMutation({
    mutationFn: (line: BudgetLine) => api.delete(`/grants/${grant.id}/budget-lines/${line.id}`),
    onSuccess: async () => {
      setDeleting(null);
      await onChanged();
      toast.success('Budget line removed.');
    },
    onError: () => toast.error('That budget line could not be removed.'),
  });

  const { budget } = grant;
  const variance = budget.variancePoints;

  return (
    <>
      <div className="grid grid--main-side">
        <Card
          title="Budget lines"
          subtitle="Planned against actual spend, stored to the cent."
          flush
          actions={
            !readOnly && (
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={() => {
                  setEditing(null);
                  setDialogOpen(true);
                }}
              >
                <Plus size={15} aria-hidden="true" />
                Add line
              </button>
            )
          }
        >
          {grant.budgetLines.length === 0 ? (
            <EmptyState
              title="No budget lines yet"
              description="Add the approved budget categories so spend can be tracked against plan."
              compact
            />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <caption className="visually-hidden">Budget lines for {grant.title}</caption>
                <thead>
                  <tr>
                    <th scope="col">Category</th>
                    <th scope="col" className="table__num">
                      Planned
                    </th>
                    <th scope="col" className="table__num">
                      Spent
                    </th>
                    <th scope="col" className="table__num">
                      Remaining
                    </th>
                    <th scope="col" style={{ width: 120 }}>
                      Used
                    </th>
                    {!readOnly && (
                      <th scope="col">
                        <span className="visually-hidden">Actions</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {grant.budgetLines.map((line) => {
                    const remaining = line.plannedCents - line.spentCents;
                    const percent = line.plannedCents > 0 ? Math.round((line.spentCents / line.plannedCents) * 100) : 0;
                    return (
                      <tr key={line.id}>
                        <td>
                          <div className="table__primary">{line.category}</div>
                          {line.description && <div className="table__meta">{line.description}</div>}
                        </td>
                        <td className="table__num">{formatCents(line.plannedCents, grant.currency)}</td>
                        <td className="table__num">{formatCents(line.spentCents, grant.currency)}</td>
                        <td className="table__num" style={remaining < 0 ? { color: 'var(--risk-ink)', fontWeight: 600 } : undefined}>
                          {formatCents(remaining, grant.currency)}
                        </td>
                        <td>
                          <div className="row" style={{ gap: 'var(--space-2)' }}>
                            <span style={{ flex: 1 }}>
                              <Progress
                                value={percent}
                                label={`${line.category} spent`}
                                tone={percent > 100 ? 'risk' : percent > 85 ? 'amber' : 'accent'}
                              />
                            </span>
                            <span className="small numeric">{percent}%</span>
                          </div>
                        </td>
                        {!readOnly && (
                          <td>
                            <div className="row">
                              <button
                                type="button"
                                className="btn btn--ghost btn--icon btn--sm"
                                onClick={() => {
                                  setEditing(line);
                                  setDialogOpen(true);
                                }}
                                aria-label={`Edit ${line.category}`}
                              >
                                <Pencil size={15} aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                className="btn btn--ghost btn--icon btn--sm"
                                onClick={() => setDeleting(line)}
                                aria-label={`Remove ${line.category}`}
                              >
                                <Trash2 size={15} aria-hidden="true" />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" style={{ textAlign: 'left' }}>
                      Total
                    </th>
                    <td className="table__num" style={{ fontWeight: 600 }}>
                      {formatCents(budget.plannedCents, grant.currency)}
                    </td>
                    <td className="table__num" style={{ fontWeight: 600 }}>
                      {formatCents(budget.spentCents, grant.currency)}
                    </td>
                    <td className="table__num" style={{ fontWeight: 600 }}>
                      {formatCents(budget.remainingCents, grant.currency)}
                    </td>
                    <td colSpan={readOnly ? 1 : 2} className="numeric">
                      {budget.spentPercent}%
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>

        <div className="stack stack-5">
          <Card title="Burn against schedule" subtitle="Spend compared with how much of the grant period has elapsed">
            <div className="stack stack-4">
              <div>
                <div className="row" style={{ justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
                  <span className="small muted">Budget spent</span>
                  <span className="numeric" style={{ fontWeight: 600 }}>
                    {budget.spentPercent}%
                  </span>
                </div>
                <Progress
                  value={budget.spentPercent}
                  markerAt={budget.elapsedPercent}
                  tall
                  label="Budget spent"
                  tone={
                    variance !== null && variance > HORIZONS.burnTolerancepoints
                      ? 'risk'
                      : variance !== null && variance < -HORIZONS.burnTolerancepoints
                        ? 'amber'
                        : 'accent'
                  }
                />
                <p className="muted small" style={{ marginTop: 'var(--space-2)' }}>
                  {budget.elapsedPercent === null ? (
                    'Set a grant period to compare spend against elapsed time.'
                  ) : (
                    <>
                      The marker shows {budget.elapsedPercent}% of the grant period elapsed.{' '}
                      {variance === null
                        ? ''
                        : Math.abs(variance) <= HORIZONS.burnTolerancepoints
                          ? `Spend is within the ${HORIZONS.burnTolerancepoints}-point tolerance.`
                          : variance > 0
                            ? `Spending is ${variance} points ahead of schedule.`
                            : `Spending is ${Math.abs(variance)} points behind schedule.`}
                    </>
                  )}
                </p>
              </div>

              <DefinitionList
                items={[
                  { term: 'Awarded', value: formatCents(grant.awardedCents, grant.currency) },
                  { term: 'Planned', value: formatCents(budget.plannedCents, grant.currency) },
                  { term: 'Spent', value: formatCents(budget.spentCents, grant.currency) },
                  { term: 'Remaining', value: formatCents(budget.remainingCents, grant.currency) },
                  { term: 'Lines', value: String(budget.lineCount) },
                ]}
              />

              {budget.plannedCents !== grant.awardedCents && grant.awardedCents > 0 && (
                <div className="banner banner--amber">
                  <div className="small">
                    Planned budget differs from the awarded amount by{' '}
                    {formatCents(Math.abs(grant.awardedCents - budget.plannedCents), grant.currency)}. Reconcile the
                    budget lines with the award before the next financial report.
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>

      <BudgetDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        grantId={grant.id}
        line={editing}
        onSaved={onChanged}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Remove this budget line?"
        description={`“${deleting?.category ?? ''}” will be removed and the grant totals will be recalculated.`}
        confirmLabel="Remove line"
        tone="danger"
        busy={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}

function BudgetDialog({
  open,
  onClose,
  grantId,
  line,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  grantId: string;
  line: BudgetLine | null;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const [form, setForm] = useState({ category: '', description: '', planned: '', spent: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  useFocusFirstInvalid(errors);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setForm({
      category: line?.category ?? '',
      description: line?.description ?? '',
      planned: line ? centsToPlainString(line.plannedCents) : '',
      spent: line ? centsToPlainString(line.spentCents) : '',
    });
  }, [open, line]);

  const save = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      line
        ? api.put(`/grants/${grantId}/budget-lines/${line.id}`, payload)
        : api.post(`/grants/${grantId}/budget-lines`, payload),
    onSuccess: async () => {
      await onSaved();
      toast.success(line ? 'Budget line updated.' : 'Budget line added.');
      onClose();
    },
    onError: (error: unknown) => {
      if (error instanceof ApiRequestError) setErrors(error.fields);
      toast.error(error instanceof ApiRequestError ? error.message : 'That budget line could not be saved.');
    },
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.category.trim()) {
      setErrors({ category: 'Give the line a category.' });
      return;
    }
    save.mutate({
      category: form.category,
      description: form.description,
      plannedCents: form.planned || '0',
      spentCents: form.spent || '0',
    });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={line ? 'Edit budget line' : 'Add budget line'}
      description="Amounts are stored as integer cents, so totals never drift."
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={save.isPending}>
            Cancel
          </button>
          <button type="submit" form="budget-form" className="btn btn--primary" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : line ? 'Save line' : 'Add line'}
          </button>
        </>
      }
    >
      <form id="budget-form" onSubmit={submit} noValidate className="form-grid">
        <Field label="Category" htmlFor="budget-category" error={errors.category} span>
          <Input
            id="budget-category"
            value={form.category}
            invalid={Boolean(errors.category)}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            placeholder="Personnel, Direct client assistance, Indirect…"
            required
          />
        </Field>
        <Field label="Description" htmlFor="budget-description" optional span>
          <Input
            id="budget-description"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </Field>
        <Field label="Planned" htmlFor="budget-planned" error={errors.plannedCents}>
          <MoneyInput
            id="budget-planned"
            value={form.planned}
            onChange={(value) => setForm({ ...form, planned: value })}
            invalid={Boolean(errors.plannedCents)}
            placeholder="0.00"
          />
        </Field>
        <Field label="Spent to date" htmlFor="budget-spent" error={errors.spentCents}>
          <MoneyInput
            id="budget-spent"
            value={form.spent}
            onChange={(value) => setForm({ ...form, spent: value })}
            invalid={Boolean(errors.spentCents)}
            placeholder="0.00"
          />
        </Field>
      </form>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- evidence */

function EvidenceTab({ grant, onChanged }: { grant: GrantDetail; onChanged: () => Promise<void> }) {
  const { can } = useSession();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState('OTHER');
  const [milestoneId, setMilestoneId] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const canUpload = can('documents:write');
  const canDelete = can('documents:delete');

  const upload = useMutation({
    mutationFn: (formData: FormData) => api.post(`/grants/${grant.id}/documents`, formData),
    onSuccess: async () => {
      setUploadError(null);
      if (fileRef.current) fileRef.current.value = '';
      await onChanged();
      toast.success('Evidence uploaded.');
    },
    onError: (error: unknown) => {
      const message =
        error instanceof ApiRequestError ? error.message : 'That file could not be uploaded. Please try again.';
      setUploadError(message);
      toast.error(message);
    },
  });

  const remove = useMutation({
    mutationFn: (documentId: string) => api.delete(`/grants/${grant.id}/documents/${documentId}`),
    onSuccess: async () => {
      setDeleting(null);
      await onChanged();
      toast.success('Evidence removed.');
    },
    onError: () => toast.error('That file could not be removed.'),
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setUploadError(null);
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setUploadError('Choose a file to upload.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setUploadError('That file is larger than the 10 MB limit.');
      return;
    }
    const formData = new FormData();
    formData.append('file', file);
    formData.append('docType', docType);
    if (milestoneId) formData.append('milestoneId', milestoneId);
    upload.mutate(formData);
  };

  const download = async (documentId: string, name: string) => {
    try {
      await downloadFile(`/grants/${grant.id}/documents/${documentId}/download`, name);
    } catch {
      toast.error('That file could not be downloaded.');
    }
  };

  const deletingDoc = grant.documents.find((d) => d.id === deleting);

  return (
    <div className="grid grid--main-side">
      <Card title="Evidence library" subtitle="Supporting documents tied to deliverables and reports." flush>
        {grant.documents.length === 0 ? (
          <EmptyState
            icon={<Paperclip size={20} />}
            title="No evidence yet"
            description="Upload the receipts, data exports and narratives that reports depend on, and link them to the deliverable they support."
            compact
          />
        ) : (
          <div className="divider-y">
            {grant.documents.map((doc) => (
              <div className="list-row" key={doc.id}>
                <span
                  style={{
                    display: 'grid',
                    placeItems: 'center',
                    width: 34,
                    height: 34,
                    flex: 'none',
                    background: 'var(--canvas-deep)',
                    borderRadius: 'var(--radius-md)',
                  }}
                  aria-hidden="true"
                >
                  <FileText size={17} />
                </span>
                <div className="list-row__body">
                  <div className="list-row__title">{doc.originalName}</div>
                  <p className="list-row__meta">
                    {DOCUMENT_TYPE_LABELS[doc.docType]} · {formatBytes(doc.sizeBytes)} · {doc.uploadedByName} ·{' '}
                    {relativeTimeLabel(doc.createdAt)}
                  </p>
                  {doc.milestoneTitle && (
                    <p className="list-row__meta">
                      <Badge tone="accent">Linked to {doc.milestoneTitle}</Badge>
                    </p>
                  )}
                </div>
                <div className="list-row__actions">
                  <button
                    type="button"
                    className="btn btn--sm"
                    onClick={() => void download(doc.id, doc.originalName)}
                  >
                    <Download size={14} aria-hidden="true" />
                    Download
                  </button>
                  {canDelete && (
                    <button
                      type="button"
                      className="btn btn--ghost btn--icon btn--sm"
                      onClick={() => setDeleting(doc.id)}
                      aria-label={`Remove ${doc.originalName}`}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="stack stack-5">
        {canUpload ? (
          <Card title="Upload evidence" subtitle="PDF, Word, Excel, CSV, PNG or JPEG up to 10 MB.">
            <form onSubmit={submit} className="stack stack-4">
              {uploadError && (
                <div className="banner banner--risk" role="alert">
                  <div className="small">{uploadError}</div>
                </div>
              )}

              <Field label="File" htmlFor="evidence-file">
                <input
                  ref={fileRef}
                  id="evidence-file"
                  className="input"
                  type="file"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.png,.jpg,.jpeg"
                  onChange={() => setUploadError(null)}
                  style={{ paddingTop: 6 }}
                />
              </Field>

              <Field label="Document type" htmlFor="evidence-type">
                <Select id="evidence-type" value={docType} onChange={(event) => setDocType(event.target.value)}>
                  {DOCUMENT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {DOCUMENT_TYPE_LABELS[type]}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Link to deliverable" htmlFor="evidence-milestone" optional>
                <Select
                  id="evidence-milestone"
                  value={milestoneId}
                  onChange={(event) => setMilestoneId(event.target.value)}
                >
                  <option value="">Not linked</option>
                  {grant.milestones.map((milestone) => (
                    <option key={milestone.id} value={milestone.id}>
                      {milestone.title}
                    </option>
                  ))}
                </Select>
              </Field>

              <button type="submit" className="btn btn--primary" disabled={upload.isPending}>
                <Upload size={16} aria-hidden="true" />
                {upload.isPending ? 'Uploading…' : 'Upload evidence'}
              </button>
            </form>
          </Card>
        ) : (
          <Card title="Upload evidence">
            <p className="muted small">Your role can download evidence but cannot upload new files.</p>
          </Card>
        )}

        <Card title="Evidence coverage" subtitle="Requirements by deliverable">
          {grant.milestones.filter((m) => m.requiredEvidenceCount > 0).length === 0 ? (
            <p className="muted small">No deliverable records an evidence requirement yet.</p>
          ) : (
            <ul className="stack stack-3" style={{ listStyle: 'none' }}>
              {grant.milestones
                .filter((m) => m.requiredEvidenceCount > 0)
                .map((milestone) => {
                  const percent = Math.min(
                    100,
                    Math.round((milestone.attachedEvidenceCount / milestone.requiredEvidenceCount) * 100),
                  );
                  return (
                    <li key={milestone.id}>
                      <div className="row" style={{ justifyContent: 'space-between', gap: 'var(--space-2)' }}>
                        <span className="small truncate">{milestone.title}</span>
                        <span className="small numeric">
                          {Math.min(milestone.attachedEvidenceCount, milestone.requiredEvidenceCount)}/
                          {milestone.requiredEvidenceCount}
                        </span>
                      </div>
                      <div style={{ marginTop: 4 }}>
                        <Progress
                          value={percent}
                          label={`Evidence for ${milestone.title}`}
                          tone={percent === 100 ? 'accent' : percent >= 50 ? 'amber' : 'risk'}
                        />
                      </div>
                    </li>
                  );
                })}
            </ul>
          )}
        </Card>
      </div>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Remove this file?"
        description={`“${deletingDoc?.originalName ?? ''}” will be deleted from the evidence library and from local storage. This cannot be undone.`}
        confirmLabel="Remove file"
        tone="danger"
        busy={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

/* ------------------------------------------------------------------- notes */

function NotesTab({ grant, onChanged, readOnly }: { grant: GrantDetail; onChanged: () => Promise<void>; readOnly: boolean }) {
  const toast = useToast();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = useMutation({
    mutationFn: (text: string) => api.post(`/grants/${grant.id}/comments`, { body: text }),
    onSuccess: async () => {
      setBody('');
      setError(null);
      await onChanged();
      toast.success('Note added.');
    },
    onError: (err: unknown) => {
      const message = err instanceof ApiRequestError ? err.message : 'That note could not be saved.';
      setError(message);
      toast.error(message);
    },
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!body.trim()) {
      setError('Write something first.');
      return;
    }
    add.mutate(body.trim());
  };

  return (
    <div className="stack stack-5" style={{ maxWidth: 820 }}>
      {!readOnly && (
        <Card title="Add a note" subtitle="Notes are plain text and visible to everyone in this organization.">
          <form onSubmit={submit} className="stack stack-3">
            <Field label="Note" htmlFor="note-body" error={error ?? undefined}>
              <Textarea
                id="note-body"
                rows={3}
                value={body}
                invalid={Boolean(error)}
                maxLength={4000}
                onChange={(event) => {
                  setBody(event.target.value);
                  setError(null);
                }}
                placeholder="What changed, what you agreed with the funder, what to watch."
              />
            </Field>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="muted small">{body.length}/4000</span>
              <button type="submit" className="btn btn--primary" disabled={add.isPending}>
                {add.isPending ? 'Saving…' : 'Add note'}
              </button>
            </div>
          </form>
        </Card>
      )}

      <Card title="Notes" subtitle={`${grant.comments.length} recorded`} flush>
        {grant.comments.length === 0 ? (
          <EmptyState title="No notes yet" description="Notes keep funder conversations and decisions with the record." compact />
        ) : (
          <div className="divider-y">
            {grant.comments.map((comment) => (
              <article className="list-row" key={comment.id}>
                <div className="list-row__body">
                  <div className="row" style={{ gap: 'var(--space-2)' }}>
                    <strong>{comment.authorName}</strong>
                    <span className="muted small">{relativeTimeLabel(comment.createdAt)}</span>
                  </div>
                  <p className="prose" style={{ marginTop: 'var(--space-2)' }}>
                    {comment.body}
                  </p>
                </div>
              </article>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------- activity */

function ActivityTab({ grant, timezone }: { grant: GrantDetail; timezone: string }) {
  const grouped = useMemo(() => grant.activity, [grant.activity]);

  return (
    <Card title="Activity" subtitle="Every recorded change to this grant, most recent first." >
      {grouped.length === 0 ? (
        <EmptyState title="No activity recorded" description="Changes will appear here as the team works." compact />
      ) : (
        <ol className="timeline">
          {grouped.map((entry) => (
            <li className="timeline__item" key={entry.id}>
              <span className="timeline__dot" aria-hidden="true" />
              <div className="timeline__body">
                <p className="timeline__summary">{entry.summary}</p>
                <p className="timeline__meta">
                  {entry.actorName} · {formatTimestamp(entry.createdAt, timezone)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
