/**
 * The calculation core: budget rollups, reporting readiness, grant health,
 * deadlines, fiscal-year and renewal exposure.
 *
 * Every function here is pure and takes plain objects, so the same code powers
 * the API, the reporting packet and the unit tests. Health is deliberately rule
 * based — each signal carries the sentence that explains it, so the UI never
 * shows a number nobody can account for.
 */

import {
  ACTIVE_STATUSES,
  AWARDED_STATUSES,
  CLOSED_MILESTONE_STATUSES,
  HORIZONS,
  MILESTONE_TYPE_LABELS,
  PIPELINE_STATUSES,
  REPORTING_MILESTONE_TYPES,
  type GrantStatus,
  type HealthLevel,
  type MilestoneStatus,
  type MilestoneType,
  type TaskStatus,
} from './constants';
import { classifyDue, daysBetween, elapsedFraction, fiscalYearFor, isWithinRange, type IsoDate } from './dates';
import { percentOf, sumCents, weightedCents } from './money';
import type { BudgetTotals, DeadlineRef, GrantHealth, HealthReason, ReadinessBreakdown } from './types';

/* ------------------------------------------------------------------ budget */

export interface BudgetLineInput {
  plannedCents: number;
  spentCents: number;
}

export function computeBudgetTotals(
  lines: readonly BudgetLineInput[],
  period: { startDate: IsoDate | null; endDate: IsoDate | null; today: IsoDate },
): BudgetTotals {
  const plannedCents = sumCents(lines.map((l) => l.plannedCents));
  const spentCents = sumCents(lines.map((l) => l.spentCents));
  const fraction = elapsedFraction(period.startDate, period.endDate, period.today);
  const elapsedPercent = fraction === null ? null : Math.round(fraction * 100);
  const spentPercent = percentOf(spentCents, plannedCents);
  return {
    plannedCents,
    spentCents,
    remainingCents: plannedCents - spentCents,
    spentPercent,
    elapsedPercent,
    variancePoints: elapsedPercent === null || plannedCents === 0 ? null : spentPercent - elapsedPercent,
    lineCount: lines.length,
  };
}

/* --------------------------------------------------------------- readiness */

export interface MilestoneInput {
  id: string;
  type: MilestoneType;
  title: string;
  dueDate: IsoDate | null;
  status: MilestoneStatus;
  requiredEvidenceCount: number;
  attachedEvidenceCount: number;
}

export function isOpenMilestone(m: Pick<MilestoneInput, 'status'>): boolean {
  return !CLOSED_MILESTONE_STATUSES.includes(m.status);
}

export function isReportingMilestone(m: Pick<MilestoneInput, 'type'>): boolean {
  return REPORTING_MILESTONE_TYPES.includes(m.type);
}

/** Readiness of a single open reporting milestone, 0-1. */
export function milestoneReadiness(m: MilestoneInput): number {
  const evidence =
    m.requiredEvidenceCount > 0
      ? Math.min(1, m.attachedEvidenceCount / m.requiredEvidenceCount)
      : m.attachedEvidenceCount > 0
        ? 1
        : 0;
  const progress = m.status === 'SUBMITTED' ? 1 : m.status === 'IN_PROGRESS' ? 0.5 : 0;
  return 0.65 * evidence + 0.35 * progress;
}

/**
 * Reports the team actually has to be ready for: open reporting deliverables
 * that are overdue, undated, or due inside the readiness horizon. A report due
 * in ten months should not drag today's readiness number down.
 */
export function reportsInReadinessHorizon(
  milestones: readonly MilestoneInput[],
  today: IsoDate | null,
  horizonDays: number = HORIZONS.readinessHorizonDays,
): MilestoneInput[] {
  return milestones.filter((m) => {
    if (!isReportingMilestone(m) || !isOpenMilestone(m)) return false;
    if (!today || !m.dueDate) return true;
    return daysBetween(today, m.dueDate) <= horizonDays;
  });
}

/**
 * Reporting readiness across a set of milestones. A grant with nothing due
 * inside the horizon is 100% ready — there is no report to be unready for.
 */
