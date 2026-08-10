import { describe, expect, it } from 'vitest';

import {
  addDays,
  addMonths,
  classifyDue,
  daysBetween,
  elapsedFraction,
  fiscalYearFor,
  formatIsoDate,
  isIsoDate,
  relativeDueLabel,
  todayInTimezone,
  weekdayIndex,
} from '../../shared/dates';

describe('iso date handling', () => {
  it('validates real calendar dates', () => {
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('26-01-01')).toBe(false);
    expect(isIsoDate('')).toBe(false);
    expect(isIsoDate(null)).toBe(false);
  });

  it('adds days and months across boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-07-01', 12)).toBe('2027-07-01');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
  });

  it('counts whole days between dates', () => {
    expect(daysBetween('2026-01-01', '2026-01-31')).toBe(30);
    expect(daysBetween('2026-01-31', '2026-01-01')).toBe(-30);
    expect(daysBetween('2026-01-01', '2026-01-01')).toBe(0);
  });

  it('formats without shifting into local time', () => {
    // A naive `new Date('2026-01-01')` renders as Dec 31 west of UTC.
    expect(formatIsoDate('2026-01-01')).toBe('Jan 1, 2026');
    expect(formatIsoDate('2026-12-31', 'long')).toBe('December 31, 2026');
    expect(formatIsoDate(null)).toBe('—');
  });

  it('resolves today in the organization timezone', () => {
    // 2026-03-02T02:00Z is still March 1 in Los Angeles.
    const instant = new Date('2026-03-02T02:00:00Z');
    expect(todayInTimezone('America/Los_Angeles', instant)).toBe('2026-03-01');
    expect(todayInTimezone('UTC', instant)).toBe('2026-03-02');
    expect(todayInTimezone('Not/AZone', instant)).toBe('2026-03-02');
  });

  it('knows the weekday for calendar layout', () => {
    expect(weekdayIndex('2026-08-10')).toBe(1); // Monday
  });
});

describe('due classification', () => {
  const today = '2026-08-10';

  it('classifies overdue, today, soon and upcoming', () => {
    expect(classifyDue('2026-08-01', today)).toBe('OVERDUE');
    expect(classifyDue('2026-08-10', today)).toBe('DUE_TODAY');
    expect(classifyDue('2026-08-20', today)).toBe('DUE_SOON');
    expect(classifyDue('2026-08-24', today)).toBe('DUE_SOON');
    expect(classifyDue('2026-08-25', today)).toBe('UPCOMING');
    expect(classifyDue(null, today)).toBe('NONE');
  });

  it('honours a custom due-soon horizon', () => {
    expect(classifyDue('2026-08-20', today, 5)).toBe('UPCOMING');
    expect(classifyDue('2026-08-13', today, 5)).toBe('DUE_SOON');
  });

  it('produces human labels', () => {
    expect(relativeDueLabel('2026-08-10', today)).toBe('Due today');
    expect(relativeDueLabel('2026-08-11', today)).toBe('Due tomorrow');
    expect(relativeDueLabel('2026-08-09', today)).toBe('1 day overdue');
    expect(relativeDueLabel('2026-08-01', today)).toBe('9 days overdue');
    expect(relativeDueLabel('2026-08-22', today)).toBe('In 12 days');
    expect(relativeDueLabel(null, today)).toBe('No date set');
  });
});

describe('fiscal year', () => {
  it('handles a July start named for the year it ends in', () => {
    const fy = fiscalYearFor('2026-08-10', 7);
    expect(fy.label).toBe('FY2027');
    expect(fy.start).toBe('2026-07-01');
    expect(fy.end).toBe('2027-06-30');
  });

  it('places dates before the start month in the previous fiscal year', () => {
    const fy = fiscalYearFor('2026-06-30', 7);
    expect(fy.start).toBe('2025-07-01');
    expect(fy.end).toBe('2026-06-30');
    expect(fy.label).toBe('FY2026');
  });

  it('treats a January start as a calendar year', () => {
    const fy = fiscalYearFor('2026-08-10', 1);
    expect(fy.label).toBe('FY2026');
    expect(fy.start).toBe('2026-01-01');
    expect(fy.end).toBe('2026-12-31');
  });

  it('handles an October start crossing the new year', () => {
    const fy = fiscalYearFor('2026-01-15', 10);
    expect(fy.start).toBe('2025-10-01');
    expect(fy.end).toBe('2026-09-30');
  });

  it('clamps out-of-range start months', () => {
    expect(fiscalYearFor('2026-08-10', 0).start).toBe('2026-01-01');
    expect(fiscalYearFor('2026-08-10', 13).start).toBe('2025-12-01');
  });
});

describe('elapsed fraction', () => {
  it('reports progress through a grant period', () => {
    expect(elapsedFraction('2026-01-01', '2026-01-11', '2026-01-06')).toBeCloseTo(0.5, 5);
    expect(elapsedFraction('2026-01-01', '2026-01-11', '2025-12-01')).toBe(0);
    expect(elapsedFraction('2026-01-01', '2026-01-11', '2026-06-01')).toBe(1);
    expect(elapsedFraction(null, '2026-01-11', '2026-01-06')).toBeNull();
    expect(elapsedFraction('2026-01-11', '2026-01-11', '2026-01-11')).toBeNull();
  });
});
