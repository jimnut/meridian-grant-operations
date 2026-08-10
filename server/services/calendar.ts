/**
 * Deadline stream shared by the calendar page, the dashboard strip and the
 * funder "next deadline" column. One source of truth so the same date can never
 * appear differently in two places.
 */

import {
  ACTIVE_STATUSES,
  GRANT_STATUS_LABELS,
  MILESTONE_STATUS_LABELS,
  MILESTONE_TYPE_LABELS,
  PIPELINE_STATUSES,
  TASK_STATUS_LABELS,
} from '../../shared/constants';
import type { IsoDate } from '../../shared/dates';
import type { CalendarEvent } from '../../shared/types';
import type { Db } from '../db/connection';
import { GRANT_SELECT, MILESTONE_SELECT, TASK_SELECT, type GrantRow, type MilestoneRow, type TaskRow } from './rows';

export interface CalendarFilters {
  from?: IsoDate | null;
  to?: IsoDate | null;
  kinds?: string[];
  ownerUserId?: string | null;
  grantId?: string | null;
  includeComplete?: boolean;
}

export function loadCalendarEvents(db: Db, orgId: string, filters: CalendarFilters = {}): CalendarEvent[] {
  const grants = db.prepare(`${GRANT_SELECT} WHERE g.org_id = ? AND g.archived = 0`).all(orgId) as GrantRow[];
  const grantById = new Map(grants.map((g) => [g.id, g]));

  const tasks = db.prepare(`${TASK_SELECT} WHERE t.org_id = ? AND t.due_date IS NOT NULL`).all(orgId) as TaskRow[];
  const milestones = db
    .prepare(`${MILESTONE_SELECT} WHERE m.org_id = ? AND m.due_date IS NOT NULL`)
    .all(orgId) as MilestoneRow[];

  const events: CalendarEvent[] = [];

  for (const task of tasks) {
    const grant = grantById.get(task.grant_id);
    if (!grant) continue;
    const complete = task.status === 'DONE';
    events.push({
      id: `task:${task.id}`,
      kind: 'TASK',
      title: task.title,
      date: task.due_date!,
      grantId: grant.id,
      grantTitle: grant.title,
      funderName: grant.funder_name,
      ownerName: task.assignee_name ?? grant.owner_name,
      status: task.status,
      statusLabel: TASK_STATUS_LABELS[task.status],
      complete,
    });
  }

  for (const milestone of milestones) {
    const grant = grantById.get(milestone.grant_id);
    if (!grant) continue;
    const complete = milestone.status === 'COMPLETE' || milestone.status === 'WAIVED';
    events.push({
      id: `milestone:${milestone.id}`,
      kind: 'MILESTONE',
      title: `${MILESTONE_TYPE_LABELS[milestone.type]}: ${milestone.title}`,
      date: milestone.due_date!,
      grantId: grant.id,
      grantTitle: grant.title,
      funderName: grant.funder_name,
      ownerName: grant.owner_name,
      status: milestone.status,
      statusLabel: MILESTONE_STATUS_LABELS[milestone.status],
      complete,
    });
  }

  for (const grant of grants) {
    const isActive = ACTIVE_STATUSES.includes(grant.status);
    const isPipeline = PIPELINE_STATUSES.includes(grant.status);

    // Only pre-submission grants owe an application; once submitted, the date
    // that matters is the funder's decision.
    if (isPipeline && grant.status !== 'SUBMITTED' && grant.application_date) {
      events.push(grantEvent(grant, 'APPLICATION', 'Application due', grant.application_date));
    }
    if (grant.status === 'SUBMITTED' && grant.decision_date) {
      events.push(grantEvent(grant, 'DECISION', 'Funder decision expected', grant.decision_date));
    }
    if (isActive && grant.end_date) {
      events.push(grantEvent(grant, 'GRANT_END', 'Grant period ends', grant.end_date));
    }
    if (isActive && grant.renewal_date) {
      events.push(grantEvent(grant, 'RENEWAL', 'Renewal decision', grant.renewal_date));
    }
    if (isActive && grant.closeout_date) {
      events.push(grantEvent(grant, 'CLOSEOUT', 'Closeout report due', grant.closeout_date));
    }
  }

  return applyFilters(events, filters);
}

function grantEvent(
  grant: GrantRow,
  kind: CalendarEvent['kind'],
  title: string,
  date: IsoDate,
): CalendarEvent {
  return {
    id: `${kind.toLowerCase()}:${grant.id}`,
    kind,
    title,
    date,
    grantId: grant.id,
    grantTitle: grant.title,
    funderName: grant.funder_name,
    ownerName: grant.owner_name,
    status: grant.status,
    statusLabel: GRANT_STATUS_LABELS[grant.status],
    complete: false,
  };
}

function applyFilters(events: CalendarEvent[], filters: CalendarFilters): CalendarEvent[] {
  const kinds = filters.kinds && filters.kinds.length > 0 ? new Set(filters.kinds) : null;
  return events
    .filter((e) => {
      if (filters.from && e.date < filters.from) return false;
      if (filters.to && e.date > filters.to) return false;
      if (kinds && !kinds.has(e.kind)) return false;
      if (filters.grantId && e.grantId !== filters.grantId) return false;
      if (!filters.includeComplete && e.complete) return false;
      return true;
    })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.title.localeCompare(b.title)));
}

/** Owner filtering needs the assignee id, which lives on tasks only. */
export function filterEventsByOwner(
  db: Db,
  orgId: string,
  events: CalendarEvent[],
  ownerUserId: string,
): CalendarEvent[] {
  const taskIds = new Set(
    (
      db.prepare('SELECT id FROM tasks WHERE org_id = ? AND assignee_user_id = ?').all(orgId, ownerUserId) as Array<{
        id: string;
      }>
    ).map((r) => `task:${r.id}`),
  );
  const grantIds = new Set(
    (
      db.prepare('SELECT id FROM grants WHERE org_id = ? AND owner_user_id = ?').all(orgId, ownerUserId) as Array<{
        id: string;
      }>
    ).map((r) => r.id),
  );
  return events.filter((e) => (e.kind === 'TASK' ? taskIds.has(e.id) : grantIds.has(e.grantId)));
}
