import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase, type Db } from '../../server/db/connection';
import { seedDemoData } from '../../server/db/seed';
import { DEMO_USERS as DEMO_USER_SPECS } from '../../server/db/demo-accounts';
import { ACTIVE_STATUSES, GRANT_STATUSES } from '../../shared/constants';
import { todayInTimezone } from '../../shared/dates';

const open: Array<{ db: Db; dir: string }> = [];

function fresh() {
  const db = openDatabase(':memory:');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meridian-seed-'));
  open.push({ db, dir });
  return { db, dir };
}

afterEach(() => {
  while (open.length > 0) {
    const entry = open.pop()!;
    entry.db.close();
    fs.rmSync(entry.dir, { recursive: true, force: true });
  }
});

function counts(db: Db) {
  const tables = [
    'organizations',
    'users',
    'memberships',
    'funders',
    'funder_contacts',
    'grants',
    'tasks',
    'milestones',
    'budget_lines',
    'documents',
    'comments',
    'activities',
  ];
  return Object.fromEntries(
    tables.map((table) => [table, (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c]),
  );
}

describe('seed content', () => {
  it('creates two organizations, all four roles and a realistic portfolio', async () => {
    const { db, dir } = fresh();
    const result = await seedDemoData(db, { force: true, uploadsDir: dir });

    expect(result.seeded).toBe(true);
    expect(result.organizations).toBe(2);
    expect(result.users).toBe(DEMO_USER_SPECS.length);
    expect(result.funders).toBeGreaterThanOrEqual(7);
    expect(result.grants).toBeGreaterThanOrEqual(10);
    expect(result.grants).toBeLessThanOrEqual(20);
    expect(result.documents).toBeGreaterThan(0);
    expect(result.comments).toBeGreaterThan(0);
    expect(result.activities).toBeGreaterThan(0);

    const roles = new Set(
      (db.prepare('SELECT DISTINCT role FROM memberships').all() as Array<{ role: string }>).map((r) => r.role),
    );
    expect(roles).toEqual(new Set(['OWNER', 'MANAGER', 'MEMBER', 'VIEWER']));
  });

  it('covers the whole lifecycle, including declined and closed', async () => {
    const { db, dir } = fresh();
    await seedDemoData(db, { force: true, uploadsDir: dir });

    const statuses = new Set(
      (db.prepare('SELECT DISTINCT status FROM grants').all() as Array<{ status: string }>).map((r) => r.status),
    );
    for (const status of GRANT_STATUSES) {
      expect(statuses.has(status), `missing seeded status ${status}`).toBe(true);
    }
  });

  it('gives the primary tenant several simultaneous active awards', async () => {
    const { db, dir } = fresh();
    await seedDemoData(db, { force: true, uploadsDir: dir });

    const active = (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM grants
            WHERE org_id = (SELECT id FROM organizations WHERE slug = 'riverbend')
              AND status IN (${ACTIVE_STATUSES.map(() => '?').join(',')})`,
        )
        .get(...ACTIVE_STATUSES) as { c: number }
    ).c;
    expect(active).toBeGreaterThanOrEqual(5);
  });

  it('writes real evidence files that match the recorded byte size', async () => {
    const { db, dir } = fresh();
    await seedDemoData(db, { force: true, uploadsDir: dir });

    const documents = db.prepare('SELECT storage_key AS key, size_bytes AS size, original_name AS name FROM documents').all() as Array<{
      key: string;
      size: number;
      name: string;
    }>;
    expect(documents.length).toBeGreaterThan(0);

    for (const doc of documents) {
      const file = path.join(dir, doc.key);
      expect(fs.existsSync(file), `missing ${doc.key}`).toBe(true);
      expect(fs.statSync(file).size).toBe(doc.size);

      const head = fs.readFileSync(file).subarray(0, 4).toString('latin1');
      if (doc.name.endsWith('.pdf')) expect(head).toBe('%PDF');
      if (doc.name.endsWith('.xlsx')) expect(head.slice(0, 2)).toBe('PK');
    }
  });

  it('anchors deadlines to the seed date so the dashboard always has live examples', async () => {
    const { db, dir } = fresh();
    const now = new Date('2026-08-10T12:00:00Z');
    await seedDemoData(db, { force: true, uploadsDir: dir, now });
    const today = todayInTimezone('America/Los_Angeles', now);

    const overdue = (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM milestones
            WHERE due_date < ? AND status NOT IN ('COMPLETE','WAIVED')`,
        )
        .get(today) as { c: number }
    ).c;
    expect(overdue).toBeGreaterThan(0);

    const dueSoon = (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM milestones
            WHERE due_date >= ? AND due_date <= date(?, '+14 day') AND status NOT IN ('COMPLETE','WAIVED')`,
        )
        .get(today, today) as { c: number }
    ).c;
    expect(dueSoon).toBeGreaterThan(0);

    const renewals = (
      db
        .prepare("SELECT COUNT(*) AS c FROM grants WHERE renewal_date >= ? AND renewal_date <= date(?, '+90 day')")
        .get(today, today) as { c: number }
    ).c;
    expect(renewals).toBeGreaterThan(0);
  });

  it('never stores money as a fractional value', async () => {
    const { db, dir } = fresh();
    await seedDemoData(db, { force: true, uploadsDir: dir });

    const rows = db.prepare('SELECT requested_cents AS r, awarded_cents AS a FROM grants').all() as Array<{
      r: number;
      a: number;
    }>;
    for (const row of rows) {
      expect(Number.isInteger(row.r)).toBe(true);
      expect(Number.isInteger(row.a)).toBe(true);
    }

    const lines = db.prepare('SELECT planned_cents AS p, spent_cents AS s FROM budget_lines').all() as Array<{
      p: number;
      s: number;
    }>;
    for (const line of lines) {
      expect(Number.isInteger(line.p)).toBe(true);
      expect(Number.isInteger(line.s)).toBe(true);
    }
  });
});

describe('seed idempotency', () => {
  it('does nothing when data already exists', async () => {
    const { db, dir } = fresh();
    const first = await seedDemoData(db, { force: true, uploadsDir: dir });
    const second = await seedDemoData(db, { uploadsDir: dir });

    expect(first.seeded).toBe(true);
    expect(second.seeded).toBe(false);
    expect(second.grants).toBe(first.grants);
    expect(second.documents).toBe(first.documents);
  });

  it('re-running with force updates the same rows instead of duplicating them', async () => {
    const { db, dir } = fresh();
    const now = new Date('2026-08-10T12:00:00Z');

    await seedDemoData(db, { force: true, uploadsDir: dir, now });
    const firstCounts = counts(db);
    const firstIds = (db.prepare('SELECT id FROM grants ORDER BY id').all() as Array<{ id: string }>).map((r) => r.id);

    await seedDemoData(db, { force: true, uploadsDir: dir, now });
    const secondCounts = counts(db);
    const secondIds = (db.prepare('SELECT id FROM grants ORDER BY id').all() as Array<{ id: string }>).map((r) => r.id);

    expect(secondCounts).toEqual(firstCounts);
    expect(secondIds).toEqual(firstIds);
  });

  it('produces identical ids in two independent databases', async () => {
    const a = fresh();
    const b = fresh();
    const now = new Date('2026-08-10T12:00:00Z');

    await seedDemoData(a.db, { force: true, uploadsDir: a.dir, now });
    await seedDemoData(b.db, { force: true, uploadsDir: b.dir, now });

    const idsOf = (db: Db, table: string) =>
      (db.prepare(`SELECT id FROM ${table} ORDER BY id`).all() as Array<{ id: string }>).map((r) => r.id);

    for (const table of ['organizations', 'users', 'funders', 'grants', 'tasks', 'milestones', 'budget_lines']) {
      expect(idsOf(a.db, table), table).toEqual(idsOf(b.db, table));
    }
  });

  it('keeps sign-in working after a forced reseed', async () => {
    const { db, dir } = fresh();
    await seedDemoData(db, { force: true, uploadsDir: dir });
    await seedDemoData(db, { force: true, uploadsDir: dir });

    const user = db.prepare('SELECT password_hash AS hash FROM users WHERE email = ?').get(DEMO_USER_SPECS[0]!.email) as {
      hash: string;
    };
    expect(user.hash.startsWith('$2')).toBe(true);
  });
});