export function computeReadiness(
  milestones: readonly MilestoneInput[],
  options: { blockingTaskCount?: number; today?: IsoDate | null; horizonDays?: number } = {},
): ReadinessBreakdown {
  const open = reportsInReadinessHorizon(milestones, options.today ?? null, options.horizonDays);
  const evidenceRequired = open.reduce((sum, m) => sum + m.requiredEvidenceCount, 0);
  const evidenceAttached = open.reduce(
    (sum, m) => sum + Math.min(m.attachedEvidenceCount, m.requiredEvidenceCount || m.attachedEvidenceCount),
    0,
  );
  const blockingTaskCount = options.blockingTaskCount ?? 0;

  if (open.length === 0) {
    return {
      percent: 100,
      openReportCount: 0,
      evidenceRequired: 0,
      evidenceAttached: 0,
      blockingTaskCount,
      detail: `No reports due in the next ${options.horizonDays ?? HORIZONS.readinessHorizonDays} days.`,
    };
  }

  const percent = Math.round((open.reduce((sum, m) => sum + milestoneReadiness(m), 0) / open.length) * 100);
  const evidenceDetail =
    evidenceRequired > 0
      ? `${evidenceAttached} of ${evidenceRequired} required evidence items attached`
      : 'no evidence requirements recorded';
  return {
    percent,
    openReportCount: open.length,
    evidenceRequired,
    evidenceAttached,
    blockingTaskCount,
    detail: `${open.length} open report${open.length === 1 ? '' : 's'} · ${evidenceDetail}.`,
  };
}

/* ------------------------------------------------------------------ health */

export interface TaskInput {
  id: string;
  title: string;
  status: TaskStatus;
  dueDate: IsoDate | null;
}

export interface HealthInput {
  status: GrantStatus;
  today: IsoDate;
  startDate: IsoDate | null;
  endDate: IsoDate | null;
  renewalDate: IsoDate | null;
  closeoutDate: IsoDate | null;
  applicationDate: IsoDate | null;
  ownerUserId: string | null;
  tasks: readonly TaskInput[];
  milestones: readonly MilestoneInput[];
  budget: BudgetTotals;
}

const PENALTY: Record<string, number> = {
  MILESTONE_OVERDUE: 40,
  PERIOD_ENDED_OPEN: 35,
  EVIDENCE_GAP_URGENT: 30,
  BURN_AHEAD: 25,
  CLOSEOUT_OPEN: 25,
  TASKS_OVERDUE: 20,
  EVIDENCE_GAP: 15,
  BURN_BEHIND: 15,
  TASK_OVERDUE_SINGLE: 10,
  RENEWAL_UNPLANNED: 12,
  NO_OWNER: 8,
  APPLICATION_DUE: 12,
};

