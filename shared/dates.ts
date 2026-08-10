/**
 * Date helpers.
 *
 * Calendar dates (due dates, grant periods) are stored as `YYYY-MM-DD` strings and
 * are timezone-free by design — a report due "March 31" is due March 31 wherever
 * the reader sits. "Today" is resolved in the organization's timezone so a team in
 * Portland does not see a deadline flip over at 5pm local time.
 *
 * Timestamps (activity, uploads) are stored as ISO-8601 UTC strings.
 */

export type IsoDate = string; // YYYY-MM-DD

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/** Current calendar date in the given IANA timezone, as `YYYY-MM-DD`. */
export function todayInTimezone(timezone: string, now: Date = new Date()): IsoDate {
  try {
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  }
}

/** Whole days from `from` to `to`. Negative when `to` is in the past. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const base = new Date(`${date}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

export function addMonths(date: IsoDate, months: number): IsoDate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const targetMonthIndex = m - 1 + months;
  const year = y + Math.floor(targetMonthIndex / 12);
  const month = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export type DueClassification = 'OVERDUE' | 'DUE_TODAY' | 'DUE_SOON' | 'UPCOMING' | 'NONE';

/**
 * Classify a due date against today. `dueSoonDays` sets the "due soon" horizon.
 */
export function classifyDue(
  dueDate: IsoDate | null | undefined,
  today: IsoDate,
  dueSoonDays = 14,
): DueClassification {
  if (!dueDate) return 'NONE';
  const delta = daysBetween(today, dueDate);
  if (delta < 0) return 'OVERDUE';
  if (delta === 0) return 'DUE_TODAY';
  if (delta <= dueSoonDays) return 'DUE_SOON';
  return 'UPCOMING';
}

/** Human phrase for a due date: "9 days overdue", "due today", "in 12 days". */
export function relativeDueLabel(dueDate: IsoDate | null | undefined, today: IsoDate): string {
  if (!dueDate) return 'No date set';
  const delta = daysBetween(today, dueDate);
  if (delta === 0) return 'Due today';
  if (delta === 1) return 'Due tomorrow';
  if (delta === -1) return '1 day overdue';
  if (delta < 0) return `${Math.abs(delta)} days overdue`;
  return `In ${delta} days`;
}

/** `2026-03-31` -> `Mar 31, 2026`. Never constructs a Date in local time. */
export function formatIsoDate(date: IsoDate | null | undefined, style: 'short' | 'medium' | 'long' = 'medium'): string {
  if (!date || !isIsoDate(date)) return '—';
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const utc = new Date(Date.UTC(y, m - 1, d));
  const options: Intl.DateTimeFormatOptions =
    style === 'short'
      ? { month: 'short', day: 'numeric', timeZone: 'UTC' }
      : style === 'long'
        ? { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }
        : { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' };
  return new Intl.DateTimeFormat('en-US', options).format(utc);
}

/** Format a stored UTC timestamp in the organization's timezone. */
export function formatTimestamp(iso: string | null | undefined, timezone: string): string {
  if (!iso) return '—';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(parsed);
  } catch {
    return parsed.toISOString().replace('T', ' ').slice(0, 16);
  }
}

/** Coarse "3 hours ago" style label for activity feeds. */
export function relativeTimeLabel(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const seconds = Math.round((now.getTime() - then) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}

export interface FiscalYear {
  /** Label such as `FY2026`. */
  label: string;
  start: IsoDate;
  /** Inclusive last day. */
  end: IsoDate;
}

/**
 * Fiscal year containing `date`, given a 1-12 start month.
 * A fiscal year that starts in July and covers Jul 2025 - Jun 2026 is labelled FY2026,
 * matching US nonprofit convention (named for the year it ends in). A January start
 * yields a calendar year label.
 */
export function fiscalYearFor(date: IsoDate, startMonth: number): FiscalYear {
  const month = Math.min(12, Math.max(1, Math.round(startMonth)));
  const [y, m] = date.split('-').map(Number) as [number, number];
  const startYear = m >= month ? y : y - 1;
  const start: IsoDate = `${String(startYear).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
  const end = addDays(addMonths(start, 12), -1);
  const label = month === 1 ? `FY${startYear}` : `FY${startYear + 1}`;
  return { label, start, end };
}

export function isWithinRange(date: IsoDate, start: IsoDate, end: IsoDate): boolean {
  return date >= start && date <= end;
}

/** Fraction (0-1) of a period that has elapsed as of `today`. */
export function elapsedFraction(start: IsoDate | null, end: IsoDate | null, today: IsoDate): number | null {
  if (!start || !end) return null;
  const total = daysBetween(start, end);
  if (total <= 0) return null;
  const elapsed = daysBetween(start, today);
  if (elapsed <= 0) return 0;
  if (elapsed >= total) return 1;
  return elapsed / total;
}

/** ISO week-independent month key `2026-03` used to bucket calendar views. */
export function monthKey(date: IsoDate): string {
  return date.slice(0, 7);
}

export function startOfMonth(monthKeyValue: string): IsoDate {
  return `${monthKeyValue}-01`;
}

export function endOfMonth(monthKeyValue: string): IsoDate {
  return addDays(addMonths(startOfMonth(monthKeyValue), 1), -1);
}

export function formatMonthLabel(monthKeyValue: string): string {
  const [y, m] = monthKeyValue.split('-').map(Number) as [number, number];
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, 1)),
  );
}

/** Day-of-week index (0 = Sunday) for a calendar date, timezone-free. */
export function weekdayIndex(date: IsoDate): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export const COMMON_TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'UTC',
] as const;
