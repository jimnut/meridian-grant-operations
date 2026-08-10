import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { UTF8_BOM } from '../../shared/csv';
import { createTestContext, DEMO_USERS, post, seedContext, signIn, type Client, type TestContext } from '../helpers/context';

let context: TestContext;
let owner: Client;
let viewer: Client;

/** Split a CSV body into rows, honouring quoted fields that contain newlines. */
function parseCsv(body: string): string[][] {
  const text = body.startsWith(UTF8_BOM) ? body.slice(1) : body;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\r') {
      // handled with the following \n
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

beforeAll(async () => {
  context = createTestContext();
  await seedContext(context);
  owner = await signIn(context.app, DEMO_USERS.owner);
  viewer = await signIn(context.app, DEMO_USERS.viewer);
});

afterAll(() => context.cleanup());

describe('portfolio CSV export', () => {
  it('returns a downloadable CSV with a BOM and a dated filename', async () => {
    const response = await owner.agent.get('/api/grants/export.csv');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-disposition']).toMatch(
      /attachment; filename="riverbend-grant-portfolio-\d{4}-\d{2}-\d{2}\.csv"/,
    );
    expect(response.text.startsWith(UTF8_BOM)).toBe(true);
  });

  it('includes a header row and one row per grant in the filtered view', async () => {
    const list = await owner.agent.get('/api/grants?pageSize=100');
    const csv = await owner.agent.get('/api/grants/export.csv');
    const rows = parseCsv(csv.text);

    expect(rows[0]).toContain('Grant');
    expect(rows[0]).toContain('Awarded');
    expect(rows[0]).toContain('Health');
    expect(rows.length - 1).toBe(list.body.total);
  });

  it('honours the same filters as the table', async () => {
    const csv = await owner.agent.get('/api/grants/export.csv?status=REPORTING');
    const rows = parseCsv(csv.text).slice(1);
    const list = await owner.agent.get('/api/grants?status=REPORTING&pageSize=100');
    expect(rows.length).toBe(list.body.total);
    expect(rows.every((row) => row[3] === 'Reporting')).toBe(true);
  });

  it('writes money as plain decimal strings, not floats', async () => {
    const rows = parseCsv((await owner.agent.get('/api/grants/export.csv')).text);
    const header = rows[0]!;
    const awardedIndex = header.indexOf('Awarded');
    for (const row of rows.slice(1)) {
      expect(row[awardedIndex]).toMatch(/^\d+\.\d{2}$/);
    }
  });

  it('quotes and neutralises hostile funder text without corrupting the row count', async () => {
    const hostileName = ['=', 'HYPERLINK("http://example.test","Click, "" now")'].join('');
    const funder = await post(owner, '/api/funders').send({ name: hostileName, type: 'CORPORATE' });
    expect(funder.status).toBe(201);

    await post(owner, '/api/grants').send({
      title: 'Grant with a hostile funder name',
      funderId: funder.body.id,
      status: 'PROSPECT',
      requestedCents: '1000',
    });

    const csv = await owner.agent.get('/api/grants/export.csv');
    const rows = parseCsv(csv.text);
    const list = await owner.agent.get('/api/grants?pageSize=100');
    expect(rows.length - 1).toBe(list.body.total);

    const row = rows.find((r) => r[0] === 'Grant with a hostile funder name');
    expect(row).toBeDefined();
    // The parsed value keeps every character but is prefixed so no spreadsheet evaluates it.
    expect(row![2]).toBe(`'${hostileName}`);
    // The raw text keeps the doubled quotes required by RFC 4180.
    expect(csv.text).toContain('""');
  });

  it('keeps a grant title containing a newline on a single logical row', async () => {
    const funderId = (
      context.db.prepare("SELECT id FROM funders WHERE name = 'Alder Point Foundation'").get() as { id: string }
    ).id;
    await post(owner, '/api/grants').send({
      title: 'Multi\nline title',
      funderId,
      status: 'PROSPECT',
      requestedCents: '500',
    });

    const csv = await owner.agent.get('/api/grants/export.csv');
    const rows = parseCsv(csv.text);
    const list = await owner.agent.get('/api/grants?pageSize=100');
    expect(rows.length - 1).toBe(list.body.total);
    expect(rows.some((r) => r[0] === 'Multi\nline title')).toBe(true);
  });

  it('is available to a viewer', async () => {
    const response = await viewer.agent.get('/api/grants/export.csv');
    expect(response.status).toBe(200);
  });
});

