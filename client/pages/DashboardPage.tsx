import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowUpRight,
  CalendarClock,
  CircleCheck,
  ClipboardList,
  Clock,
  FolderOpen,
  RefreshCw,
  TriangleAlert,
  Wallet,
} from 'lucide-react';

import { BRAND } from '../../shared/brand';
import { TRIAL_DAYS } from '../../shared/plans';
import { GRANT_STATUS_LABELS, HEALTH_LABELS, HORIZONS } from '../../shared/constants';
import { formatIsoDate, relativeTimeLabel } from '../../shared/dates';
import type { DashboardPayload } from '../../shared/types';
import { api } from '../lib/api';
import { attentionGrantHref, calendarGrantHref } from '../lib/grant-links';
import { useCurrentSession, useSession } from '../lib/session';
import { trackEvent } from '../lib/analytics';
import { dueTone, formatCents, formatCentsCompact, formatPercent, pluralize } from '../lib/format';
import { CHART_COLORS, DonutChart, StackedBar } from '../components/charts';
import { OnboardingCard } from '../components/OnboardingCard';
import { Card, EmptyState, ErrorState, LoadingState, Progress, StatTile, StatusPill } from '../components/ui';
import '../styles/dashboard.css';

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
      <header className="page-header page-header--dashboard">
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

      {session.workspace.isDemo ? <DemoGuide data={data} /> : <OnboardingCard />}

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

/** The public demo has a session, so signup must explicitly leave it first. */
function DemoGuide({ data }: { data?: DashboardPayload }) {
  const { signOut } = useSession();
  const [leavingDemo, setLeavingDemo] = useState(false);
  const [leaveError, setLeaveError] = useState(false);
  const exampleGrantId = data?.attention[0]?.grantId ?? data?.upcoming[0]?.grantId;

  const startTrial = async () => {
    setLeavingDemo(true);
    setLeaveError(false);
    try {
      // signOut clears the mutation cache too, so this must not depend on a
      // mutation's onSuccess. Reloading also discards all demo query observers.
      await signOut();
      trackEvent('demo_trial_clicked', { location: 'dashboard' });
      window.location.replace('/signup');
    } catch {
      setLeaveError(true);
      setLeavingDemo(false);
    }
  };

  return (
    <section className="dashboard-demo" aria-labelledby="demo-guide-heading">
      <div className="dashboard-demo__copy">
        <p className="dashboard-kicker">Public demo · sample nonprofit data</p>
        <h2 id="demo-guide-heading">A closer look at your next clear move.</h2>
        <nav className="dashboard-demo__links" aria-label="Explore the demo">
          <a href="#attention-heading">1. Review a risk</a>
          <a href="#burn-heading">2. Check restricted funds</a>
          <Link to={exampleGrantId ? `/grants/${encodeURIComponent(exampleGrantId)}/packet` : '/reports'}>
            {exampleGrantId ? '3. Open a reporting packet' : '3. Explore reporting'}
          </Link>
        </nav>
      </div>
      <div className="dashboard-demo__action">
        <button className="btn btn--primary" type="button" onClick={() => void startTrial()} disabled={leavingDemo}>
          {leavingDemo ? 'Leaving demo…' : 'Leave demo & start free trial'}
          <ArrowUpRight size={16} aria-hidden="true" />
        </button>
        <p>{TRIAL_DAYS} days · no card · your own workspace</p>
        {leaveError && <p className="dashboard-demo__error" role="alert">Could not leave the demo. Please try again.</p>}
      </div>
    </section>
  );
}

function summarySentence(data: DashboardPayload): string {
  const { totals } = data;
  return `Here is where your ${totals.activeGrantCount} active ${pluralize(totals.activeGrantCount, 'award')} ${totals.activeGrantCount === 1 ? 'stands' : 'stand'} today. Every priority, deadline and dollar in view.`;
}

