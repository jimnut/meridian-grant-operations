import { describe, expect, it } from 'vitest';

import {
  awardedInFiscalYear,
  computeBudgetTotals,
  computeHealth,
  computeReadiness,
  milestoneReadiness,
  nextDeadline,
  portfolioReadiness,
  renewalExposure,
  reportsDueWithin,
  weightedPipelineTotal,
  type HealthInput,
  type MilestoneInput,
  type PortfolioGrantInput,
  type TaskInput,
} from '../../shared/analytics';
import { HORIZONS } from '../../shared/constants';

const TODAY = '2026-08-10';

function milestone(overrides: Partial<MilestoneInput> = {}): MilestoneInput {
  return {
    id: 'm1',
    type: 'REPORT',
    title: 'Mid-year report',
    dueDate: '2026-08-19',
    status: 'NOT_STARTED',
    requiredEvidenceCount: 0,
    attachedEvidenceCount: 0,
    ...overrides,
  };
}

function healthInput(overrides: Partial<HealthInput> = {}): HealthInput {
  return {
    status: 'REPORTING',
    today: TODAY,
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    renewalDate: null,
    closeoutDate: null,
    applicationDate: null,
    ownerUserId: 'usr_1',
    tasks: [],
    milestones: [],
    budget: computeBudgetTotals([{ plannedCents: 100_000, spentCents: 60_000 }], {
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      today: TODAY,
    }),
    ...overrides,
  };
}

describe('computeBudgetTotals', () => {
  it('sums lines and derives remaining, percent and variance', () => {
    const totals = computeBudgetTotals(
      [
        { plannedCents: 16_800_000, spentCents: 11_940_000 },
        { plannedCents: 4_800_000, spentCents: 3_560_000 },
      ],
      { startDate: '2026-01-01', endDate: '2026-12-31', today: '2026-07-02' },
    );
    expect(totals.plannedCents).toBe(21_600_000);
    expect(totals.spentCents).toBe(15_500_000);
    expect(totals.remainingCents).toBe(6_100_000);
    expect(totals.spentPercent).toBe(72);
    expect(totals.elapsedPercent).toBe(50);
    expect(totals.variancePoints).toBe(22);
    expect(totals.lineCount).toBe(2);
  });

  it('handles an empty budget and an unknown period without dividing by zero', () => {
    const totals = computeBudgetTotals([], { startDate: null, endDate: null, today: TODAY });
    expect(totals.plannedCents).toBe(0);
    expect(totals.spentPercent).toBe(0);
    expect(totals.elapsedPercent).toBeNull();
    expect(totals.variancePoints).toBeNull();
  });

  it('reports overspend as a negative remaining balance', () => {
    const totals = computeBudgetTotals([{ plannedCents: 1000, spentCents: 1500 }], {
      startDate: null,
      endDate: null,
      today: TODAY,
    });
    expect(totals.remainingCents).toBe(-500);
    expect(totals.spentPercent).toBe(150);
  });
});

