import { describe, expect, it } from 'vitest';

import { encodeForm, verifyWebhookSignature, signWebhookPayload } from '../../server/lib/stripe';
import { buildIcs } from '../../server/services/ics';
import { parseFunderType, parseStatus } from '../../server/services/import';
import { detectDelimiter, parseCsv } from '../../shared/csv';
import { parseFlexibleDate } from '../../shared/dates';
import { annualSavingsPercent, PLANS } from '../../shared/plans';
import type { CalendarEvent } from '../../shared/types';

describe('parseFlexibleDate', () => {
  it('reads the formats spreadsheets contain', () => {
    expect(parseFlexibleDate('2026-09-30')).toBe('2026-09-30');
    expect(parseFlexibleDate('9/30/2026')).toBe('2026-09-30');
    expect(parseFlexibleDate('09-30-26')).toBe('2026-09-30');
    expect(parseFlexibleDate('2026/9/3')).toBe('2026-09-03');
    expect(parseFlexibleDate('Sep 30, 2026')).toBe('2026-09-30');
    expect(parseFlexibleDate('30 September 2026')).toBe('2026-09-30');
    expect(parseFlexibleDate('2026-09-30T12:00:00Z')).toBe('2026-09-30');
    expect(parseFlexibleDate(46295)).toBe('2026-09-30');
    expect(parseFlexibleDate('')).toBeNull();
    expect(parseFlexibleDate('yesterday')).toBeNull();
    expect(parseFlexibleDate('13/45/2026')).toBeNull();
  });
});

describe('parseCsv', () => {
  it('handles quotes, embedded delimiters, CRLF and a BOM', () => {
    const text = '﻿Title,Funder,Amount\r\n"Youth, Mentoring","Harbor ""Light"" Foundation",85000\r\nSecond,State,"1,000"\r\n\r\n';
    expect(parseCsv(text)).toEqual([
      ['Title', 'Funder', 'Amount'],
      ['Youth, Mentoring', 'Harbor "Light" Foundation', '85000'],
      ['Second', 'State', '1,000'],
    ]);
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('a\tb\n1\t2')).toBe('\t');
    expect(parseCsv('a;b\n1;2', ';')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('import synonyms', () => {
  it('maps statuses and funder types from everyday spreadsheet words', () => {
    expect(parseStatus('active', 100, 100)).toBe('AWARDED');
    expect(parseStatus('Pending', 0, 100)).toBe('SUBMITTED');
    expect(parseStatus('not funded', 0, 0)).toBe('DECLINED');
    expect(parseStatus('REPORTING', 0, 0)).toBe('REPORTING');
    expect(parseStatus(null, 500, 0)).toBe('AWARDED');
    expect(parseStatus(null, 0, 500)).toBe('SUBMITTED');
    expect(parseStatus(null, 0, 0)).toBe('PROSPECT');
    expect(() => parseStatus('banana', 0, 0)).toThrow(/not recognised/);
    expect(parseFunderType('community foundation', 'X')).toBe('COMMUNITY_FOUNDATION');
    expect(parseFunderType(null, 'State Department of Health')).toBe('STATE');
    expect(parseFunderType(null, 'Acme Corporation')).toBe('CORPORATE');
    expect(parseFunderType(null, 'Harbor Light Foundation')).toBe('PRIVATE_FOUNDATION');
    expect(parseFunderType(null, 'Mystery')).toBe('OTHER');
  });
});

describe('stripe helpers', () => {
  it('encodes nested form bodies the way Stripe expects', () => {
    const encoded = encodeForm({ mode: 'subscription', line_items: [{ price: 'price_1', quantity: 1 }], metadata: { orgId: 'org_a b' } });
    expect(encoded).toBe('mode=subscription&line_items%5B0%5D%5Bprice%5D=price_1&line_items%5B0%5D%5Bquantity%5D=1&metadata%5BorgId%5D=org_a%20b');
  });

  it('verifies signatures within tolerance only', () => {
    const body = '{"id":"evt_1"}';
    const now = 1_800_000_000;
    const header = signWebhookPayload(body, 'secret', now);
    expect(verifyWebhookSignature(body, header, 'secret', now + 10)).toBe(true);
    expect(verifyWebhookSignature(body, header, 'other', now + 10)).toBe(false);
    expect(verifyWebhookSignature(body, header, 'secret', now + 1000)).toBe(false);
    expect(verifyWebhookSignature(`${body} `, header, 'secret', now)).toBe(false);
    expect(verifyWebhookSignature(body, undefined, 'secret', now)).toBe(false);
  });
});

describe('ics', () => {
  it('emits all-day events with escaped text and folded lines', () => {
    const events: CalendarEvent[] = [
      {
        id: 'milestone:mil_1',
        kind: 'MILESTONE',
        title: 'Narrative report; with, commas and a very long title that needs folding because it exceeds seventy-five octets',
        date: '2026-10-15',
        grantId: 'gr_1',
        grantTitle: 'Youth Mentoring',
        funderName: 'Harbor Light',
        ownerName: 'Dana',
        status: 'NOT_STARTED',
        statusLabel: 'Not started',
        complete: false,
      },
    ];
    const ics = buildIcs(events, { organizationName: 'Test Org', siteUrl: 'https://grantconsole.com', generatedAt: new Date('2026-09-06T00:00:00Z') });
    expect(ics).toContain('DTSTART;VALUE=DATE:20261015');
    expect(ics).toContain('DTEND;VALUE=DATE:20261016');
    expect(ics).toContain('UID:milestone:mil_1@grantconsole.com');
    expect(ics).toContain('\\; with\\, commas');
    for (const line of ics.split('\r\n')) expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });
});

describe('plans', () => {
  it('prices annual billing at roughly two months free on every tier', () => {
    for (const plan of Object.values(PLANS)) {
      expect(annualSavingsPercent(plan)).toBeGreaterThanOrEqual(15);
      expect(annualSavingsPercent(plan)).toBeLessThanOrEqual(20);
      expect(plan.priceAnnualUsdPerMonth).toBeLessThan(plan.priceMonthlyUsd);
    }
  });
});
