import { describe, expect, it } from 'vitest';

import { attentionGrantHref, calendarGrantHref } from '../../client/lib/grant-links';
import type { AttentionItem, CalendarEvent } from '../../shared/types';

const attention = (kind: string): AttentionItem => ({
  id: `grant-1:${kind}:0`,
  grantId: 'grant-1',
  grantTitle: 'Community Grant',
  funderName: 'Community Fund',
  severity: 'RISK',
  headline: 'Needs attention',
  reason: 'A clear reason.',
  dueDate: '2026-08-15',
  ownerName: 'Dana',
  kind,
});

const event = (kind: CalendarEvent['kind']): CalendarEvent => ({
  id: `${kind.toLowerCase()}:record-1`,
  kind,
  title: 'Deadline',
  date: '2026-08-15',
  grantId: 'grant-1',
  grantTitle: 'Community Grant',
  funderName: 'Community Fund',
  ownerName: 'Dana',
  status: 'TODO',
  statusLabel: 'To do',
  complete: false,
});

describe('grant action links', () => {
  it('routes task risks to Tasks', () => {
    expect(attentionGrantHref(attention('TASKS_OVERDUE'))).toBe('/grants/grant-1?tab=tasks');
  });

  it('routes evidence risks to Deliverables', () => {
    expect(attentionGrantHref(attention('EVIDENCE_GAP_URGENT'))).toBe('/grants/grant-1?tab=deliverables');
  });

  it('routes budget risks to Budget', () => {
    expect(attentionGrantHref(attention('BURN_AHEAD'))).toBe('/grants/grant-1?tab=budget');
  });

  it('leaves general grant risks on the overview', () => {
    expect(attentionGrantHref(attention('NO_OWNER'))).toBe('/grants/grant-1');
  });

  it('routes calendar work to the corresponding tab', () => {
    expect(calendarGrantHref(event('TASK'))).toBe('/grants/grant-1?tab=tasks');
    expect(calendarGrantHref(event('MILESTONE'))).toBe('/grants/grant-1?tab=deliverables');
    expect(calendarGrantHref(event('RENEWAL'))).toBe('/grants/grant-1');
  });
});
