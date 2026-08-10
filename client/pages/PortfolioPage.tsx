import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Columns3, Download, LayoutList, Plus, Search, X } from 'lucide-react';

import { BRAND } from '../../shared/brand';
import {
  GRANT_STATUSES,
  GRANT_STATUS_LABELS,
  GRANT_STAGE_LABELS,
  HEALTH_LABELS,
  HEALTH_LEVELS,
  STATUS_STAGE,
  type GrantStatus,
} from '../../shared/constants';
import type { GrantListItem, Paginated } from '../../shared/types';
import { api, buildQuery, downloadFile } from '../lib/api';
import { useCurrentSession, useSession } from '../lib/session';
import { useToast } from '../lib/toast';
import {
  dueTone,
  formatCents,
  formatCentsCompact,
  formatIsoDate,
  healthTone,
  relativeDueLabel,
  statusTone,
} from '../lib/format';
import { useLookups, GrantFormDialog } from '../components/GrantFormDialog';
import { Badge, Card, EmptyState, ErrorState, LoadingState, Progress, StatusPill } from '../components/ui';

type SortKey = 'title' | 'funder' | 'status' | 'awarded' | 'deadline' | 'readiness' | 'health' | 'updated';

const COLUMNS: Array<{ key: SortKey; label: string; numeric?: boolean }> = [
  { key: 'title', label: 'Grant' },
  { key: 'funder', label: 'Funder' },
  { key: 'status', label: 'Status' },
  { key: 'awarded', label: 'Awarded', numeric: true },
  { key: 'deadline', label: 'Next deadline' },
  { key: 'readiness', label: 'Readiness', numeric: true },
  { key: 'health', label: 'Health' },
];

/** Largest pageSize the server accepts (see grantQuerySchema in server/lib/validation.ts). */
const MAX_PAGE_SIZE = 100;

/**
 * The board has no pager, so it must walk every server page until the reported
 * total is loaded — otherwise records past the first page silently vanish.
 * Exported for unit tests.
 */
export async function fetchAllGrantPages<T>(
  fetchPage: (page: number) => Promise<Paginated<T>>,
): Promise<{ items: T[]; total: number }> {
  const first = await fetchPage(1);
  const items = [...first.items];
  for (let page = 2; page <= first.pageCount && items.length < first.total; page += 1) {
    const next = await fetchPage(page);
    // Records deleted mid-walk can empty a page early; stop rather than spin.
    if (next.items.length === 0) break;
    items.push(...next.items);
  }
  return { items, total: items.length };
}

