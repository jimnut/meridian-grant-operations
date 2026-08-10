import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Building2, CalendarDays, FileText, LayoutDashboard, Search, Settings, Users } from 'lucide-react';

import { api } from '../lib/api';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal focus behaviour shared by the palette and the mobile navigation
 * drawer, mirroring Dialog.tsx (which owns the pattern but renders its own
 * chrome, so it cannot be reused for these surfaces). While `active`: focus
 * moves into the container, the background is inert, body scroll is locked,
 * and closing restores focus. Spread the returned handler on the container so
 * Escape and the Tab trap apply to the whole layer, not just one input.
 */
export function useModalFocus({
  active,
  containerRef,
  onClose,
  initialFocusRef,
  restoreFocusRef,
  inertSelector,
}: {
  /** Modal behaviour engages only while true (e.g. drawer at mobile widths). */
  active: boolean;
  /** Container whose focusables define the trap. */
  containerRef: React.RefObject<HTMLElement>;
  onClose: () => void;
  /** Receives focus on open; defaults to the container's first focusable. */
  initialFocusRef?: React.RefObject<HTMLElement>;
  /** Receives focus on close; defaults to whatever was focused before opening. */
  restoreFocusRef?: React.RefObject<HTMLElement>;
  /** Background made inert (unfocusable, hidden from assistive tech) while active. */
  inertSelector: string;
}): (event: React.KeyboardEvent) => void {
  const previousFocus = useRef<HTMLElement | null>(null);

  /*
   * Same ref indirection as Dialog.tsx: the effect below must depend on
   * `active` alone, or a fresh `onClose` arrow function on every parent
   * render would re-run it and drag focus around mid-interaction.
   */
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const initialFocusStore = useRef(initialFocusRef);
  initialFocusStore.current = initialFocusRef;
  const restoreFocusStore = useRef(restoreFocusRef);
  restoreFocusStore.current = restoreFocusRef;

  const focusables = useCallback(
    () =>
      Array.from(containerRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      ),
    [containerRef],
  );

  useEffect(() => {
    if (!active) return undefined;

    previousFocus.current = document.activeElement as HTMLElement | null;

    // React 18.3 has no `inert` prop, so flag the background imperatively.
    const inertTargets = Array.from(document.querySelectorAll<HTMLElement>(inertSelector));
    for (const el of inertTargets) el.setAttribute('inert', '');

    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    const focusTarget =
      initialFocusStore.current?.current ??
      containerRef.current?.querySelector<HTMLElement>(FOCUSABLE) ??
      containerRef.current;
    // Wait a frame so the element exists and animations do not swallow focus.
    // If focus already landed inside by then, do not steal it mid-interaction.
    const raf = requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== containerRef.current && containerRef.current?.contains(active)) {
        return;
      }
      focusTarget?.focus();
    });

    return () => {
      cancelAnimationFrame(raf);
      for (const el of inertTargets) el.removeAttribute('inert');
      document.body.style.overflow = overflow;
      (restoreFocusStore.current?.current ?? previousFocus.current)?.focus?.();
    };
  }, [active, containerRef, inertSelector]);

  return (event: React.KeyboardEvent) => {
    if (!active) return;
    if (event.key === 'Escape') {
      event.stopPropagation();
      onCloseRef.current();
      return;
    }
    if (event.key !== 'Tab') return;

    const items = focusables();
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
}

interface SearchResults {
  grants: Array<{ type: 'grant'; id: string; title: string; subtitle: string }>;
  funders: Array<{ type: 'funder'; id: string; title: string; subtitle: string }>;
}

interface PaletteEntry {
  id: string;
  label: string;
  hint?: string;
  group: string;
  icon: React.ReactNode;
  to: string;
}

