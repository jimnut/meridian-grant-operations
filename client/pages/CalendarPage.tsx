import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, ChevronLeft, ChevronRight, List } from 'lucide-react';

import { BRAND } from '../../shared/brand';
import {
  addDays,
  addMonths,
  endOfMonth,
  formatMonthLabel,
  monthKey,
  startOfMonth,
  weekdayIndex,
} from '../../shared/dates';
import type { CalendarEvent } from '../../shared/types';
import { api, buildQuery } from '../lib/api';
import { useCurrentSession } from '../lib/session';
import { dueTone, formatIsoDate, relativeDueLabel } from '../lib/format';
import { useLookups } from '../components/GrantFormDialog';
import { Badge, Card, EmptyState, ErrorState, LoadingState, StatusPill } from '../components/ui';

const KIND_LABELS: Record<CalendarEvent['kind'], string> = {
  TASK: 'Task',
  MILESTONE: 'Deliverable',
  GRANT_END: 'Period end',
  RENEWAL: 'Renewal',
  CLOSEOUT: 'Closeout',
  APPLICATION: 'Application',
  DECISION: 'Decision',
};

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "Tuesday, August 12, 2026" — timezone-free, like every date in shared/dates. */
function formatFullDate(date: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}

/** Up to this many events render in a month cell before the "+N more" toggle. */
const CELL_EVENT_PREVIEW = 3;