export function computeHealth(input: HealthInput): GrantHealth {
  const { today, status } = input;
  const reasons: HealthReason[] = [];
  const openMilestones = input.milestones.filter(isOpenMilestone);
  const openTasks = input.tasks.filter((t) => t.status !== 'DONE');

  const overdueMilestones = openMilestones.filter(
    (m) => classifyDue(m.dueDate, today) === 'OVERDUE',
  );
  const overdueTasks = openTasks.filter((t) => classifyDue(t.dueDate, today) === 'OVERDUE');

  const isActive = ACTIVE_STATUSES.includes(status);
  const isPipeline = PIPELINE_STATUSES.includes(status);
  const isEnded = !isActive && !isPipeline;

  if (isEnded) {
    // Never claim a closed grant is clear while work is still outstanding. The
    // lifecycle guards block closing with open obligations, but a grant closed
    // before that rule existed — or reopened work — must still report honestly.
    const stillOpen = openMilestones.length + openTasks.length;
    if (stillOpen > 0) {
      return {
        level: 'AT_RISK',
        score: Math.max(0, 100 - PENALTY.PERIOD_ENDED_OPEN!),
        reasons: [
          {
            code: 'ENDED_WITH_OPEN_WORK',
            severity: 'RISK',
            label: `${status === 'DECLINED' ? 'Declined' : 'Closed'} with ${stillOpen} item${stillOpen === 1 ? '' : 's'} still open`,
            detail: `${openMilestones.length} deliverable${openMilestones.length === 1 ? '' : 's'} and ${openTasks.length} task${openTasks.length === 1 ? '' : 's'} remain open on a grant that is no longer active. Complete or waive them so the record is auditable.`,
          },
        ],
      };
    }

    return {
      level: 'ON_TRACK',
      score: 100,
      reasons: [
        {
          code: 'CLOSED',
          severity: 'GOOD',
          label: status === 'DECLINED' ? 'Declined — no open obligations' : 'Closed — no open obligations',
          detail:
            status === 'DECLINED'
              ? 'This request was declined. It is retained for renewal history and reapplication planning.'
              : 'This grant is closed. Records are retained for audit and renewal history.',
        },
      ],
    };
  }

  if (overdueMilestones.length > 0) {
    const first = overdueMilestones[0]!;
    const days = Math.abs(daysBetween(today, first.dueDate!));
    reasons.push({
      code: 'MILESTONE_OVERDUE',
      severity: 'RISK',
      label: `${overdueMilestones.length} deliverable${overdueMilestones.length === 1 ? '' : 's'} past due`,
      detail: `“${first.title}” was due ${days} day${days === 1 ? '' : 's'} ago and has not been submitted.`,
    });
  }

  if (overdueTasks.length >= 2) {
    reasons.push({
      code: 'TASKS_OVERDUE',
      severity: 'RISK',
      label: `${overdueTasks.length} tasks overdue`,
      detail: `Oldest: “${overdueTasks[0]!.title}”, due ${Math.abs(daysBetween(today, overdueTasks[0]!.dueDate!))} days ago.`,
    });
  } else if (overdueTasks.length === 1) {
    reasons.push({
      code: 'TASK_OVERDUE_SINGLE',
      severity: 'WATCH',
      label: '1 task overdue',
      detail: `“${overdueTasks[0]!.title}” was due ${Math.abs(daysBetween(today, overdueTasks[0]!.dueDate!))} days ago.`,
    });
  }

  // Evidence gaps on upcoming reports.
  for (const m of openMilestones) {
    if (!isReportingMilestone(m) || !m.dueDate) continue;
    const delta = daysBetween(today, m.dueDate);
    if (delta < 0) continue; // already covered by MILESTONE_OVERDUE
    const missing = Math.max(0, m.requiredEvidenceCount - m.attachedEvidenceCount);
    if (missing === 0) continue;
    // The title goes in the label so a grant with two reports due the same week
    // produces two distinguishable signals rather than the same sentence twice.
    if (delta <= HORIZONS.dueSoonDays) {
      reasons.push({
        code: 'EVIDENCE_GAP_URGENT',
        severity: 'RISK',
        label: `“${m.title}” due in ${delta} day${delta === 1 ? '' : 's'} with ${missing} evidence item${missing === 1 ? '' : 's'} missing`,
        detail: `This ${MILESTONE_TYPE_LABELS[m.type].toLowerCase()} needs ${missing} more of ${m.requiredEvidenceCount} required attachment${m.requiredEvidenceCount === 1 ? '' : 's'} before it can be submitted.`,
      });
    } else if (delta <= HORIZONS.reportsDueDays) {
      reasons.push({
        code: 'EVIDENCE_GAP',
        severity: 'WATCH',
        label: `“${m.title}” due in ${delta} days, evidence incomplete`,
        detail: `This ${MILESTONE_TYPE_LABELS[m.type].toLowerCase()} is missing ${missing} of ${m.requiredEvidenceCount} required evidence items.`,
      });
    }
  }

  if (isActive) {
    // Budget burn against elapsed period.
    const { variancePoints, plannedCents, spentPercent, elapsedPercent } = input.budget;
    if (variancePoints !== null && plannedCents > 0 && elapsedPercent !== null) {
      if (variancePoints > HORIZONS.burnTolerancepoints) {
        reasons.push({
          code: 'BURN_AHEAD',
          severity: 'RISK',
          label: `Spending ahead of schedule by ${variancePoints} points`,
          detail: `${spentPercent}% of the restricted budget is spent with ${elapsedPercent}% of the grant period elapsed. Restricted funds may run out before the period ends.`,
        });
      } else if (variancePoints < -HORIZONS.burnTolerancepoints) {
        reasons.push({
          code: 'BURN_BEHIND',
          severity: 'WATCH',
          label: `Budget burn is behind schedule by ${Math.abs(variancePoints)} points`,
          detail: `${spentPercent}% of the restricted budget is spent with ${elapsedPercent}% of the grant period elapsed. Underspending can trigger a return of funds at closeout.`,
        });
      }
    }

    // Period ended but obligations remain.
    if (input.endDate && daysBetween(today, input.endDate) < 0 && openMilestones.length > 0) {
      reasons.push({
        code: 'PERIOD_ENDED_OPEN',
        severity: 'RISK',
        label: 'Grant period ended with open deliverables',
        detail: `The period ended ${Math.abs(daysBetween(today, input.endDate))} days ago and ${openMilestones.length} deliverable${openMilestones.length === 1 ? ' remains' : 's remain'} open.`,
      });
    } else if (input.endDate) {
      const toEnd = daysBetween(today, input.endDate);
      if (toEnd >= 0 && toEnd <= 30 && openMilestones.length > 0) {
        reasons.push({
          code: 'CLOSEOUT_OPEN',
          severity: 'RISK',
          label: `Closeout in ${toEnd} days with ${openMilestones.length} open deliverable${openMilestones.length === 1 ? '' : 's'}`,
          detail: 'Finish or waive the remaining deliverables before the grant period closes.',
        });
      }
    }

    // Renewal window with nothing scheduled.
    const renewalAnchor = input.renewalDate ?? input.endDate;
    if (renewalAnchor) {
      const toRenewal = daysBetween(today, renewalAnchor);
      const hasRenewalPlan = openMilestones.some((m) => m.type === 'RENEWAL');
      if (toRenewal >= 0 && toRenewal <= HORIZONS.renewalDays && !hasRenewalPlan) {
        reasons.push({
          code: 'RENEWAL_UNPLANNED',
          severity: 'WATCH',
          label: `Renewal window opens in ${toRenewal} days`,
          detail: 'No renewal deliverable is scheduled. Confirm the funder’s reapplication timeline to avoid a funding gap.',
        });
      }
    }
  }

  if (isPipeline && input.applicationDate) {
    const delta = daysBetween(today, input.applicationDate);
    if (delta >= 0 && delta <= HORIZONS.dueSoonDays && status !== 'SUBMITTED') {
      reasons.push({
        code: 'APPLICATION_DUE',
        severity: 'WATCH',
        label: `Application due in ${delta} day${delta === 1 ? '' : 's'}`,
        detail: 'The submission deadline is inside two weeks and the application is not yet submitted.',
      });
    } else if (delta < 0 && status !== 'SUBMITTED') {
      reasons.push({
        code: 'MILESTONE_OVERDUE',
        severity: 'RISK',
        label: `Application deadline passed ${Math.abs(delta)} days ago`,
        detail: 'The submission date has passed without the request being marked submitted.',
      });
    }
  }

  if (!input.ownerUserId) {
    reasons.push({
      code: 'NO_OWNER',
      severity: 'WATCH',
      label: 'No internal owner assigned',
      detail: 'Assign an owner so reporting and compliance work has a named accountable person.',
    });
  }

  const penalty = reasons.reduce((sum, r) => sum + (PENALTY[r.code] ?? 0), 0);
  const score = Math.max(0, Math.min(100, 100 - penalty));

  if (reasons.length === 0) {
    return {
      level: 'ON_TRACK',
      score: 100,
      reasons: [
        {
          code: 'ALL_CLEAR',
          severity: 'GOOD',
          label: 'On track',
          detail: 'No overdue work, evidence gaps, or budget variance outside tolerance.',
        },
      ],
    };
  }

  const level: HealthLevel = reasons.some((r) => r.severity === 'RISK') ? 'AT_RISK' : 'WATCH';
  const order = { RISK: 0, WATCH: 1, GOOD: 2 } as const;
  reasons.sort((a, b) => order[a.severity] - order[b.severity] || (PENALTY[b.code] ?? 0) - (PENALTY[a.code] ?? 0));
  return { level, score, reasons };
}