describe('reporting readiness', () => {
  it('scores a single milestone from evidence and progress', () => {
    expect(milestoneReadiness(milestone({ requiredEvidenceCount: 4, attachedEvidenceCount: 4, status: 'SUBMITTED' }))).toBe(1);
    expect(milestoneReadiness(milestone({ requiredEvidenceCount: 4, attachedEvidenceCount: 0 }))).toBe(0);
    expect(
      milestoneReadiness(milestone({ requiredEvidenceCount: 4, attachedEvidenceCount: 2, status: 'IN_PROGRESS' })),
    ).toBeCloseTo(0.65 * 0.5 + 0.35 * 0.5, 5);
  });

  it('caps evidence credit at the requirement', () => {
    expect(milestoneReadiness(milestone({ requiredEvidenceCount: 2, attachedEvidenceCount: 9 }))).toBe(0.65);
  });

  it('is 100% when nothing is due in the horizon', () => {
    const result = computeReadiness([], { today: TODAY });
    expect(result.percent).toBe(100);
    expect(result.openReportCount).toBe(0);
    expect(result.detail).toContain('No reports due');
  });

  it('ignores completed and non-reporting deliverables', () => {
    const result = computeReadiness(
      [
        milestone({ id: 'a', status: 'COMPLETE', requiredEvidenceCount: 3 }),
        milestone({ id: 'b', type: 'PAYMENT', requiredEvidenceCount: 3 }),
        milestone({ id: 'c', type: 'FINANCIAL_REPORT', requiredEvidenceCount: 2, attachedEvidenceCount: 2, status: 'SUBMITTED' }),
      ],
      { today: TODAY },
    );
    expect(result.openReportCount).toBe(1);
    expect(result.percent).toBe(100);
  });

  it('excludes reports beyond the readiness horizon', () => {
    const farAway = milestone({ id: 'far', dueDate: '2027-06-01', requiredEvidenceCount: 3 });
    const soon = milestone({ id: 'soon', dueDate: '2026-08-20', requiredEvidenceCount: 2, attachedEvidenceCount: 2, status: 'SUBMITTED' });
    const result = computeReadiness([farAway, soon], { today: TODAY });
    expect(result.openReportCount).toBe(1);
    expect(result.percent).toBe(100);
  });

  it('still counts overdue reports even though they are in the past', () => {
    const overdue = milestone({ id: 'late', dueDate: '2026-07-01', requiredEvidenceCount: 2 });
    const result = computeReadiness([overdue], { today: TODAY });
    expect(result.openReportCount).toBe(1);
    expect(result.percent).toBe(0);
  });

  it('summarises evidence coverage in the detail sentence', () => {
    const result = computeReadiness(
      [milestone({ requiredEvidenceCount: 4, attachedEvidenceCount: 2, status: 'IN_PROGRESS' })],
      { today: TODAY },
    );
    expect(result.evidenceRequired).toBe(4);
    expect(result.evidenceAttached).toBe(2);
    expect(result.detail).toContain('2 of 4 required evidence items attached');
  });

  it('averages every open report at the portfolio level', () => {
    const result = portfolioReadiness(
      [
        milestone({ id: 'a', requiredEvidenceCount: 2, attachedEvidenceCount: 2, status: 'SUBMITTED' }),
        milestone({ id: 'b', requiredEvidenceCount: 2, attachedEvidenceCount: 0, status: 'NOT_STARTED' }),
      ],
      TODAY,
    );
    expect(result.openReportCount).toBe(2);
    expect(result.percent).toBe(50);
  });
});

