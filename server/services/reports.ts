/** Portfolio reporting, CSV exports and the audit-ready grant packet. */

import {
  awardedInFiscalYear,
  renewalExposure,
  weightedPipelineTotal,
  type PortfolioGrantInput,
} from '../../shared/analytics';
import {
  ACTIVE_STATUSES,
  DOCUMENT_TYPE_LABELS,
  GRANT_STATUSES,
  GRANT_STATUS_LABELS,
  HEALTH_LABELS,
  HORIZONS,
  MILESTONE_STATUS_LABELS,
  MILESTONE_TYPE_LABELS,
  REPORTING_MILESTONE_TYPES,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  type MilestoneStatus,
  type MilestoneType,
} from '../../shared/constants';
import { toCsv } from '../../shared/csv';
import { formatIsoDate, type IsoDate } from '../../shared/dates';
import { centsToPlainString, sumCents } from '../../shared/money';
import type { GrantListItem, PortfolioReport, ReportingPacket, SessionOrganization } from '../../shared/types';
import type { Db } from '../db/connection';
import { getGrantDetail, loadPortfolio } from './portfolio';
import type { MilestoneRow } from './rows';

export interface ReportFilters {
  status?: string | null;
  ownerUserId?: string | null;
  funderId?: string | null;
  health?: string | null;
}

export function filterGrants(grants: GrantListItem[], filters: ReportFilters): GrantListItem[] {
  const statuses = filters.status ? new Set(filters.status.split(',').filter(Boolean)) : null;
  return grants.filter((g) => {
    if (statuses && !statuses.has(g.status)) return false;
    if (filters.ownerUserId && g.ownerUserId !== filters.ownerUserId) return false;
    if (filters.funderId && g.funderId !== filters.funderId) return false;
    if (filters.health && g.health.level !== filters.health) return false;
    return true;
  });
}

export function buildPortfolioReport(
  db: Db,
  org: SessionOrganization,
  today: IsoDate,
  filters: ReportFilters,
): PortfolioReport {
  const { grants, milestonesByGrant } = loadPortfolio(db, org.id, today);
  const selected = filterGrants(grants, filters);

  const decisionDates = new Map(
    (
      db
        .prepare('SELECT id, decision_date AS decisionDate, start_date AS startDate FROM grants WHERE org_id = ?')
        .all(org.id) as Array<{ id: string; decisionDate: IsoDate | null; startDate: IsoDate | null }>
    ).map((r) => [r.id, r.decisionDate ?? r.startDate]),
  );

  const inputs: PortfolioGrantInput[] = selected.map((g) => ({
    id: g.id,
    status: g.status,
    requestedCents: g.requestedCents,
    awardedCents: g.awardedCents,
    probability: g.probability,
    startDate: g.startDate,
    endDate: g.endDate,
    renewalDate: g.renewalDate,
    decisionDate: decisionDates.get(g.id) ?? null,
  }));

  const fiscal = awardedInFiscalYear(inputs, today, org.fiscalYearStartMonth);
  const renewal = renewalExposure(inputs, today, 365);

  const byFunderMap = new Map<string, { funderId: string; funderName: string; count: number; awardedCents: number }>();
  const byOwnerMap = new Map<string, { ownerUserId: string | null; ownerName: string; count: number; awardedCents: number }>();

  for (const grant of selected) {
    const funder = byFunderMap.get(grant.funderId) ?? {
      funderId: grant.funderId,
      funderName: grant.funderName,
      count: 0,
      awardedCents: 0,
    };
    funder.count += 1;
    funder.awardedCents += grant.awardedCents;
    byFunderMap.set(grant.funderId, funder);

    const ownerKey = grant.ownerUserId ?? 'unassigned';
    const owner = byOwnerMap.get(ownerKey) ?? {
      ownerUserId: grant.ownerUserId,
      ownerName: grant.ownerName ?? 'Unassigned',
      count: 0,
      awardedCents: 0,
    };
    owner.count += 1;
    owner.awardedCents += grant.awardedCents;
    byOwnerMap.set(ownerKey, owner);
  }

  const reportSchedule: PortfolioReport['reportSchedule'] = [];
  for (const grant of selected) {
    if (!ACTIVE_STATUSES.includes(grant.status)) continue;
    for (const row of milestonesByGrant.get(grant.id) ?? []) {
      if (!REPORTING_MILESTONE_TYPES.includes(row.type)) continue;
      if (row.status === 'COMPLETE' || row.status === 'WAIVED') continue;
      if (!row.due_date) continue;
      reportSchedule.push({
        grantId: grant.id,
        grantTitle: grant.title,
        funderName: grant.funderName,
        milestoneId: row.id,
        milestoneTitle: row.title,
        type: row.type,
        dueDate: row.due_date,
        status: row.status,
        ownerName: grant.ownerName,
        evidenceAttached: row.attached_evidence_count,
        evidenceRequired: row.required_evidence_count,
      });
    }
  }
  reportSchedule.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));

  const readiness = selected
    .filter((g) => ACTIVE_STATUSES.includes(g.status))
    .map((g) => {
      const openReports = (milestonesByGrant.get(g.id) ?? []).filter(
        (m: MilestoneRow) =>
          REPORTING_MILESTONE_TYPES.includes(m.type) && m.status !== 'COMPLETE' && m.status !== 'WAIVED',
      );
      const nextReport = openReports
        .filter((m) => m.due_date)
        .sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1))[0];
      const missingEvidence = openReports.reduce(
        (sum, m) => sum + Math.max(0, m.required_evidence_count - m.attached_evidence_count),
        0,
      );
      return {
        grantId: g.id,
        grantTitle: g.title,
        funderName: g.funderName,
        readinessPercent: g.readiness.percent,
        health: g.health.level,
        nextReportDate: nextReport?.due_date ?? null,
        missingEvidence,
      };
    })
    .sort((a, b) => a.readinessPercent - b.readinessPercent);

  return {
    today,
    currency: org.currency,
    fiscalYear: { label: fiscal.fiscalYear.label, start: fiscal.fiscalYear.start, end: fiscal.fiscalYear.end },
    filters: {
      status: filters.status ?? null,
      ownerUserId: filters.ownerUserId ?? null,
      funderId: filters.funderId ?? null,
      health: filters.health ?? null,
    },
    totals: {
      grantCount: selected.length,
      requestedCents: sumCents(selected.map((g) => g.requestedCents)),
      awardedCents: sumCents(selected.map((g) => g.awardedCents)),
      plannedCents: sumCents(selected.map((g) => g.budget.plannedCents)),
      spentCents: sumCents(selected.map((g) => g.budget.spentCents)),
      remainingCents: sumCents(selected.map((g) => g.budget.remainingCents)),
      weightedPipelineCents: weightedPipelineTotal(inputs),
      awardedThisFiscalYearCents: fiscal.cents,
      renewalExposureCents: renewal.cents,
    },
    byStatus: GRANT_STATUSES.map((status) => {
      const inStatus = selected.filter((g) => g.status === status);
      return {
        status,
        count: inStatus.length,
        valueCents: sumCents(inStatus.map((g) => (g.awardedCents > 0 ? g.awardedCents : g.requestedCents))),
      };
    }).filter((r) => r.count > 0),
    byFunder: [...byFunderMap.values()].sort((a, b) => b.awardedCents - a.awardedCents),
    byOwner: [...byOwnerMap.values()].sort((a, b) => b.awardedCents - a.awardedCents),
    readiness,
    reportSchedule,
  };
}

