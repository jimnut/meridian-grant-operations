/**
 * A small, realistic sample portfolio a new workspace can load with one click
 * and remove just as easily. Three grants are enough to make every dashboard
 * signal fire: an overdue report, a budget running ahead of its period, a
 * renewal window and a pending application.
 */

import type { Db } from './connection';
import { logActivity } from '../lib/activity';
import { newId } from '../lib/ids';
import { addDays, type IsoDate } from '../../shared/dates';

export function hasSampleData(db: Db, orgId: string): boolean {
  const row = db.prepare('SELECT 1 AS ok FROM grants WHERE org_id = ? AND is_sample = 1 LIMIT 1').get(orgId);
  return Boolean(row);
}

export function loadSampleData(
  db: Db,
  input: { orgId: string; userId: string; userName: string; today: IsoDate; currency: string },
): { funders: number; grants: number } {
  const now = new Date().toISOString();
  const { orgId, userId, today, currency } = input;

  const insertFunder = db.prepare(
    `INSERT INTO funders (id, org_id, name, type, focus_areas, website, notes, archived, is_sample, created_at, updated_at)
     VALUES (@id, @orgId, @name, @type, @focusAreas, @website, @notes, 0, 1, @now, @now)`,
  );
  const insertGrant = db.prepare(
    `INSERT INTO grants (id, org_id, funder_id, owner_user_id, title, program, status, requested_cents, awarded_cents,
        currency, probability, purpose, requirements, next_action, notes, application_date, decision_date, start_date,
        end_date, renewal_date, closeout_date, archived, is_sample, created_at, updated_at)
     VALUES (@id, @orgId, @funderId, @ownerUserId, @title, @program, @status, @requestedCents, @awardedCents, @currency,
        @probability, @purpose, @requirements, @nextAction, NULL, @applicationDate, @decisionDate, @startDate, @endDate,
        @renewalDate, NULL, 0, 1, @now, @now)`,
  );
  const insertMilestone = db.prepare(
    `INSERT INTO milestones (id, org_id, grant_id, type, title, due_date, status, required_evidence_count, notes, created_at, updated_at)
     VALUES (@id, @orgId, @grantId, @type, @title, @dueDate, @status, @required, @notes, @now, @now)`,
  );
  const insertTask = db.prepare(
    `INSERT INTO tasks (id, org_id, grant_id, assignee_user_id, title, description, status, priority, due_date, created_at, updated_at)
     VALUES (@id, @orgId, @grantId, @assigneeUserId, @title, @description, @status, @priority, @dueDate, @now, @now)`,
  );
  const insertBudget = db.prepare(
    `INSERT INTO budget_lines (id, org_id, grant_id, category, description, planned_cents, spent_cents, sort_order, created_at, updated_at)
     VALUES (@id, @orgId, @grantId, @category, NULL, @planned, @spent, @sort, @now, @now)`,
  );

  const run = db.transaction(() => {
    const foundation = newId('fnd');
    const state = newId('fnd');
    insertFunder.run({
      id: foundation,
      orgId,
      name: 'Harbor Light Foundation (sample)',
      type: 'PRIVATE_FOUNDATION',
      focusAreas: 'Youth|Education',
      website: null,
      notes: 'Sample funder. Remove sample data from the Today page when you are ready.',
      now,
    });
    insertFunder.run({
      id: state,
      orgId,
      name: 'State Department of Health (sample)',
      type: 'STATE',
      focusAreas: 'Public health',
      website: null,
      notes: 'Sample funder with quarterly expenditure reporting.',
      now,
    });

    const mentoring = newId('gr');
    insertGrant.run({
      id: mentoring,
      orgId,
      funderId: foundation,
      ownerUserId: userId,
      title: 'Youth Mentoring Expansion (sample)',
      program: 'Youth Programs',
      status: 'AWARDED',
      requestedCents: 9_000_000,
      awardedCents: 8_500_000,
      currency,
      probability: null,
      purpose: 'Expand one-to-one mentoring from 60 to 120 matched pairs across two neighborhoods.',
      requirements: 'Mid-year narrative and financial report; final report 60 days after period end.',
      nextAction: 'Collect mentor session logs for the mid-year report.',
      applicationDate: addDays(today, -170),
      decisionDate: addDays(today, -125),
      startDate: addDays(today, -120),
      endDate: addDays(today, 245),
      renewalDate: null,
      now,
    });
    insertMilestone.run({ id: newId('mil'), orgId, grantId: mentoring, type: 'REPORT', title: 'Mid-year narrative report', dueDate: addDays(today, 25), status: 'IN_PROGRESS', required: 2, notes: 'Attach mentor logs and the outcomes summary.', now });
    insertMilestone.run({ id: newId('mil'), orgId, grantId: mentoring, type: 'FINANCIAL_REPORT', title: 'Mid-year financial report', dueDate: addDays(today, 25), status: 'NOT_STARTED', required: 1, notes: null, now });
    insertMilestone.run({ id: newId('mil'), orgId, grantId: mentoring, type: 'REPORT', title: 'Final report', dueDate: addDays(today, 305), status: 'NOT_STARTED', required: 2, notes: null, now });
    insertTask.run({ id: newId('tsk'), orgId, grantId: mentoring, assigneeUserId: userId, title: 'Collect mentor session logs', description: 'Export from the program database and attach to the mid-year report.', status: 'IN_PROGRESS', priority: 'HIGH', dueDate: addDays(today, 10), now });
    insertTask.run({ id: newId('tsk'), orgId, grantId: mentoring, assigneeUserId: null, title: 'Draft outcomes summary', description: null, status: 'TODO', priority: 'MEDIUM', dueDate: addDays(today, 18), now });
    [
      ['Personnel', 5_000_000, 2_200_000],
      ['Program supplies', 1_500_000, 900_000],
      ['Evaluation', 1_000_000, 150_000],
      ['Administration', 1_000_000, 400_000],
    ].forEach(([category, planned, spent], index) => {
      insertBudget.run({ id: newId('bud'), orgId, grantId: mentoring, category, planned, spent, sort: index, now });
    });

    const navigators = newId('gr');
    insertGrant.run({
      id: navigators,
      orgId,
      funderId: state,
      ownerUserId: userId,
      title: 'Community Health Navigators (sample)',
      program: 'Health Access',
      status: 'REPORTING',
      requestedCents: 24_000_000,
      awardedCents: 24_000_000,
      currency,
      probability: null,
      purpose: 'Deploy six community health navigators to connect residents with primary care.',
      requirements: 'Quarterly expenditure reports within 30 days of quarter end; renewal application due 60 days before period end.',
      nextAction: 'Submit the overdue Q3 expenditure report.',
      applicationDate: addDays(today, -360),
      decisionDate: addDays(today, -310),
      startDate: addDays(today, -300),
      endDate: addDays(today, 65),
      renewalDate: addDays(today, 50),
      now,
    });
    insertMilestone.run({ id: newId('mil'), orgId, grantId: navigators, type: 'FINANCIAL_REPORT', title: 'Q3 expenditure report', dueDate: addDays(today, -5), status: 'IN_PROGRESS', required: 1, notes: 'Overdue — finance is reconciling the last month.', now });
    insertMilestone.run({ id: newId('mil'), orgId, grantId: navigators, type: 'RENEWAL', title: 'Renewal application', dueDate: addDays(today, 50), status: 'NOT_STARTED', required: 0, notes: null, now });
    insertMilestone.run({ id: newId('mil'), orgId, grantId: navigators, type: 'REPORT', title: 'Final program report', dueDate: addDays(today, 95), status: 'NOT_STARTED', required: 3, notes: null, now });
    insertTask.run({ id: newId('tsk'), orgId, grantId: navigators, assigneeUserId: userId, title: 'Reconcile navigator payroll to grant ledger', description: null, status: 'BLOCKED', priority: 'URGENT', dueDate: addDays(today, -2), now });
    [
      ['Personnel', 18_000_000, 17_100_000],
      ['Travel', 1_500_000, 1_320_000],
      ['Training', 1_000_000, 700_000],
      ['Indirect', 3_500_000, 3_200_000],
    ].forEach(([category, planned, spent], index) => {
      insertBudget.run({ id: newId('bud'), orgId, grantId: navigators, category, planned, spent, sort: index, now });
    });

    const pilot = newId('gr');
    insertGrant.run({
      id: pilot,
      orgId,
      funderId: foundation,
      ownerUserId: null,
      title: 'Food Access Pilot (sample)',
      program: 'Community Wellbeing',
      status: 'SUBMITTED',
      requestedCents: 4_000_000,
      awardedCents: 0,
      currency,
      probability: 45,
      purpose: 'Weekly mobile market at three senior housing sites.',
      requirements: null,
      nextAction: 'Board decision expected next month.',
      applicationDate: addDays(today, -20),
      decisionDate: addDays(today, 30),
      startDate: null,
      endDate: null,
      renewalDate: null,
      now,
    });

    logActivity(db, {
      orgId,
      actorUserId: userId,
      entityType: 'ORGANIZATION',
      entityId: orgId,
      action: 'SAMPLE_LOADED',
      summary: `${input.userName} loaded the sample portfolio (2 funders, 3 grants)`,
    });
  });
  run();
  return { funders: 2, grants: 3 };
}

export function removeSampleData(db: Db, input: { orgId: string; userId: string; userName: string }): { grants: number; funders: number } {
  const { orgId } = input;
  const grants = (db.prepare('SELECT COUNT(*) AS count FROM grants WHERE org_id = ? AND is_sample = 1').get(orgId) as { count: number }).count;
  const funders = (db.prepare('SELECT COUNT(*) AS count FROM funders WHERE org_id = ? AND is_sample = 1').get(orgId) as { count: number }).count;
  db.transaction(() => {
    // Child rows cascade from grants; funders go last because grants restrict them.
    db.prepare('DELETE FROM grants WHERE org_id = ? AND is_sample = 1').run(orgId);
    db.prepare(
      `DELETE FROM funders WHERE org_id = ? AND is_sample = 1
         AND NOT EXISTS (SELECT 1 FROM grants g WHERE g.funder_id = funders.id)`,
    ).run(orgId);
    if (grants > 0) {
      logActivity(db, {
        orgId,
        actorUserId: input.userId,
        entityType: 'ORGANIZATION',
        entityId: orgId,
        action: 'SAMPLE_REMOVED',
        summary: `${input.userName} removed the sample portfolio`,
      });
    }
  })();
  return { grants, funders };
}
