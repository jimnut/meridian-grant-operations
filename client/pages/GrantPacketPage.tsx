import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download, Printer } from 'lucide-react';

import { BRAND } from '../../shared/brand';
import {
  DOCUMENT_TYPE_LABELS,
  GRANT_STATUS_LABELS,
  HEALTH_LABELS,
  MILESTONE_STATUS_LABELS,
  MILESTONE_TYPE_LABELS,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
} from '../../shared/constants';
import { formatTimestamp } from '../../shared/dates';
import type { ReportingPacket } from '../../shared/types';
import { api, downloadFile } from '../lib/api';
import { useToast } from '../lib/toast';
import { formatCents, formatDateRange, formatIsoDate } from '../lib/format';
import { ErrorState, LoadingState } from '../components/ui';

export function GrantPacketPage() {
  const { grantId = '' } = useParams();
  const toast = useToast();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['packet', grantId],
    queryFn: () => api.get<ReportingPacket>(`/grants/${grantId}/packet`),
    retry: false,
  });

  useEffect(() => {
    document.title = data ? `Reporting packet — ${data.grant.title} · ${BRAND.titleSuffix}` : `Reporting packet · ${BRAND.titleSuffix}`;
  }, [data]);

  if (isLoading) {
    return (
      <div className="card">
        <LoadingState label="Assembling the reporting packet…" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="card">
        <ErrorState
          title="We could not build this packet"
          description="The grant may not exist, or it belongs to another organization."
          onRetry={() => void refetch()}
        />
      </div>
    );
  }

  const { grant, organization, budgetTotals } = data;

  const exportCsv = async () => {
    try {
      await downloadFile(`/grants/${grantId}/packet.csv`, 'reporting-packet.csv');
      toast.success('Packet exported.');
    } catch {
      toast.error('The export could not be generated.');
    }
  };

  return (
    <>
      <div className="row row-wrap no-print" style={{ marginBottom: 'var(--space-5)' }}>
        <Link to={`/grants/${grant.id}`} className="btn btn--sm">
          <ArrowLeft size={15} aria-hidden="true" />
          Back to grant
        </Link>
        <div className="spacer" />
        <button type="button" className="btn btn--sm" onClick={() => void exportCsv()}>
          <Download size={15} aria-hidden="true" />
          Export CSV
        </button>
        <button type="button" className="btn btn--primary btn--sm" onClick={() => window.print()}>
          <Printer size={15} aria-hidden="true" />
          Print / save as PDF
        </button>
      </div>

      <article className="packet">
        <header className="packet__masthead">
          <div>
            <p className="packet__org">{organization.name}</p>
            <p className="packet__doctype">Grant reporting packet</p>
          </div>
          <div className="text-right small muted">
            <div>Generated {formatTimestamp(data.generatedAt, organization.timezone)}</div>
            <div>{BRAND.fullName}</div>
          </div>
        </header>

        <h1 className="packet__title">{grant.title}</h1>
        <p className="muted" style={{ marginTop: 'var(--space-2)' }}>
          {grant.funderName}
          {grant.program ? ` · ${grant.program}` : ''}
        </p>

        <section className="packet__section">
          <h2 className="packet__section-title">Grant summary</h2>
          <div className="table-wrap">
            <table className="table table--compact">
              <caption className="visually-hidden">Grant summary</caption>
              <tbody>
                <tr>
                  <th scope="row" style={{ width: '32%' }}>
                    Funder
                  </th>
                  <td>{grant.funder.name}</td>
                </tr>
                <tr>
                  <th scope="row">Status</th>
                  <td>
                    {GRANT_STATUS_LABELS[grant.status]} · Health: {HEALTH_LABELS[grant.health.level]}
                  </td>
                </tr>
                <tr>
                  <th scope="row">Internal owner</th>
                  <td>{grant.ownerName ?? 'Unassigned'}</td>
                </tr>
                <tr>
                  <th scope="row">Grant period</th>
                  <td>{formatDateRange(grant.startDate, grant.endDate)}</td>
                </tr>
                <tr>
                  <th scope="row">Award</th>
                  <td>
                    {formatCents(grant.awardedCents, grant.currency)}
                    {grant.requestedCents > 0 && ` (requested ${formatCents(grant.requestedCents, grant.currency)})`}
                  </td>
                </tr>
                <tr>
                  <th scope="row">Key dates</th>
                  <td>
                    Application {formatIsoDate(grant.applicationDate)} · Decision {formatIsoDate(grant.decisionDate)} ·
                    Renewal {formatIsoDate(grant.renewalDate)} · Closeout {formatIsoDate(grant.closeoutDate)}
                  </td>
                </tr>
                <tr>
                  <th scope="row">Reporting readiness</th>
                  <td>
                    {grant.readiness.percent}% — {grant.readiness.detail}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {grant.purpose && (
          <section className="packet__section">
            <h2 className="packet__section-title">Purpose</h2>
            <p className="prose">{grant.purpose}</p>
          </section>
        )}

        {grant.requirements && (
          <section className="packet__section">
            <h2 className="packet__section-title">Funder requirements</h2>
            <p className="prose">{grant.requirements}</p>
          </section>
        )}

        <section className="packet__section">
          <h2 className="packet__section-title">Budget</h2>
          <div className="table-wrap">
            <table className="table table--compact">
              <caption className="visually-hidden">Budget lines and totals</caption>
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
                </tr>
              </thead>
              <tbody>
                {grant.budgetLines.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted">
                      No budget lines recorded.
                    </td>
                  </tr>
                )}
                {grant.budgetLines.map((line) => (
                  <tr key={line.id}>
                    <td>
                      {line.category}
                      {line.description && <div className="table__meta">{line.description}</div>}
                    </td>
                    <td className="table__num">{formatCents(line.plannedCents, grant.currency)}</td>
                    <td className="table__num">{formatCents(line.spentCents, grant.currency)}</td>
                    <td className="table__num">{formatCents(line.plannedCents - line.spentCents, grant.currency)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Total</th>
                  <td className="table__num">{formatCents(budgetTotals.plannedCents, grant.currency)}</td>
                  <td className="table__num">{formatCents(budgetTotals.spentCents, grant.currency)}</td>
                  <td className="table__num">{formatCents(budgetTotals.remainingCents, grant.currency)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="muted small" style={{ marginTop: 'var(--space-2)' }}>
            {budgetTotals.spentPercent}% of the planned budget is spent
            {budgetTotals.elapsedPercent !== null ? `, with ${budgetTotals.elapsedPercent}% of the grant period elapsed.` : '.'}
          </p>
        </section>

        <section className="packet__section">
          <h2 className="packet__section-title">Deliverables and evidence checklist</h2>
          <div className="table-wrap">
            <table className="table table--compact">
              <caption className="visually-hidden">Deliverables with evidence coverage</caption>
              <thead>
                <tr>
                  <th scope="col">Deliverable</th>
                  <th scope="col">Type</th>
                  <th scope="col">Due</th>
                  <th scope="col">Status</th>
                  <th scope="col">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {data.evidenceChecklist.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">
                      No deliverables recorded.
                    </td>
                  </tr>
                )}
                {data.evidenceChecklist.map((item) => (
                  <tr key={item.milestoneId}>
                    <td>
                      {item.milestoneTitle}
                      {item.documents.length > 0 && (
                        <ul style={{ marginTop: 4, paddingLeft: 16, listStyle: 'disc' }}>
                          {item.documents.map((doc) => (
                            <li key={doc.id} className="table__meta">
                              {doc.name} — {DOCUMENT_TYPE_LABELS[doc.docType]}, uploaded by {doc.uploadedBy}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td>{MILESTONE_TYPE_LABELS[item.type]}</td>
                    <td>{formatIsoDate(item.dueDate)}</td>
                    <td>{MILESTONE_STATUS_LABELS[item.status]}</td>
                    <td>
                      {item.required > 0 ? `${Math.min(item.attached, item.required)} of ${item.required}` : `${item.attached} attached`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="packet__section">
          <h2 className="packet__section-title">Open risks</h2>
          {data.openRisks.length === 0 ? (
            <p className="muted">No open risks. No overdue work, evidence gaps or budget variance outside tolerance.</p>
          ) : (
            <ul style={{ paddingLeft: 18, listStyle: 'disc' }}>
              {data.openRisks.map((risk, index) => (
                <li key={`${risk.code}-${index}`} style={{ marginBottom: 'var(--space-2)' }}>
                  <strong>{risk.label}</strong> ({risk.severity === 'RISK' ? 'Risk' : 'Watch'}) — {risk.detail}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="packet__section">
          <h2 className="packet__section-title">Open tasks</h2>
          {grant.tasks.filter((t) => t.status !== 'DONE').length === 0 ? (
            <p className="muted">No open tasks.</p>
          ) : (
            <div className="table-wrap">
              <table className="table table--compact">
                <caption className="visually-hidden">Open tasks</caption>
                <thead>
                  <tr>
                    <th scope="col">Task</th>
                    <th scope="col">Owner</th>
                    <th scope="col">Due</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {grant.tasks
                    .filter((task) => task.status !== 'DONE')
                    .map((task) => (
                      <tr key={task.id}>
                        <td>
                          {task.title}
                          <div className="table__meta">{TASK_PRIORITY_LABELS[task.priority]} priority</div>
                        </td>
                        <td>{task.assigneeName ?? 'Unassigned'}</td>
                        <td>{formatIsoDate(task.dueDate)}</td>
                        <td>{TASK_STATUS_LABELS[task.status]}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="packet__section">
          <h2 className="packet__section-title">Activity trail</h2>
          {grant.activity.length === 0 ? (
            <p className="muted">No recorded activity.</p>
          ) : (
            <>
              {/* An audit surface: state the total plainly and omit nothing. */}
              <p className="muted small" style={{ marginBottom: 'var(--space-2)' }}>
                Showing all {grant.activity.length} {grant.activity.length === 1 ? 'entry' : 'entries'}.
              </p>
              <div className="table-wrap">
                <table className="table table--compact">
                  <caption className="visually-hidden">Activity trail</caption>
                  <thead>
                    <tr>
                      <th scope="col">When</th>
                      <th scope="col">Who</th>
                      <th scope="col">What</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grant.activity.map((entry) => (
                      <tr key={entry.id}>
                        <td style={{ whiteSpace: 'nowrap' }}>{formatTimestamp(entry.createdAt, organization.timezone)}</td>
                        <td>{entry.actorName}</td>
                        <td>{entry.summary}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>

        <footer className="packet__footer">
          Prepared in {BRAND.fullName} for {organization.name}. Figures are derived from the grant records held in this
          workspace at the time of generation. Evidence files referenced above are retained in the workspace evidence
          library.
        </footer>
      </article>
    </>
  );
}
