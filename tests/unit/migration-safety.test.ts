import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate, type Db } from '../../server/db/connection';
import { SCHEMA_VERSION } from '../../server/db/schema';
import { seedDemoData } from '../../server/db/seed';

let db: Db;
let uploadsDir: string;
beforeEach(() => {
  db = new Database(':memory:');
  db.exec(fs.readFileSync(path.resolve('tests/fixtures/schema-v2.sql'), 'utf8'));
  uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grantconsole-migration-'));
  // Synthetic pre-release customer records, including old lead and billing rows.
  db.exec(`
    INSERT INTO schema_meta VALUES ('schema_version','2');
    INSERT INTO users (id,name,email,password_hash,created_at) VALUES ('customer_user','Synthetic owner','owner@example.org','existing-hash','2026-08-01');
    INSERT INTO organizations (id,name,slug,plan,subscription_status,is_demo,stripe_customer_id,created_at,updated_at)
      VALUES ('customer_org','Synthetic customer','synthetic-customer','growth','active',0,'cus_synthetic_existing','2026-08-01','2026-08-02');
    INSERT INTO memberships (id,user_id,org_id,role,created_at) VALUES ('customer_member','customer_user','customer_org','OWNER','2026-08-01');
    INSERT INTO sessions (id,user_id,org_id,csrf_token,created_at,expires_at) VALUES ('synthetic_session','customer_user','customer_org','synthetic-token','2026-08-01','2026-12-31');
    INSERT INTO funders (id,org_id,name,type,created_at,updated_at) VALUES ('customer_funder','customer_org','Synthetic funder','OTHER','2026-08-01','2026-08-02');
    INSERT INTO grants (id,org_id,funder_id,owner_user_id,title,status,awarded_cents,created_at,updated_at)
      VALUES ('customer_grant','customer_org','customer_funder','customer_user','Synthetic existing award','REPORTING',123456,'2026-08-01','2026-08-02');
    INSERT INTO milestones (id,org_id,grant_id,type,title,due_date,created_at,updated_at)
      VALUES ('customer_report','customer_org','customer_grant','REPORT','Synthetic obligation','2026-11-01','2026-08-01','2026-08-02');
    INSERT INTO documents (id,org_id,grant_id,uploaded_by,original_name,storage_key,mime_type,size_bytes,created_at)
      VALUES ('customer_doc','customer_org','customer_grant','customer_user','Synthetic evidence.txt','customer_org/evidence.txt','text/plain',8,'2026-08-01');
    INSERT INTO leads (id,email,name,organization,message,source,created_at)
      VALUES ('old_lead','lead@example.org','Synthetic inquiry','Synthetic org','Existing request','contact','2026-08-01');
    INSERT INTO billing_events (id,org_id,stripe_event_id,type,summary,payload,created_at)
      VALUES ('old_billing','customer_org','evt_synthetic_existing','invoice.paid','Existing paid invoice','{}','2026-08-01');
  `);
  fs.mkdirSync(path.join(uploadsDir, 'customer_org'));
  fs.writeFileSync(path.join(uploadsDir, 'customer_org/evidence.txt'), 'evidence');
});
afterEach(() => {
  db.close();
  fs.rmSync(uploadsDir, { recursive: true, force: true });
});

type Column = { name: string; type: string; notnull: number; dflt_value: string | null; pk: number };
function oldTables() {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name <> 'schema_meta' ORDER BY name").all() as Array<{ name: string }>).map(({ name }) => ({
    name,
    columns: db.prepare(`PRAGMA table_info(${name})`).all() as Column[],
    rows: db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all(),
  }));
}

describe('production-style additive migration and setup safety', () => {
  it('preserves every pre-change column definition and existing row across repeated migration and old-style writes', () => {
    const baseline = oldTables();
    migrate(db);
    migrate(db);
    for (const table of baseline) {
      const columns = db.prepare(`PRAGMA table_info(${table.name})`).all() as Column[];
      expect(columns.filter((column) => table.columns.some((old) => old.name === column.name)), table.name).toEqual(table.columns);
      expect(db.prepare(`SELECT ${table.columns.map((column) => column.name).join(',')} FROM ${table.name} ORDER BY rowid`).all(), table.name).toEqual(table.rows);
    }
    expect(db.prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'").get()).toEqual({ value: String(SCHEMA_VERSION) });
    expect(db.prepare('SELECT conversion_quality,acquisition_channel,acquisition_landing FROM organizations').get()).toEqual({ conversion_quality: 'unreviewed', acquisition_channel: 'unknown', acquisition_landing: null });
    expect(db.prepare('SELECT quality_status,quality_reason,receipt_hash FROM leads').get()).toEqual({ quality_status: 'unreviewed', quality_reason: null, receipt_hash: null });
    expect(db.prepare('SELECT COUNT(*) AS n FROM conversion_events').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM payment_facts').get()).toEqual({ n: 0 });
    // Previous release's explicit-column insert/update SQL remains compatible.
    db.prepare("INSERT INTO leads (id,email,source,created_at) VALUES ('second_old_lead','old-client@example.org','pricing','2026-08-02')").run();
    db.prepare("UPDATE organizations SET plan = 'starter', updated_at = '2026-08-03' WHERE id = 'customer_org'").run();
    expect(db.prepare("SELECT quality_status FROM leads WHERE id = 'second_old_lead'").get()).toEqual({ quality_status: 'unreviewed' });
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(fs.readFileSync(path.join(uploadsDir, 'customer_org/evidence.txt'), 'utf8')).toBe('evidence');
  });

  it('the setup seeder without force preserves customers both without and with an existing demo', async () => {
    migrate(db);
    const customer = db.prepare("SELECT * FROM organizations WHERE id = 'customer_org'").get();
    const grant = db.prepare("SELECT * FROM grants WHERE id = 'customer_grant'").get();
    const first = await seedDemoData(db, { force: false, uploadsDir, now: new Date('2026-10-18T00:00:00Z') });
    expect(first.seeded).toBe(true);
    expect(db.prepare("SELECT * FROM organizations WHERE id = 'customer_org'").get()).toEqual(customer);
    expect(db.prepare("SELECT * FROM grants WHERE id = 'customer_grant'").get()).toEqual(grant);
    const afterSeed = oldTables();
    const repeat = await seedDemoData(db, { force: false, uploadsDir, now: new Date('2026-10-19T00:00:00Z') });
    expect(repeat.seeded).toBe(false);
    expect(oldTables()).toEqual(afterSeed);
    expect(fs.readFileSync(path.join(uploadsDir, 'customer_org/evidence.txt'), 'utf8')).toBe('evidence');
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
});
