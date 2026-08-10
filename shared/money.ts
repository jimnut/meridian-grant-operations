/**
 * Money is stored and computed exclusively as integer cents.
 *
 * Nothing in this module converts to a float for arithmetic. Parsing goes
 * straight from the decimal string to an integer so `0.1 + 0.2` style drift
 * can never enter the ledger.
 */

import type { CurrencyCode } from './constants';

export const MAX_CENTS = 1_000_000_000_00; // $1B — a hard sanity ceiling for a single record.

export class MoneyParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyParseError';
  }
}

/**
 * Parse a user-entered amount ("12,500", "$12,500.50", "12500.5") into integer cents.
 * Rejects anything that is not a plain, non-negative decimal with at most 2 decimal places.
 */
export function parseAmountToCents(input: string | number): number {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new MoneyParseError('Amount must be a number.');
    if (!Number.isInteger(input)) {
      // Numbers arriving from JSON are treated as dollars only when whole; otherwise
      // route through the string parser to avoid binary float rounding.
      return parseAmountToCents(input.toFixed(2));
    }
    return assertRange(input * 100);
  }

  const raw = input.trim();
  if (raw === '') throw new MoneyParseError('Enter an amount.');

  const cleaned = raw.replace(/[$\s]/g, '').replace(/,/g, '');
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) {
    throw new MoneyParseError('Use a plain amount such as 12500 or 12500.50.');
  }
  const [, sign, whole, fraction] = match;
  if (sign === '-') throw new MoneyParseError('Amount cannot be negative.');

  const wholeDigits = whole ?? '0';
  if (wholeDigits.length > 12) throw new MoneyParseError('Amount is too large.');

  const cents = Number(wholeDigits) * 100 + Number((fraction ?? '').padEnd(2, '0') || '0');
  return assertRange(cents);
}

function assertRange(cents: number): number {
  if (!Number.isSafeInteger(cents)) throw new MoneyParseError('Amount is too large.');
  if (cents < 0) throw new MoneyParseError('Amount cannot be negative.');
  if (cents > MAX_CENTS) throw new MoneyParseError('Amount exceeds the maximum of $1,000,000,000.');
  return cents;
}

/** Integer-safe sum. */
export function sumCents(values: readonly number[]): number {
  let total = 0;
  for (const value of values) {
    total += Math.round(value);
  }
  return total;
}

/** `123456` -> `"1,234.56"` (no symbol). */
export function centsToDecimalString(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100);
  const fraction = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}${whole.toLocaleString('en-US')}.${fraction}`;
}

/** `123456` -> `"1234.56"` — for CSV/number inputs where separators are unwanted. */
export function centsToPlainString(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  return `${negative ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

const CURRENCY_SYMBOLS: Record<CurrencyCode, string> = {
  USD: '$',
  CAD: 'CA$',
  EUR: '€',
  GBP: '£',
};

export function currencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency as CurrencyCode] ?? '';
}

/** Full display: `$12,500.50`. */
export function formatCents(cents: number, currency = 'USD'): string {
  const symbol = currencySymbol(currency);
  const negative = cents < 0;
  const body = centsToDecimalString(Math.abs(cents));
  return `${negative ? '-' : ''}${symbol}${body}`;
}

/** Compact display for dense tables and stat tiles: `$1.2M`, `$847K`, `$980`. */
export function formatCentsCompact(cents: number, currency = 'USD'): string {
  const symbol = currencySymbol(currency);
  const negative = cents < 0;
  const dollars = Math.abs(cents) / 100;
  let body: string;
  if (dollars >= 1_000_000) {
    body = `${trimZero((dollars / 1_000_000).toFixed(dollars >= 10_000_000 ? 1 : 2))}M`;
  } else if (dollars >= 10_000) {
    body = `${Math.round(dollars / 1000).toLocaleString('en-US')}K`;
  } else if (dollars >= 1000) {
    body = `${trimZero((dollars / 1000).toFixed(1))}K`;
  } else {
    body = Math.round(dollars).toLocaleString('en-US');
  }
  return `${negative ? '-' : ''}${symbol}${body}`;
}

function trimZero(value: string): string {
  return value.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

/**
 * Percentage of `part` within `whole`, returned as an integer 0-100.
 * Returns 0 when `whole` is 0 so callers never divide by zero.
 */
export function percentOf(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 100);
}

/**
 * Weighted pipeline value: requested cents scaled by probability (0-100),
 * rounded to the nearest cent with integer arithmetic.
 */
export function weightedCents(requestedCents: number, probabilityPercent: number): number {
  const clamped = Math.min(100, Math.max(0, Math.round(probabilityPercent)));
  return Math.round((requestedCents * clamped) / 100);
}