function DashboardBody({ data }: { data: DashboardPayload }) {
  const { totals, currency } = data;
  const { can, session } = useSession();
  const canAddGrants = can('grants:write') && !session?.workspace.readOnly;
  const hasGrants = data.stageBreakdown.some((entry) => entry.count > 0);

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

  if (!hasGrants) {
    return (
      <section className="dashboard-empty" aria-labelledby="empty-portfolio-heading">
        <FolderOpen size={24} aria-hidden="true" />
        <div>
          <h2 id="empty-portfolio-heading">Your portfolio is ready for its first grant</h2>
          <p>Health signals, reporting deadlines and restricted-budget totals will appear here as you add your awards and obligations.</p>
          <Link to={canAddGrants ? '/grants/import' : '/grants'}>
            {canAddGrants ? 'Import your grant spreadsheet' : 'View the portfolio'} →
          </Link>
        </div>
      </section>
    );
  }

  return (
    <div className="dashboard-body stack stack-6">
      <section
        className={`decision-strip${totals.atRiskCount > 0 ? ' decision-strip--attention' : ' decision-strip--clear'}`}
        aria-labelledby="portfolio-signal-heading"
      >
        <div className="decision-strip__signal">
          <p className="decision-strip__eyebrow">
            <span className="decision-strip__pulse" aria-hidden="true" />
            Portfolio signal
          </p>
          <h2 id="portfolio-signal-heading">
            {totals.atRiskCount > 0
              ? `${totals.atRiskCount} ${pluralize(totals.atRiskCount, 'grant')} ${totals.atRiskCount === 1 ? 'needs' : 'need'} a decision`
              : totals.watchCount > 0
                ? `${totals.watchCount} ${pluralize(totals.watchCount, 'grant')} on watch`
                : totals.activeGrantCount === 0
                  ? 'No active awards to assess yet'
                  : 'Your active portfolio is on course'}
          </h2>
          <p>
            {totals.overdueCount > 0
              ? `${totals.overdueCount} overdue ${pluralize(totals.overdueCount, 'obligation')} and ${totals.reportsDue30} ${pluralize(totals.reportsDue30, 'report')} due within ${HORIZONS.reportsDueDays} days.`
              : `${totals.reportsDue30} ${pluralize(totals.reportsDue30, 'report')} due within ${HORIZONS.reportsDueDays} days, with no overdue work.`}
          </p>
          <Link
            to={data.attention[0] ? attentionGrantHref(data.attention[0]) : '/grants'}
            className="decision-strip__link"
          >
            {data.attention.length > 0 ? 'Open the first priority' : 'Review the portfolio'}
            <ArrowUpRight size={15} aria-hidden="true" />
          </Link>
        </div>

        <dl className="decision-strip__metrics" aria-label="Key portfolio figures">
          <div className="decision-strip__metric">
            <dt>
              <Wallet size={14} aria-hidden="true" />
              Active awarded value
            </dt>
            <dd>{formatCents(totals.activeAwardedCents, currency)}</dd>
            <span>{totals.activeGrantCount} active awards</span>
          </div>
          <div className="decision-strip__metric">
            <dt>
              <Wallet size={14} aria-hidden="true" />
              Restricted funds remaining
            </dt>
            <dd>{formatCents(totals.restrictedRemainingCents, currency)}</dd>
            <span>{formatPercent(totals.burnPercent)} spent across the portfolio</span>
          </div>
          <div
            className={`decision-strip__metric${totals.readinessOpenReports > 0 && totals.readinessPercent < 40 ? ' decision-strip__metric--risk' : ''}`}
          >
            <dt>
              <ClipboardList size={14} aria-hidden="true" />
              Reporting readiness
            </dt>
            <dd>{totals.readinessOpenReports > 0 ? formatPercent(totals.readinessPercent) : '—'}</dd>
            <span>
              {totals.readinessOpenReports > 0
                ? `${totals.readinessOpenReports} open within ${HORIZONS.readinessHorizonDays} days`
                : `No open reports in the next ${HORIZONS.readinessHorizonDays} days`}
            </span>
          </div>
          <div className={`decision-strip__metric${totals.atRiskCount > 0 ? ' decision-strip__metric--risk' : ''}`}>
            <dt>
              <TriangleAlert size={14} aria-hidden="true" />
              Grants at risk
            </dt>
            <dd>{totals.atRiskCount}</dd>
            <span>{totals.watchCount} on watch · {totals.onTrackCount} on track</span>
          </div>
        </dl>
      </section>

      <div className="dashboard-columns grid grid--main-side">
        <div className="stack stack-6">
          <Card
            id="attention-heading"
            title="Attention needed"
            subtitle="Your priorities, ordered by severity and next date."
            actions={<span className="dashboard-count">{data.attention.length} {pluralize(data.attention.length, 'item')}</span>}
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
                    <span className={`attention__icon${item.severity === 'RISK' ? ' attention__icon--risk' : ''}`} aria-hidden="true">
                      <TriangleAlert size={17} />
                    </span>
                    <div className="attention__body">
                      <div className="attention__heading">
                        <StatusPill tone={item.severity === 'RISK' ? 'risk' : 'amber'} label={item.severity === 'RISK' ? 'At risk' : 'Watch'} />
                        <Link to={attentionGrantHref(item)} className="attention__headline link-plain">
                          {item.headline}
                          <ArrowUpRight size={15} aria-hidden="true" />
                        </Link>
                      </div>
                      <p className="attention__reason">{item.reason}</p>
                      <p className="attention__meta">
                        <Link to={attentionGrantHref(item)}>{item.grantTitle}</Link>
                        <span aria-hidden="true">·</span>
                        <span>{item.funderName}</span>
                        <span aria-hidden="true">·</span>
                        <span>{item.ownerName ?? 'Unassigned'}</span>
                        {item.dueDate && (
                          <>
                            <span className="attention__due">
                              <CalendarClock size={12} aria-hidden="true" />
                              Next date {formatIsoDate(item.dueDate)}
                            </span>
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
            <div className="dashboard-secondary-stats grid grid--stats">
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
            <div className="dashboard-budget stack stack-4">
              <div className="dashboard-budget__headline">
                <span className="dashboard-budget__value numeric">
                  {formatPercent(totals.burnPercent)}
                </span>
                <span className="dashboard-budget__label">of restricted budget spent</span>
              </div>
              <Progress
                value={totals.burnPercent}
                tall
                label="Restricted budget spent"
                tone={totals.burnPercent > 90 ? 'risk' : totals.burnPercent > 75 ? 'amber' : 'accent'}
              />
              <dl className="dashboard-budget__figures">
                <div>
                  <dt>Spent</dt>
                  <dd>{formatCents(totals.restrictedSpentCents, currency)}</dd>
                </div>
                <div>
                  <dt>Planned</dt>
                  <dd>{formatCents(totals.restrictedPlannedCents, currency)}</dd>
                </div>
              </dl>
              <div className="dashboard-budget__remaining">
                <Wallet size={16} aria-hidden="true" />
                <p><strong>{formatCents(totals.restrictedRemainingCents, currency)}</strong> remaining across {totals.activeGrantCount} active {pluralize(totals.activeGrantCount, 'award')}</p>
              </div>
              <p className="dashboard-budget__note">
                Risk is assessed against each grant’s own timeline, not this portfolio total.
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
                    <Link key={event.id} to={calendarGrantHref(event)} className="deadline-row">
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
                        <span className="deadline-row__title">{event.title}</span>
                        <span className="deadline-row__meta">
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
  '#b7c5af',
  '#c9b780',
  '#568b82',
  '#9ccc62',
  '#397b3c',
  '#d49c35',
  '#827945',
  '#708275',
  '#c55d4b',
];
