import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowUpRight,
  CalendarClock,
  CircleCheck,
  ClipboardList,
  Clock,
  RefreshCw,
  TriangleAlert,
  Wallet,
} from 'lucide-react';

import { BRAND } from '../../shared/brand';
import { GRANT_STATUS_LABELS, HEALTH_LABELS, HORIZONS } from '../../shared/constants';
import { formatIsoDate, relativeTimeLabel } from '../../shared/dates';
import type { DashboardPayload } from '../../shared/types';
import { api } from '../lib/api';
import { useCurrentSession } from '../lib/session';
import { dueTone, formatCents, formatCentsCompact, formatPercent, pluralize } from '../lib/format';
import { CHART_COLORS, DonutChart, StackedBar } from '../components/charts';
import { Card, EmptyState, ErrorState, LoadingState, Progress, StatTile, StatusPill } from '../components/ui';

export function DashboardPage() {
  const session = useCurrentSession();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardPayload>('/dashboard'),
  });

  useEffect(() => {
    document.title = `Today · ${BRAND.titleSuffix}`;
  }, []);

  const firstName = session.user.name.split(' ')[0] ?? session.user.name;

  return (
    <>
      <header className="page-header">
        <div className="page-header__text">
          <p className="page-header__eyebrow">{formatIsoDate(session.today, 'long')}</p>
          <h1 className="page-header__title">Good day, {firstName}</h1>
          <p className="page-header__lede">
            {data
              ? summarySentence(data)
              : 'Your portfolio at a glance: what is due, what is at risk, and where restricted funds stand.'}
          </p>
        </div>
        <div className="page-header__actions">
          <Link to="/reports" className="btn">
            Portfolio report
          </Link>
          <Link to="/grants" className="btn btn--primary">
            Open portfolio
            <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        </div>
      </header>

      {isLoading && (
        <div className="card">
          <LoadingState label="Calculating portfolio health…" />
        </div>
      )}

      {isError && (
        <div className="card">
          <ErrorState
            title="We could not load your dashboard"
            description="The workspace data could not be read. Check that the server is running, then try again."
            onRetry={() => void refetch()}
          />
        </div>
      )}

      {data && <DashboardBody data={data} />}
    </>
  );
}

function summarySentence(data: DashboardPayload): string {
  const { totals } = data;
  const risk =
    totals.atRiskCount > 0
      ? `${totals.atRiskCount} ${pluralize(totals.atRiskCount, 'grant')} ${totals.atRiskCount === 1 ? 'needs' : 'need'} attention`
      : 'no grants are flagged at risk';
  return `${totals.activeGrantCount} active ${pluralize(totals.activeGrantCount, 'award')} worth ${formatCents(totals.activeAwardedCents, data.currency)} — ${risk}, and ${totals.reportsDue30} ${pluralize(totals.reportsDue30, 'report')} fall due in the next ${HORIZONS.reportsDueDays} days.`;
}