export function PortfolioPage() {
  const session = useCurrentSession();
  const { can } = useSession();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const { data: lookups } = useLookups();

  const [view, setView] = useState<'table' | 'board'>(() =>
    (localStorage.getItem('meridian.portfolio.view') as 'table' | 'board' | null) ?? 'table',
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [searchDraft, setSearchDraft] = useState(params.get('q') ?? '');

  useEffect(() => {
    document.title = `Grants · ${BRAND.titleSuffix}`;
  }, []);

  useEffect(() => {
    localStorage.setItem('meridian.portfolio.view', view);
  }, [view]);

  // Debounce the free-text search so typing does not fire a request per keystroke.
  useEffect(() => {
    const handle = window.setTimeout(() => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (searchDraft.trim()) next.set('q', searchDraft.trim());
          else next.delete('q');
          next.delete('page');
          return next;
        },
        { replace: true },
      );
    }, 260);
    return () => window.clearTimeout(handle);
  }, [searchDraft, setParams]);

  const query = useMemo(
    () => ({
      q: params.get('q') ?? '',
      status: params.get('status') ?? '',
      health: params.get('health') ?? '',
      ownerUserId: params.get('ownerUserId') ?? '',
      funderId: params.get('funderId') ?? '',
      stage: params.get('stage') ?? '',
      dueBefore: params.get('dueBefore') ?? '',
      includeArchived: params.get('includeArchived') === 'true',
      sort: (params.get('sort') as SortKey) ?? 'deadline',
      dir: (params.get('dir') as 'asc' | 'desc') ?? 'asc',
      page: Number(params.get('page') ?? '1'),
      pageSize: 25,
    }),
    [params],
  );

  const queryString = buildQuery({ ...query, includeArchived: query.includeArchived || undefined });

  const tableQuery = useQuery({
    queryKey: ['grants', queryString],
    queryFn: () => api.get<Paginated<GrantListItem>>(`/grants${queryString}`),
    placeholderData: keepPreviousData,
    enabled: view === 'table',
  });

  // The board shows the whole filtered portfolio at once, so it ignores the
  // table's page param and accumulates every server page instead.
  const boardFilters = useMemo(
    () => ({
      q: query.q,
      status: query.status,
      health: query.health,
      ownerUserId: query.ownerUserId,
      funderId: query.funderId,
      stage: query.stage,
      dueBefore: query.dueBefore,
      includeArchived: query.includeArchived || undefined,
      sort: query.sort,
      dir: query.dir,
    }),
    [query],
  );

  const boardQuery = useQuery({
    queryKey: ['grants', 'board', buildQuery(boardFilters)],
    queryFn: () =>
      fetchAllGrantPages((page) =>
        api.get<Paginated<GrantListItem>>(`/grants${buildQuery({ ...boardFilters, page, pageSize: MAX_PAGE_SIZE })}`),
      ),
    enabled: view === 'board',
  });

  const data = tableQuery.data;
  const board = boardQuery.data;
  const isLoading = view === 'board' ? boardQuery.isLoading : tableQuery.isLoading;
  const isError = view === 'board' ? boardQuery.isError : tableQuery.isError;
  const refetch = view === 'board' ? boardQuery.refetch : tableQuery.refetch;
  const isFetching = tableQuery.isFetching;
  const itemsInView = view === 'board' ? board?.items : data?.items;

  const setParam = (key: string, value: string | null) => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        if (key !== 'page') next.delete('page');
        return next;
      },
      { replace: true },
    );
  };

  const toggleSort = (key: SortKey) => {
    if (query.sort === key) {
      setParam('dir', query.dir === 'asc' ? 'desc' : 'asc');
    } else {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set('sort', key);
          next.set('dir', key === 'awarded' || key === 'readiness' ? 'desc' : 'asc');
          next.delete('page');
          return next;
        },
        { replace: true },
      );
    }
  };

  const activeFilters = useMemo(() => {
    const chips: Array<{ key: string; label: string }> = [];
    if (query.status) chips.push({ key: 'status', label: `Status: ${GRANT_STATUS_LABELS[query.status as GrantStatus] ?? query.status}` });
    if (query.stage) chips.push({ key: 'stage', label: `Stage: ${GRANT_STAGE_LABELS[query.stage as keyof typeof GRANT_STAGE_LABELS] ?? query.stage}` });
    if (query.health) chips.push({ key: 'health', label: `Health: ${HEALTH_LABELS[query.health as keyof typeof HEALTH_LABELS] ?? query.health}` });
    if (query.ownerUserId) {
      const owner = lookups?.members.find((m) => m.id === query.ownerUserId);
      chips.push({ key: 'ownerUserId', label: `Owner: ${owner?.name ?? (query.ownerUserId === 'unassigned' ? 'Unassigned' : 'Selected')}` });
    }
    if (query.funderId) {
      const funder = lookups?.funders.find((f) => f.id === query.funderId);
      chips.push({ key: 'funderId', label: `Funder: ${funder?.name ?? 'Selected'}` });
    }
    if (query.dueBefore) chips.push({ key: 'dueBefore', label: `Deadline before ${formatIsoDate(query.dueBefore)}` });
    if (query.includeArchived) chips.push({ key: 'includeArchived', label: 'Including archived' });
    return chips;
  }, [query, lookups]);

  const exportCsv = async () => {
    try {
      await downloadFile(`/grants/export.csv${queryString}`, 'grant-portfolio.csv');
      toast.success('Portfolio exported.');
    } catch {
      toast.error('The export could not be generated.');
    }
  };

  return (
    <>
      <header className="page-header">
        <div className="page-header__text">
          <p className="page-header__eyebrow">Portfolio</p>
          <h1 className="page-header__title">Grants</h1>
          <p className="page-header__lede">
            Every prospect, award and closeout in {session.organization.name}, with the next deadline and the reason
            behind each health signal.
          </p>
        </div>
        <div className="page-header__actions">
          <div className="row" role="group" aria-label="View mode">
            <button
              type="button"
              className={`btn btn--sm ${view === 'table' ? 'btn--primary' : ''}`}
              aria-pressed={view === 'table'}
              onClick={() => setView('table')}
            >
              <LayoutList size={15} aria-hidden="true" />
              Table
            </button>
            <button
              type="button"
              className={`btn btn--sm ${view === 'board' ? 'btn--primary' : ''}`}
              aria-pressed={view === 'board'}
              onClick={() => setView('board')}
            >
              <Columns3 size={15} aria-hidden="true" />
              Board
            </button>
          </div>
          <button type="button" className="btn" onClick={() => void exportCsv()}>
            <Download size={16} aria-hidden="true" />
            Export CSV
          </button>
          {can('grants:write') && (
            <button type="button" className="btn btn--primary" onClick={() => setCreateOpen(true)}>
              <Plus size={16} aria-hidden="true" />
              New grant
            </button>
          )}
        </div>
      </header>

      <div className="stack stack-4">
        <div className="toolbar">
          <div className="toolbar__search">
            <Search size={16} className="toolbar__search-icon" aria-hidden="true" />
            <label className="visually-hidden" htmlFor="portfolio-search">
              Search grants
            </label>
            <input
              id="portfolio-search"
              className="input"
              type="search"
              placeholder="Search grant, program, funder or owner…"
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
            />
          </div>

          <label className="visually-hidden" htmlFor="filter-status">
            Filter by status
          </label>
          <select
            id="filter-status"
            className="select"
            style={{ width: 'auto' }}
            value={query.status}
            onChange={(event) => setParam('status', event.target.value || null)}
          >
            <option value="">All statuses</option>
            {GRANT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {GRANT_STATUS_LABELS[status]}
              </option>
            ))}
          </select>

          <label className="visually-hidden" htmlFor="filter-health">
            Filter by health
          </label>
          <select
            id="filter-health"
            className="select"
            style={{ width: 'auto' }}
            value={query.health}
            onChange={(event) => setParam('health', event.target.value || null)}
          >
            <option value="">All health</option>
            {HEALTH_LEVELS.map((level) => (
              <option key={level} value={level}>
                {HEALTH_LABELS[level]}
              </option>
            ))}
          </select>

          <label className="visually-hidden" htmlFor="filter-owner">
            Filter by owner
          </label>
          <select
            id="filter-owner"
            className="select"
            style={{ width: 'auto' }}
            value={query.ownerUserId}
            onChange={(event) => setParam('ownerUserId', event.target.value || null)}
          >
            <option value="">All owners</option>
            <option value="unassigned">Unassigned</option>
            {(lookups?.members ?? []).map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>

          <label className="visually-hidden" htmlFor="filter-funder">
            Filter by funder
          </label>
          <select
            id="filter-funder"
            className="select"
            style={{ width: 'auto' }}
            value={query.funderId}
            onChange={(event) => setParam('funderId', event.target.value || null)}
          >
            <option value="">All funders</option>
            {(lookups?.funders ?? []).map((funder) => (
              <option key={funder.id} value={funder.id}>
                {funder.name}
              </option>
            ))}
          </select>

          <label className="visually-hidden" htmlFor="filter-due">
            Deadline before
          </label>
          <input
            id="filter-due"
            className="input"
            style={{ width: 'auto' }}
            type="date"
            value={query.dueBefore}
            onChange={(event) => setParam('dueBefore', event.target.value || null)}
            aria-label="Next deadline before"
          />

          <label className="checkbox">
            <input
              type="checkbox"
              checked={query.includeArchived}
              onChange={(event) => setParam('includeArchived', event.target.checked ? 'true' : null)}
            />
            <span className="small">Archived</span>
          </label>
        </div>

        {activeFilters.length > 0 && (
          <div className="row row-wrap" role="status">
            <span className="muted small">Filters:</span>
            {activeFilters.map((chip) => (
              <span key={chip.key} className="chip">
                {chip.label}
                <button
                  type="button"
                  className="chip__remove"
                  onClick={() => setParam(chip.key, null)}
                  aria-label={`Remove filter ${chip.label}`}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </span>
            ))}
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => {
                setSearchDraft('');
                setParams(new URLSearchParams(), { replace: true });
              }}
            >
              Clear all
            </button>
          </div>
        )}

        {isLoading && (
          <div className="card">
            <LoadingState label={view === 'board' ? 'Loading the full portfolio…' : 'Loading portfolio…'} />
          </div>
        )}

        {isError && (
          <div className="card">
            <ErrorState onRetry={() => void refetch()} />
          </div>
        )}

        {itemsInView && itemsInView.length === 0 && (
          <div className="card">
            <EmptyState
              title={activeFilters.length > 0 || query.q ? 'No grants match these filters' : 'No grants yet'}
              description={
                activeFilters.length > 0 || query.q
                  ? 'Try widening the filters, or clear them to see the whole portfolio.'
                  : 'Add your first grant to start tracking deadlines, budgets and reporting evidence.'
              }
              action={
                activeFilters.length > 0 || query.q ? (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setSearchDraft('');
                      setParams(new URLSearchParams(), { replace: true });
                    }}
                  >
                    Clear filters
                  </button>
                ) : can('grants:write') ? (
                  <button type="button" className="btn btn--primary" onClick={() => setCreateOpen(true)}>
                    <Plus size={16} aria-hidden="true" />
                    New grant
                  </button>
                ) : undefined
              }
            />
          </div>
        )}

        {view === 'table' && data && data.items.length > 0 && (
          <Card flush>
            <div className="table-wrap">
              <table className="table table--fixed">
                <caption className="visually-hidden">
                  Grant portfolio, {data.total} records, sorted by {query.sort} {query.dir === 'asc' ? 'ascending' : 'descending'}
                </caption>
                {/* Explicit widths keep long funder names from starving the other columns. */}
                <colgroup>
                  <col style={{ width: '25%' }} />
                  <col style={{ width: '15%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '13%' }} />
                  <col style={{ width: '18%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '13%' }} />
                </colgroup>
                <thead>
                  <tr>
                    {COLUMNS.map((column) => {
                      const active = query.sort === column.key;
                      return (
                        <th
                          key={column.key}
                          scope="col"
                          className={column.numeric ? 'table__num' : undefined}
                          aria-sort={active ? (query.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                        >
                          <button type="button" className="table__sort" onClick={() => toggleSort(column.key)}>
                            {column.label}
                            {active &&
                              (query.dir === 'asc' ? (
                                <ArrowUp size={13} aria-hidden="true" />
                              ) : (
                                <ArrowDown size={13} aria-hidden="true" />
                              ))}
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((grant) => (
                    <tr key={grant.id}>
                      <td>
                        <Link to={`/grants/${grant.id}`} className="table__primary table__wrap-2 link-plain" title={grant.title}>
                          {grant.title}
                        </Link>
                        <div className="table__meta truncate">
                          {grant.program ?? 'No program'} · {grant.ownerName ?? 'Unassigned'}
                          {grant.archived && ' · Archived'}
                        </div>
                      </td>
                      <td>
                        <Link
                          to={`/funders/${grant.funderId}`}
                          className="link-plain table__wrap-2"
                          title={grant.funderName}
                        >
                          {grant.funderName}
                        </Link>
                      </td>
                      <td>
                        <StatusPill tone={statusTone[grant.status]} label={GRANT_STATUS_LABELS[grant.status]} />
                      </td>
                      <td className="table__num">
                        <span style={{ fontWeight: 600 }}>{formatCents(grant.awardedCents, grant.currency)}</span>
                        {grant.awardedCents === 0 && grant.requestedCents > 0 && (
                          <div className="table__meta">requested {formatCentsCompact(grant.requestedCents, grant.currency)}</div>
                        )}
                      </td>
                      <td>
                        {grant.nextDeadline ? (
                          <>
                            <div>{formatIsoDate(grant.nextDeadline.date)}</div>
                            <div className="table__meta truncate" title={grant.nextDeadline.title}>
                              {grant.nextDeadline.title}
                            </div>
                          </>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="table__num" style={{ minWidth: 120 }}>
                        <div className="row" style={{ justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
                          <span className="numeric">{grant.readiness.percent}%</span>
                          <span style={{ width: 52 }}>
                            <Progress
                              value={grant.readiness.percent}
                              label={`Reporting readiness for ${grant.title}`}
                              tone={grant.readiness.percent >= 70 ? 'accent' : grant.readiness.percent >= 40 ? 'amber' : 'risk'}
                            />
                          </span>
                        </div>
                      </td>
                      <td>
                        <StatusPill tone={healthTone[grant.health.level]} label={HEALTH_LABELS[grant.health.level]} />
                        {/* Only show a reason when it says more than the pill already does. */}
                        {grant.health.reasons[0] && grant.health.reasons[0].severity !== 'GOOD' && (
                          <div className="table__meta truncate" title={grant.health.reasons[0].label}>
                            {grant.health.reasons[0].label}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="pagination">
              <span>
                Showing {(data.page - 1) * data.pageSize + 1}–{Math.min(data.page * data.pageSize, data.total)} of{' '}
                {data.total} {isFetching && <span className="muted">· updating…</span>}
              </span>
              {data.pageCount > 1 && (
                <div className="row">
                  <button
                    type="button"
                    className="btn btn--sm"
                    disabled={data.page <= 1}
                    onClick={() => setParam('page', String(data.page - 1))}
                  >
                    Previous
                  </button>
                  <span className="small">
                    Page {data.page} of {data.pageCount}
                  </span>
                  <button
                    type="button"
                    className="btn btn--sm"
                    disabled={data.page >= data.pageCount}
                    onClick={() => setParam('page', String(data.page + 1))}
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          </Card>
        )}

        {view === 'board' && board && board.items.length > 0 && <BoardView grants={board.items} today={session.today} />}
      </div>

      <GrantFormDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </>
  );
}

function BoardView({ grants, today }: { grants: GrantListItem[]; today: string }) {
  const stages = ['PIPELINE', 'ACTIVE', 'ENDED'] as const;

  return (
    <>
      <p className="muted small">
        Showing all {grants.length} {grants.length === 1 ? 'grant' : 'grants'}. Board view groups the same records by
        lifecycle stage. Open a grant to change its status — status changes always happen through a labelled control,
        never by dragging alone.
      </p>
      <div className="board">
        {stages.map((stage) => {
          const inStage = grants.filter((grant) => STATUS_STAGE[grant.status] === stage);
          return (
            <section className="board__column" key={stage} aria-label={`${GRANT_STAGE_LABELS[stage]} grants`}>
              <header className="board__column-header">
                <h2 className="board__column-title">{GRANT_STAGE_LABELS[stage]}</h2>
                <span className="board__column-count">{inStage.length}</span>
              </header>
              <div className="board__list">
                {inStage.length === 0 && <p className="muted small">No grants in this stage.</p>}
                {inStage.map((grant) => (
                  <Link key={grant.id} to={`/grants/${grant.id}`} className="board__card">
                    <span className="board__card-title">{grant.title}</span>
                    <span className="board__card-meta">
                      {grant.funderName} · {formatCentsCompact(grant.awardedCents || grant.requestedCents, grant.currency)}
                    </span>
                    <span className="board__card-footer">
                      <StatusPill tone={statusTone[grant.status]} label={GRANT_STATUS_LABELS[grant.status]} />
                      <StatusPill tone={healthTone[grant.health.level]} label={HEALTH_LABELS[grant.health.level]} />
                    </span>
                    {grant.nextDeadline && (
                      <span className="board__card-meta" style={{ marginTop: 'var(--space-2)', display: 'block' }}>
                        <Badge tone={dueTone(grant.nextDeadline.date, today)}>
                          {relativeDueLabel(grant.nextDeadline.date, today)}
                        </Badge>
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
