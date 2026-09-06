import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

import { config } from '../config';
import { COLUMN_MIGRATIONS, SCHEMA_SQL, SCHEMA_VERSION } from './schema';

export type Db = Database.Database;

let instance: Db | null = null;

export function ensureDataDirs(dataDir = config.dataDir, uploadsDir = config.uploadsDir): void {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(uploadsDir, { recursive: true });
}

function hasColumn(db: Db, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

export function migrate(db: Db): void {
  db.exec(SCHEMA_SQL);
  // Columns added after a table was first created. Each ALTER is skipped when
  // the column already exists, so this is safe to run on every boot.
  for (const migration of COLUMN_MIGRATIONS) {
    if (!hasColumn(db, migration.table, migration.column)) {
      db.exec(`ALTER TABLE ${migration.table} ADD COLUMN ${migration.column} ${migration.ddl}`);
    }
  }
  db.prepare('INSERT INTO schema_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    'schema_version',
    String(SCHEMA_VERSION),
  );
}

export function openDatabase(file: string = config.databaseFile): Db {
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

/** Process-wide handle used by the running server. */
export function getDb(): Db {
  if (!instance) {
    ensureDataDirs();
    instance = openDatabase();
  }
  return instance;
}

/** Used by tests to point the process handle at an isolated database. */
export function setDb(db: Db): void {
  instance = db;
}

export function closeDb(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}