/* ------------------------------------------------------------------ exports */

export function portfolioCsv(grants: GrantListItem[], today: IsoDate): string {
  const headers = [
    'Grant',
    'Program',
    'Funder',
    'Status',
    'Owner',
    'Requested',
    'Awarded',
    'Currency',
    'Probability %',
    'Period start',
    'Period end',
    'Renewal date',
    'Next deadline',
    'Next deadline date',
    'Days to deadline',
    'Health',
    'Health reason',
    'Reporting readiness %',
    'Budget planned',
    'Budget spent',
    'Budget remaining',
    'Budget spent %',
    'Open tasks',
    'Overdue items',
  ];

  const rows = grants.map((g) => [
    g.title,
    g.program ?? '',
    g.funderName,
    GRANT_STATUS_LABELS[g.status],
    g.ownerName ?? 'Unassigned',
    centsToPlainString(g.requestedCents),
    centsToPlainString(g.awardedCents),
    g.currency,
    g.probability ?? '',
    g.startDate ?? '',
    g.endDate ?? '',
    g.renewalDate ?? '',
    g.nextDeadline?.title ?? '',
    g.nextDeadline?.date ?? '',
    g.nextDeadline ? daysTo(today, g.nextDeadline.date) : '',
    HEALTH_LABELS[g.health.level],
    g.health.reasons[0]?.label ?? '',
    g.readiness.percent,
    centsToPlainString(g.budget.plannedCents),
    centsToPlainString(g.budget.spentCents),
    centsToPlainString(g.budget.remainingCents),
    g.budget.spentPercent,
    g.openTaskCount,
    g.overdueCount,
  ]);

  return toCsv(headers, rows);
}