function DashboardBody({ data }: { data: DashboardPayload }) {
  const { totals, currency } = data;

  const healthSlices = data.healthBreakdown.map((entry) => ({
    key: entry.level,
    label: HEALTH_LABELS[entry.level],
    value: entry.count,
    display: `${entry.count} · ${formatCentsCompact(entry.valueCents, currency)}`,
    color:
      entry.level === 'ON_TRACK' ? CHART_COLORS.onTrack : entry.level === 'WATCH' ? CHART_COLORS.watch : CHART_COLORS.atRisk,
  }));

  const stageSlices = data.stageBreakdown.map((entry, index) => ({
    key: entry.status,
    label: GRANT_STATUS_LABELS[entry.status],
    value: entry.count,
    display: `${entry.count} · ${formatCentsCompact(entry.valueCents, currency)}`,
    color: STAGE_COLORS[index % STAGE_COLORS.length]!,
  }));

  const activeTotal = data.healthBreakdown.reduce((sum, e) => sum + e.count, 0);

  return (
    <div className="stack stack-6">
      <section aria-labelledby="kpi-heading">
        <h2 className="visually-hidden" id="kpi-heading">
          Key portfolio figures
        </h2>
        <div className="grid grid--stats">
          <StatTile
            label="Active awarded value"
            value={formatCents(totals.activeAwardedCents, currency)}
            helper={`${totals.activeGrantCount} active ${pluralize(totals.activeGrantCount, 'award')} · ${formatCents(totals.awardedThisFiscalYearCents, currency)} awarded in ${data.fiscalYear.label}`}
            icon={<Wallet size={14} aria-hidden="true" />}
          />
          <StatTile
            label="Restricted funds remaining"
            value={formatCents(totals.restrictedRemainingCents, currency)}
            helper={`${formatCents(totals.restrictedSpentCents, currency)} spent of ${formatCents(totals.restrictedPlannedCents, currency)} (${formatPercent(totals.burnPercent)})`}
            icon={<Wallet size={14} aria-hidden="true" />}
          />
          <StatTile
            label="Reporting readiness"
            value={formatPercent(totals.readinessPercent)}
            helper={
              totals.readinessOpenReports === 0
                ? `No reports due in the next ${HORIZONS.readinessHorizonDays} days`
                : `Across ${totals.readinessOpenReports} ${pluralize(totals.readinessOpenReports, 'report')} due within ${HORIZONS.readinessHorizonDays} days`
            }
            tone={totals.readinessPercent >= 70 ? 'positive' : totals.readinessPercent >= 40 ? 'attention' : 'risk'}
            icon={<ClipboardList size={14} aria-hidden="true" />}
          />
          <StatTile
            label="Grants at risk"
            value={String(totals.atRiskCount)}
            helper={`${totals.watchCount} on watch · ${totals.onTrackCount} on track`}
            tone={totals.atRiskCount > 0 ? 'risk' : 'positive'}
            icon={<TriangleAlert size={14} aria-hidden="true" />}
          />
        </div>
      </section>

      <div className="grid grid--main-side">
        <div className="stack stack-6">
          <Card
            id="attention-heading"
            title="Attention needed"
            subtitle="Ranked by severity, then by the next date that matters. Every item states its reason."
            flush
          >
            {data.attention.length === 0 ? (
              <EmptyState
                icon={<CircleCheck size={20} />}
                title="Nothing needs attention right now"
                description="No overdue work, evidence gaps, or budget variance outside tolerance across your active awards."
                compact
              />
            ) : (
              <ul className="attention">
                {data.attention.map((item) => (
                  <li key={item.id} className="attention__item">
                    <span
                      className={`attention__rail${item.severity === 'RISK' ? ' attention__rail--risk' : ''}`}
                      aria-hidden="true"
                    />
                    <div className="attention__body">
                      <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                        <StatusPill tone={item.severity === 'RISK' ? 'risk' : 'amber'} label={item.severity === 'RISK' ? 'At risk' : 'Watch'} />
                        <Link to={`/grants/${item.grantId}`} className="attention__headline link-plain">
                          {item.headline}
                        </Link>
                      </div>
                      <p className="attention__reason">{item.reason}</p>
                      <p className="attention__meta">
                        <Link to={`/grants/${item.grantId}`}>{item.grantTitle}</Link>
                        <span aria-hidden="true">·</span>
                        <span>{item.funderName}</span>
                        <span aria-hidden="true">·</span>
                        <span>{item.ownerName ?? 'Unassigned'}</span>
                        {item.dueDate && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>Next date {formatIsoDate(item.dueDate)}</span>
                          </>
                        )}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Secondary counts sit below the actionable list on purpose: the
              dashboard leads with what to do, then with how things stand. */}
          <section aria-labelledby="kpi2-heading">
            <h2 className="visually-hidden" id="kpi2-heading">
              Deadlines and renewals
            </h2>
            <div className="grid grid--stats">
              <StatTile
                small
                label={`Reports due in ${HORIZONS.reportsDueDays} days`}
                value={String(totals.reportsDue30)}
                helper="Narrative and financial deliverables"
                tone={totals.reportsDue30 > 0 ? 'attention' : 'neutral'}
                icon={<CalendarClock size={14} aria-hidden="true" />}
              />
              <StatTile
                small
                label={`Renewals in ${HORIZONS.renewalDays} days`}
                value={String(totals.renewalsDue90)}
                helper={`${formatCents(totals.renewalExposureCents, currency)} of awarded value to re-win`}
                tone={totals.renewalsDue90 > 0 ? 'attention' : 'neutral'}
                icon={<RefreshCw size={14} aria-hidden="true" />}
              />
              <StatTile
                small
                label="Overdue work"
                value={String(totals.overdueCount)}
                helper="Tasks and deliverables past their due date"
                tone={totals.overdueCount > 0 ? 'risk' : 'positive'}
                icon={<Clock size={14} aria-hidden="true" />}
              />
              <StatTile
                small
                label="Weighted pipeline"
                value={formatCents(totals.weightedPipelineCents, currency)}
                helper={`${totals.pipelineCount} ${pluralize(totals.pipelineCount, 'request')} in progress, weighted by probability`}
                icon={<ArrowUpRight size={14} aria-hidden="true" />}
              />
            </div>
          </section>

          <Card
            id="portfolio-health-heading"
            title="Portfolio health"
            subtitle={`${activeTotal} active ${pluralize(activeTotal, 'award')} by health signal`}
          >
            <DonutChart
              slices={healthSlices}
              centerValue={String(activeTotal)}
              centerLabel="active awards"
              tableCaption="Active awards by health level"
              valueHeading="Awards and value"
              summary={
                <>
                  {totals.atRiskCount > 0 ? (
                    <>
                      <strong>{totals.atRiskCount}</strong> of {activeTotal} active awards are at risk, representing{' '}
                      <strong>{formatCents(data.healthBreakdown.find((h) => h.level === 'AT_RISK')?.valueCents ?? 0, currency)}</strong>{' '}
                      in awarded value.{' '}
                    </>
                  ) : (
                    <>No active award is currently flagged at risk. </>
                  )}
                  {totals.watchCount} on watch and {totals.onTrackCount} on track.
                </>
              }
            />
          </Card>

          <Card id="pipeline-heading" title="Lifecycle" subtitle="Every grant by stage, valued at award or request">
            <StackedBar
              slices={stageSlices}
              tableCaption="Grants by lifecycle stage"
              summary={
                <>
                  The portfolio spans {stageSlices.length} {pluralize(stageSlices.length, 'stage')}, from prospect
                  through closeout. Weighted pipeline value is {formatCents(totals.weightedPipelineCents, currency)}{' '}
                  across {totals.pipelineCount} open {pluralize(totals.pipelineCount, 'request')}.
                </>
              }
            />
          </Card>
        </div>

        <div className="stack stack-6">
          <Card id="burn-heading" title="Restricted budget burn" subtitle="Spend against plan across active awards">
            <div className="stack stack-3">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="numeric" style={{ fontSize: 'var(--text-2xl)', fontWeight: 600 }}>
                  {formatPercent(totals.burnPercent)}
                </span>
                <span className="muted small">
                  {formatCents(totals.restrictedSpentCents, currency)} of {formatCents(totals.restrictedPlannedCents, currency)}
                </span>
              </div>
              <Progress
                value={totals.burnPercent}
                tall
                label="Restricted budget spent"
                tone={totals.burnPercent > 90 ? 'risk' : totals.burnPercent > 75 ? 'amber' : 'accent'}
              />
              <p className="muted small">
                {formatCents(totals.restrictedRemainingCents, currency)} of restricted funding remains unspent across{' '}
                {totals.activeGrantCount} active {pluralize(totals.activeGrantCount, 'award')}. Individual grants are
                checked against their own period elapsed, so a portfolio figure alone never triggers a risk flag.
              </p>
            </div>
          </Card>

          <Card id="upcoming-heading" title="Next 45 days" subtitle="Deadlines across tasks, deliverables and renewals" flush>
            {data.upcoming.length === 0 ? (
              <EmptyState title="Nothing scheduled" description="No deadlines fall in the next 45 days." compact />
            ) : (
              <div className="deadline-strip">
                {data.upcoming.map((event) => {
                  const tone = dueTone(event.date, data.today, event.complete);
                  return (
                    <Link key={event.id} to={`/grants/${event.grantId}`} className="deadline-row">
                      <span className="deadline-row__date">
                        <span className="deadline-row__day numeric">{Number(event.date.slice(8, 10))}</span>
                        <span className="deadline-row__month">
                          {new Date(`${event.date}T00:00:00Z`).toLocaleDateString('en-US', {
                            month: 'short',
                            timeZone: 'UTC',
                          })}
                        </span>
                      </span>
                      <span className="deadline-row__body">
                        <span className="deadline-row__title truncate">{event.title}</span>
                        <span className="deadline-row__meta truncate">
                          {event.grantTitle} · {event.funderName}
                        </span>
                      </span>
                      <StatusPill tone={tone} label={event.statusLabel} />
                    </Link>
                  );
                })}
              </div>
            )}
            <div className="card__footer">
              <Link to="/calendar">Open the full calendar →</Link>
            </div>
          </Card>

          <Card id="activity-heading" title="Recent activity" subtitle="Who changed what, most recent first">
            {data.activity.length === 0 ? (
              <EmptyState title="No activity yet" description="Changes to grants and records will appear here." compact />
            ) : (
              <ol className="timeline">
                {data.activity.map((entry) => (
                  <li key={entry.id} className="timeline__item">
                    <span className="timeline__dot" aria-hidden="true" />
                    <div className="timeline__body">
                      <p className="timeline__summary">{entry.summary}</p>
                      <p className="timeline__meta">
                        {entry.actorName}
                        {entry.grantTitle && (
                          <>
                            {' · '}
                            <Link to={`/grants/${entry.grantId}`}>{entry.grantTitle}</Link>
                          </>
                        )}
                        {' · '}
                        {relativeTimeLabel(entry.createdAt)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

const STAGE_COLORS = [
  '#a3aca7',
  '#c9b98e',
  '#2f5c75',
  '#1c6b58',
  '#2b6a4a',
  '#b8891f',
  '#8a6a2f',
  '#6f7d76',
  '#9c3227',
];
