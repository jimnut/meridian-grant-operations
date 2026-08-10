import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';

import { BRAND } from '../../shared/brand';
import {
  GRANT_STATUSES,
  GRANT_STATUS_LABELS,
  HEALTH_LABELS,
  HEALTH_LEVELS,
  MILESTONE_STATUS_LABELS,
  MILESTONE_TYPE_LABELS,
} from '../../shared/constants';
import type { PortfolioReport } from '../../shared/types';
import { api, buildQuery, downloadFile } from '../lib/api';
import { useCurrentSession } from '../lib/session';
import { useToast } from '../lib/toast';
import { dueTone, formatCents, formatCentsCompact, formatIsoDate, healthTone, relativeDueLabel } from '../lib/format';
import { BarList, CHART_COLORS } from '../components/charts';
import { useLookups } from '../components/GrantFormDialog';
import { Badge, Card, EmptyState, ErrorState, LoadingState, Progress, StatTile, StatusPill } from '../components/ui';

export function ReportsPage() {
  const session = useCurrentSession();
  const toast = useToast();
  const { data: lookups } = useLookups();
  const [status, setStatus] = useState('');
  const [health, setHealth] = useState('');
  const [ownerUserId, setOwnerUserId] = useState('');
  const [funderId, setFunderId] = useState('');

  useEffect(() => {
    document.title = `Reports · ${BRAND.titleSuffix}`;
  }, []);

  const queryString = buildQuery({
    status: status || undefined,
    health: health || undefined,
    ownerUserId: ownerUserId || undefined,
    funderId: funderId || undefined,
  });

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['report', queryString],
    queryFn: () => api.get<PortfolioReport>(`/reports/portfolio${queryString}`),
  });

  const exportFile = async (path: string, fallback: string) => {
    try {
      await downloadFile(path, fallback);
      toast.success('Export downloaded.');
    } catch {
      toast.error('That export could not be generated.');
    }
  };

  return (
    <>
      <header className="page-header">
        <div className="page-header__text">
          <p className="page-header__eyebrow">Analysis</p>
          <h1 className="page-header__title">Reports</h1>
          <p className="page-header__lede">
            Portfolio totals, reporting readiness and the funder report schedule for {session.organization.name}. Every
            figure is calculated from the current records — exports match exactly what you see.
          </p>
        </div>
        <div className="page-header__actions">
          <button
            type="button"
            className="btn"
            onClick={() => void exportFile(`/reports/report-schedule.csv${queryString}`, 'funder-report-schedule.csv')}
          >
            <Download size={16} aria-hidden="true" />
            Report schedule CSV
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => void exportFile(`/reports/portfolio.csv${queryString}`, 'portfolio-summary.csv')}
          >
            <Download size={16} aria-hidden="true" />
            Portfolio CSV
          </button>
        </div>
      </header>

      <div className="stack stack-5">
        <div className="toolbar">
          <label className="visually-hidden" htmlFor="report-status">
            Filter by status
          </label>
          <select id="report-status" className="select" style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {GRANT_STATUSES.map((value) => (
              <option key={value} value={value}>
                {GRANT_STATUS_LABELS[value]}
              </option>
            ))}
          </select>

          <label className="visually-hidden" htmlFor="report-health">
            Filter by health
          </label>
          <select id="report-health" className="select" style={{ width: 'auto' }} value={health} onChange={(e) => setHealth(e.target.value)}>
            <option value="">All health</option>
            {HEALTH_LEVELS.map((value) => (
              <option key={value} value={value}>
                {HEALTH_LABELS[value]}
              </option>
            ))}
          </select>

          <label className="visually-hidden" htmlFor="report-owner">
            Filter by owner
          </label>
          <select
            id="report-owner"
            className="select"
            style={{ width: 'auto' }}
            value={ownerUserId}
            onChange={(e) => setOwnerUserId(e.target.value)}
          >
            <option value="">All owners</option>
            {(lookups?.members ?? []).map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>

          <label className="visually-hidden" htmlFor="report-funder">
            Filter by funder
          </label>
          <select
            id="report-funder"
            className="select"
            style={{ width: 'auto', maxWidth: 260 }}
            value={funderId}
            onChange={(e) => setFunderId(e.target.value)}
          >
            <option value="">All funders</option>
            {(lookups?.funders ?? []).map((funder) => (
              <option key={funder.id} value={funder.id}>
                {funder.name}
              </option>
            ))}
          </select>

          {(status || health || ownerUserId || funderId) && (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => {
                setStatus('');
                setHealth('');
                setOwnerUserId('');
                setFunderId('');
              }}
            >
              Clear filters
            </button>
          )}
        </div>

        {isLoading && (
          <div className="card">
            <LoadingState label="Calculating report…" />
          </div>
        )}
        {isError && (
          <div className="card">
            <ErrorState onRetry={() => void refetch()} />
          </div>
        )}

        {data && (
          <>
            <div className="grid grid--stats">
              <StatTile small label="Grants in view" value={String(data.totals.grantCount)} helper={`Fiscal year ${data.fiscalYear.label}`} />
              <StatTile small label="Awarded" value={formatCents(data.totals.awardedCents, data.currency)} helper={`Requested ${formatCents(data.totals.requestedCents, data.currency)}`} />
              <StatTile
                small
                label="Restricted remaining"
                value={formatCents(data.totals.remainingCents, data.currency)}
                helper={`${formatCents(data.totals.spentCents, data.currency)} spent of ${formatCents(data.totals.plannedCents, data.currency)}`}
              />
              <StatTile
                small
                label="Renewal exposure"
                value={formatCents(data.totals.renewalExposureCents, data.currency)}
                helper="Awarded value with a renewal decision inside 12 months"
                tone={data.totals.renewalExposureCents > 0 ? 'attention' : 'neutral'}
              />
            </div>

            <div className="grid grid--halves">
              <Card title="By funder" subtitle="Awarded value across the filtered set">
                {data.byFunder.length === 0 ? (
                  <EmptyState title="No grants in view" description="Adjust the filters to see funder totals." compact />
                ) : (
                  <BarList
                    tableCaption="Awarded value by funder"
                    valueHeading="Awarded"
                    data={data.byFunder.map((row) => ({
                      key: row.funderId,
                      label: row.funderName,
                      value: row.awardedCents,
                      display: formatCentsCompact(row.awardedCents, data.currency),
                      color: CHART_COLORS.accent,
                    }))}
                    summary={
                      <>
                        {data.byFunder[0]!.funderName} is the largest funder in view at{' '}
                        {formatCents(data.byFunder[0]!.awardedCents, data.currency)} across {data.byFunder[0]!.count}{' '}
                        {data.byFunder[0]!.count === 1 ? 'grant' : 'grants'}, of {data.byFunder.length} funders total.
                      </>
                    }
                  />
                )}
              </Card>

              <Card title="By owner" subtitle="Workload and value by internal owner">
                {data.byOwner.length === 0 ? (
                  <EmptyState title="No grants in view" description="Adjust the filters to see owner totals." compact />
                ) : (
                  <BarList
                    tableCaption="Awarded value by internal owner"
                    valueHeading="Awarded"
                    data={data.byOwner.map((row) => ({
                      key: row.ownerUserId ?? 'unassigned',
                      label: `${row.ownerName} (${row.count})`,
                      value: row.awardedCents,
                      display: formatCentsCompact(row.awardedCents, data.currency),
                      color: row.ownerUserId ? CHART_COLORS.accentSoft : CHART_COLORS.neutral,
                    }))}
                    summary={
                      <>
                        {data.byOwner.length} {data.byOwner.length === 1 ? 'person holds' : 'people hold'} grants in this
                        view.{' '}
                        {data.byOwner.some((o) => !o.ownerUserId)
                          ? 'Some grants are unassigned — assign an owner so reporting has a named accountable person.'
                          : 'Every grant in view has a named owner.'}
                      </>
                    }
                  />
                )}
              </Card>
            </div>

            <Card
              title="Reporting readiness by grant"
              subtitle="Lowest readiness first — these are the reports most likely to slip."
              flush
            >
              {data.readiness.length === 0 ? (
                <EmptyState title="No active awards in view" description="Readiness is measured on active awards." compact />
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <caption className="visually-hidden">Reporting readiness by grant</caption>
                    <thead>
                      <tr>
                        <th scope="col">Grant</th>
                        <th scope="col">Funder</th>
                        <th scope="col">Next report</th>
                        <th scope="col">Missing evidence</th>
                        <th scope="col" style={{ width: 180 }}>
                          Readiness
                        </th>
                        <th scope="col">Health</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.readiness.map((row) => (
                        <tr key={row.grantId}>
                          <td>
                            <Link to={`/grants/${row.grantId}`} className="table__primary link-plain">
                              {row.grantTitle}
                            </Link>
                          </td>
                          <td className="small">{row.funderName}</td>
                          <td className="small">
                            {row.nextReportDate ? (
                              <>
                                {formatIsoDate(row.nextReportDate)}
                                <div className="table__meta">
                                  <Badge tone={dueTone(row.nextReportDate, data.today)}>
                                    {relativeDueLabel(row.nextReportDate, data.today)}
                                  </Badge>
                                </div>
                              </>
                            ) : (
                              <span className="muted">None scheduled</span>
                            )}
                          </td>
                          <td className="table__num">
                            {row.missingEvidence > 0 ? (
                              <span style={{ color: 'var(--risk-ink)', fontWeight: 600 }}>{row.missingEvidence}</span>
                            ) : (
                              <span className="muted">0</span>
                            )}
                          </td>
                          <td>
                            <div className="row" style={{ gap: 'var(--space-2)' }}>
                              <span style={{ flex: 1 }}>
                                <Progress
                                  value={row.readinessPercent}
                                  label={`Readiness for ${row.grantTitle}`}
                                  tone={row.readinessPercent >= 70 ? 'accent' : row.readinessPercent >= 40 ? 'amber' : 'risk'}
                                />
                              </span>
                              <span className="small numeric">{row.readinessPercent}%</span>
                            </div>
                          </td>
                          <td>
                            <StatusPill tone={healthTone[row.health]} label={HEALTH_LABELS[row.health]} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card
              title="Upcoming funder report schedule"
              subtitle="Every open narrative and financial report on active awards, earliest first."
              flush
            >
              {data.reportSchedule.length === 0 ? (
                <EmptyState title="No reports scheduled" description="No open reporting deliverables in this view." compact />
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <caption className="visually-hidden">Upcoming funder report schedule</caption>
                    <thead>
                      <tr>
                        <th scope="col">Due</th>
                        <th scope="col">Report</th>
                        <th scope="col">Grant</th>
                        <th scope="col">Owner</th>
                        <th scope="col">Evidence</th>
                        <th scope="col">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.reportSchedule.map((row) => (
                        <tr key={row.milestoneId}>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            {formatIsoDate(row.dueDate)}
                            <div className="table__meta">
                              <Badge tone={dueTone(row.dueDate, data.today)}>{relativeDueLabel(row.dueDate, data.today)}</Badge>
                            </div>
                          </td>
                          <td>
                            <div className="table__primary">{row.milestoneTitle}</div>
                            <div className="table__meta">{MILESTONE_TYPE_LABELS[row.type]}</div>
                          </td>
                          <td>
                            <Link to={`/grants/${row.grantId}`} className="link-plain">
                              {row.grantTitle}
                            </Link>
                            <div className="table__meta">{row.funderName}</div>
                          </td>
                          <td className="small">{row.ownerName ?? 'Unassigned'}</td>
                          <td className="small">
                            {row.evidenceRequired > 0
                              ? `${Math.min(row.evidenceAttached, row.evidenceRequired)} of ${row.evidenceRequired}`
                              : `${row.evidenceAttached} attached`}
                          </td>
                          <td>
                            <StatusPill tone="plain" label={MILESTONE_STATUS_LABELS[row.status]} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        )}
      </div>
    </>
  );
}
