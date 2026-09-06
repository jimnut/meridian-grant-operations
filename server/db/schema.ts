/**
 * Schema definition.
 *
 * Every tenant-owned table carries `org_id` and is indexed on it. Application
 * queries always filter by the org resolved from the session — the column is
 * never taken from client input.
 */

export const SCHEMA_VERSION = 2;

export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  title         TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1,
  last_sign_in_at TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS organizations (
  id                      TEXT PRIMARY KEY,
  name                    TEXT NOT NULL,
  slug                    TEXT NOT NULL UNIQUE,
  timezone                TEXT NOT NULL DEFAULT 'America/Los_Angeles',
  currency                TEXT NOT NULL DEFAULT 'USD',
  fiscal_year_start_month INTEGER NOT NULL DEFAULT 1,
  plan                    TEXT NOT NULL DEFAULT 'trial',
  subscription_status     TEXT NOT NULL DEFAULT 'trialing',
  trial_ends_at           TEXT,
  plan_valid_until        TEXT,
  stripe_customer_id      TEXT,
  stripe_subscription_id  TEXT,
  billing_email           TEXT,
  is_demo                 INTEGER NOT NULL DEFAULT 0,
  calendar_token          TEXT,
  onboarding_dismissed_at TEXT,
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id     TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('OWNER','MANAGER','MEMBER','VIEWER')),
  created_at TEXT NOT NULL,
  UNIQUE (user_id, org_id)
);
CREATE INDEX IF NOT EXISTS idx_memberships_org ON memberships(org_id);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id     TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS funders (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL,
  focus_areas TEXT NOT NULL DEFAULT '',
  website     TEXT,
  notes       TEXT,
  archived    INTEGER NOT NULL DEFAULT 0,
  is_sample   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_funders_org ON funders(org_id);

CREATE TABLE IF NOT EXISTS funder_contacts (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  funder_id  TEXT NOT NULL REFERENCES funders(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  title      TEXT,
  email      TEXT,
  phone      TEXT,
  notes      TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contacts_funder ON funder_contacts(funder_id);
CREATE INDEX IF NOT EXISTS idx_contacts_org ON funder_contacts(org_id);

CREATE TABLE IF NOT EXISTS grants (
  id               TEXT PRIMARY KEY,
  org_id           TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  funder_id        TEXT NOT NULL REFERENCES funders(id) ON DELETE RESTRICT,
  owner_user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  title            TEXT NOT NULL,
  program          TEXT,
  status           TEXT NOT NULL,
  requested_cents  INTEGER NOT NULL DEFAULT 0,
  awarded_cents    INTEGER NOT NULL DEFAULT 0,
  currency         TEXT NOT NULL DEFAULT 'USD',
  probability      INTEGER,
  purpose          TEXT,
  requirements     TEXT,
  next_action      TEXT,
  notes            TEXT,
  application_date TEXT,
  decision_date    TEXT,
  start_date       TEXT,
  end_date         TEXT,
  renewal_date     TEXT,
  closeout_date    TEXT,
  archived         INTEGER NOT NULL DEFAULT 0,
  is_sample        INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_grants_org ON grants(org_id);
CREATE INDEX IF NOT EXISTS idx_grants_org_status ON grants(org_id, status);
CREATE INDEX IF NOT EXISTS idx_grants_funder ON grants(funder_id);
CREATE INDEX IF NOT EXISTS idx_grants_owner ON grants(owner_user_id);

CREATE TABLE IF NOT EXISTS tasks (
  id               TEXT PRIMARY KEY,
  org_id           TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  grant_id         TEXT NOT NULL REFERENCES grants(id) ON DELETE CASCADE,
  assignee_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  title            TEXT NOT NULL,
  description      TEXT,
  status           TEXT NOT NULL DEFAULT 'TODO',
  priority         TEXT NOT NULL DEFAULT 'MEDIUM',
  due_date         TEXT,
  completed_at     TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_grant ON tasks(grant_id);
CREATE INDEX IF NOT EXISTS idx_tasks_org_status ON tasks(org_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_user_id);

CREATE TABLE IF NOT EXISTS milestones (
  id                      TEXT PRIMARY KEY,
  org_id                  TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  grant_id                TEXT NOT NULL REFERENCES grants(id) ON DELETE CASCADE,
  type                    TEXT NOT NULL,
  title                   TEXT NOT NULL,
  due_date                TEXT,
  status                  TEXT NOT NULL DEFAULT 'NOT_STARTED',
  submitted_at            TEXT,
  completed_at            TEXT,
  required_evidence_count INTEGER NOT NULL DEFAULT 0,
  notes                   TEXT,
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_milestones_grant ON milestones(grant_id);
CREATE INDEX IF NOT EXISTS idx_milestones_org_due ON milestones(org_id, due_date);

CREATE TABLE IF NOT EXISTS budget_lines (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  grant_id      TEXT NOT NULL REFERENCES grants(id) ON DELETE CASCADE,
  category      TEXT NOT NULL,
  description   TEXT,
  planned_cents INTEGER NOT NULL DEFAULT 0,
  spent_cents   INTEGER NOT NULL DEFAULT 0,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_budget_grant ON budget_lines(grant_id);
CREATE INDEX IF NOT EXISTS idx_budget_org ON budget_lines(org_id);

CREATE TABLE IF NOT EXISTS documents (
  id                 TEXT PRIMARY KEY,
  org_id             TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  grant_id           TEXT NOT NULL REFERENCES grants(id) ON DELETE CASCADE,
  milestone_id       TEXT REFERENCES milestones(id) ON DELETE SET NULL,
  uploaded_by        TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  original_name      TEXT NOT NULL,
  storage_key        TEXT NOT NULL UNIQUE,
  doc_type           TEXT NOT NULL DEFAULT 'OTHER',
  mime_type          TEXT NOT NULL,
  size_bytes         INTEGER NOT NULL,
  created_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_grant ON documents(grant_id);
CREATE INDEX IF NOT EXISTS idx_documents_milestone ON documents(milestone_id);
CREATE INDEX IF NOT EXISTS idx_documents_org ON documents(org_id);

CREATE TABLE IF NOT EXISTS comments (
  id             TEXT PRIMARY KEY,
  org_id         TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  grant_id       TEXT NOT NULL REFERENCES grants(id) ON DELETE CASCADE,
  author_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  body           TEXT NOT NULL,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_grant ON comments(grant_id);

CREATE TABLE IF NOT EXISTS activities (
  id             TEXT PRIMARY KEY,
  org_id         TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
  entity_type    TEXT NOT NULL,
  entity_id      TEXT,
  grant_id       TEXT REFERENCES grants(id) ON DELETE CASCADE,
  action         TEXT NOT NULL,
  summary        TEXT NOT NULL,
  metadata       TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activities_org_created ON activities(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activities_grant ON activities(grant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS invites (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email        TEXT,
  role         TEXT NOT NULL CHECK (role IN ('OWNER','MANAGER','MEMBER','VIEWER')),
  token_hash   TEXT NOT NULL UNIQUE,
  created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  expires_at   TEXT NOT NULL,
  accepted_at  TEXT,
  accepted_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  revoked_at   TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invites_org ON invites(org_id);

CREATE TABLE IF NOT EXISTS password_resets (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);

CREATE TABLE IF NOT EXISTS leads (
  id           TEXT PRIMARY KEY,
  email        TEXT NOT NULL,
  name         TEXT,
  organization TEXT,
  message      TEXT,
  source       TEXT NOT NULL DEFAULT 'contact',
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS billing_events (
  id           TEXT PRIMARY KEY,
  org_id       TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  stripe_event_id TEXT UNIQUE,
  type         TEXT NOT NULL,
  summary      TEXT NOT NULL,
  payload      TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_billing_events_org ON billing_events(org_id);

CREATE TABLE IF NOT EXISTS notification_log (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  period_key TEXT NOT NULL,
  sent_to    TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (org_id, kind, period_key)
);
`;

/**
 * Additive column migrations for databases created before a column existed.
 * `CREATE TABLE IF NOT EXISTS` never alters an existing table, so each entry is
 * applied idempotently by inspecting `PRAGMA table_info` at startup.
 */
export const COLUMN_MIGRATIONS: ReadonlyArray<{ table: string; column: string; ddl: string }> = [
  { table: 'users', column: 'last_sign_in_at', ddl: 'TEXT' },
  { table: 'organizations', column: 'plan', ddl: "TEXT NOT NULL DEFAULT 'trial'" },
  { table: 'organizations', column: 'subscription_status', ddl: "TEXT NOT NULL DEFAULT 'trialing'" },
  { table: 'organizations', column: 'trial_ends_at', ddl: 'TEXT' },
  { table: 'organizations', column: 'plan_valid_until', ddl: 'TEXT' },
  { table: 'organizations', column: 'stripe_customer_id', ddl: 'TEXT' },
  { table: 'organizations', column: 'stripe_subscription_id', ddl: 'TEXT' },
  { table: 'organizations', column: 'billing_email', ddl: 'TEXT' },
  { table: 'organizations', column: 'is_demo', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'organizations', column: 'calendar_token', ddl: 'TEXT' },
  { table: 'organizations', column: 'onboarding_dismissed_at', ddl: 'TEXT' },
  { table: 'funders', column: 'is_sample', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'grants', column: 'is_sample', ddl: 'INTEGER NOT NULL DEFAULT 0' },
];