export function CalendarPage() {
  const session = useCurrentSession();
  const { data: lookups } = useLookups();
  const [month, setMonth] = useState(() => monthKey(session.today));
  // The month grid needs ~7 comfortable columns; below the layout.css shell
  // breakpoint (900px) the agenda list is the usable default. The toggle still
  // lets phones switch to the month grid deliberately.
  const [view, setView] = useState<'month' | 'agenda'>(() =>
    window.matchMedia('(max-width: 900px)').matches ? 'agenda' : 'month',
  );
  const [kind, setKind] = useState('');
  const [ownerUserId, setOwnerUserId] = useState('');
  const [grantId, setGrantId] = useState('');
  const [includeComplete, setIncludeComplete] = useState(false);
  // Day whose full event list is expanded in the month grid.
  const [expandedDay, setExpandedDay] = useState<string | null>(null);

  useEffect(() => {
    document.title = `Calendar · ${BRAND.titleSuffix}`;
  }, []);

  const range = useMemo(() => {
    if (view === 'agenda') {
      return { from: session.today, to: addDays(session.today, 120) };
    }
    // Pad the month so the grid shows adjacent-month days that fall in the same week.
    return { from: addDays(startOfMonth(month), -7), to: addDays(endOfMonth(month), 7) };
  }, [view, month, session.today]);

  const queryString = buildQuery({
    from: range.from,
    to: range.to,
    kinds: kind || undefined,
    ownerUserId: ownerUserId || undefined,
    grantId: grantId || undefined,
    includeComplete: includeComplete || undefined,
  });

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['calendar', queryString],
    queryFn: () => api.get<{ today: string; events: CalendarEvent[] }>(`/calendar${queryString}`),
  });

  const events = useMemo(() => data?.events ?? [], [data]);
  const today = data?.today ?? session.today;

  const byDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of events) {
      const list = map.get(event.date) ?? [];
      list.push(event);
      map.set(event.date, list);
    }
    return map;
  }, [events]);

  // Six weeks of seven days, so the ARIA rows mirror the visual rows.
  const gridWeeks = useMemo(() => {
    const first = startOfMonth(month);
    const start = addDays(first, -weekdayIndex(first));
    const weeks: string[][] = [];
    for (let week = 0; week < 6; week += 1) {
      weeks.push(Array.from({ length: 7 }, (_, day) => addDays(start, week * 7 + day)));
    }
    return weeks;
  }, [month]);

  // Every event in the 120-day window — the card subtitle reports this count,
  // so it must never be truncated.
  const agendaEvents = useMemo(() => events.filter((event) => event.date >= today), [events, today]);

  // A day expanded in one month or filter set means nothing in another.
  useEffect(() => {
    setExpandedDay(null);
  }, [month, queryString]);

  return (
    <>
      <header className="page-header">
        <div className="page-header__text">
          <p className="page-header__eyebrow">Deadlines</p>
          <h1 className="page-header__title">Calendar</h1>
          <p className="page-header__lede">
            Task deadlines, deliverables, grant period ends, renewals and closeouts in one place. Dates are shown in{' '}
            {session.organization.timezone.replace('_', ' ')}.
          </p>
        </div>
        <div className="page-header__actions">
          <div className="row" role="group" aria-label="Calendar view">
            <button
              type="button"
              className={`btn btn--sm ${view === 'month' ? 'btn--primary' : ''}`}
              aria-pressed={view === 'month'}
              onClick={() => setView('month')}
            >
              <CalendarDays size={15} aria-hidden="true" />
              Month
            </button>
            <button
              type="button"
              className={`btn btn--sm ${view === 'agenda' ? 'btn--primary' : ''}`}
              aria-pressed={view === 'agenda'}
              onClick={() => setView('agenda')}
            >
              <List size={15} aria-hidden="true" />
              Agenda
            </button>
          </div>
        </div>
      </header>

      <div className="stack stack-4">
        <div className="toolbar">
          {view === 'month' && (
            <div className="row">
              <button
                type="button"
                className="btn btn--icon btn--sm"
                onClick={() => setMonth(monthKey(addMonths(startOfMonth(month), -1)))}
                aria-label="Previous month"
              >
                <ChevronLeft size={16} aria-hidden="true" />
              </button>
              <strong style={{ minWidth: 168, textAlign: 'center' }}>{formatMonthLabel(month)}</strong>
              <button
                type="button"
                className="btn btn--icon btn--sm"
                onClick={() => setMonth(monthKey(addMonths(startOfMonth(month), 1)))}
                aria-label="Next month"
              >
                <ChevronRight size={16} aria-hidden="true" />
              </button>
              <button type="button" className="btn btn--sm" onClick={() => setMonth(monthKey(session.today))}>
                Today
              </button>
            </div>
          )}

          <div className="spacer" />

          <label className="visually-hidden" htmlFor="calendar-kind">
            Filter by type
          </label>
          <select id="calendar-kind" className="select" style={{ width: 'auto' }} value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">All types</option>
            {Object.entries(KIND_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>

          <label className="visually-hidden" htmlFor="calendar-owner">
            Filter by owner
          </label>
          <select
            id="calendar-owner"
            className="select"
            style={{ width: 'auto' }}
            value={ownerUserId}
            onChange={(e) => setOwnerUserId(e.target.value)}
          >
            <option value="">All owners</option>
            {(lookups?.members ?? []).map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>

          <label className="visually-hidden" htmlFor="calendar-grant">
            Filter by grant
          </label>
          <select
            id="calendar-grant"
            className="select"
            style={{ width: 'auto', maxWidth: 240 }}
            value={grantId}
            onChange={(e) => setGrantId(e.target.value)}
          >
            <option value="">All grants</option>
            {(lookups?.grants ?? []).map((grant) => (
              <option key={grant.id} value={grant.id}>
                {grant.title}
              </option>
            ))}
          </select>

          <label className="checkbox">
            <input type="checkbox" checked={includeComplete} onChange={(e) => setIncludeComplete(e.target.checked)} />
            <span className="small">Show completed</span>
          </label>
        </div>

        {isLoading && (
          <div className="card">
            <LoadingState label="Loading deadlines…" />
          </div>
        )}
        {isError && (
          <div className="card">
            <ErrorState onRetry={() => void refetch()} />
          </div>
        )}

        {data && view === 'month' && (
          <Card flush>
            <div className="calendar" role="grid" aria-label={`${formatMonthLabel(month)} deadlines`}>
              <div className="calendar__row" role="row">
                {WEEKDAYS.map((day) => (
                  <div className="calendar__weekday" role="columnheader" key={day}>
                    <span aria-hidden="true">{day.slice(0, 3)}</span>
                    <span className="visually-hidden">{day}</span>
                  </div>
                ))}
              </div>
              {gridWeeks.map((week) => (
                <div className="calendar__row" role="row" key={week[0]}>
                  {week.map((day) => {
                    const dayEvents = byDate.get(day) ?? [];
                    const inMonth = day.slice(0, 7) === month;
                    const isToday = day === today;
                    const expanded = expandedDay === day;
                    const hiddenCount = dayEvents.length - CELL_EVENT_PREVIEW;
                    const visibleEvents = expanded ? dayEvents : dayEvents.slice(0, CELL_EVENT_PREVIEW);
                    return (
                      <div
                        key={day}
                        role="gridcell"
                        aria-label={`${formatFullDate(day)}${isToday ? ', today' : ''}, ${
                          dayEvents.length === 0
                            ? 'no deadlines'
                            : `${dayEvents.length} ${dayEvents.length === 1 ? 'deadline' : 'deadlines'}`
                        }`}
                        className={`calendar__cell${inMonth ? '' : ' calendar__cell--muted'}${isToday ? ' calendar__cell--today' : ''}`}
                      >
                        <div className="calendar__daynum numeric" aria-hidden="true">
                          {Number(day.slice(8, 10))}
                        </div>
                        {visibleEvents.map((event) => (
                          <Link
                            key={event.id}
                            to={`/grants/${event.grantId}`}
                            className={`calendar__event${
                              event.complete
                                ? ' calendar__event--done'
                                : day < today
                                  ? ' calendar__event--risk'
                                  : day <= addDays(today, 14)
                                    ? ' calendar__event--amber'
                                    : ''
                            }`}
                            title={`${event.title} — ${event.grantTitle}`}
                          >
                            {event.title}
                          </Link>
                        ))}
                        {hiddenCount > 0 && (
                          <button
                            type="button"
                            className="calendar__more"
                            aria-expanded={expanded}
                            onClick={() => setExpandedDay(expanded ? null : day)}
                          >
                            {expanded ? 'Show fewer' : `+${hiddenCount} more`}
                            <span className="visually-hidden"> deadlines on {formatFullDate(day)}</span>
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>

            <div className="card__footer">
              <p className="small muted">
                {events.length} {events.length === 1 ? 'deadline' : 'deadlines'} in view. Overdue items are outlined in
                red and labelled, items due within 14 days in amber. Switch to Agenda for a screen-reader friendly list.
              </p>
            </div>
          </Card>
        )}

        {data && view === 'agenda' && (
          <Card title="Next 120 days" subtitle={`${agendaEvents.length} upcoming deadlines`} flush>
            {agendaEvents.length === 0 ? (
              <EmptyState title="Nothing scheduled" description="No deadlines match these filters." compact />
            ) : (
              <div className="divider-y">
                {agendaEvents.map((event) => (
                  <Link key={event.id} to={`/grants/${event.grantId}`} className="list-row link-plain">
                    <div style={{ width: 96, flex: 'none' }}>
                      <div style={{ fontWeight: 600 }}>{formatIsoDate(event.date)}</div>
                      <Badge tone={dueTone(event.date, today, event.complete)}>{relativeDueLabel(event.date, today)}</Badge>
                    </div>
                    <div className="list-row__body">
                      <div className="list-row__title">{event.title}</div>
                      <p className="list-row__meta">
                        {event.grantTitle} · {event.funderName} · {event.ownerName ?? 'Unassigned'}
                      </p>
                    </div>
                    <div className="list-row__actions">
                      <Badge tone="plain">{KIND_LABELS[event.kind]}</Badge>
                      <StatusPill tone={event.complete ? 'positive' : 'plain'} label={event.statusLabel} />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
