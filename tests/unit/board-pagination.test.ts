import { describe, expect, it } from 'vitest';

import { fetchAllGrantPages } from '../../client/pages/PortfolioPage';
import type { Paginated } from '../../shared/types';

/** A fake paginated server over `total` numbered records. */
function makeServer(total: number, pageSize: number) {
  const calls: number[] = [];
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const fetchPage = (page: number): Promise<Paginated<number>> => {
    calls.push(page);
    const start = (page - 1) * pageSize;
    const items = Array.from({ length: Math.max(0, Math.min(pageSize, total - start)) }, (_, i) => start + i);
    return Promise.resolve({ items, total, page, pageSize, pageCount });
  };
  return { calls, fetchPage };
}

describe('fetchAllGrantPages', () => {
  it('returns a single page without extra requests', async () => {
    const server = makeServer(8, 100);
    const result = await fetchAllGrantPages(server.fetchPage);
    expect(server.calls).toEqual([1]);
    expect(result.items).toHaveLength(8);
    expect(result.total).toBe(8);
  });

  it('walks every page until the reported total is loaded', async () => {
    const server = makeServer(250, 100);
    const result = await fetchAllGrantPages(server.fetchPage);
    expect(server.calls).toEqual([1, 2, 3]);
    expect(result.items).toHaveLength(250);
    expect(result.total).toBe(250);
    // No record dropped or duplicated across page boundaries.
    expect(new Set(result.items).size).toBe(250);
    expect(result.items[0]).toBe(0);
    expect(result.items[249]).toBe(249);
  });

  it('loads exactly the total when it lands on a page boundary', async () => {
    const server = makeServer(200, 100);
    const result = await fetchAllGrantPages(server.fetchPage);
    expect(server.calls).toEqual([1, 2]);
    expect(result.items).toHaveLength(200);
  });

  it('stops instead of spinning when a page comes back empty mid-walk', async () => {
    // Simulates records deleted between page fetches: page 2 is suddenly empty.
    const server = makeServer(250, 100);
    const flaky = (page: number): Promise<Paginated<number>> =>
      page === 2
        ? Promise.resolve({ items: [], total: 250, page, pageSize: 100, pageCount: 3 })
        : server.fetchPage(page);
    const result = await fetchAllGrantPages(flaky);
    expect(result.items).toHaveLength(100);
    // The honest count is what was actually loaded, not the stale server total.
    expect(result.total).toBe(100);
  });
});
