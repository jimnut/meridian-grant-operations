/**
 * Spreadsheet import. The client parses the CSV and maps columns to the keys
 * below; the server validates each row, creates missing funders, enforces the
 * plan's grant allowance and reports what happened row by row. One bad row
 * never blocks the others.
 */

import type { Db } from '../db/connection';
import { logActivity } from '../lib/activity';
import { ApiError } from '../lib/errors';
import { newId } from '../lib/ids';
import { assertGrantCapacity, countsTowardLimit } from '../lib/plans';
import { FUNDER_TYPES, GRANT_STATUSES, type FunderType, type GrantStatus } from '../../shared/constants';
import { parseFlexibleDate } from '../../shared/dates';
import { MoneyParseError, parseAmountToCents } from '../../shared/money';
import type { WorkspaceStatus } from '../../shared/plans';
import type { ImportResult, ImportRowResult } from '../../shared/types';

export const IMPORT_FIELDS = [
  'title',
  'funderName',
  'funderType',
  'program',
  'status',
  'requested',
  'awarded',
  'startDate',
  'endDate',
  'renewalDate',
  'reportTitle',
  'reportDueDate',
  'ownerEmail',
  'purpose',
  'notes',
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

export type ImportRow = Partial<Record<ImportField, string | number | null | undefined>>;

const STATUS_SYNONYMS: Record<string, GrantStatus> = {
  prospect: 'PROSPECT',
  researching: 'PROSPECT',
  identified: 'PROSPECT',
  idea: 'PROSPECT',
  drafting: 'DRAFTING',
  draft: 'DRAFTING',
  'in progress': 'DRAFTING',
  writing: 'DRAFTING',
  submitted: 'SUBMITTED',
  pending: 'SUBMITTED',
  applied: 'SUBMITTED',
  'under review': 'SUBMITTED',
  awarded: 'AWARDED',
  active: 'AWARDED',
  funded: 'AWARDED',
  approved: 'AWARDED',
  open: 'AWARDED',
  reporting: 'REPORTING',
  renewal: 'RENEWAL',
  renewing: 'RENEWAL',
  closeout: 'CLOSEOUT',
  closing: 'CLOSEOUT',
  closed: 'CLOSED',
  complete: 'CLOSED',
  completed: 'CLOSED',
  ended: 'CLOSED',
  declined: 'DECLINED',
  rejected: 'DECLINED',
  'not funded': 'DECLINED',
  unsuccessful: 'DECLINED',
};

const FUNDER_TYPE_SYNONYMS: Array<[RegExp, FunderType]> = [
  [/community/, 'COMMUNITY_FOUNDATION'],
  [/family/, 'FAMILY_FOUNDATION'],
  [/corporat|company|business/, 'CORPORATE'],
  [/\b(?:federal|nih|nsf|hhs|hud|usda|doe|epa|samhsa|cdc|nea|neh)\b/, 'FEDERAL'],
  [/\bstate\b|department of|dept/, 'STATE'],
  [/city|county|municipal|local|town/, 'LOCAL'],
  [/intermediar|re-?grant|united way|fiscal/, 'INTERMEDIARY'],
  [/foundation|trust|philanthrop|fund\b/, 'PRIVATE_FOUNDATION'],
];

function text(value: unknown, max = 4000): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed.slice(0, max);
}

function money(value: unknown, label: string): number {
  const raw = text(value, 40);
  if (raw === null) return 0;
  try {
    return parseAmountToCents(raw);
  } catch (error) {
    throw new Error(`${label}: ${error instanceof MoneyParseError ? error.message : 'not a valid amount'}`);
  }
}

function date(value: unknown, label: string): string | null {
  const raw = text(value, 40);
  if (raw === null) return null;
  const parsed = parseFlexibleDate(typeof value === 'number' ? value : raw);
  if (!parsed) throw new Error(`${label}: could not read "${raw}" as a date (use YYYY-MM-DD or MM/DD/YYYY)`);
  return parsed;
}

export function parseStatus(value: unknown, awardedCents: number, requestedCents: number): GrantStatus {
  const raw = text(value, 40)?.toLowerCase();
  if (raw) {
    const upper = raw.toUpperCase().replace(/[\s-]+/g, '_');
    if ((GRANT_STATUSES as readonly string[]).includes(upper)) return upper as GrantStatus;
    const synonym = STATUS_SYNONYMS[raw];
    if (synonym) return synonym;
    throw new Error(`Status: "${raw}" is not recognised (try Awarded, Reporting, Submitted, Prospect, Closed or Declined)`);
  }
  if (awardedCents > 0) return 'AWARDED';
  if (requestedCents > 0) return 'SUBMITTED';
  return 'PROSPECT';
}

export function parseFunderType(value: unknown, funderName: string): FunderType {
  const raw = text(value, 60)?.toLowerCase();
  if (raw) {
    const upper = raw.toUpperCase().replace(/[\s-]+/g, '_');
    if ((FUNDER_TYPES as readonly string[]).includes(upper)) return upper as FunderType;
    for (const [pattern, type] of FUNDER_TYPE_SYNONYMS) if (pattern.test(raw)) return type;
  }
  const name = funderName.toLowerCase();
  for (const [pattern, type] of FUNDER_TYPE_SYNONYMS) if (pattern.test(name)) return type;
  return 'OTHER';
}

export interface ImportContext {
  orgId: string;
  userId: string;
  userName: string;
  currency: string;
  workspace: WorkspaceStatus;
}