describe('computeHealth', () => {
  it('is on track with no negative signals', () => {
    const health = computeHealth(healthInput());
    expect(health.level).toBe('ON_TRACK');
    expect(health.score).toBe(100);
    expect(health.reasons[0]?.code).toBe('ALL_CLEAR');
  });

  it('flags an overdue deliverable as at risk and explains it', () => {
    const health = computeHealth(
      healthInput({ milestones: [milestone({ dueDate: '2026-08-01', title: 'Monthly expenditure report' })] }),
    );
    expect(health.level).toBe('AT_RISK');
    const reason = health.reasons.find((r) => r.code === 'MILESTONE_OVERDUE');
    expect(reason?.severity).toBe('RISK');
    expect(reason?.detail).toContain('Monthly expenditure report');
    expect(reason?.detail).toContain('9 days ago');
  });

  it('treats one overdue task as watch and two as risk', () => {
    const one: TaskInput[] = [{ id: 't1', title: 'Pull data', status: 'TODO', dueDate: '2026-08-05' }];
    const two: TaskInput[] = [...one, { id: 't2', title: 'Reconcile', status: 'BLOCKED', dueDate: '2026-08-02' }];
    expect(computeHealth(healthInput({ tasks: one })).level).toBe('WATCH');
    expect(computeHealth(healthInput({ tasks: two })).level).toBe('AT_RISK');
  });

  it('raises an urgent evidence gap for a report due inside two weeks', () => {
    const health = computeHealth(
      healthInput({
        milestones: [milestone({ dueDate: '2026-08-19', requiredEvidenceCount: 4, attachedEvidenceCount: 2 })],
      }),
    );
    const reason = health.reasons.find((r) => r.code === 'EVIDENCE_GAP_URGENT');
    expect(reason?.severity).toBe('RISK');
    expect(reason?.label).toContain('due in 9 days');
    expect(reason?.label).toContain('Mid-year report');
    expect(reason?.label).toContain('2 evidence items missing');
  });

  it('downgrades the same gap to watch when the report is further out', () => {
    const health = computeHealth(
      healthInput({
        milestones: [milestone({ dueDate: '2026-09-05', requiredEvidenceCount: 4, attachedEvidenceCount: 2 })],
      }),
    );
    expect(health.reasons.some((r) => r.code === 'EVIDENCE_GAP')).toBe(true);
    expect(health.level).toBe('WATCH');
  });

  it('does not raise an evidence gap when the requirement is met', () => {
    const health = computeHealth(
      healthInput({
        milestones: [milestone({ dueDate: '2026-08-19', requiredEvidenceCount: 2, attachedEvidenceCount: 2 })],
      }),
    );
    expect(health.reasons.some((r) => r.code.startsWith('EVIDENCE_GAP'))).toBe(false);
  });

  it('flags overspending ahead of the elapsed period as risk', () => {
    const health = computeHealth(
      healthInput({
        budget: computeBudgetTotals([{ plannedCents: 100_000, spentCents: 90_000 }], {
          startDate: '2026-01-01',
          endDate: '2026-12-31',
          today: TODAY,
        }),
      }),
    );
    const reason = health.reasons.find((r) => r.code === 'BURN_AHEAD');
    expect(reason?.severity).toBe('RISK');
    expect(reason?.detail).toContain('90%');
  });

  it('flags underspending as watch, not risk', () => {
    const health = computeHealth(
      healthInput({
        budget: computeBudgetTotals([{ plannedCents: 100_000, spentCents: 5_000 }], {
          startDate: '2026-01-01',
          endDate: '2026-12-31',
          today: TODAY,
        }),
      }),
    );
    expect(health.reasons.find((r) => r.code === 'BURN_BEHIND')?.severity).toBe('WATCH');
    expect(health.level).toBe('WATCH');
  });

  it('leaves burn inside tolerance alone', () => {
    const elapsed = 61; // ~61% through 2026 on 10 August
    const health = computeHealth(
      healthInput({
        budget: computeBudgetTotals([{ plannedCents: 100_000, spentCents: elapsed * 1000 }], {
          startDate: '2026-01-01',
          endDate: '2026-12-31',
          today: TODAY,
        }),
      }),
    );
    expect(health.reasons.some((r) => r.code.startsWith('BURN_'))).toBe(false);
  });

  it('flags a closeout window with open deliverables', () => {
    const health = computeHealth(
      healthInput({
        endDate: '2026-08-30',
        milestones: [milestone({ dueDate: '2026-08-28' })],
      }),
    );
    expect(health.reasons.some((r) => r.code === 'CLOSEOUT_OPEN')).toBe(true);
    expect(health.level).toBe('AT_RISK');
  });

  it('flags a grant period that ended with open obligations', () => {
    const health = computeHealth(
      healthInput({
        endDate: '2026-07-01',
        milestones: [milestone({ dueDate: '2026-09-01' })],
      }),
    );
    expect(health.reasons.some((r) => r.code === 'PERIOD_ENDED_OPEN')).toBe(true);
  });

  it('warns when a renewal window opens with nothing scheduled', () => {
    const health = computeHealth(healthInput({ renewalDate: '2026-09-20' }));
    const reason = health.reasons.find((r) => r.code === 'RENEWAL_UNPLANNED');
    expect(reason?.severity).toBe('WATCH');
    expect(reason?.label).toContain('41 days');
  });

  it('stays quiet when a renewal deliverable already exists', () => {
    const health = computeHealth(
      healthInput({
        renewalDate: '2026-09-20',
        milestones: [milestone({ type: 'RENEWAL', dueDate: '2026-09-01', status: 'IN_PROGRESS' })],
      }),
    );
    expect(health.reasons.some((r) => r.code === 'RENEWAL_UNPLANNED')).toBe(false);
  });

  it('notes a missing owner', () => {
    const health = computeHealth(healthInput({ ownerUserId: null }));
    expect(health.reasons.some((r) => r.code === 'NO_OWNER')).toBe(true);
    expect(health.level).toBe('WATCH');
  });

  it('warns about an application deadline inside two weeks', () => {
    const health = computeHealth(
      healthInput({ status: 'DRAFTING', applicationDate: '2026-08-21', endDate: null, startDate: null }),
    );
    expect(health.reasons.some((r) => r.code === 'APPLICATION_DUE')).toBe(true);
  });

  it('treats a fully resolved closed or declined grant as having no open obligations', () => {
    for (const status of ['CLOSED', 'DECLINED'] as const) {
      const health = computeHealth(
        healthInput({
          status,
          milestones: [milestone({ dueDate: '2020-01-01', status: 'COMPLETE' })],
          tasks: [{ id: 't1', title: 'Archive logs', status: 'DONE', dueDate: '2020-01-01' }],
          ownerUserId: null,
        }),
      );
      expect(health.level).toBe('ON_TRACK');
      expect(health.reasons).toHaveLength(1);
      expect(health.reasons[0]?.severity).toBe('GOOD');
      expect(health.reasons[0]?.label).toContain('no open obligations');
    }
  });

  it('never claims a closed grant is clear while obligations remain open', () => {
    for (const status of ['CLOSED', 'DECLINED'] as const) {
      const health = computeHealth(
        healthInput({
          status,
          milestones: [milestone({ dueDate: '2020-01-01' })],
          tasks: [{ id: 't1', title: 'Return unspent funds', status: 'TODO', dueDate: '2020-02-01' }],
        }),
      );
      expect(health.level).toBe('AT_RISK');
      expect(health.reasons[0]?.code).toBe('ENDED_WITH_OPEN_WORK');
      expect(health.reasons[0]?.severity).toBe('RISK');
      expect(health.reasons.some((r) => r.label.includes('no open obligations'))).toBe(false);
    }
  });

  it('sorts risk reasons ahead of watch reasons', () => {
    const health = computeHealth(
      healthInput({
        ownerUserId: null,
        milestones: [milestone({ dueDate: '2026-08-01' })],
      }),
    );
    expect(health.reasons[0]?.severity).toBe('RISK');
    expect(health.reasons[health.reasons.length - 1]?.severity).toBe('WATCH');
    expect(health.score).toBeLessThan(100);
  });
});

