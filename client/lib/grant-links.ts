import type { AttentionItem, CalendarEvent } from '../../shared/types';

function grantHref(grantId: string, tab?: 'tasks' | 'deliverables' | 'budget'): string {
  const base = `/grants/${encodeURIComponent(grantId)}`;
  return tab ? `${base}?tab=${tab}` : base;
}

/** Send a risk signal to the part of the grant record where it can be acted on. */
export function attentionGrantHref(item: AttentionItem): string {
  if (item.kind === 'TASKS_OVERDUE' || item.kind === 'TASK_OVERDUE_SINGLE') {
    return grantHref(item.grantId, 'tasks');
  }
  if (item.kind === 'BURN_AHEAD' || item.kind === 'BURN_BEHIND') {
    return grantHref(item.grantId, 'budget');
  }
  if (
    item.kind === 'MILESTONE_OVERDUE' ||
    item.kind === 'EVIDENCE_GAP_URGENT' ||
    item.kind === 'EVIDENCE_GAP' ||
    item.kind === 'PERIOD_ENDED_OPEN' ||
    item.kind === 'CLOSEOUT_OPEN' ||
    item.kind === 'ENDED_WITH_OPEN_WORK' ||
    item.kind === 'RENEWAL_UNPLANNED'
  ) {
    return grantHref(item.grantId, 'deliverables');
  }
  return grantHref(item.grantId);
}

/** Calendar rows deep-link to the matching work type instead of the overview. */
export function calendarGrantHref(event: CalendarEvent): string {
  if (event.kind === 'TASK') return grantHref(event.grantId, 'tasks');
  if (event.kind === 'MILESTONE') return grantHref(event.grantId, 'deliverables');
  return grantHref(event.grantId);
}
