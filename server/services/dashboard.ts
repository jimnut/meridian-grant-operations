/**
 * Dashboard rollups. Every figure here is derived from persisted rows via the
 * shared calculation core — nothing is stored pre-aggregated and nothing is
 * hard-coded for display.
 */

import {
  awardedInFiscalYear,
  portfolioReadiness,
  renewalExposure,
  weightedPipelineTotal,
  type MilestoneInput,
  type PortfolioGrantInput,
} from '../../shared/analytics';
import {
  ACTIVE_STATUSES,
  GRANT_STATUSES,
  HEALTH_LEVELS,
  HORIZONS,
  REPORTING_MILESTONE_TYPES,
  type HealthLevel,
} from '../../shared/constants';
import { addDays, daysBetween, type IsoDate } from '../../shared/dates';
import { percentOf, sumCents } from '../../shared/money';
import type { AttentionItem, DashboardPayload, GrantListItem, StageBreakdown } from '../../shared/types';
import type { Db } from '../db/connection';
import { loadCalendarEvents } from './calendar';
import { loadPortfolio } from './portfolio';
import { ACTIVITY_SELECT, mapActivity, type ActivityRow } from './rows';

export interface OrgContext {
  orgId: string;
  timezone: string;
  currency: DashboardPayload['currency'];
  fiscalYearStartMonth: number;
}