/* --------------------------------------------------------------- deadlines */

export interface DeadlineSourceGrant {
  id: string;
  status: GrantStatus;
  endDate: IsoDate | null;
  renewalDate: IsoDate | null;
  closeoutDate: IsoDate | null;
  applicationDate: IsoDate | null;
  decisionDate: IsoDate | null;
}

/**
 * Pipeline statuses where the application is still the team's job. Once a
 * request is SUBMITTED the application date is history, not a next action —
 * surfacing it would put a past date at the top of a deadline-sorted list.
 */
const PRE_SUBMISSION_STATUSES: readonly GrantStatus[] = ['PROSPECT', 'DRAFTING'];

/**
 * The single next thing that has to happen on a grant: the earliest open task,
 * deliverable, renewal or closeout date. Overdue items win over future ones.
 */
export function nextDeadline(
  grant: DeadlineSourceGrant,
  tasks: readonly TaskInput[],
  milestones: readonly MilestoneInput[],
): DeadlineRef | null {
  const candidates: DeadlineRef[] = [];

  for (const m of milestones) {
    if (isOpenMilestone(m) && m.dueDate) {
      candidates.push({ kind: 'MILESTONE', id: m.id, title: m.title, date: m.dueDate });
    }
  }
  for (const t of tasks) {
    if (t.status !== 'DONE' && t.dueDate) {
      candidates.push({ kind: 'TASK', id: t.id, title: t.title, date: t.dueDate });
    }
  }
  if (ACTIVE_STATUSES.includes(grant.status)) {
    if (grant.renewalDate) {
      candidates.push({ kind: 'RENEWAL', id: `${grant.id}:renewal`, title: 'Renewal decision', date: grant.renewalDate });
    }
    if (grant.closeoutDate) {
      candidates.push({ kind: 'CLOSEOUT', id: `${grant.id}:closeout`, title: 'Closeout due', date: grant.closeoutDate });
    } else if (grant.endDate) {
      candidates.push({ kind: 'GRANT_END', id: `${grant.id}:end`, title: 'Grant period ends', date: grant.endDate });
    }
  }
  if (PRE_SUBMISSION_STATUSES.includes(grant.status) && grant.applicationDate) {
    candidates.push({
      kind: 'MILESTONE',
      id: `${grant.id}:application`,
      title: 'Application due',
      date: grant.applicationDate,
    });
  }

  // A submitted request is waiting on the funder: the meaningful next date is
  // the expected decision, and only while it is still ahead of us.
  if (grant.status === 'SUBMITTED' && grant.decisionDate) {
    candidates.push({
      kind: 'DECISION',
      id: `${grant.id}:decision`,
      title: 'Funder decision expected',
      date: grant.decisionDate,
    });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.title.localeCompare(b.title)));
  return candidates[0]!;
}

