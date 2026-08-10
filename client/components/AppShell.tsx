import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  CalendarDays,
  ChevronRight,
  FileBarChart,
  FolderOpen,
  LayoutDashboard,
  LogOut,
  Menu as MenuIcon,
  Search,
  Settings,
  Users,
  X,
} from 'lucide-react';

import { BRAND } from '../../shared/brand';
import { ROLE_LABELS } from '../../shared/constants';
import type { DashboardPayload, GrantDetail } from '../../shared/types';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { useToast } from '../lib/toast';
import { Avatar } from './ui';
import { CommandPalette, useModalFocus } from './CommandPalette';
import { Dialog } from './Dialog';
import { Menu } from './Menu';

/** Must match the breakpoint at which layout.css turns the sidebar into a drawer. */
const MOBILE_NAV_QUERY = '(max-width: 900px)';

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    setMatches(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

interface NavEntry {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
}

const PRIMARY_NAV: NavEntry[] = [
  { to: '/', label: 'Today', icon: <LayoutDashboard size={17} />, end: true },
  { to: '/grants', label: 'Grants', icon: <FolderOpen size={17} /> },
  { to: '/funders', label: 'Funders', icon: <Building2 size={17} /> },
  { to: '/calendar', label: 'Calendar', icon: <CalendarDays size={17} /> },
  { to: '/reports', label: 'Reports', icon: <FileBarChart size={17} /> },
];

const ORG_NAV: NavEntry[] = [
  { to: '/team', label: 'Team', icon: <Users size={17} /> },
  { to: '/settings', label: 'Settings', icon: <Settings size={17} /> },
];

export function AppShell() {
  const { session, signOut } = useSession();
  const [navOpen, setNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [orgDialogOpen, setOrgDialogOpen] = useState(false);
  const location = useLocation();
  const toast = useToast();
  const queryClient = useQueryClient();

  const isMobileNav = useMediaQuery(MOBILE_NAV_QUERY);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const drawerCloseRef = useRef<HTMLButtonElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  // The sidebar is a modal drawer only while it is off-canvas; at desktop
  // widths it is a static rail and must keep none of this behaviour.
  const onDrawerKeyDown = useModalFocus({
    active: isMobileNav && navOpen,
    containerRef: sidebarRef as React.RefObject<HTMLElement>,
    onClose: () => setNavOpen(false),
    initialFocusRef: drawerCloseRef as React.RefObject<HTMLElement>,
    restoreFocusRef: menuButtonRef as React.RefObject<HTMLElement>,
    inertSelector: '.main',
  });

  const { data: dashboard } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardPayload>('/dashboard'),
    staleTime: 30_000,
  });

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    // A drawer left open across a viewport change would keep `.main` inert.
    if (!isMobileNav) setNavOpen(false);
  }, [isMobileNav]);

  useEffect(() => {
    // Closed at mobile widths the sidebar is merely translated off-canvas, so
    // its links would still be tab-reachable; `inert` removes it from the tab
    // order and the accessibility tree while keeping the slide animation.
    // (React 18.3 has no `inert` prop, hence the imperative attribute.)
    const sidebar = sidebarRef.current;
    if (!sidebar) return;
    if (isMobileNav && !navOpen) sidebar.setAttribute('inert', '');
    else sidebar.removeAttribute('inert');
  }, [isMobileNav, navOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const switchOrg = useMutation({
    mutationFn: (organizationId: string) => api.post('/auth/switch-organization', { organizationId }),
    onSuccess: async () => {
      setOrgDialogOpen(false);
      await queryClient.invalidateQueries();
      toast.success('Switched organization.');
    },
    onError: () => toast.error('Could not switch organization.'),
  });

  if (!session) return null;

  const atRisk = dashboard?.totals.atRiskCount ?? 0;
  const overdue = dashboard?.totals.overdueCount ?? 0;

  return (
    <div className="app">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>

      {navOpen && <button type="button" className="scrim" aria-label="Close navigation" onClick={() => setNavOpen(false)} />}

      {/*
        A plain container, not an <aside>: the meaningful landmark inside is the
        primary <nav>, and a second unlabelled complementary landmark would only
        add noise for screen-reader users.
      */}
      <div className="sidebar" data-open={navOpen} ref={sidebarRef} onKeyDown={onDrawerKeyDown}>
        <div className="sidebar__brand">
          <span className="brandmark" aria-hidden="true">
            {BRAND.monogram}
          </span>
          <span className="sidebar__wordmark">
            <span className="sidebar__name">{BRAND.name}</span>
            <span className="sidebar__descriptor">{BRAND.descriptor}</span>
          </span>
          <button
            type="button"
            ref={drawerCloseRef}
            className="btn btn--ghost btn--icon btn--sm sidebar__close"
            onClick={() => setNavOpen(false)}
            aria-label="Close menu"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="sidebar__search">
          <button type="button" className="search-trigger" onClick={() => setPaletteOpen(true)}>
            <Search size={15} aria-hidden="true" />
            Search…
            <kbd aria-hidden="true">⌘K</kbd>
            <span className="visually-hidden">Open search. Keyboard shortcut: Command or Control plus K.</span>
          </button>
        </div>

        <nav className="nav" aria-label="Primary">
          <ul>
            {PRIMARY_NAV.map((entry) => (
              <li key={entry.to}>
                <NavLink to={entry.to} end={entry.end} className="nav__item">
                  {entry.icon}
                  {entry.label}
                  {entry.to === '/grants' && atRisk > 0 && (
                    <span className="nav__badge nav__badge--risk">
                      {atRisk}
                      <span className="visually-hidden"> grants at risk</span>
                    </span>
                  )}
                  {entry.to === '/' && overdue > 0 && (
                    <span className="nav__badge">
                      {overdue}
                      <span className="visually-hidden"> overdue items</span>
                    </span>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>

          <p className="nav__group-label" id="nav-org-label">
            Organization
          </p>
          <ul aria-labelledby="nav-org-label">
            {ORG_NAV.map((entry) => (
              <li key={entry.to}>
                <NavLink to={entry.to} className="nav__item">
                  {entry.icon}
                  {entry.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="sidebar__footer">
          {session.memberships.length > 1 ? (
            <button type="button" className="org-switch" onClick={() => setOrgDialogOpen(true)}>
              <Avatar name={session.organization.name} nav />
              <span style={{ minWidth: 0, flex: 1 }}>
                <span className="org-switch__name truncate">{session.organization.name}</span>
                <span className="org-switch__role">{ROLE_LABELS[session.role]}</span>
              </span>
              <ChevronRight size={15} aria-hidden="true" />
              <span className="visually-hidden">Switch organization</span>
            </button>
          ) : (
            <div className="org-switch" style={{ cursor: 'default' }}>
              <Avatar name={session.organization.name} nav />
              <span style={{ minWidth: 0 }}>
                <span className="org-switch__name truncate">{session.organization.name}</span>
                <span className="org-switch__role">{ROLE_LABELS[session.role]}</span>
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="main">
        <header className="topbar">
          <button
            type="button"
            ref={menuButtonRef}
            className="btn btn--ghost btn--icon menu-button"
            onClick={() => setNavOpen(true)}
            aria-label="Open navigation"
          >
            <MenuIcon size={19} aria-hidden="true" />
          </button>

          <Breadcrumbs />

          <div className="spacer" />

          <button
            type="button"
            className="btn btn--ghost btn--icon"
            onClick={() => setPaletteOpen(true)}
            aria-label="Search"
          >
            <Search size={17} aria-hidden="true" />
          </button>

          <Menu
            label="Account"
            items={[
              {
                id: 'signout',
                label: 'Sign out',
                icon: <LogOut size={16} />,
                tone: 'danger',
                onSelect: () => {
                  void signOut();
                },
              },
            ]}
            trigger={(props) => (
              <button type="button" className="btn btn--ghost" {...props}>
                <Avatar name={session.user.name} />
                <span className="truncate" style={{ maxWidth: 140 }}>
                  {session.user.name}
                </span>
              </button>
            )}
          />
        </header>

        <main className="content" id="main-content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />

      <Dialog
        open={orgDialogOpen}
        onClose={() => setOrgDialogOpen(false)}
        title="Switch organization"
        description="You belong to more than one organization. Records, roles and settings are kept completely separate."
      >
        <div className="stack stack-2">
          {session.memberships.map((membership) => {
            const active = membership.organizationId === session.organization.id;
            return (
              <button
                key={membership.organizationId}
                type="button"
                className="demo-account"
                disabled={active || switchOrg.isPending}
                onClick={() => switchOrg.mutate(membership.organizationId)}
              >
                <Avatar name={membership.organizationName} large />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="demo-account__name truncate">{membership.organizationName}</span>
                  <span className="demo-account__meta">{ROLE_LABELS[membership.role]}</span>
                </span>
                {active && <span className="badge badge--accent">Current</span>}
              </button>
            );
          })}
        </div>
      </Dialog>
    </div>
  );
}

const CRUMB_LABELS: Record<string, string> = {
  grants: 'Grants',
  funders: 'Funders',
  calendar: 'Calendar',
  reports: 'Reports',
  team: 'Team',
  settings: 'Settings',
  packet: 'Reporting packet',
  new: 'New',
};

/** What a record id under a given section should be called. */
const RECORD_LABELS: Record<string, string> = {
  grants: 'Grant',
  funders: 'Funder',
};

/**
 * Resolve a detail route's record name from the React Query cache. The detail
 * pages own the fetch; subscribing to the same keys with `enabled: false`
 * never issues a request of its own but re-renders the crumb the moment the
 * page's data lands in the cache.
 */
function useRecordName(section: string, recordId: string | undefined): string | undefined {
  // Hooks cannot be conditional, so both observers stay mounted; the one that
  // does not match the current section just watches a key that never fills.
  const grantId = section === 'grants' ? recordId : undefined;
  const funderId = section === 'funders' ? recordId : undefined;

  const { data: grant } = useQuery({
    queryKey: ['grant', grantId ?? ''],
    queryFn: () => api.get<GrantDetail>(`/grants/${grantId ?? ''}`),
    enabled: false,
  });
  // Same shape GrantDetailPage/FunderDetailPage cache; only the name is needed here.
  const { data: funderDetail } = useQuery({
    queryKey: ['funder', funderId ?? ''],
    queryFn: () => api.get<{ funder: { name: string } }>(`/funders/${funderId ?? ''}`),
    enabled: false,
  });

  if (grantId) return grant?.title;
  if (funderId) return funderDetail?.funder.name;
  return undefined;
}

function Breadcrumbs() {
  const location = useLocation();
  const segments = location.pathname.split('/').filter(Boolean);

  // /grants/<id> and /funders/<id>(/…) carry a record id in the second
  // segment; static child segments like "packet" are named in CRUMB_LABELS.
  const section = segments[0] ?? '';
  const recordId =
    RECORD_LABELS[section] && segments[1] && !CRUMB_LABELS[segments[1]!] ? segments[1] : undefined;
  const recordName = useRecordName(section, recordId);

  if (segments.length === 0) {
    return (
      <nav className="topbar__crumbs" aria-label="Breadcrumb">
        <span className="topbar__crumb-current">Today</span>
      </nav>
    );
  }

  return (
    <nav className="topbar__crumbs" aria-label="Breadcrumb">
      <Link to="/">Today</Link>
      {segments.map((segment, index) => {
        const path = `/${segments.slice(0, index + 1).join('/')}`;
        const isLast = index === segments.length - 1;
        // A record id renders as the record's cached name; before the detail
        // page's fetch resolves, fall back to a label derived from the parent
        // section, so /grants/<id> reads as "Grant" rather than an opaque id.
        const parent = index > 0 ? segments[index - 1] : undefined;
        const label =
          CRUMB_LABELS[segment] ??
          (segment === recordId ? recordName : undefined) ??
          RECORD_LABELS[parent ?? ''] ??
          'Detail';
        return (
          <span key={path} className="row" style={{ gap: 'var(--space-2)', minWidth: 0 }}>
            <ChevronRight size={14} aria-hidden="true" />
            {isLast ? (
              <span className="topbar__crumb-current truncate">{label}</span>
            ) : (
              <Link to={path} className="truncate">
                {label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