export function buildDashboard(db: Db, org: OrgContext, today: IsoDate): DashboardPayload {
  const { grants, milestonesByGrant } = loadPortfolio(db, org.orgId, today);

  const portfolioInputs: PortfolioGrantInput[] = grants.map((g) => ({
    id: g.id,
    status: g.status,
    requestedCents: g.requestedCents,
    awardedCents: g.awardedCents,
    probability: g.probability,
    startDate: g.startDate,
    endDate: g.endDate,
    renewalDate: g.renewalDate,
    decisionDate: null,
  }));

  // decision_date is not on the list item — read it once for fiscal-year math.
  const decisionDates = new Map(
    (
      db
        .prepare('SELECT id, decision_date AS decisionDate, start_date AS startDate FROM grants WHERE org_id = ?')
        .all(org.orgId) as Array<{ id: string; decisionDate: IsoDate | null; startDate: IsoDate | null }>
    ).map((r) => [r.id, r.decisionDate ?? r.startDate]),
  );
  for (const input of portfolioInputs) {
    input.decisionDate = decisionDates.get(input.id) ?? null;
  }

  const activeGrants = grants.filter((g) => ACTIVE_STATUSES.includes(g.status));
  const activeAwardedCents = sumCents(activeGrants.map((g) => g.awardedCents));
  const restrictedPlannedCents = sumCents(activeGrants.map((g) => g.budget.plannedCents));
  const restrictedSpentCents = sumCents(activeGrants.map((g) => g.budget.spentCents));

  const activeMilestones: MilestoneInput[] = [];
  for (const grant of activeGrants) {
    for (const row of milestonesByGrant.get(grant.id) ?? []) {
      activeMilestones.push({
        id: row.id,
        type: row.type,
        title: row.title,
        dueDate: row.due_date,
        status: row.status,
        requiredEvidenceCount: row.required_evidence_count,
        attachedEvidenceCount: row.attached_evidence_count,
      });
    }
  }

  const readiness = portfolioReadiness(activeMilestones, today);
  const fiscal = awardedInFiscalYear(portfolioInputs, today, org.fiscalYearStartMonth);
  const renewal = renewalExposure(portfolioInputs, today, HORIZONS.renewalDays);

  const reportsDue30 = activeMilestones.filter((m) => {
    if (!REPORTING_MILESTONE_TYPES.includes(m.type)) return false;
    if (m.status === 'COMPLETE' || m.status === 'WAIVED') return false;
    if (!m.dueDate) return false;
    const delta = daysBetween(today, m.dueDate);
    return delta >= 0 && delta <= HORIZONS.reportsDueDays;
  }).length;

  const overdueCount = grants.reduce((sum, g) => sum + g.overdueCount, 0);

  const healthCounts: Record<HealthLevel, { count: number; valueCents: number }> = {
    ON_TRACK: { count: 0, valueCents: 0 },
    WATCH: { count: 0, valueCents: 0 },
    AT_RISK: { count: 0, valueCents: 0 },
  };
  for (const grant of grants) {
    if (!ACTIVE_STATUSES.includes(grant.status)) continue;
    const bucket = healthCounts[grant.health.level];
    bucket.count += 1;
    bucket.valueCents += grant.awardedCents;
  }

  const stageBreakdown: StageBreakdown[] = GRANT_STATUSES.map((status) => {
    const inStatus = grants.filter((g) => g.status === status);
    return {
      status,
      count: inStatus.length,
      valueCents: sumCents(
        inStatus.map((g) => (g.awardedCents > 0 ? g.awardedCents : g.requestedCents)),
      ),
    };
  }).filter((row) => row.count > 0);

  const upcoming = loadCalendarEvents(db, org.orgId, {
    from: today,
    to: addDays(today, 45),
    includeComplete: false,
  }).slice(0, 12);

  // Sign-ins stay in the full audit log but would otherwise crowd out the record
  // changes this feed exists to surface.
  const activityRows = db
    .prepare(`${ACTIVITY_SELECT} WHERE a.org_id = ? AND a.action <> 'SIGNED_IN' ORDER BY a.created_at DESC LIMIT 12`)
    .all(org.orgId) as ActivityRow[];

  return {
    today,
    fiscalYear: {
      label: fiscal.fiscalYear.label,
      start: fiscal.fiscalYear.start,
      end: fiscal.fiscalYear.end,
    },
    currency: org.currency,
    totals: {
      activeAwardedCents,
      activeGrantCount: activeGrants.length,
      restrictedSpentCents,
      restrictedRemainingCents: restrictedPlannedCents - restrictedSpentCents,
      restrictedPlannedCents,
      burnPercent: percentOf(restrictedSpentCents, restrictedPlannedCents),
      readinessPercent: readiness.percent,
      readinessOpenReports: readiness.openReportCount,
      atRiskCount: healthCounts.AT_RISK.count,
      watchCount: healthCounts.WATCH.count,
      onTrackCount: healthCounts.ON_TRACK.count,
      reportsDue30,
      renewalsDue90: renewal.count,
      renewalExposureCents: renewal.cents,
      overdueCount,
      awardedThisFiscalYearCents: fiscal.cents,
      weightedPipelineCents: weightedPipelineTotal(portfolioInputs),
      pipelineCount: portfolioInputs.filter((g) => !ACTIVE_STATUSES.includes(g.status) && g.status !== 'CLOSED' && g.status !== 'DECLINED').length,
    },
    stageBreakdown,
    healthBreakdown: HEALTH_LEVELS.map((level) => ({
      level,
      count: healthCounts[level].count,
      valueCents: healthCounts[level].valueCents,
    })),
    attention: buildAttentionQueue(grants),
    upcoming,
    activity: activityRows.map(mapActivity),
  };
}

/**
 * The "attention needed" queue. Each entry carries the sentence that explains
 * why it is there, taken straight from the health engine.
 */
export function buildAttentionQueue(grants: GrantListItem[], limit = 8): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const grant of grants) {
    if (grant.status === 'CLOSED' || grant.status === 'DECLINED') continue;
    grant.health.reasons.forEach((reason, index) => {
      if (reason.severity === 'GOOD') return;
      items.push({
        // A grant can raise the same rule twice (two reports, two gaps), so the
        // index keeps every queue entry uniquely identifiable.
        id: `${grant.id}:${reason.code}:${index}`,
        grantId: grant.id,
        grantTitle: grant.title,
        funderName: grant.funderName,
        severity: reason.severity,
        headline: reason.label,
        reason: reason.detail,
        dueDate: grant.nextDeadline?.date ?? null,
        ownerName: grant.ownerName,
        kind: reason.code,
      });
    });
  }

  items.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'RISK' ? -1 : 1;
    const aDue = a.dueDate ?? '9999-12-31';
    const bDue = b.dueDate ?? '9999-12-31';
    if (aDue !== bDue) return aDue < bDue ? -1 : 1;
    return a.grantTitle.localeCompare(b.grantTitle);
  });

  return items.slice(0, limit);
}