/* --------------------------------------------------------- portfolio rollups */

export interface PortfolioGrantInput {
  id: string;
  status: GrantStatus;
  requestedCents: number;
  awardedCents: number;
  probability: number | null;
  startDate: IsoDate | null;
  endDate: IsoDate | null;
  renewalDate: IsoDate | null;
  decisionDate: IsoDate | null;
}

export function activeAwardedTotal(grants: readonly PortfolioGrantInput[]): number {
  return sumCents(grants.filter((g) => ACTIVE_STATUSES.includes(g.status)).map((g) => g.awardedCents));
}

export function weightedPipelineTotal(grants: readonly PortfolioGrantInput[]): number {
  return sumCents(
    grants
      .filter((g) => PIPELINE_STATUSES.includes(g.status))
      .map((g) => weightedCents(g.requestedCents, g.probability ?? 0)),
  );
}

/**
 * Awarded dollars recognised inside the organization's current fiscal year.
 * Uses the decision date when present, otherwise the period start.
 */
export function awardedInFiscalYear(
  grants: readonly PortfolioGrantInput[],
  today: IsoDate,
  fiscalYearStartMonth: number,
): { cents: number; fiscalYear: ReturnType<typeof fiscalYearFor> } {
  const fy = fiscalYearFor(today, fiscalYearStartMonth);
  const cents = sumCents(
    grants
      .filter((g) => AWARDED_STATUSES.includes(g.status))
      .filter((g) => {
        const anchor = g.decisionDate ?? g.startDate;
        return anchor ? isWithinRange(anchor, fy.start, fy.end) : false;
      })
      .map((g) => g.awardedCents),
  );
  return { cents, fiscalYear: fy };
}

/**
 * Awarded value of active grants whose renewal decision (or period end, when no
 * renewal date is recorded) falls inside the horizon. This is the money that has
 * to be re-won to stay flat.
 */
export function renewalExposure(
  grants: readonly PortfolioGrantInput[],
  today: IsoDate,
  withinDays: number,
): { cents: number; count: number } {
  let cents = 0;
  let count = 0;
  for (const g of grants) {
    if (!ACTIVE_STATUSES.includes(g.status)) continue;
    const anchor = g.renewalDate ?? g.endDate;
    if (!anchor) continue;
    const delta = daysBetween(today, anchor);
    if (delta >= 0 && delta <= withinDays) {
      cents += g.awardedCents;
      count += 1;
    }
  }
  return { cents, count };
}

/** Count of open reporting deliverables due inside the horizon. */
export function reportsDueWithin(
  milestones: readonly (MilestoneInput & { grantStatus: GrantStatus })[],
  today: IsoDate,
  withinDays: number,
): number {
  return milestones.filter((m) => {
    if (!isReportingMilestone(m) || !isOpenMilestone(m) || !m.dueDate) return false;
    if (!ACTIVE_STATUSES.includes(m.grantStatus)) return false;
    const delta = daysBetween(today, m.dueDate);
    return delta >= 0 && delta <= withinDays;
  }).length;
}

/** Portfolio-level reporting readiness: every report in the horizon weighted equally. */
export function portfolioReadiness(
  milestones: readonly MilestoneInput[],
  today: IsoDate | null = null,
  horizonDays: number = HORIZONS.readinessHorizonDays,
): { percent: number; openReportCount: number } {
  const open = reportsInReadinessHorizon(milestones, today, horizonDays);
  if (open.length === 0) return { percent: 100, openReportCount: 0 };
  const total = open.reduce((sum, m) => sum + milestoneReadiness(m), 0);
  return { percent: Math.round((total / open.length) * 100), openReportCount: open.length };
}
