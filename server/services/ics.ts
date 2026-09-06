/**
 * iCalendar feed of every dated obligation in a workspace, so deadlines show
 * up in Google Calendar, Outlook and Apple Calendar next to everything else.
 * All-day events, one per task, deliverable, period end, renewal or closeout.
 */

import type { CalendarEvent } from '../../shared/types';

function escapeText(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll(';', '\\;').replaceAll(',', '\\,').replace(/\r?\n/g, '\\n');
}

/** RFC 5545 line folding: 75 octets max, continuation lines start with a space. */
function fold(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let start = 0;
  let first = true;
  while (start < bytes.length) {
    const limit = first ? 75 : 74;
    let end = Math.min(start + limit, bytes.length);
    // Never split inside a multi-byte UTF-8 sequence.
    while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end -= 1;
    out.push((first ? '' : ' ') + bytes.subarray(start, end).toString('utf8'));
    start = end;
    first = false;
  }
  return out.join('\r\n');
}

function dateStamp(iso: string): string {
  return iso.replaceAll('-', '');
}

function nextDay(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function kindLabel(kind: CalendarEvent['kind']): string {
  switch (kind) {
    case 'TASK':
      return 'Task';
    case 'MILESTONE':
      return 'Deliverable';
    case 'GRANT_END':
      return 'Grant period ends';
    case 'RENEWAL':
      return 'Renewal decision';
    case 'CLOSEOUT':
      return 'Closeout';
    case 'APPLICATION':
      return 'Application deadline';
    case 'DECISION':
      return 'Funder decision';
    default:
      return 'Deadline';
  }
}

export interface IcsOptions {
  organizationName: string;
  siteUrl: string;
  generatedAt?: Date;
}

export function buildIcs(events: CalendarEvent[], options: IcsOptions): string {
  const stamp = (options.generatedAt ?? new Date()).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const host = options.siteUrl.replace(/^https?:\/\//, '');
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//GrantConsole//Grant deadlines//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(`${options.organizationName} · grant deadlines`)}`,
    'X-WR-CALDESC:Grant deadlines, deliverables and renewals from GrantConsole',
    'X-PUBLISHED-TTL:PT1H',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
  ];

  for (const event of events) {
    const summary = `${event.complete ? '✓ ' : ''}${event.title} — ${event.grantTitle}`;
    const description = [
      `${kindLabel(event.kind)} · ${event.statusLabel}`,
      `Grant: ${event.grantTitle}`,
      `Funder: ${event.funderName}`,
      event.ownerName ? `Owner: ${event.ownerName}` : null,
      `${options.siteUrl}/grants/${event.grantId}`,
    ]
      .filter((line): line is string => Boolean(line))
      .join('\n');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.id.replace(/[^A-Za-z0-9:_-]/g, '')}@${host}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${dateStamp(event.date)}`,
      `DTEND;VALUE=DATE:${dateStamp(nextDay(event.date))}`,
      `SUMMARY:${escapeText(summary)}`,
      `DESCRIPTION:${escapeText(description)}`,
      `URL:${options.siteUrl}/grants/${event.grantId}`,
      `CATEGORIES:${escapeText(kindLabel(event.kind))}`,
      `STATUS:${event.complete ? 'COMPLETED' : 'CONFIRMED'}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