describe('report exports', () => {
  it('exports the portfolio summary', async () => {
    const response = await owner.agent.get('/api/reports/portfolio.csv');
    expect(response.status).toBe(200);
    expect(response.headers['content-disposition']).toContain('riverbend-portfolio-summary-');
  });

  it('exports the funder report schedule matching the JSON report', async () => {
    const json = await owner.agent.get('/api/reports/portfolio');
    const csv = await owner.agent.get('/api/reports/report-schedule.csv');
    const rows = parseCsv(csv.text);

    expect(rows[0]).toEqual([
      'Grant',
      'Funder',
      'Deliverable',
      'Type',
      'Due date',
      'Status',
      'Owner',
      'Evidence attached',
      'Evidence required',
      'Evidence gap',
    ]);
    expect(rows.length - 1).toBe(json.body.reportSchedule.length);
  });

  it('exports a grant reporting packet', async () => {
    const grantId = (
      context.db.prepare("SELECT id FROM grants WHERE title = 'Family Stability Navigators'").get() as { id: string }
    ).id;
    const response = await owner.agent.get(`/api/grants/${grantId}/packet.csv`);
    expect(response.status).toBe(200);
    expect(response.headers['content-disposition']).toContain('reporting-packet-family-stability-navigators');

    const rows = parseCsv(response.text);
    expect(rows[0]).toEqual(['Section', 'Item', 'Detail', 'Value']);
    expect(rows.some((r) => r[0] === 'Budget' && r[1] === 'Total planned')).toBe(true);
    expect(rows.some((r) => r[0] === 'Deliverable')).toBe(true);
    expect(rows.some((r) => r[0] === 'Risk')).toBe(true);
  });
});

describe('reporting packet payload', () => {
  it('matches the grant record and lists evidence per deliverable', async () => {
    const grantId = (
      context.db.prepare("SELECT id FROM grants WHERE title = 'Family Stability Navigators'").get() as { id: string }
    ).id;

    const packet = await owner.agent.get(`/api/grants/${grantId}/packet`);
    const grant = await owner.agent.get(`/api/grants/${grantId}`);

    expect(packet.status).toBe(200);
    expect(packet.body.grant.title).toBe('Family Stability Navigators');
    expect(packet.body.budgetTotals.plannedCents).toBe(grant.body.budget.plannedCents);
    expect(packet.body.organization.name).toBe('Riverbend Community Alliance');
    expect(packet.body.evidenceChecklist.length).toBe(grant.body.milestones.length);
    expect(packet.body.openRisks.every((r: { severity: string }) => r.severity !== 'GOOD')).toBe(true);

    const withEvidence = packet.body.evidenceChecklist.find(
      (item: { documents: unknown[] }) => item.documents.length > 0,
    );
    expect(withEvidence).toBeDefined();
    expect(withEvidence.documents[0].uploadedBy).toBeTruthy();
  });
});

describe('dashboard figures come from persisted records', () => {
  it('recomputes totals after a budget change', async () => {
    const grantId = (
      context.db.prepare("SELECT id FROM grants WHERE title = 'Youth Workforce Bridge'").get() as { id: string }
    ).id;

    const before = (await owner.agent.get('/api/dashboard')).body.totals.restrictedPlannedCents;
    await post(owner, `/api/grants/${grantId}/budget-lines`).send({
      category: 'New dashboard line',
      plannedCents: '10000',
      spentCents: '2500',
    });
    const after = (await owner.agent.get('/api/dashboard')).body.totals.restrictedPlannedCents;

    expect(after).toBe(before + 1_000_000);
  });

  it('derives every headline number rather than storing it', async () => {
    const dashboard = (await owner.agent.get('/api/dashboard')).body;
    const grants = (await owner.agent.get('/api/grants?pageSize=100')).body.items as Array<{
      status: string;
      awardedCents: number;
      budget: { plannedCents: number; spentCents: number };
    }>;

    const activeStatuses = new Set(['AWARDED', 'REPORTING', 'RENEWAL', 'CLOSEOUT']);
    const active = grants.filter((g) => activeStatuses.has(g.status));
    expect(dashboard.totals.activeGrantCount).toBe(active.length);
    expect(dashboard.totals.activeAwardedCents).toBe(active.reduce((sum, g) => sum + g.awardedCents, 0));
    expect(dashboard.totals.restrictedSpentCents).toBe(active.reduce((sum, g) => sum + g.budget.spentCents, 0));
    expect(dashboard.totals.restrictedRemainingCents).toBe(
      dashboard.totals.restrictedPlannedCents - dashboard.totals.restrictedSpentCents,
    );
  });

  it('always produces an attention queue whose items explain themselves', async () => {
    const dashboard = (await owner.agent.get('/api/dashboard')).body;
    expect(dashboard.attention.length).toBeGreaterThan(0);
    for (const item of dashboard.attention) {
      expect(item.headline.length).toBeGreaterThan(0);
      expect(item.reason.length).toBeGreaterThan(10);
      expect(['RISK', 'WATCH']).toContain(item.severity);
      expect(item.grantTitle).toBeTruthy();
    }
    // Risk items sort ahead of watch items.
    const severities = dashboard.attention.map((a: { severity: string }) => a.severity);
    expect(severities.indexOf('WATCH') === -1 || severities.lastIndexOf('RISK') < severities.indexOf('WATCH')).toBe(true);
  });

  it('includes overdue, due-soon and renewal examples in the seeded demo', async () => {
    const dashboard = (await owner.agent.get('/api/dashboard')).body;
    expect(dashboard.totals.overdueCount).toBeGreaterThan(0);
    expect(dashboard.totals.reportsDue30).toBeGreaterThan(0);
    expect(dashboard.totals.renewalsDue90).toBeGreaterThan(0);
    expect(dashboard.totals.atRiskCount).toBeGreaterThan(0);
    expect(dashboard.totals.onTrackCount).toBeGreaterThan(0);
    expect(dashboard.upcoming.length).toBeGreaterThan(0);
    expect(dashboard.activity.length).toBeGreaterThan(0);
  });
});
