import { describe, expect, it } from 'vitest';

import { dueTone } from '../../client/lib/format';

/**
 * Regression for the Tasks tab: the second argument must be the session's
 * "today", not the grant's next deadline. Feeding a task its own due date as
 * "today" made every task look due-today and hid genuinely overdue work.
 */
describe('dueTone', () => {
  const today = '2026-08-10';

  it('marks an overdue open item as risk', () => {
    expect(dueTone('2026-08-01', today)).toBe('risk');
    expect(dueTone('2026-08-09', today)).toBe('risk');
  });

  it('marks due-today and due-soon as amber', () => {
    expect(dueTone('2026-08-10', today)).toBe('amber');
    expect(dueTone('2026-08-15', today)).toBe('amber');
  });

  it('leaves comfortably future work plain', () => {
    expect(dueTone('2026-12-01', today)).toBe('plain');
  });

  it('treats completion as positive regardless of the date', () => {
    expect(dueTone('2026-08-01', today, true)).toBe('positive');
    expect(dueTone(null, today, true)).toBe('positive');
  });

  it('leaves undated work plain', () => {
    expect(dueTone(null, today)).toBe('plain');
    expect(dueTone(undefined, today)).toBe('plain');
  });

  it('never reports due-today for an overdue date fed as its own baseline', () => {
    // The old bug: dueTone(task.dueDate, task.dueDate) === 'amber' for any date.
    // With a real "today" the same overdue date must be risk.
    const overdue = '2026-07-01';
    expect(dueTone(overdue, overdue)).toBe('amber'); // the broken framing
    expect(dueTone(overdue, today)).toBe('risk'); // the correct framing
  });
});
