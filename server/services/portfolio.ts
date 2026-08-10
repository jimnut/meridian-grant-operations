/**
 * Portfolio assembly.
 *
 * Loads the tenant's grants plus their children in a fixed number of queries and
 * hands them to the shared calculation core. Every query is scoped by `org_id`,
 * which always comes from the session.
 */

import {
  computeBudgetTotals,
  computeHealth,
  computeReadiness,
  nextDeadline,
  type MilestoneInput,
  type TaskInput,
} from '../../shared/analytics';
import { STATUS_STAGE } from '../../shared/constants';
import { classifyDue, type IsoDate } from '../../shared/dates';
import type { GrantDetail, GrantListItem } from '../../shared/types';
import type { Db } from '../db/connection';
import { notFound } from '../lib/errors';
import {
  ACTIVITY_SELECT,
  COMMENT_SELECT,
  DOCUMENT_SELECT,
  GRANT_SELECT,
  MILESTONE_SELECT,
  TASK_SELECT,
  mapActivity,
  mapBudgetLine,
  mapComment,
  mapDocument,
  mapFunder,
  mapFunderContact,
  mapMilestone,
  mapTask,
  type ActivityRow,
  type BudgetRow,
  type CommentRow,
  type DocumentRow,
  type FunderContactRow,
  type FunderRow,
  type GrantRow,
  type MilestoneRow,
  type TaskRow,
} from './rows';

export interface PortfolioBundle {
  grants: GrantListItem[];
  byId: Map<string, GrantListItem>;
  tasksByGrant: Map<string, TaskRow[]>;
  milestonesByGrant: Map<string, MilestoneRow[]>;
  budgetByGrant: Map<string, BudgetRow[]>;
}

function groupBy<T extends { grant_id: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const list = map.get(row.grant_id);
    if (list) list.push(row);
    else map.set(row.grant_id, [row]);
  }
  return map;
}

function toTaskInput(row: TaskRow): TaskInput {
  return { id: row.id, title: row.title, status: row.status, dueDate: row.due_date };
}

function toMilestoneInput(row: MilestoneRow): MilestoneInput {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    dueDate: row.due_date,
    status: row.status,
    requiredEvidenceCount: row.required_evidence_count,
    attachedEvidenceCount: row.attached_evidence_count,
  };
}

export function buildGrantListItem(
  grant: GrantRow,
  tasks: TaskRow[],
  milestones: MilestoneRow[],
  budget: BudgetRow[],
  today: IsoDate,
): GrantListItem {
  const taskInputs = tasks.map(toTaskInput);
  const milestoneInputs = milestones.map(toMilestoneInput);
  const budgetTotals = computeBudgetTotals(
    budget.map((b) => ({ plannedCents: b.planned_cents, spentCents: b.spent_cents })),
    { startDate: grant.start_date, endDate: grant.end_date, today },
  );

  const openTasks = taskInputs.filter((t) => t.status !== 'DONE');
  const overdueTasks = openTasks.filter((t) => classifyDue(t.dueDate, today) === 'OVERDUE');
  const overdueMilestones = milestoneInputs.filter(
    (m) => m.status !== 'COMPLETE' && m.status !== 'WAIVED' && classifyDue(m.dueDate, today) === 'OVERDUE',
  );

  const health = computeHealth({
    status: grant.status,
    today,
    startDate: grant.start_date,
    endDate: grant.end_date,
    renewalDate: grant.renewal_date,
    closeoutDate: grant.closeout_date,
    applicationDate: grant.application_date,
    ownerUserId: grant.owner_user_id,
    tasks: taskInputs,
    milestones: milestoneInputs,
    budget: budgetTotals,
  });

  const readiness = computeReadiness(milestoneInputs, { blockingTaskCount: overdueTasks.length, today });

  return {
    id: grant.id,
    title: grant.title,
    program: grant.program,
    status: grant.status,
    stage: STATUS_STAGE[grant.status],
    funderId: grant.funder_id,
    funderName: grant.funder_name,
    ownerUserId: grant.owner_user_id,
    ownerName: grant.owner_name,
    requestedCents: grant.requested_cents,
    awardedCents: grant.awarded_cents,
    currency: grant.currency,
    probability: grant.probability,
    startDate: grant.start_date,
    endDate: grant.end_date,
    renewalDate: grant.renewal_date,
    archived: grant.archived === 1,
    nextDeadline: nextDeadline(
      {
        id: grant.id,
        status: grant.status,
        endDate: grant.end_date,
        renewalDate: grant.renewal_date,
        closeoutDate: grant.closeout_date,
        applicationDate: grant.application_date,
        decisionDate: grant.decision_date,
      },
      taskInputs,
      milestoneInputs,
    ),
    health,
    readiness,
    budget: budgetTotals,
    openTaskCount: openTasks.length,
    overdueCount: overdueTasks.length + overdueMilestones.length,
    updatedAt: grant.updated_at,
  };
}

