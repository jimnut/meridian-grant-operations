import { describe, expect, it } from 'vitest';

import {
  MoneyParseError,
  centsToDecimalString,
  centsToPlainString,
  formatCents,
  formatCentsCompact,
  parseAmountToCents,
  percentOf,
  sumCents,
  weightedCents,
} from '../../shared/money';

describe('parseAmountToCents', () => {
  it('parses plain and formatted dollar strings to integer cents', () => {
    expect(parseAmountToCents('12500')).toBe(1_250_000);
    expect(parseAmountToCents('12,500.50')).toBe(1_250_050);
    expect(parseAmountToCents('$12,500.05')).toBe(1_250_005);
    expect(parseAmountToCents(' 0.01 ')).toBe(1);
    expect(parseAmountToCents('0')).toBe(0);
  });

  it('handles one-decimal input without dropping the cent', () => {
    expect(parseAmountToCents('12500.5')).toBe(1_250_050);
    expect(parseAmountToCents('0.1')).toBe(10);
  });

  it('never introduces floating point drift', () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point; integer cents must be exact.
    const a = parseAmountToCents('0.1');
    const b = parseAmountToCents('0.2');
    expect(a + b).toBe(parseAmountToCents('0.30'));
    expect(sumCents([a, b])).toBe(30);
  });

  it('accepts whole numbers and rounds fractional numbers through the string parser', () => {
    expect(parseAmountToCents(500)).toBe(50_000);
    expect(parseAmountToCents(1234.56)).toBe(123_456);
    expect(parseAmountToCents(0.1 + 0.2)).toBe(30);
  });

  it('rejects negatives, junk and over-precise values', () => {
    expect(() => parseAmountToCents('-5')).toThrow(MoneyParseError);
    expect(() => parseAmountToCents('abc')).toThrow(MoneyParseError);
    expect(() => parseAmountToCents('')).toThrow(MoneyParseError);
    expect(() => parseAmountToCents('1.005')).toThrow(MoneyParseError);
    expect(() => parseAmountToCents('1e5')).toThrow(MoneyParseError);
    // Spaces are stripped, so a space-separated amount is still accepted.
    expect(parseAmountToCents('12 500')).toBe(1_250_000);
  });

  it('rejects amounts beyond the sanity ceiling', () => {
    expect(() => parseAmountToCents('1000000001')).toThrow(MoneyParseError);
  });
});

describe('formatting', () => {
  it('formats cents with separators and two decimals', () => {
    expect(centsToDecimalString(1_250_050)).toBe('12,500.50');
    expect(centsToDecimalString(5)).toBe('0.05');
    expect(centsToDecimalString(-1_250_050)).toBe('-12,500.50');
    expect(formatCents(1_250_050)).toBe('$12,500.50');
    expect(formatCents(-500, 'USD')).toBe('-$5.00');
  });

  it('produces plain machine-readable strings for exports', () => {
    expect(centsToPlainString(1_250_050)).toBe('12500.50');
    expect(centsToPlainString(0)).toBe('0.00');
    expect(centsToPlainString(-25)).toBe('-0.25');
  });

  it('compacts large values without losing the sign', () => {
    expect(formatCentsCompact(28_500_000)).toBe('$285K');
    expect(formatCentsCompact(150_000_000)).toBe('$1.5M');
    expect(formatCentsCompact(98_000)).toBe('$980');
    expect(formatCentsCompact(-28_500_000)).toBe('-$285K');
  });
});

describe('derived figures', () => {
  it('computes integer percentages and never divides by zero', () => {
    expect(percentOf(50, 200)).toBe(25);
    expect(percentOf(1, 3)).toBe(33);
    expect(percentOf(5, 0)).toBe(0);
  });

  it('weights pipeline value with integer arithmetic', () => {
    expect(weightedCents(18_000_000, 60)).toBe(10_800_000);
    expect(weightedCents(18_000_000, 0)).toBe(0);
    expect(weightedCents(18_000_000, 150)).toBe(18_000_000);
    expect(weightedCents(333, 33)).toBe(110);
    expect(Number.isInteger(weightedCents(333, 33))).toBe(true);
  });

  it('sums with integer safety', () => {
    expect(sumCents([1, 2, 3])).toBe(6);
    expect(sumCents([])).toBe(0);
  });
});