const PAGES: PaletteEntry[] = [
  { id: 'page-today', label: 'Today', group: 'Go to', icon: <LayoutDashboard size={16} />, to: '/' },
  { id: 'page-grants', label: 'Grants portfolio', group: 'Go to', icon: <FileText size={16} />, to: '/grants' },
  { id: 'page-funders', label: 'Funders', group: 'Go to', icon: <Building2 size={16} />, to: '/funders' },
  { id: 'page-calendar', label: 'Calendar', group: 'Go to', icon: <CalendarDays size={16} />, to: '/calendar' },
  { id: 'page-reports', label: 'Reports', group: 'Go to', icon: <FileText size={16} />, to: '/reports' },
  { id: 'page-team', label: 'Team', group: 'Go to', icon: <Users size={16} />, to: '/team' },
  { id: 'page-settings', label: 'Settings', group: 'Go to', icon: <Settings size={16} />, to: '/settings' },
];

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const trimmed = query.trim();

  const { data, isError, isFetching, refetch } = useQuery({
    queryKey: ['search', trimmed],
    queryFn: () => api.get<SearchResults>(`/search?q=${encodeURIComponent(trimmed)}`),
    enabled: open && trimmed.length >= 2,
    staleTime: 20_000,
    // Fail fast: a typeahead that silently retries just looks like "no matches".
    retry: false,
  });

  // The palette portals to <body>, so `#root` (the whole app) is the background.
  const onPaletteKeyDown = useModalFocus({
    active: open,
    containerRef: paletteRef as React.RefObject<HTMLElement>,
    onClose,
    initialFocusRef: inputRef as React.RefObject<HTMLElement>,
    inertSelector: '#root',
  });

  const entries = useMemo<PaletteEntry[]>(() => {
    const pages = PAGES.filter((page) => page.label.toLowerCase().includes(trimmed.toLowerCase()));
    const grants = (data?.grants ?? []).map<PaletteEntry>((hit) => ({
      id: `grant-${hit.id}`,
      label: hit.title,
      hint: hit.subtitle,
      group: 'Grants',
      icon: <FileText size={16} />,
      to: `/grants/${hit.id}`,
    }));
    const funders = (data?.funders ?? []).map<PaletteEntry>((hit) => ({
      id: `funder-${hit.id}`,
      label: hit.title,
      hint: hit.subtitle,
      group: 'Funders',
      icon: <Building2 size={16} />,
      to: `/funders/${hit.id}`,
    }));
    return [...grants, ...funders, ...pages];
  }, [data, trimmed]);

  useEffect(() => {
    setActiveIndex(0);
  }, [trimmed, data]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  if (!open) return null;

  const select = (entry: PaletteEntry | undefined) => {
    if (!entry) return;
    onClose();
    navigate(entry.to);
  };

  const onInputKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((i) => (entries.length === 0 ? 0 : (i + 1) % entries.length));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((i) => (entries.length === 0 ? 0 : (i - 1 + entries.length) % entries.length));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      select(entries[activeIndex]);
    }
  };

  let lastGroup = '';

  return createPortal(
    <div
      className="palette-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Search Meridian"
        ref={paletteRef}
        onKeyDown={onPaletteKeyDown}
      >
        <div className="palette__input-row">
          <Search size={18} aria-hidden="true" style={{ color: 'var(--ink-400)' }} />
          <input
            ref={inputRef}
            className="palette__input"
            type="text"
            placeholder="Search grants, funders and pages…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onInputKeyDown}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            aria-activedescendant={entries[activeIndex] ? `palette-${entries[activeIndex]!.id}` : undefined}
            aria-autocomplete="list"
            autoComplete="off"
          />
        </div>

        {/* Persistent politely-live region so search state changes are announced. */}
        <div className="palette__status" aria-live="polite">
          {isError ? (
            <>
              <span>Search is unavailable right now — record results may be missing.</span>
              <button type="button" className="btn btn--sm" onClick={() => void refetch()}>
                Retry
              </button>
            </>
          ) : isFetching ? (
            <span>Searching…</span>
          ) : entries.length === 0 ? (
            <span>
              {trimmed.length >= 2 ? `No matches for “${trimmed}”.` : 'Type at least two characters to search records.'}
            </span>
          ) : null}
        </div>

        <div className="palette__results" id="palette-results" role="listbox" aria-label="Results">
          {entries.map((entry, index) => {
            const showGroup = entry.group !== lastGroup;
            lastGroup = entry.group;
            return (
              <div key={entry.id}>
                {showGroup && <p className="palette__group-label">{entry.group}</p>}
                <button
                  type="button"
                  id={`palette-${entry.id}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  className="palette__item"
                  data-active={index === activeIndex}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => select(entry)}
                >
                  {entry.icon}
                  <span className="truncate">{entry.label}</span>
                  {entry.hint && <span className="palette__item-sub truncate">{entry.hint}</span>}
                </button>
              </div>
            );
          })}
        </div>

        <p className="palette__footer">
          <kbd>↑</kbd> <kbd>↓</kbd> to navigate · <kbd>Enter</kbd> to open · <kbd>Esc</kbd> to close
        </p>
      </div>
    </div>,
    document.body,
  );
}