export function reportScheduleCsv(report: PortfolioReport): string {
  const headers = [
    'Grant',
    'Funder',
    'Deliverable',
    'Type',
    'Due date',
    'Status',
    'Owner',
    'Evidence attached',
    'Evidence required',
    'Evidence gap',
  ];
  const rows = report.reportSchedule.map((r) => [
    r.grantTitle,
    r.funderName,
    r.milestoneTitle,
    MILESTONE_TYPE_LABELS[r.type],
    r.dueDate,
    MILESTONE_STATUS_LABELS[r.status],
    r.ownerName ?? 'Unassigned',
    r.evidenceAttached,
    r.evidenceRequired,
    Math.max(0, r.evidenceRequired - r.evidenceAttached),
  ]);
  return toCsv(headers, rows);
}

export function grantPacketCsv(packet: ReportingPacket): string {
  const g = packet.grant;
  const headers = ['Section', 'Item', 'Detail', 'Value'];
  const rows: Array<readonly unknown[]> = [];

  rows.push(['Grant', 'Title', g.title, '']);
  rows.push(['Grant', 'Funder', g.funderName, '']);
  rows.push(['Grant', 'Status', GRANT_STATUS_LABELS[g.status], '']);
  rows.push(['Grant', 'Owner', g.ownerName ?? 'Unassigned', '']);
  rows.push(['Grant', 'Period', `${formatIsoDate(g.startDate)} – ${formatIsoDate(g.endDate)}`, '']);
  rows.push(['Grant', 'Awarded', g.currency, centsToPlainString(g.awardedCents)]);

  for (const line of g.budgetLines) {
    rows.push([
      'Budget',
      line.category,
      line.description ?? '',
      `planned ${centsToPlainString(line.plannedCents)} / spent ${centsToPlainString(line.spentCents)}`,
    ]);
  }
  rows.push(['Budget', 'Total planned', '', centsToPlainString(packet.budgetTotals.plannedCents)]);
  rows.push(['Budget', 'Total spent', '', centsToPlainString(packet.budgetTotals.spentCents)]);
  rows.push(['Budget', 'Remaining', '', centsToPlainString(packet.budgetTotals.remainingCents)]);

  for (const item of packet.evidenceChecklist) {
    rows.push([
      'Deliverable',
      item.milestoneTitle,
      `${MILESTONE_TYPE_LABELS[item.type]} · due ${item.dueDate ?? 'n/a'} · ${MILESTONE_STATUS_LABELS[item.status]}`,
      `${item.attached}/${item.required} evidence`,
    ]);
    for (const doc of item.documents) {
      rows.push(['Evidence', doc.name, DOCUMENT_TYPE_LABELS[doc.docType], `uploaded by ${doc.uploadedBy}`]);
    }
  }

  for (const task of g.tasks) {
    rows.push([
      'Task',
      task.title,
      `${TASK_STATUS_LABELS[task.status]} · ${TASK_PRIORITY_LABELS[task.priority]}`,
      task.dueDate ?? '',
    ]);
  }

  for (const risk of packet.openRisks) {
    rows.push(['Risk', risk.label, risk.detail, risk.severity]);
  }

  return toCsv(headers, rows);
}

function daysTo(today: IsoDate, date: IsoDate): number {
  const a = Date.parse(`${today}T00:00:00Z`);
  const b = Date.parse(`${date}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/* ------------------------------------------------------------------- packet */

export function buildReportingPacket(
  db: Db,
  org: SessionOrganization,
  grantId: string,
  today: IsoDate,
  generatedAt: Date = new Date(),
): ReportingPacket {
  // The packet is a compliance document: it must carry the full activity trail,
  // not the recent window the grant workspace shows.
  const grant = getGrantDetail(db, org.id, grantId, today, { activityLimit: null });

  const documentsByMilestone = new Map<string, typeof grant.documents>();
  for (const doc of grant.documents) {
    if (!doc.milestoneId) continue;
    const list = documentsByMilestone.get(doc.milestoneId) ?? [];
    list.push(doc);
    documentsByMilestone.set(doc.milestoneId, list);
  }

  const evidenceChecklist = grant.milestones.map((m) => ({
    milestoneId: m.id,
    milestoneTitle: m.title,
    type: m.type as MilestoneType,
    dueDate: m.dueDate,
    status: m.status as MilestoneStatus,
    required: m.requiredEvidenceCount,
    attached: m.attachedEvidenceCount,
    documents: (documentsByMilestone.get(m.id) ?? []).map((d) => ({
      id: d.id,
      name: d.originalName,
      docType: d.docType,
      uploadedAt: d.createdAt,
      uploadedBy: d.uploadedByName,
    })),
  }));

  return {
    generatedAt: generatedAt.toISOString(),
    organization: org,
    grant,
    budgetTotals: grant.budget,
    evidenceChecklist,
    openRisks: grant.health.reasons.filter((r) => r.severity !== 'GOOD'),
  };
}

export const REPORT_HORIZONS = HORIZONS;
