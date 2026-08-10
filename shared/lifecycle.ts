/**
 * Lifecycle invariants.
 *
 * One place that answers "may this grant move to that state?", so the full-edit
 * route, the status-only route, the archive route and the UI all agree. A grant
 * that still owes work must never be presentable as finished or hidden from the
 * dashboard, calendar and reports.
 */

import { ACTIVE_STATUSES, AWARDED_STATUSES, type GrantStatus } from './constants';

export interface OpenObligations {
  openTaskCount: number;
  openMilestoneCount: number;
}

export interface LifecycleContext extends OpenObligations {
  status: GrantStatus;
  awardedCents: number;
}

/** Human phrase such as "2 open tasks and 1 open deliverable". */
export function describeObligations(counts: OpenObligations): string {
  const parts: string[] = [];
  if (counts.openTaskCount > 0) {
    parts.push(`${counts.openTaskCount} open ${counts.openTaskCount === 1 ? 'task' : 'tasks'}`);
  }
  if (counts.openMilestoneCount > 0) {
    parts.push(
      `${counts.openMilestoneCount} open ${counts.openMilestoneCount === 1 ? 'deliverable' : 'deliverables'}`,
    );
  }
  if (parts.length === 0) return 'no open work';
  return parts.join(' and ');
}

export function hasOpenObligations(counts: OpenObligations): boolean {
  return counts.openTaskCount > 0 || counts.openMilestoneCount > 0;
}

/**
 * Why a target status is not allowed, or null when it is.
 * Applied identically by `PUT /grants/:id` and `PATCH /grants/:id/status`.
 */
export function statusChangeDenialReason(
  next: GrantStatus,
  context: LifecycleContext,
): string | null {
  if (AWARDED_STATUSES.includes(next) && context.awardedCents <= 0) {
    return 'Record the awarded amount before moving this grant to an awarded stage.';
  }

  if (next === 'DECLINED' && context.awardedCents > 0) {
    return 'A declined request cannot carry an awarded amount. Clear the award first.';
  }

  if (next === 'CLOSED' && hasOpenObligations(context)) {
    return `This grant still has ${describeObligations(context)}. Complete or waive them before closing it, so the work cannot disappear from reporting.`;
  }

  return null;
}

/**
 * Why a grant cannot be archived, or null when it can.
 *
 * Archiving removes a grant from the default portfolio, the dashboard rollups
 * and the calendar. Doing that to a live award — or to anything with open work —
 * would silently erase obligations the team is still accountable for.
 */
export function archiveDenialReason(context: LifecycleContext): string | null {
  if (ACTIVE_STATUSES.includes(context.status)) {
    return 'Active awards cannot be archived while they are live. Move the grant to Closed or Declined first, so its obligations are resolved rather than hidden.';
  }

  if (hasOpenObligations(context)) {
    return `This grant still has ${describeObligations(context)}. Complete or waive them before archiving, so nothing disappears from the calendar and reports.`;
  }

  return null;
}

/** True when the UI should offer the archive control at all. */
export function canArchive(context: LifecycleContext): boolean {
  return archiveDenialReason(context) === null;
}