export function importGrants(db: Db, context: ImportContext, rows: ImportRow[], createFunders: boolean): ImportResult {
  const now = new Date().toISOString();
  const results: ImportRowResult[] = [];
  let created = 0;
  let skipped = 0;
  let errors = 0;
  let fundersCreated = 0;
  let capacityReached: string | null = null;

  const findFunder = db.prepare('SELECT id FROM funders WHERE org_id = ? AND lower(name) = lower(?)');
  const insertFunder = db.prepare(
    `INSERT INTO funders (id, org_id, name, type, focus_areas, website, notes, archived, created_at, updated_at)
     VALUES (?, ?, ?, ?, '', NULL, NULL, 0, ?, ?)`,
  );
  const findDuplicate = db.prepare(
    'SELECT id FROM grants WHERE org_id = ? AND funder_id = ? AND lower(title) = lower(?) AND archived = 0',
  );
  const findMember = db.prepare(
    'SELECT u.id FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = ? AND lower(u.email) = lower(?)',
  );
  const insertGrant = db.prepare(
    `INSERT INTO grants (id, org_id, funder_id, owner_user_id, title, program, status, requested_cents, awarded_cents,
        currency, probability, purpose, requirements, next_action, notes, application_date, decision_date, start_date,
        end_date, renewal_date, closeout_date, archived, created_at, updated_at)
     VALUES (@id, @orgId, @funderId, @ownerUserId, @title, @program, @status, @requestedCents, @awardedCents, @currency,
        NULL, @purpose, NULL, NULL, @notes, NULL, NULL, @startDate, @endDate, @renewalDate, NULL, 0, @now, @now)`,
  );
  const insertMilestone = db.prepare(
    `INSERT INTO milestones (id, org_id, grant_id, type, title, due_date, status, required_evidence_count, notes, created_at, updated_at)
     VALUES (?, ?, ?, 'REPORT', ?, ?, 'NOT_STARTED', 1, NULL, ?, ?)`,
  );

  rows.forEach((row, index) => {
    const rowNumber = index + 2; // header is row 1 in the spreadsheet
    const title = text(row.title, 180) ?? '';
    try {
      if (!title) throw new Error('Grant title is required');
      const funderName = text(row.funderName, 160);
      if (!funderName) throw new Error('Funder is required');

      const requestedCents = money(row.requested, 'Requested amount');
      const awardedCents = money(row.awarded, 'Awarded amount');
      const status = parseStatus(row.status, awardedCents, requestedCents);
      if (['AWARDED', 'REPORTING', 'RENEWAL', 'CLOSEOUT', 'CLOSED'].includes(status) && awardedCents <= 0) {
        throw new Error(`Awarded amount is required for a grant with status ${status.toLowerCase()}`);
      }
      const startDate = date(row.startDate, 'Period start');
      const endDate = date(row.endDate, 'Period end');
      if (startDate && endDate && endDate < startDate) throw new Error('Period end is before the period start');
      const renewalDate = date(row.renewalDate, 'Renewal date');
      const reportDueDate = date(row.reportDueDate, 'Report due date');

      const run = db.transaction((): ImportRowResult => {
        let funder = findFunder.get(context.orgId, funderName) as { id: string } | undefined;
        if (!funder) {
          if (!createFunders) throw new Error(`Funder "${funderName}" does not exist yet`);
          const funderId = newId('fnd');
          insertFunder.run(funderId, context.orgId, funderName, parseFunderType(row.funderType, funderName), now, now);
          fundersCreated += 1;
          funder = { id: funderId };
        }

        if (findDuplicate.get(context.orgId, funder.id, title)) {
          return { row: rowNumber, title, outcome: 'skipped', message: 'Already in the portfolio (same title and funder)', grantId: null };
        }

        if (countsTowardLimit(status)) {
          if (capacityReached) throw new ApiError('PLAN_LIMIT', capacityReached);
          assertGrantCapacity(db, context.orgId, context.workspace);
        }

        let ownerUserId: string | null = null;
        const ownerEmail = text(row.ownerEmail, 200);
        if (ownerEmail) {
          const member = findMember.get(context.orgId, ownerEmail) as { id: string } | undefined;
          ownerUserId = member?.id ?? null;
        }

        const grantId = newId('gr');
        insertGrant.run({
          id: grantId,
          orgId: context.orgId,
          funderId: funder.id,
          ownerUserId,
          title,
          program: text(row.program, 160),
          status,
          requestedCents,
          awardedCents,
          currency: context.currency,
          purpose: text(row.purpose, 4000),
          notes: text(row.notes, 4000),
          startDate,
          endDate,
          renewalDate,
          now,
        });
        if (reportDueDate) {
          insertMilestone.run(newId('mil'), context.orgId, grantId, text(row.reportTitle, 180) ?? 'Funder report', reportDueDate, now, now);
        }
        return { row: rowNumber, title, outcome: 'created', message: null, grantId };
      });

      const result = run();
      results.push(result);
      if (result.outcome === 'created') created += 1;
      else skipped += 1;
    } catch (error) {
      errors += 1;
      const message = error instanceof Error ? error.message : 'Could not import this row';
      if (error instanceof ApiError && error.code === 'PLAN_LIMIT') capacityReached = message;
      results.push({ row: rowNumber, title: title || `Row ${rowNumber}`, outcome: 'error', message, grantId: null });
    }
  });

  if (created > 0 || fundersCreated > 0) {
    logActivity(db, {
      orgId: context.orgId,
      actorUserId: context.userId,
      entityType: 'ORGANIZATION',
      entityId: context.orgId,
      action: 'IMPORTED',
      summary: `${context.userName} imported ${created} grant${created === 1 ? '' : 's'}${fundersCreated ? ` and ${fundersCreated} funder${fundersCreated === 1 ? '' : 's'}` : ''} from a spreadsheet`,
    });
  }

  return { created, skipped, errors, fundersCreated, rows: results };
}