/** Load every grant for the tenant with computed health, readiness and budget. */
export function loadPortfolio(
  db: Db,
  orgId: string,
  today: IsoDate,
  options: { includeArchived?: boolean } = {},
): PortfolioBundle {
  const grantRows = db
    .prepare(`${GRANT_SELECT} WHERE g.org_id = ? ${options.includeArchived ? '' : 'AND g.archived = 0'} ORDER BY g.title`)
    .all(orgId) as GrantRow[];

  const taskRows = db.prepare(`${TASK_SELECT} WHERE t.org_id = ?`).all(orgId) as TaskRow[];
  const milestoneRows = db.prepare(`${MILESTONE_SELECT} WHERE m.org_id = ?`).all(orgId) as MilestoneRow[];
  const budgetRows = db
    .prepare('SELECT * FROM budget_lines WHERE org_id = ? ORDER BY sort_order, category')
    .all(orgId) as BudgetRow[];

  const tasksByGrant = groupBy(taskRows);
  const milestonesByGrant = groupBy(milestoneRows);
  const budgetByGrant = groupBy(budgetRows);

  const grants = grantRows.map((g) =>
    buildGrantListItem(
      g,
      tasksByGrant.get(g.id) ?? [],
      milestonesByGrant.get(g.id) ?? [],
      budgetByGrant.get(g.id) ?? [],
      today,
    ),
  );

  return {
    grants,
    byId: new Map(grants.map((g) => [g.id, g])),
    tasksByGrant,
    milestonesByGrant,
    budgetByGrant,
  };
}

export function getGrantRow(db: Db, orgId: string, grantId: string): GrantRow {
  const row = db.prepare(`${GRANT_SELECT} WHERE g.org_id = ? AND g.id = ?`).get(orgId, grantId) as
    | GrantRow
    | undefined;
  if (!row) throw notFound('Grant');
  return row;
}

export interface GrantDetailOptions {
  /**
   * How many activity entries to return, newest first. The grant workspace
   * shows a recent window; the reporting packet is an audit surface and passes
   * `null` to get the complete trail.
   */
  activityLimit?: number | null;
}

/** Full grant record including children, tenant-scoped. */
export function getGrantDetail(
  db: Db,
  orgId: string,
  grantId: string,
  today: IsoDate,
  options: GrantDetailOptions = {},
): GrantDetail {
  const activityLimit = options.activityLimit === undefined ? 120 : options.activityLimit;
  const grant = getGrantRow(db, orgId, grantId);

  const tasks = db
    .prepare(`${TASK_SELECT} WHERE t.org_id = ? AND t.grant_id = ? ORDER BY
       CASE t.status WHEN 'DONE' THEN 1 ELSE 0 END,
       CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END, t.due_date, t.created_at`)
    .all(orgId, grantId) as TaskRow[];

  const milestones = db
    .prepare(`${MILESTONE_SELECT} WHERE m.org_id = ? AND m.grant_id = ? ORDER BY
       CASE WHEN m.due_date IS NULL THEN 1 ELSE 0 END, m.due_date, m.created_at`)
    .all(orgId, grantId) as MilestoneRow[];

  const budget = db
    .prepare('SELECT * FROM budget_lines WHERE org_id = ? AND grant_id = ? ORDER BY sort_order, category')
    .all(orgId, grantId) as BudgetRow[];

  const documents = db
    .prepare(`${DOCUMENT_SELECT} WHERE d.org_id = ? AND d.grant_id = ? ORDER BY d.created_at DESC`)
    .all(orgId, grantId) as DocumentRow[];

  const comments = db
    .prepare(`${COMMENT_SELECT} WHERE c.org_id = ? AND c.grant_id = ? ORDER BY c.created_at DESC`)
    .all(orgId, grantId) as CommentRow[];

  const activity = (
    activityLimit === null
      ? db
          .prepare(`${ACTIVITY_SELECT} WHERE a.org_id = ? AND a.grant_id = ? ORDER BY a.created_at DESC`)
          .all(orgId, grantId)
      : db
          .prepare(`${ACTIVITY_SELECT} WHERE a.org_id = ? AND a.grant_id = ? ORDER BY a.created_at DESC LIMIT ?`)
          .all(orgId, grantId, activityLimit)
  ) as ActivityRow[];

  const funderRow = db.prepare('SELECT * FROM funders WHERE org_id = ? AND id = ?').get(orgId, grant.funder_id) as
    | FunderRow
    | undefined;
  if (!funderRow) throw notFound('Funder');

  const contactRows = db
    .prepare('SELECT * FROM funder_contacts WHERE org_id = ? AND funder_id = ? ORDER BY name')
    .all(orgId, grant.funder_id) as FunderContactRow[];

  const base = buildGrantListItem(grant, tasks, milestones, budget, today);

  return {
    ...base,
    purpose: grant.purpose,
    requirements: grant.requirements,
    nextAction: grant.next_action,
    notes: grant.notes,
    applicationDate: grant.application_date,
    decisionDate: grant.decision_date,
    closeoutDate: grant.closeout_date,
    funder: mapFunder(funderRow),
    contacts: contactRows.map(mapFunderContact),
    tasks: tasks.map(mapTask),
    milestones: milestones.map(mapMilestone),
    budgetLines: budget.map(mapBudgetLine),
    documents: documents.map(mapDocument),
    comments: comments.map(mapComment),
    activity: activity.map(mapActivity),
  };
}