describe('nextDeadline', () => {
  const grant = {
    id: 'gr_1',
    status: 'REPORTING' as const,
    endDate: '2026-12-31',
    renewalDate: '2026-11-01',
    closeoutDate: null,
    applicationDate: null,
    decisionDate: null,
  };

  it('picks the earliest open item across tasks, deliverables and grant dates', () => {
    const result = nextDeadline(
      grant,
      [{ id: 't1', title: 'Pull data', status: 'TODO', dueDate: '2026-09-15' }],
      [milestone({ id: 'm1', dueDate: '2026-08-19' })],
    );
    expect(result?.kind).toBe('MILESTONE');
    expect(result?.date).toBe('2026-08-19');
  });

  it('skips completed work', () => {
    const result = nextDeadline(
      grant,
      [{ id: 't1', title: 'Done thing', status: 'DONE', dueDate: '2026-08-01' }],
      [milestone({ id: 'm1', dueDate: '2026-08-05', status: 'COMPLETE' })],
    );
    expect(result?.date).toBe('2026-11-01');
    expect(result?.kind).toBe('RENEWAL');
  });

  it('returns null when nothing is scheduled', () => {
    expect(
      nextDeadline(
        { id: 'gr', status: 'PROSPECT', endDate: null, renewalDate: null, closeoutDate: null, applicationDate: null, decisionDate: null },
        [],
        [],
      ),
    ).toBeNull();
  });

  it('uses the application date for pipeline grants', () => {
    const result = nextDeadline(
      { id: 'gr', status: 'DRAFTING', endDate: null, renewalDate: null, closeoutDate: null, applicationDate: '2026-08-21', decisionDate: null },
      [],
      [],
    );
    expect(result?.title).toBe('Application due');
  });

  it('does not surface a past application date once the request is submitted', () => {
    expect(
      nextDeadline(
        { id: 'gr', status: 'SUBMITTED', endDate: null, renewalDate: null, closeoutDate: null, applicationDate: '2026-07-01', decisionDate: null },
        [],
        [],
      ),
    ).toBeNull();
  });

  it('surfaces the expected funder decision for submitted requests', () => {
    const result = nextDeadline(
      { id: 'gr', status: 'SUBMITTED', endDate: null, renewalDate: null, closeoutDate: null, applicationDate: '2026-07-01', decisionDate: '2026-09-15' },
      [],
      [],
    );
    expect(result?.kind).toBe('DECISION');
    expect(result?.title).toBe('Funder decision expected');
    expect(result?.date).toBe('2026-09-15');
  });
});

describe('portfolio rollups', () => {
  const grants: PortfolioGrantInput[] = [
    {
      id: 'a',
      status: 'REPORTING',
      requestedCents: 30_000_000,
      awardedCents: 28_500_000,
      probability: null,
      startDate: '2025-11-01',
      endDate: '2026-11-01',
      renewalDate: '2026-10-15',
      decisionDate: '2025-10-20',
    },
    {
      id: 'b',
      status: 'AWARDED',
      requestedCents: 12_000_000,
      awardedCents: 12_000_000,
      probability: null,
      startDate: '2026-07-05',
      endDate: '2027-07-04',
      renewalDate: null,
      decisionDate: '2026-07-05',
    },
    {
      id: 'c',
      status: 'SUBMITTED',
      requestedCents: 18_000_000,
      awardedCents: 0,
      probability: 60,
      startDate: null,
      endDate: null,
      renewalDate: null,
      decisionDate: null,
    },
    {
      id: 'd',
      status: 'DECLINED',
      requestedCents: 3_500_000,
      awardedCents: 0,
      probability: 0,
      startDate: null,
      endDate: null,
      renewalDate: null,
      decisionDate: '2026-06-11',
    },
  ];

  it('weights the pipeline by probability', () => {
    expect(weightedPipelineTotal(grants)).toBe(10_800_000);
  });

  it('counts awarded value inside the current fiscal year only', () => {
    const july = awardedInFiscalYear(grants, TODAY, 7);
    expect(july.fiscalYear.label).toBe('FY2027');
    expect(july.cents).toBe(12_000_000);

    const january = awardedInFiscalYear(grants, TODAY, 1);
    expect(january.fiscalYear.label).toBe('FY2026');
    expect(january.cents).toBe(12_000_000);
  });

  it('measures renewal exposure inside a horizon', () => {
    const ninety = renewalExposure(grants, TODAY, HORIZONS.renewalDays);
    expect(ninety.count).toBe(1);
    expect(ninety.cents).toBe(28_500_000);

    const week = renewalExposure(grants, TODAY, 7);
    expect(week.count).toBe(0);
    expect(week.cents).toBe(0);
  });

  it('falls back to the period end when no renewal date is recorded', () => {
    const exposure = renewalExposure(grants, '2027-06-20', 30);
    expect(exposure.count).toBe(1);
    expect(exposure.cents).toBe(12_000_000);
  });

  it('counts reports due within a horizon on active grants only', () => {
    const milestones = [
      { ...milestone({ id: 'a', dueDate: '2026-08-20' }), grantStatus: 'REPORTING' as const },
      { ...milestone({ id: 'b', dueDate: '2026-08-20' }), grantStatus: 'CLOSED' as const },
      { ...milestone({ id: 'c', dueDate: '2026-11-20' }), grantStatus: 'REPORTING' as const },
      { ...milestone({ id: 'd', dueDate: '2026-08-20', status: 'COMPLETE' as const }), grantStatus: 'REPORTING' as const },
    ];
    expect(reportsDueWithin(milestones, TODAY, HORIZONS.reportsDueDays)).toBe(1);
  });
});
